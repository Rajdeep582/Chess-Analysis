import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CachePersistence, CacheRecord } from '../engine/analysisCache';
import type { SavedAnalysis } from './savedAnalyses';
import type { DbGame } from '../database/types';

interface OutpostDB extends DBSchema {
  analyses: { key: string; value: SavedAnalysis; indexes: { updatedAt: number } };
  engineCache: { key: string; value: CacheRecord; indexes: { updatedAt: number } };
  games: { key: string; value: DbGame; indexes: { collection: string } };
}

export class StorageError extends Error {
  constructor(message: string, public readonly kind: 'unavailable' | 'corrupt' | 'quota' | 'not-found' | 'unknown' = 'unknown') {
    super(message);
    this.name = 'StorageError';
  }
}

const DB_NAME = 'outpost-chess';
let dbPromise: Promise<IDBPDatabase<OutpostDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<OutpostDB>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new StorageError('Local storage (IndexedDB) is not available in this browser or mode.', 'unavailable'));
  }
  if (!dbPromise) {
    dbPromise = openDB<OutpostDB>(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const a = db.createObjectStore('analyses', { keyPath: 'id' });
          a.createIndex('updatedAt', 'updatedAt');
          const c = db.createObjectStore('engineCache', { keyPath: 'key' });
          c.createIndex('updatedAt', 'updatedAt');
        }
        if (oldVersion < 2) {
          const g = db.createObjectStore('games', { keyPath: 'id' });
          g.createIndex('collection', 'collection');
        }
      },
    }).catch((e: unknown) => {
      dbPromise = null;
      throw new StorageError(`Could not open local storage: ${(e as Error)?.message ?? e}`, 'unavailable');
    });
  }
  return dbPromise;
}

/** Test helper: forget the cached connection. */
export function resetDbConnection(): void {
  dbPromise = null;
}

export function translateStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string })?.name;
  if (name === 'QuotaExceededError') return new StorageError('Your browser storage is full. Delete some saved analyses or clear the engine cache.', 'quota');
  return new StorageError(`A storage error occurred: ${(e as Error)?.message ?? String(e)}`);
}

export const idbCachePersistence: CachePersistence = {
  async get(key) {
    return (await getDb()).get('engineCache', key);
  },
  async put(record) {
    await (await getDb()).put('engineCache', record);
  },
  async count() {
    return (await getDb()).count('engineCache');
  },
  async deleteOldest(n) {
    const db = await getDb();
    const tx = db.transaction('engineCache', 'readwrite');
    let cursor = await tx.store.index('updatedAt').openCursor();
    let removed = 0;
    while (cursor && removed < n) {
      await cursor.delete();
      removed++;
      cursor = await cursor.continue();
    }
    await tx.done;
  },
  async clear() {
    await (await getDb()).clear('engineCache');
  },
};
