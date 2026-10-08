import { fenKey } from '../chess/fen';
import type { EngineAnalysis } from './types';

export interface CacheRecord {
  key: string;
  analyses: EngineAnalysis[];
  updatedAt: number;
}

export interface CachePersistence {
  get(key: string): Promise<CacheRecord | undefined>;
  put(record: CacheRecord): Promise<void>;
  count(): Promise<number>;
  deleteOldest(n: number): Promise<void>;
  clear(): Promise<void>;
}

const MAX_PER_POSITION = 3;

/** Builds the canonical cache key: position (FEN without move counters) + depth + MultiPV. */
export function cacheKey(fen: string, depth: number, multipv: number): string {
  return `${fenKey(fen)}|d${depth}|pv${multipv}`;
}

function satisfies(a: EngineAnalysis, depth: number, multipv: number): boolean {
  return a.complete && a.depth >= depth && a.multipv >= multipv;
}

function adapt(a: EngineAnalysis, fen: string, multipv: number): EngineAnalysis {
  return { ...a, fen, multipv, lines: a.lines.slice(0, multipv), source: 'cache' };
}

/**
 * Two-level analysis cache: an in-memory LRU keyed by position, optionally backed by
 * persistent storage (IndexedDB). A stored result satisfies any request with
 * depth ≤ stored depth and MultiPV ≤ stored MultiPV.
 */
export class AnalysisCache {
  private mem = new Map<string, EngineAnalysis[]>();
  private writes = 0;
  enabled = true;

  constructor(
    private readonly maxPositions = 2000,
    private readonly persistence?: CachePersistence,
    private readonly maxPersisted = 5000,
  ) {}

  getSync(fen: string, depth: number, multipv: number): EngineAnalysis | null {
    if (!this.enabled) return null;
    const k = fenKey(fen);
    const list = this.mem.get(k);
    if (!list) return null;
    const hit = list.find((a) => satisfies(a, depth, multipv));
    if (!hit) return null;
    this.mem.delete(k);
    this.mem.set(k, list);
    return adapt(hit, fen, multipv);
  }

  /** Best (deepest) cached analysis for a position regardless of depth, for previews. */
  peekBest(fen: string): EngineAnalysis | null {
    const list = this.mem.get(fenKey(fen));
    if (!list?.length) return null;
    const best = [...list].sort((a, b) => b.depth - a.depth)[0];
    return { ...best, fen, source: 'cache' };
  }

  async get(fen: string, depth: number, multipv: number): Promise<EngineAnalysis | null> {
    if (!this.enabled) return null;
    const hit = this.getSync(fen, depth, multipv);
    if (hit || !this.persistence) return hit;
    try {
      const rec = await this.persistence.get(fenKey(fen));
      if (!rec) return null;
      for (const a of rec.analyses) this.remember(a, false);
      const found = rec.analyses.find((a) => satisfies(a, depth, multipv));
      return found ? adapt(found, fen, multipv) : null;
    } catch {
      return null;
    }
  }

  set(a: EngineAnalysis): void {
    if (!this.enabled || !a.complete || a.source !== 'engine' || !a.lines.length) return;
    this.remember(a, true);
  }

  private remember(a: EngineAnalysis, persist: boolean): void {
    const k = fenKey(a.fen);
    let list = this.mem.get(k) ?? [];
    // Drop entries dominated by the new one.
    list = list.filter((x) => !(x.depth <= a.depth && x.multipv <= a.multipv));
    if (!list.some((x) => x.depth >= a.depth && x.multipv >= a.multipv)) list.push({ ...a, source: 'engine' });
    list.sort((x, y) => y.depth - x.depth);
    list = list.slice(0, MAX_PER_POSITION);
    this.mem.delete(k);
    this.mem.set(k, list);
    while (this.mem.size > this.maxPositions) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
    if (persist && this.persistence) void this.persist(k, list);
  }

  private async persist(key: string, analyses: EngineAnalysis[]): Promise<void> {
    try {
      await this.persistence!.put({ key, analyses, updatedAt: Date.now() });
      if (++this.writes % 50 === 0) {
        const n = await this.persistence!.count();
        if (n > this.maxPersisted) await this.persistence!.deleteOldest(n - Math.floor(this.maxPersisted * 0.8));
      }
    } catch {
      /* storage is best-effort */
    }
  }

  get size(): number {
    return this.mem.size;
  }

  async clear(): Promise<void> {
    this.mem.clear();
    try {
      await this.persistence?.clear();
    } catch {
      /* ignore */
    }
  }
}
