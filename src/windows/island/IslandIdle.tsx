/**
 * X-Whisper — Island Idle State
 * Low, wide always-on pill in the spirit of the real Dynamic Island:
 * full width, minimal height, only the logo centred. The parent overlays
 * the connection dot on the right edge.
 */

export function IslandIdle() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-3.5 h-3.5 rounded-[3px] overflow-hidden flex items-center justify-center bg-black/20 shrink-0">
        <img src="/logo.png" alt="X-Whisper" className="w-full h-full object-cover scale-[2.0]" />
      </div>
    </div>
  );
}
