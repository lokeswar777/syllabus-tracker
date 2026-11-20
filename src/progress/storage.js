/**
 * Storage adapters. Each collection (progress, sharedLearning, practice, weightOverrides) is stored
 * under its own key, so resetting or corrupting one never erases the others.
 *
 * Adapter interface:  async read(key) → object | null      async write(key, object) → void
 * Optional:           async writeMany([[key, object], …]) → void   all-or-nothing (used when one change touches several collections)
 */
import { COLLECTIONS, normalizeDb, createEmptyDb } from './progress-db.js';

export class MemoryStorage {
  constructor(initial = {}) { this.data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)])); }
  async read(key) { return this.data.has(key) ? JSON.parse(this.data.get(key)) : null; }
  async write(key, value) { this.data.set(key, JSON.stringify(value)); }
}

/** Browser adapter for window.localStorage (or any Web Storage-compatible object). */
export class WebStorageAdapter {
  constructor(storage, prefix = 'syllabus-tracker:') { this.storage = storage; this.prefix = prefix; }
  async read(key) {
    const raw = this.storage.getItem(this.prefix + key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch {
      // keep the unreadable payload for recovery instead of discarding it
      this.storage.setItem(`${this.prefix}${key}.corrupt-${Date.now()}`, raw);
      return null;
    }
  }
  async write(key, value) { this.storage.setItem(this.prefix + key, JSON.stringify(value)); }
}

/** Loads all collections from storage and normalises them (missing/invalid parts become empty, never throw). */
export async function loadDb(storage, now = new Date()) {
  const raw = {};
  const readErrors = [];
  for (const key of COLLECTIONS) {
    try { raw[key] = await storage.read(key); } catch (e) { readErrors.push(`${key}: ${e.message}`); raw[key] = null; }
  }
  const anything = COLLECTIONS.some((k) => raw[k]);
  const { db, issues } = anything ? normalizeDb(raw, now) : { db: createEmptyDb(now), issues: [] };
  return { db, issues: [...readErrors, ...issues] };
}

export async function saveCollections(storage, db, keys = COLLECTIONS) {
  if (typeof storage.writeMany === 'function') return storage.writeMany(keys.map((key) => [key, db[key]])); // atomic when supported
  for (const key of keys) await storage.write(key, db[key]);
}
