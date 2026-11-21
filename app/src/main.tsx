import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppStore, ALL_KEYS } from './lib/store';
import { createFetchLoader } from './lib/loader';
import { progress } from './lib/engines';
import type { StorageAdapter } from './lib/engines';
import { IndexedDBStorage, migrateFromLocalStorage } from './lib/idb';
import { CloudAccount, isCloudConfigured, openAccountDatabase, readAccountPointer } from './lib/account';
import '@fontsource-variable/inter/wght.css';
import './index.css';

type Kind = 'indexeddb' | 'localstorage' | 'memory';

/** IndexedDB first (Phase 7); localStorage if IndexedDB is unavailable; memory as the last resort (with a warning). */
async function openStorage(): Promise<{ storage: StorageAdapter; kind: Kind; notes: string[] }> {
  const notes: string[] = [];
  try {
    const idb = await IndexedDBStorage.open();
    try {
      const { migrated, skipped } = await migrateFromLocalStorage(idb, window.localStorage, ALL_KEYS);
      if (migrated.length) notes.push(`Your saved progress was moved to the browser database (IndexedDB): ${migrated.length} collection(s).`);
      if (skipped.length) notes.push(`Unreadable old data was left in place: ${skipped.join(', ')}.`);
    } catch (e) {
      notes.push(`Moving old data to IndexedDB failed (${(e as Error).message}); it is still in localStorage and was not deleted.`);
    }
    return { storage: idb, kind: 'indexeddb', notes };
  } catch (e) {
    notes.push(`IndexedDB is unavailable (${(e as Error).message}).`);
  }
  try {
    const probe = '__syllabus-tracker-probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    notes.push('Using localStorage instead (smaller capacity, no restore points).');
    return { storage: new progress.WebStorageAdapter(window.localStorage), kind: 'localstorage', notes };
  } catch {
    notes.push('Browser storage is blocked (private mode?). Progress will be lost when this tab closes: export a backup from Settings.');
    return { storage: new progress.MemoryStorage(), kind: 'memory', notes };
  }
}

const root = createRoot(document.getElementById('root')!);
const { storage: guest, kind, notes } = await openStorage();
const cloudReady = isCloudConfigured() && kind === 'indexeddb';
const accountDb = cloudReady ? await openAccountDatabase(readAccountPointer()).catch(() => null) : null;
const store = new AppStore({ loader: createFetchLoader(), storage: accountDb ?? guest, storageKind: kind });
if (cloudReady) store.account = new CloudAccount({ store, guest: guest as IndexedDBStorage, activeDb: accountDb });
(window as unknown as { __store?: AppStore }).__store = store; // for debugging and end-to-end tests
root.render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
await store.init();
for (const n of notes) store.toast(kind === 'indexeddb' ? 'info' : 'error', n);
void store.account?.init();

// Save before the page goes away; warn when something is not on disk yet.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store.flush().catch(() => {}); });
window.addEventListener('pagehide', () => { void store.flush().catch(() => {}); });
window.addEventListener('beforeunload', (e) => {
  if (store.saveState !== 'saved') { e.preventDefault(); e.returnValue = ''; }
});
