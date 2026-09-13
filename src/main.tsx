/**
 * X-Whisper — Main Application Entry
 *
 * Routes to the correct window component based on the Tauri window label.
 * The app has four windows:
 *   - "island" → Dynamic Island floating overlay
 *   - "settings" → Full settings/configuration window
 *   - "onboarding" → First-run onboarding flow
 *   - "transcribe" → File transcribe dedicated window (Phase 19)
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Island } from './windows/island/Island';
import { Settings } from './windows/settings/Settings';
import { Onboarding } from './windows/onboarding/Onboarding';
import { TranscribeFile } from './windows/transcribe/TranscribeFile';
import './index.css';

function App() {
  // Detect which window we're in via URL search params or default to island
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get('window') || 'island';

  // Add body class for window-specific styling
  React.useEffect(() => {
    document.body.classList.add(`${windowType}-window`);
    return () => {
      document.body.classList.remove(`${windowType}-window`);
    };
  }, [windowType]);

  switch (windowType) {
    case 'settings':
      return <Settings />;
    case 'onboarding':
      return <Onboarding />;
    case 'transcribe':
      return <TranscribeFile />;
    case 'island':
    default:
      return <Island />;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
