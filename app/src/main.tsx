import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppStore } from './lib/store';
import { createFetchLoader } from './lib/loader';
import { progress } from './lib/engines';
import type { StorageAdapter } from './lib/engines';
import './index.css';

function browserStorage(): { storage: StorageAdapter; persistent: boolean } {
  try {
    const probe = '__syllabus-tracker-probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return { storage: new progress.WebStorageAdapter(window.localStorage), persistent: true };
  } catch {
    return { storage: new progress.MemoryStorage(), persistent: false };
  }
}

const { storage, persistent } = browserStorage();
const store = new AppStore({ loader: createFetchLoader(), storage });
void store.init().then(() => {
  if (!persistent) store.toast('error', 'Browser storage is unavailable (private mode or blocked). Progress will be lost when this tab closes: export it from Settings.');
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store.flush(); });
(window as unknown as { __store?: AppStore }).__store = store; // for debugging and end-to-end tests

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
