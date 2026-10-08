import { afterAll, describe, expect, it } from 'vitest';
import { parseBestMove, parseInfoLine, parseOptionLine } from '../src/engine/uciParser';
import { EngineSession } from '../src/engine/engineCore';
import { AnalysisQueue } from '../src/engine/analysisQueue';
import { AnalysisCache, cacheKey, type CachePersistence, type CacheRecord } from '../src/engine/analysisCache';
import { StockfishManager, terminalAnalysis, type WorkerLike } from '../src/engine/StockfishManager';
import { evalBarFraction, expectedPointsWhite, formatScore } from '../src/engine/evalUtils';
import type { EngineAnalysis, WorkerOut } from '../src/engine/types';
import { createNodeWorker, spawnEngine } from './helpers/nodeEngine';
import { START_FEN } from '../src/chess/types';

describe('UCI parsing', () => {
  it('parses info lines with score, bounds and pv', () => {
    const i = parseInfoLine('info depth 12 seldepth 19 multipv 2 score cp -31 upperbound nodes 70353 nps 245989 hashfull 25 time 286 pv e2e4 e7e6 d2d4')!;
    expect(i).toMatchObject({ depth: 12, seldepth: 19, multipv: 2, cp: -31, bound: 'upper', nodes: 70353, nps: 245989, time: 286 });
    expect(i.pv).toEqual(['e2e4', 'e7e6', 'd2d4']);
    expect(parseInfoLine('info depth 5 score mate -3 pv a1a2')!.mate).toBe(-3);
    expect(parseInfoLine('info string NNUE enabled')!.string).toBe('NNUE enabled');
    expect(parseInfoLine('bestmove e2e4')).toBeNull();
  });
  it('parses bestmove and options', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestmove: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove (none)')!.bestmove).toBeNull();
    expect(parseOptionLine('option name Threads type spin default 1 min 1 max 512')).toMatchObject({ name: 'Threads', max: 512 });
  });
});

describe('eval utils', () => {
  it('formats scores including mates', () => {
    expect(formatScore({ cp: 42, mate: null })).toBe('+0.42');
    expect(formatScore({ cp: -183, mate: null })).toBe('−1.83');
    expect(formatScore({ cp: null, mate: 4 })).toBe('M4');
    expect(formatScore({ cp: null, mate: -2 })).toBe('M-2');
  });
  it('maps to expected points and bar fraction', () => {
    expect(expectedPointsWhite({ cp: 0, mate: null })).toBeCloseTo(0.5);
    expect(expectedPointsWhite({ cp: null, mate: 3 })).toBe(1);
    expect(expectedPointsWhite({ cp: 300, mate: null })).toBeGreaterThan(0.7);
    const a = { evaluation: 10000, mate: null } as EngineAnalysis;
    expect(evalBarFraction(a)).toBeLessThan(1);
  });
});

describe('AnalysisQueue', () => {
  it('orders by priority then FIFO and clears groups', () => {
    const q = new AnalysisQueue<string>();
    q.enqueue(1, 'a', 2, 'review');
    q.enqueue(2, 'b', 0, 'live');
    q.enqueue(3, 'c', 2, 'review');
    q.enqueue(4, 'd', 0, 'live');
    expect(q.next()!.payload).toBe('b');
    expect(q.clearGroup('live').map((x) => x.payload)).toEqual(['d']);
    expect(q.next()!.payload).toBe('a');
    expect(q.remove(3)!.payload).toBe('c');
    expect(q.size).toBe(0);
  });
});

function fakeAnalysis(fen: string, depth: number, multipv: number, complete = true): EngineAnalysis {
  return {
    fen,
    depth,
    evaluation: 20,
    mate: null,
    bestMove: 'e2e4',
    principalVariation: ['e2e4'],
    lines: Array.from({ length: multipv }, (_, i) => ({ multipv: i + 1, depth, score: { cp: 20 - i, mate: null }, pv: ['e2e4'] })),
    multipv,
    complete,
    source: 'engine',
  };
}

class MemPersistence implements CachePersistence {
  map = new Map<string, CacheRecord>();
  async get(k: string) {
    return this.map.get(k);
  }
  async put(r: CacheRecord) {
    this.map.set(r.key, r);
  }
  async count() {
    return this.map.size;
  }
  async deleteOldest(n: number) {
    [...this.map.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, n).forEach((r) => this.map.delete(r.key));
  }
  async clear() {
    this.map.clear();
  }
}

describe('AnalysisCache', () => {
  it('serves equal/shallower requests and ignores move counters', async () => {
    const p = new MemPersistence();
    const c = new AnalysisCache(10, p);
    c.set(fakeAnalysis(START_FEN, 18, 3));
    expect(cacheKey(START_FEN, 18, 3)).toContain('|d18|pv3');
    const hit = c.getSync(START_FEN.replace(' 0 1', ' 5 9'), 16, 2)!;
    expect(hit.source).toBe('cache');
    expect(hit.lines.length).toBe(2);
    expect(c.getSync(START_FEN, 20, 1)).toBeNull();
    expect(c.getSync(START_FEN, 12, 4)).toBeNull();
    c.set(fakeAnalysis(START_FEN, 10, 1, false));
    expect(c.size).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    // persisted copy restores a fresh cache
    const c2 = new AnalysisCache(10, p);
    expect(await c2.get(START_FEN, 18, 3)).not.toBeNull();
  });
  it('bounds memory size', () => {
    const c = new AnalysisCache(3);
    const fens = ['8/8/8/8/8/8/8/K6k w - - 0 1', '8/8/8/8/8/8/8/K5k1 w - - 0 1', '8/8/8/8/8/8/8/K4k2 w - - 0 1', '8/8/8/8/8/8/8/K3k3 w - - 0 1'];
    fens.forEach((f) => c.set(fakeAnalysis(f, 10, 1)));
    expect(c.size).toBe(3);
    expect(c.getSync(fens[0], 10, 1)).toBeNull();
  });
});

describe('EngineSession sequencing (mock transport)', () => {
  it('stops the running search before starting a new one', () => {
    const sent: string[] = [];
    const out: WorkerOut[] = [];
    const s = new EngineSession((c) => sent.push(c), (m) => out.push(m));
    s.boot('lite-single', 1, 16, 1000);
    s.onLine('option name Threads type spin default 1 min 1 max 1');
    s.onLine('uciok');
    s.onLine('readyok');
    expect(out[0].type).toBe('ready');
    s.handle({ type: 'analyze', id: 1, fen: START_FEN, limit: { kind: 'infinite' }, multipv: 2 });
    expect(sent).toContain('setoption name MultiPV value 2');
    expect(sent[sent.length - 1]).toBe('go infinite');
    s.onLine('info depth 10 multipv 1 score cp 30 nodes 100 nps 10 pv e2e4 e7e5');
    s.handle({ type: 'analyze', id: 2, fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', limit: { kind: 'depth', depth: 5 }, multipv: 1 });
    expect(sent[sent.length - 1]).toBe('stop');
    s.onLine('bestmove e2e4');
    const done1 = out.find((m) => m.type === 'done' && m.id === 1) as Extract<WorkerOut, { type: 'done' }>;
    expect(done1.stopped).toBe(true);
    expect(done1.analysis.evaluation).toBe(30);
    expect(sent[sent.length - 1]).toBe('go depth 5');
    // Black to move: score converted to White POV
    s.onLine('info depth 5 multipv 1 score cp 25 pv e7e5');
    s.onLine('bestmove e7e5');
    const done2 = out.find((m) => m.type === 'done' && m.id === 2) as Extract<WorkerOut, { type: 'done' }>;
    expect(done2.analysis.evaluation).toBe(-25);
    expect(done2.analysis.complete).toBe(true);
  });
  it('reports a boot timeout as a fatal error', async () => {
    const out: WorkerOut[] = [];
    const s = new EngineSession(() => undefined, (m) => out.push(m));
    s.boot('lite-single', 1, 16, 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(out[0]).toMatchObject({ type: 'error', fatal: true });
  });
});

describe('Real Stockfish WASM (Node)', () => {
  const procs: { kill: () => void }[] = [];
  afterAll(() => procs.forEach((p) => p.kill()));

  it('speaks UCI', async () => {
    const e = spawnEngine();
    procs.push(e.proc);
    const lines: string[] = [];
    const ok = new Promise<void>((res) => e.onLine((l) => (lines.push(l), l === 'uciok' && res())));
    e.send('uci');
    await ok;
    expect(lines.some((l) => l.startsWith('id name Stockfish'))).toBe(true);
  });

  it('analyzes with depth and MultiPV through the manager, uses the cache and handles stop/restart', async () => {
    let worker: ReturnType<typeof createNodeWorker> | null = null;
    const cache = new AnalysisCache();
    const m = new StockfishManager({
      cache,
      engineBaseUrl: '/engine',
      flavors: ['lite-single'],
      threads: 1,
      hashMb: 16,
      createWorker: () => {
        worker = createNodeWorker();
        procs.push(worker.proc);
        return worker as WorkerLike;
      },
    });
    await m.start();
    expect(m.state.status).toBe('ready');
    const updates: EngineAnalysis[] = [];
    const a = await m.analyze({ fen: START_FEN, limit: { kind: 'depth', depth: 10 }, multipv: 3 }, { onUpdate: (u) => updates.push(u) }).promise;
    expect(a.complete).toBe(true);
    expect(a.depth).toBeGreaterThanOrEqual(10);
    expect(a.lines.length).toBe(3);
    expect(new Set(a.lines.map((l) => l.pv[0])).size).toBe(3);
    expect(a.bestMove).toMatch(/^[a-h][1-8][a-h][1-8]/);
    expect(Math.abs(a.evaluation!)).toBeLessThan(150);
    expect(updates.length).toBeGreaterThan(0);

    // Cache hit
    const cached = await m.analyze({ fen: START_FEN, limit: { kind: 'depth', depth: 8 }, multipv: 2 }).promise;
    expect(cached.source).toBe('cache');

    // Mate detection
    const mate = await m.analyze({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', limit: { kind: 'depth', depth: 8 }, multipv: 1 }).promise;
    expect(mate.mate).toBe(1);
    expect(mate.bestMove).toBe('d1d8');

    // Terminal positions bypass the engine
    expect(terminalAnalysis('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 1)!.terminal).toBe('checkmate');

    // Stop an infinite search
    const inf = m.analyze({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', limit: { kind: 'infinite' }, multipv: 1 }, { group: 'live' });
    await new Promise((r) => setTimeout(r, 300));
    inf.cancel();
    const partial = await inf.promise;
    expect(partial.complete).toBe(false);
    expect(partial.depth).toBeGreaterThan(0);

    // Obsolete queued work is cleared
    const q1 = m.analyze({ fen: 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8', limit: { kind: 'depth', depth: 30 }, multipv: 1 }, { group: 'live' });
    const q2 = m.analyze({ fen: 'r2q1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9', limit: { kind: 'depth', depth: 30 }, multipv: 1 }, { group: 'live' });
    m.cancelGroup('live');
    expect((await q2.promise).complete).toBe(false);
    expect((await q1.promise).complete).toBe(false);

    // Restart after crash
    worker!.proc.kill('SIGKILL');
    worker!.onerror?.({ message: 'crash' });
    await new Promise((r) => setTimeout(r, 50));
    await m.start();
    const again = await m.analyze({ fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', limit: { kind: 'depth', depth: 6 }, multipv: 1 }).promise;
    expect(again.complete).toBe(true);
    m.dispose();
  });
});
