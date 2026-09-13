use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;

/// Build a `Command` that will not flash a console window on Windows.
/// On other platforms it's equivalent to `Command::new`.
///
/// Without CREATE_NO_WINDOW (0x08000000), every child we spawn from our
/// windows-subsystem binary (python.exe, powershell.exe, reg.exe) briefly
/// shows a black console — especially noticeable at auto-startup when
/// several children launch back-to-back.
fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new(program);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }
    #[cfg(not(windows))]
    {
        Command::new(program)
    }
}

/// Assign `child` to a Windows Job Object with KILL_ON_JOB_CLOSE so the
/// child dies automatically if the Tauri parent exits abruptly (Ctrl+C,
/// crash, taskkill). Without this, a killed dev-loop leaves an orphaned
/// python.exe holding port 9876 and the next `tauri dev` fails to bind.
///
/// The job handle is intentionally leaked via `mem::forget`: the OS
/// closes it when our process dies, which is exactly the trigger that
/// fires KILL_ON_JOB_CLOSE. Calling CloseHandle ourselves would defeat
/// the mechanism. We only ever run one engine child at a time, so a
/// single leaked handle per process lifetime is fine.
#[cfg(windows)]
fn bind_child_to_job(child: &Child) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err("CreateJobObjectW returned NULL".into());
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let ok = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if ok == 0 {
            CloseHandle(job);
            return Err("SetInformationJobObject failed".into());
        }

        let ok = AssignProcessToJobObject(job, child.as_raw_handle() as _);
        if ok == 0 {
            CloseHandle(job);
            return Err("AssignProcessToJobObject failed".into());
        }

        // Deliberately do NOT CloseHandle(job). We want the handle to
        // live for the lifetime of this process so the OS closes it on
        // exit — that's what triggers KILL_ON_JOB_CLOSE.
        let _ = job;
    }
    Ok(())
}

/// Holds the Python engine child process
struct EngineProcess(Mutex<Option<Child>>);

/// Platform-specific config.json path.
fn config_json_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    let base = {
        let appdata = std::env::var("APPDATA").ok()?;
        std::path::PathBuf::from(appdata).join("X-Whisper")
    };
    #[cfg(target_os = "macos")]
    let base = {
        let home = std::env::var("HOME").ok()?;
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("X-Whisper")
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = {
        let home = std::env::var("HOME").ok()?;
        std::path::PathBuf::from(home).join(".config").join("x-whisper")
    };
    Some(base.join("config.json"))
}

/// Check if onboarding has been completed by reading config.json
fn check_onboarding_needed() -> bool {
    let config_path = match config_json_path() {
        Some(p) => p,
        None => return true,
    };

    if !config_path.exists() {
        return true; // No config file = first run
    }

    match std::fs::read_to_string(&config_path) {
        Ok(content) => {
            // Simple JSON parse — look for "onboarding_completed": true
            !content.contains("\"onboarding_completed\": true")
                && !content.contains("\"onboarding_completed\":true")
        }
        Err(_) => true,
    }
}

/// Compute 50% width × 60% height of the primary monitor, in logical pixels.
/// Falls back to 1000×760 if the monitor probe fails.
fn preferred_settings_size(app: &tauri::AppHandle) -> (f64, f64) {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let size = m.size();
            let logical_w = (size.width as f64) / scale;
            let logical_h = (size.height as f64) / scale;
            (logical_w * 0.5, logical_h * 0.6)
        })
        .unwrap_or((1000.0, 760.0))
}

/// Open the settings window (or focus it if already open).
/// Always re-applies the preferred size + recenters so every entry point
/// (tray menu, island button) lands at the same monitor-relative size.
fn open_settings_window(app: &tauri::AppHandle) {
    let (width, height) = preferred_settings_size(app);

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.center();
        let _ = window.set_focus();
        let _ = window.show();
        return;
    }

    let _settings_window = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?window=settings".into()),
    )
    .title("X-Whisper Settings")
    .inner_size(width, height)
    .min_inner_size(820.0, 600.0)
    .resizable(true)
    .center()
    .decorations(true)
    .visible(true)
    .build();
}

/// Compute the transcribe window size — a bit wider than settings so
/// the DropZone + transcript side-by-side can breathe.
fn preferred_transcribe_size(app: &tauri::AppHandle) -> (f64, f64) {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let size = m.size();
            let logical_w = (size.width as f64) / scale;
            let logical_h = (size.height as f64) / scale;
            (logical_w * 0.55, logical_h * 0.7)
        })
        .unwrap_or((1080.0, 800.0))
}

/// Open the transcribe-file window (or focus it if already open).
fn open_transcribe_window_handle(app: &tauri::AppHandle) {
    let (width, height) = preferred_transcribe_size(app);

    if let Some(window) = app.get_webview_window("transcribe") {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.center();
        let _ = window.set_focus();
        let _ = window.show();
        return;
    }

    let _ = WebviewWindowBuilder::new(
        app,
        "transcribe",
        WebviewUrl::App("index.html?window=transcribe".into()),
    )
    .title("X-Whisper — Transcribe File")
    .inner_size(width, height)
    .min_inner_size(860.0, 560.0)
    .resizable(true)
    .center()
    .decorations(true)
    .visible(true)
    .build();
}

/// JS-facing wrapper for the transcribe window. Used by tray menu /
/// island button / settings link so every entry point lands at the
/// same monitor-relative size.
#[tauri::command]
async fn open_transcribe_window(app: tauri::AppHandle) -> Result<(), String> {
    open_transcribe_window_handle(&app);
    Ok(())
}

/// Save a UTF-8 text file to an absolute path chosen by the user via
/// the dialog plugin. Phase 19 uses this to export .txt / .srt from
/// the transcribe window — plugin-fs would need a scope declaration
/// per path, which doesn't fit a free-form save dialog.
#[tauri::command]
async fn save_text_file(path: String, contents: String) -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
        }
    }
    fs::write(target, contents.as_bytes()).map_err(|e| format!("write failed: {}", e))
}

/// Set or remove the platform "launch at startup" entry for X-Whisper.
#[tauri::command]
async fn set_launch_at_startup(enabled: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.to_string_lossy().to_string();
        let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
        let value_name = "X-Whisper";
        let output = if enabled {
            hidden_command("reg")
                .args(["add", &format!("HKCU\\{}", key_path), "/v", value_name, "/t", "REG_SZ", "/d", &exe_str, "/f"])
                .output()
                .map_err(|e| e.to_string())?
        } else {
            hidden_command("reg")
                .args(["delete", &format!("HKCU\\{}", key_path), "/v", value_name, "/f"])
                .output()
                .map_err(|e| e.to_string())?
        };
        if output.status.success() {
            println!("[X-Whisper] Launch at startup: {}", if enabled { "enabled" } else { "disabled" });
            return Ok(enabled);
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Registry operation failed: {}", stderr));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let plist_path = {
            let home = std::env::var("HOME").map_err(|e| e.to_string())?;
            std::path::PathBuf::from(home)
                .join("Library")
                .join("LaunchAgents")
                .join("com.xwhisper.agent.plist")
        };
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe.to_string_lossy();
            let plist = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.xwhisper.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>"#,
                exe = exe_str
            );
            if let Some(parent) = plist_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&plist_path, plist).map_err(|e| e.to_string())?;
            // Get current user UID for launchctl domain
            let uid_output = Command::new("id").arg("-u").output().map_err(|e| e.to_string())?;
            let uid = String::from_utf8_lossy(&uid_output.stdout).trim().to_string();
            let _ = Command::new("launchctl")
                .args(["bootstrap", &format!("gui/{}", uid), &plist_path.to_string_lossy()])
                .output();
        } else {
            if plist_path.exists() {
                let uid_output = Command::new("id").arg("-u").output().map_err(|e| e.to_string())?;
                let uid = String::from_utf8_lossy(&uid_output.stdout).trim().to_string();
                let _ = Command::new("launchctl")
                    .args(["bootout", &format!("gui/{}", uid), &plist_path.to_string_lossy()])
                    .output();
                std::fs::remove_file(&plist_path).map_err(|e| e.to_string())?;
            }
        }
        println!("[X-Whisper] Launch at startup: {}", if enabled { "enabled" } else { "disabled" });
        return Ok(enabled);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = enabled;
        Err("Launch at startup not supported on this platform".to_string())
    }
}

/// Check whether the "launch at startup" entry exists.
#[tauri::command]
async fn get_launch_at_startup() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let key_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
        let value_name = "X-Whisper";
        let output = hidden_command("reg")
            .args(["query", &format!("HKCU\\{}", key_path), "/v", value_name])
            .output()
            .map_err(|e| e.to_string())?;
        return Ok(output.status.success());
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let plist_path = std::path::PathBuf::from(home)
            .join("Library")
            .join("LaunchAgents")
            .join("com.xwhisper.agent.plist");
        return Ok(plist_path.exists());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Ok(false)
}

/// Open the settings window from JS. Thin wrapper around `open_settings_window`
/// so every entry point (tray menu, island button, future shortcuts) goes
/// through the same sizing logic.
#[tauri::command]
async fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_window(&app);
    Ok(())
}

/// Write text to clipboard and simulate a paste keystroke.
/// On Windows: PowerShell Set-Clipboard + enigo Ctrl+V.
/// On macOS: pbcopy stdin + osascript Cmd+V (requires Accessibility permission on first use).
#[tauri::command]
async fn paste_text(text: String) -> Result<String, String> {
    match clipboard_write(&text) {
        Ok(_) => {}
        Err(e) => return Err(format!("Clipboard write failed: {}", e)),
    }

    std::thread::sleep(std::time::Duration::from_millis(50));

    #[cfg(target_os = "windows")]
    {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to keystroke \"v\" using command down"])
            .status()
            .map_err(|e| format!("osascript failed: {}", e))?;
        if !status.success() {
            return Err("osascript keystroke failed — check Accessibility permission".to_string());
        }
    }

    Ok("Pasted successfully".to_string())
}

/// Get engine process status
#[tauri::command]
fn engine_status(state: tauri::State<'_, EngineProcess>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    match &*guard {
        Some(child) => Ok(format!("running (pid: {})", child.id())),
        None => Ok("stopped".to_string()),
    }
}

/// Restart the Python engine process
#[tauri::command]
fn restart_engine(state: tauri::State<'_, EngineProcess>, app: tauri::AppHandle) -> Result<String, String> {
    // Kill existing
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // Start new
    let engine_dir = resolve_engine_dir(&app);
    match spawn_engine(&engine_dir) {
        Ok(child) => {
            let pid = child.id();
            let mut guard = state.0.lock().map_err(|e| e.to_string())?;
            *guard = Some(child);
            Ok(format!("Engine restarted (pid: {})", pid))
        }
        Err(e) => Err(format!("Failed to restart engine: {}", e)),
    }
}

/// Atomically resize and (re)position the island window.
///
/// Tauri's JS API exposes `setSize` and `setPosition` as two separate
/// async calls. For the island that must stay anchored on a fixed
/// centre while the pill grows / shrinks, doing them in sequence
/// leaves the window in an inconsistent state for one render frame —
/// long enough for AppKit to fire transient mouseExited events and
/// flip the React hover state. We side-step that on macOS by going
/// straight to AppKit's `NSWindow setFrame:display:animate:` which is
/// a single, atomic operation.
///
/// `center_x` is the desired horizontal centre and `top` the desired top
/// edge of the window, both in logical screen points measured from the
/// top-left of the primary screen. Anchoring on the top edge means a
/// state change grows the pill downward from a fixed spot, Dynamic
/// Island style. When `None`, defaults to horizontally centred and
/// pinned to the top of the screen — the placement before the user has
/// dragged.
#[tauri::command]
fn set_island_frame(
    window: tauri::WebviewWindow,
    width: f64,
    height: f64,
    center_x: Option<f64>,
    top: Option<f64>,
) -> Result<(), String> {
    const TOP_OFFSET_PTS: f64 = 4.0;

    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::base::id;
        use cocoa::foundation::{NSPoint, NSRect, NSSize};
        use objc::{msg_send, sel, sel_impl};

        let ns_window = window.ns_window().map_err(|e| e.to_string())? as id;
        let screen: id = msg_send![ns_window, screen];
        if screen.is_null() {
            return Err("no screen for island window".into());
        }
        let screen_frame: NSRect = msg_send![screen, frame];
        // `visibleFrame` excludes the menu bar (and notch area on
        // recent MacBooks) — the default island position must sit
        // below it or the top of the pill is clipped.
        let visible_frame: NSRect = msg_send![screen, visibleFrame];
        let visible_top_y = visible_frame.origin.y + visible_frame.size.height;
        let cx = center_x.unwrap_or(screen_frame.size.width / 2.0);
        let x = cx - width / 2.0;
        // Cocoa screen coords have their origin at the bottom-left.
        // `top` (from the user / localStorage) is measured from the top
        // of the SCREEN, so the same conversion works whether the user
        // dragged into the menu-bar area or below it.
        let y = match top {
            Some(top_from_top) => screen_frame.size.height - top_from_top - height,
            None => visible_top_y - height - TOP_OFFSET_PTS,
        };
        let new_frame = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));
        let _: () = msg_send![ns_window, setFrame: new_frame display: true animate: false];
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{LogicalPosition, LogicalSize, Position, Size};
        window
            .set_size(Size::Logical(LogicalSize::new(width, height)))
            .map_err(|e| e.to_string())?;
        if let Ok(Some(monitor)) = window.primary_monitor() {
            let scale = monitor.scale_factor();
            let monitor_logical_width = monitor.size().width as f64 / scale;
            let cx = center_x.unwrap_or(monitor_logical_width / 2.0);
            let x = (cx - width / 2.0).round();
            let y = top.map(|t| t.round()).unwrap_or(TOP_OFFSET_PTS);
            window
                .set_position(Position::Logical(LogicalPosition::new(x, y)))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

/// Show or hide the island window *without* activating it. The frontend
/// drives this from the "Dynamic Island" visibility setting — in
/// "while speaking" mode the pill appears the moment recording starts,
/// and a plain `window.show()` would steal keyboard focus from whatever
/// app the user is dictating into, so the auto-paste lands in the wrong
/// place. The webview keeps running while hidden, so the hotkey, WS
/// connection and paste hooks that live in the island keep working.
#[tauri::command]
fn set_island_visible(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
        };
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        unsafe {
            ShowWindow(
                hwnd as windows_sys::Win32::Foundation::HWND,
                if visible { SW_SHOWNOACTIVATE } else { SW_HIDE },
            );
        }
        Ok(())
    }

    #[cfg(target_os = "macos")]
    unsafe {
        use cocoa::base::{id, nil};
        use objc::{msg_send, sel, sel_impl};
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as id;
        if visible {
            let _: () = msg_send![ns_window, orderFrontRegardless];
        } else {
            let _: () = msg_send![ns_window, orderOut: nil];
        }
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if visible { window.show() } else { window.hide() }.map_err(|e| e.to_string())
    }
}

/// Write text to the system clipboard.
fn clipboard_write(text: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = hidden_command("powershell")
            .args(["-Command", &format!("Set-Clipboard -Value '{}'", text.replace("'", "''"))])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("PowerShell clipboard command failed".to_string());
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let mut child = Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("pbcopy spawn failed: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes())
                .map_err(|e| format!("pbcopy write failed: {}", e))?;
        }
        child.wait().map_err(|e| format!("pbcopy wait failed: {}", e))?;
    }
    Ok(())
}

/// Resolve the Python engine directory.
///
/// Probes a set of candidate locations so the same binary works from:
///   - `cargo run` under `src-tauri/` (current_dir = src-tauri/)
///   - `cargo run` under `src-tauri/target/debug/` (current_dir = .../target/debug)
///   - Running the packaged app (resource_dir/python-engine)
///   - Running from project root in dev
///
/// The "engine dir" is the directory that contains `main.py`.
fn resolve_engine_dir(app: &tauri::AppHandle) -> String {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // Tauri resource dir (production bundle). In dev, resources with
    // a `../` prefix land under a `_up_` sibling to preserve structure.
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("python-engine"));
        candidates.push(res.join("_up_").join("python-engine"));
        candidates.push(res.join("resources").join("python-engine"));
        candidates.push(res.join("resources").join("_up_").join("python-engine"));
    }

    // Walk up from the executable path — handles target/debug in dev
    if let Ok(exe) = std::env::current_exe() {
        let mut ancestor = exe.parent();
        for _ in 0..5 {
            if let Some(dir) = ancestor {
                candidates.push(dir.join("python-engine"));
                ancestor = dir.parent();
            } else {
                break;
            }
        }
    }

    // Walk up from the current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let mut ancestor: Option<&std::path::Path> = Some(cwd.as_path());
        for _ in 0..5 {
            if let Some(dir) = ancestor {
                candidates.push(dir.join("python-engine"));
                ancestor = dir.parent();
            } else {
                break;
            }
        }
    }

    for c in &candidates {
        if c.join("main.py").exists() {
            println!("[X-Whisper] Engine dir resolved to: {}", c.display());
            return c.to_string_lossy().to_string();
        }
    }

    eprintln!(
        "[X-Whisper] Could not locate python-engine. Tried: {:?}",
        candidates
    );
    "python-engine".to_string()
}

/// Path to the managed Python runtime executable.
fn managed_python_path() -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    let result = {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        std::path::PathBuf::from(appdata)
            .join("X-Whisper").join("runtime").join("python").join("python.exe")
    };
    #[cfg(target_os = "macos")]
    let result = {
        let home = std::env::var("HOME").unwrap_or_default();
        std::path::PathBuf::from(home)
            .join("Library").join("Application Support")
            .join("X-Whisper").join("runtime").join("python").join("bin").join("python3.12")
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = {
        let home = std::env::var("HOME").unwrap_or_default();
        std::path::PathBuf::from(home)
            .join(".config").join("x-whisper")
            .join("runtime").join("python").join("bin").join("python3.12")
    };
    result
}

/// Run the platform bootstrap script to download + prepare the managed Python runtime.
/// Blocking — called before spawn_engine when the managed runtime is absent.
fn bootstrap_managed_runtime(engine_dir: &str) -> Result<(), String> {
    let requirements = std::path::Path::new(engine_dir).join("requirements.txt");
    // Windows exe is <runtime_dir>/python.exe (one parent up).
    // macOS/Linux exe is <runtime_dir>/bin/python3.12 (two parents up).
    #[cfg(target_os = "windows")]
    let runtime_dir = managed_python_path()
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not resolve runtime directory".to_string())?;
    #[cfg(not(target_os = "windows"))]
    let runtime_dir = managed_python_path()
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Could not resolve runtime directory".to_string())?;

    println!("[X-Whisper] Bootstrapping managed Python runtime (first launch)...");

    #[cfg(target_os = "windows")]
    let status = {
        let bootstrap = std::path::Path::new(engine_dir).join("bootstrap.ps1");
        if !bootstrap.exists() {
            return Err(format!("bootstrap.ps1 not found at {}", bootstrap.display()));
        }
        hidden_command("powershell")
            .args([
                "-ExecutionPolicy", "Bypass",
                "-File", &bootstrap.to_string_lossy(),
                "-RuntimeDir", &runtime_dir.to_string_lossy(),
                "-RequirementsFile", &requirements.to_string_lossy(),
            ])
            .status()
            .map_err(|e| format!("Failed to launch bootstrap.ps1: {}", e))?
    };

    #[cfg(not(target_os = "windows"))]
    let status = {
        let bootstrap = std::path::Path::new(engine_dir).join("bootstrap.sh");
        if !bootstrap.exists() {
            return Err(format!("bootstrap.sh not found at {}", bootstrap.display()));
        }
        Command::new("bash")
            .args([
                &bootstrap.to_string_lossy().to_string(),
                "-RuntimeDir", &runtime_dir.to_string_lossy(),
                "-RequirementsFile", &requirements.to_string_lossy(),
            ])
            .status()
            .map_err(|e| format!("Failed to launch bootstrap.sh: {}", e))?
    };

    if !status.success() {
        return Err(format!(
            "Bootstrap script exited with code {:?}",
            status.code()
        ));
    }
    println!("[X-Whisper] Managed runtime ready.");
    Ok(())
}

/// Resolve the python.exe used to host the engine. Always points at
/// the managed runtime; invokes the bootstrap script if it is missing.
fn ensure_engine_python(engine_dir: &str) -> Result<std::path::PathBuf, String> {
    let managed = managed_python_path();
    if !managed.exists() {
        bootstrap_managed_runtime(engine_dir)?;
    }
    if !managed.exists() {
        return Err(format!(
            "Managed Python still not present at {} after bootstrap.",
            managed.display()
        ));
    }
    Ok(managed)
}

/// Spawn the Python engine as a child process
fn spawn_engine(engine_dir: &str) -> Result<Child, String> {
    let python = ensure_engine_python(engine_dir)?;
    let main_py = std::path::Path::new(engine_dir).join("main.py");

    if !main_py.exists() {
        return Err(format!("Engine script not found: {}", main_py.display()));
    }

    println!(
        "[X-Whisper] Starting Python engine: {} {}",
        python.display(),
        main_py.display()
    );

    let mut child = hidden_command(&python)
        .arg(main_py.to_string_lossy().to_string())
        .current_dir(engine_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to spawn Python engine: {}. Expected managed Python at {}",
                e,
                python.display()
            )
        })?;

    // Bind to a KILL_ON_JOB_CLOSE job object so the engine can't outlive
    // the parent (Ctrl+C on `tauri dev`, crash, etc.). Failure here is
    // non-fatal — we log and carry on with the less-robust Destroyed
    // event cleanup as a fallback.
    #[cfg(windows)]
    if let Err(e) = bind_child_to_job(&child) {
        eprintln!("[X-Whisper] WARNING: could not bind engine to job object: {}", e);
    }

    // Drain both pipes on dedicated threads. Without this, the OS
    // pipe buffer (~64 KB on Windows) fills up and the engine blocks
    // on its next log/print — silently freezes the whole sidecar.
    if let Some(stdout) = child.stdout.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                println!("[engine] {}", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[engine] {}", line);
            }
        });
    }

    println!("[X-Whisper] Python engine started (pid: {})", child.id());
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![paste_text, engine_status, restart_engine, open_settings, open_transcribe_window, save_text_file, set_launch_at_startup, get_launch_at_startup, set_island_frame, set_island_visible])
        .setup(|app| {
            // ── Spawn Python Engine (backgrounded) ────────────
            //
            // First-launch bootstrap installs the managed Python runtime
            // via pip, which can take 2–5 minutes. Doing that inside
            // setup() froze the whole UI thread ("Not responding" title
            // bar, no windows painted). Spawn on a worker thread so
            // setup() returns instantly — the island + onboarding
            // windows paint right away, the WS reconnect loop handles
            // the connection gap, and bootstrap overlaps with the
            // human-paced onboarding steps.
            let engine_dir = resolve_engine_dir(&app.handle());
            app.manage(EngineProcess(Mutex::new(None)));

            let engine_state_dir = engine_dir.clone();
            let app_handle_for_engine = app.handle().clone();
            thread::spawn(move || {
                match spawn_engine(&engine_state_dir) {
                    Ok(child) => {
                        println!("[X-Whisper] Python engine spawned successfully");
                        if let Some(state) = app_handle_for_engine.try_state::<EngineProcess>() {
                            if let Ok(mut guard) = state.0.lock() {
                                *guard = Some(child);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[X-Whisper] WARNING: Failed to start Python engine: {}", e);
                        eprintln!("[X-Whisper] The app will still work but requires manual engine start");
                    }
                }
            });

            // ── Position Island at Top-Center ────────────────
            // Note: on macOS the JS layer (Island.tsx) takes ownership of
            // sizing and positioning once the webview boots so that the
            // window matches the actual pill dimensions (no transparent
            // margins that would otherwise capture clicks). The initial
            // placement below is just a sane pre-render position so the
            // window doesn't flash at (0, 0).
            if let Some(island) = app.get_webview_window("island") {
                if let Ok(monitor) = island.primary_monitor() {
                    if let Some(monitor) = monitor {
                        let monitor_size = monitor.size();
                        let window_width: u32 = 520; // matches tauri.conf.json default
                        let center_x = (monitor_size.width.saturating_sub(window_width)) / 2;
                        let _ = island.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(center_x as i32, 0),
                        ));
                        println!("[X-Whisper] Island positioned at top-center (x: {})", center_x);
                    }
                }

                // ── macOS: NSWindow tweaks for full-screen overlay ──
                // Tauri's alwaysOnTop sets NSFloatingWindowLevel (3),
                // which sits above normal windows but is hidden by full-
                // screen apps (which live in their own Space). To stay
                // visible we (a) raise the level above the menu bar and
                // (b) opt the window into FullScreenAuxiliary so AppKit
                // lets it join other apps' full-screen Spaces.
                #[cfg(target_os = "macos")]
                unsafe {
                    use cocoa::appkit::{NSWindow, NSWindowCollectionBehavior};
                    use cocoa::base::id;

                    if let Ok(ns_window_ptr) = island.ns_window() {
                        let ns_window = ns_window_ptr as id;
                        let current = ns_window.collectionBehavior();
                        ns_window.setCollectionBehavior_(
                            current
                                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
                                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
                        );
                        // We deliberately leave the window level at Tauri's
                        // default (NSFloatingWindowLevel = 3) instead of
                        // raising it to NSStatusWindowLevel. The full-screen
                        // overlay behaviour comes from the collection-behavior
                        // bits above; bumping the level also prevented
                        // AppKit's `performWindowDragWithEvent:` from working,
                        // which broke the user's ability to drag the pill.
                        println!("[X-Whisper] Island: NSWindow full-screen collection behavior applied");
                    }
                }
            }

            // ── System Tray ──────────────────────────────────
            let quit = MenuItem::with_id(app, "quit", "Quit X-Whisper", true, None::<&str>)?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let transcribe_file =
                MenuItem::with_id(app, "transcribe_file", "Transcribe File…", true, None::<&str>)?;
            let separator = MenuItem::with_id(app, "sep", "────────────", false, None::<&str>)?;

            let menu = Menu::with_items(app, &[&transcribe_file, &settings, &separator, &quit])?;

            // Load the 32x32 icon explicitly. `app.default_window_icon()`
            // picks up a higher-res variant from bundle.icon[] (typically
            // 128x128 or icon.ico), which Windows then downscales for the
            // tray and the result looks blurry / zoomed-out. Pre-sizing to
            // 32x32 avoids the scale pass.
            //
            // include_bytes! is relative to this .rs file and bakes the
            // PNG into the binary — no runtime path resolution.
            let tray_icon = tauri::image::Image::from_bytes(
                include_bytes!("../icons/32x32.png"),
            )?;

            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("X-Whisper — Speech to Text")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => {
                        // Kill engine before exiting
                        if let Some(state) = app.try_state::<EngineProcess>() {
                            let mut guard = state.0.lock().unwrap();
                            if let Some(mut child) = guard.take() {
                                println!("[X-Whisper] Killing Python engine (pid: {})...", child.id());
                                let _ = child.kill();
                                let _ = child.wait();
                                println!("[X-Whisper] Python engine stopped");
                            }
                        }
                        app.exit(0);
                    }
                    "settings" => {
                        open_settings_window(app);
                    }
                    "transcribe_file" => {
                        open_transcribe_window_handle(app);
                    }
                    _ => {}
                })
                .build(app)?;

            // ── Onboarding Check ─────────────────────────────
            let needs_onboarding = check_onboarding_needed();
            println!("[X-Whisper] Onboarding needed: {}", needs_onboarding);

            if needs_onboarding {
                // Hide the island during onboarding
                if let Some(island) = app.get_webview_window("island") {
                    let _ = island.hide();
                }

                // Create the onboarding window
                let _onboarding = WebviewWindowBuilder::new(
                    app,
                    "onboarding",
                    WebviewUrl::App("index.html?window=onboarding".into()),
                )
                .title("Welcome to X-Whisper")
                .inner_size(640.0, 600.0)
                .resizable(false)
                .center()
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .skip_taskbar(true)
                .visible(true)
                .build()?;

                // Listen for onboarding completion event
                let app_handle = app.handle().clone();
                app.listen("onboarding_complete", move |_| {
                    println!("[X-Whisper] Onboarding completed!");

                    // Close onboarding window
                    if let Some(onboarding_win) = app_handle.get_webview_window("onboarding") {
                        let _ = onboarding_win.close();
                    }

                    // Show and position the island
                    if let Some(island) = app_handle.get_webview_window("island") {
                        let _ = island.show();
                        if let Ok(Some(monitor)) = island.primary_monitor() {
                            let monitor_size = monitor.size();
                            let window_width: u32 = 520;
                            let center_x = (monitor_size.width.saturating_sub(window_width)) / 2;
                            let _ = island.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(center_x as i32, 0),
                            ));
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill engine when the main window (island) is destroyed
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "island" {
                    if let Some(state) = window.app_handle().try_state::<EngineProcess>() {
                        let mut guard = state.0.lock().unwrap();
                        if let Some(mut child) = guard.take() {
                            println!("[X-Whisper] Island closed — killing Python engine (pid: {})", child.id());
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
