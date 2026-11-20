// Test harness: the real engines (../src) on the real built data (../dist, ../data) with in-memory storage.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error untyped JS module (Node-only loader shared with the engine tests)
import { createNodeLoader, PROJECT_ROOT } from '../../src/progress/node.js';
import { progress } from '../src/lib/engines';
import type { Loader, PlannerConfig, ProgressConfig, StorageAdapter } from '../src/lib/engines';
import { AppStore } from '../src/lib/store';

const root = PROJECT_ROOT as string;
export const defaults = {
  progress: JSON.parse(readFileSync(join(root, 'data', 'progress', 'config.json'), 'utf8')) as ProgressConfig,
  planner: JSON.parse(readFileSync(join(root, 'data', 'planner', 'config.json'), 'utf8')) as PlannerConfig,
};
export const TODAY = '2026-11-20';
export const fixedClock = () => new Date(`${TODAY}T09:00:00Z`);
export const nodeLoader = (): Loader => (createNodeLoader as () => Loader)();
export const memoryStorage = (): StorageAdapter => new progress.MemoryStorage();

export async function makeStore({ storage = memoryStorage(), loader = nodeLoader() }: { storage?: StorageAdapter; loader?: Loader } = {}) {
  const store = new AppStore({ loader, storage, defaults, clock: fixedClock, historyDelayMs: 5 });
  await store.init();
  return store;
}
