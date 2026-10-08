import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, idbCachePersistence, resetDbConnection } from '../src/storage/indexedDB';
import {
  deleteAnalysis,
  duplicateAnalysis,
  getAnalysis,
  listAnalyses,
  renameAnalysis,
  saveAnalysis,
  validateSavedAnalysis,
} from '../src/storage/savedAnalyses';
import { parsePgn } from '../src/chess/pgn';
import { mainline } from '../src/chess/tree';
import { decodeShare, encodeShare } from '../src/sharing/urlState';
import { AnalysisCache } from '../src/engine/analysisCache';
import { START_FEN } from '../src/chess/types';

const PGN = '[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 (1... c5) 2. Nf3 Nc6 1-0';

async function wipe() {
  const db = await getDb();
  await db.clear('analyses');
  await db.clear('engineCache');
}

describe('saved analyses (IndexedDB)', () => {
  beforeEach(async () => {
    resetDbConnection();
    await wipe();
  });

  it('saves, loads, updates, renames, duplicates and deletes', async () => {
    const p = parsePgn(PGN);
    const ml = mainline(p.tree);
    const saved = await saveAnalysis({
      title: '',
      tree: p.tree,
      headers: p.headers,
      currentNodeId: ml[2],
      review: null,
      engineSettings: { depth: 18, multipv: 3, mode: 'depth' },
    });
    expect(saved.title).toBe('Alice vs Bob');
    expect(saved.pgn).toContain('(1... c5)');

    const loaded = await getAnalysis(saved.id);
    expect(loaded.currentNodeId).toBe(ml[2]);
    expect(Object.keys(loaded.tree.nodes).length).toBe(Object.keys(p.tree.nodes).length);

    const updated = await saveAnalysis({ id: saved.id, title: 'Club game', tree: p.tree, headers: p.headers, currentNodeId: ml[4], review: null, engineSettings: saved.engineSettings });
    expect(updated.createdAt).toBe(saved.createdAt);
    expect((await listAnalyses()).items.length).toBe(1);

    await renameAnalysis(saved.id, 'Renamed');
    expect((await getAnalysis(saved.id)).title).toBe('Renamed');

    const copy = await duplicateAnalysis(saved.id);
    expect(copy.id).not.toBe(saved.id);
    expect((await listAnalyses()).items.length).toBe(2);

    await deleteAnalysis(saved.id);
    const list = await listAnalyses();
    expect(list.items.map((i) => i.id)).toEqual([copy.id]);
    await expect(getAnalysis(saved.id)).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('handles corrupt records', async () => {
    const db = await getDb();
    await db.put('analyses', { id: 'bad', schema: 1 } as never);
    await db.put('analyses', { id: 'repairable', pgn: PGN, tree: { broken: true } } as never);
    const list = await listAnalyses();
    expect(list.corrupt).toEqual(['bad']);
    expect(list.items.map((i) => i.id)).toEqual(['repairable']);
    await expect(getAnalysis('bad')).rejects.toMatchObject({ kind: 'corrupt' });
    const repaired = await getAnalysis('repairable');
    expect(mainline(repaired.tree).length).toBe(5);
    expect(() => validateSavedAnalysis(null)).toThrow(/corrupt/);
  });

  it('persists the engine cache with pruning', async () => {
    const cache = new AnalysisCache(10, idbCachePersistence, 3);
    cache.set({
      fen: START_FEN,
      depth: 12,
      evaluation: 20,
      mate: null,
      bestMove: 'e2e4',
      principalVariation: ['e2e4'],
      lines: [{ multipv: 1, depth: 12, score: { cp: 20, mate: null }, pv: ['e2e4'] }],
      multipv: 1,
      complete: true,
      source: 'engine',
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(await idbCachePersistence.count()).toBe(1);
    const fresh = new AnalysisCache(10, idbCachePersistence);
    expect((await fresh.get(START_FEN, 12, 1))?.bestMove).toBe('e2e4');
    await idbCachePersistence.deleteOldest(1);
    expect(await idbCachePersistence.count()).toBe(0);
  });
});

describe('share URLs', () => {
  it('round-trips a game through the URL hash', () => {
    const hash = encodeShare({ v: 1, pgn: PGN, ply: 3, orientation: 'b' });
    expect(hash.startsWith('#a=')).toBe(true);
    const d = decodeShare(hash);
    expect(d.ok && d.payload.pgn).toBe(PGN);
    expect(d.ok && d.payload.ply).toBe(3);
  });
  it('reports damaged links', () => {
    expect(decodeShare('#a=%%%garbage')).toMatchObject({ ok: false });
    expect(decodeShare('#a=@@')).toMatchObject({ ok: false });
    expect(decodeShare('')).toEqual({ ok: false, error: null });
  });
});
