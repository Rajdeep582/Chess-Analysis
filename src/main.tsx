import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import './styles/app.css';
import App from './App';
import { warmUpSounds } from './audio/sounds';

warmUpSounds();
import { ErrorBoundary } from './components/common/ErrorBoundary';

function unsupported(): string | null {
  if (typeof Worker === 'undefined') return 'This browser does not support Web Workers, which are required to run the chess engine.';
  return null;
}

// When the service worker first takes control it adds cross-origin isolation headers,
// unlocking the multi-threaded engine. Reload once if nothing has been loaded yet.
if ('serviceWorker' in navigator && !window.crossOriginIsolated) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    try {
      if (sessionStorage.getItem('nocturne64.coi-reload')) return;
      sessionStorage.setItem('nocturne64.coi-reload', '1');
    } catch {
      return;
    }
    const input = document.querySelector<HTMLTextAreaElement>('#pgn-input');
    if (input && !input.value) window.location.reload();
  });
}

const root = createRoot(document.getElementById('root')!);
const problem = unsupported();
root.render(
  <StrictMode>
    {problem ? (
      <div className="fatal">
        <h1>Browser not supported</h1>
        <p>{problem}</p>
        <p>Please use a current version of Chrome, Edge, Firefox or Safari.</p>
      </div>
    ) : (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    )}
  </StrictMode>,
);
