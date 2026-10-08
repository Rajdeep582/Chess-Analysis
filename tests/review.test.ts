import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyMove, type MoveContext } from '../src/review/classification';
import { isBrilliant } from '../src/review/brilliant';
import { isGreat } from '../src/review/great';
import { isMiss } from '../src/review/miss';
import { gameAccuracy, moveAccuracy, moveAccuracyFromWin, volatilityWeights, winPercentWhite } from '../src/review/accuracy';
import { dividePhases, phaseOfPly } from '../src/review/phases';
import { estimateElo } from '../src/review/elo';
import { findCriticalMoments } from '../src/review/criticalMoments';
import { collectMainline, runReview, DEFAULT_REVIEW_SETTINGS } from '../src/review/reviewPipeline';
import { createOpeningBook, type OpeningData } from '../src/review/openingBook';
import { DEFAULT_THRESHOLDS, type MoveReview } from '../src/review/types';
import { explainMove } from '../src/review/explanations';
import type { EngineAnalysis } from '../src/engine/types';
import { parsePgn } from '../src/chess/pgn';
import { AnalysisCache } from '../src/engine/analysisCache';
import { StockfishManager, type WorkerLike } from '../src/engine/StockfishManager';
import { createNodeWorker } from './helpers/nodeEngine';

function an(fen: string, lines: { cp?: number; mate?: number; pv: string[] }[], depth = 16): EngineAnalysis {
  const ls = lines.map((l, i) => ({ multipv: i + 1, depth, score: { cp: l.cp ?? null, mate: l.mate ?? null }, pv: l.pv }));
  return {
    fen,
    depth,
    evaluation: ls[0]?.score.cp ?? null,
    mate: ls[0]?.score.mate ?? null,
    bestMove: ls[0]?.pv[0] ?? null,
    principalVariation: ls[0]?.pv ?? [],
    lines: ls,
    multipv: ls.length,
    complete: true,
    source: 'engine',
  };
}

const base = (o: Partial<MoveContext>): MoveContext => ({
  color: 'w',
  uci: 'e2e4',
  fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  before: an('x', [{ cp: 30, pv: ['e2e4'] }, { cp: 25, pv: ['d2d4'] }]),
  after: an('y', [{ cp: 30, pv: ['e7e5'] }]),
  thresholds: DEFAULT_THRESHOLDS,
  legalMoves: 20,
  inCheckBefore: false,
  isBook: false,
  ...o,
});

describe('classification thresholds', () => {
  it('classifies by expected-point loss', () => {
    expect(classifyMove(base({})).classification).toBe('best');
    const cls = (cpAfter: number) =>
      classifyMove(base({ uci: 'a2a3', after: an('y', [{ cp: cpAfter, pv: ['e7e5'] }]) })).classification;
    expect(cls(25)).toBe('excellent'); // ~0.005
    expect(cls(-20)).toBe('good'); // ~0.046
    expect(cls(-60)).toBe('inaccuracy'); // ~0.08
    expect(cls(-140)).toBe('mistake'); // ~0.15
    expect(cls(-600)).toBe('blunder');
  });
  it('marks forced and book moves', () => {
    expect(classifyMove(base({ legalMoves: 1, uci: 'a2a3' })).forced).toBe(true);
    expect(classifyMove(base({ isBook: true, uci: 'd2d4', after: an('y', [{ cp: 25, pv: ['d7d5'] }]) })).classification).toBe('book');
    expect(classifyMove(base({ isBook: true, uci: 'g2g4', after: an('y', [{ cp: -300, pv: ['d7d5'] }]) })).classification).toBe('blunder');
  });
  it('uses configurable thresholds', () => {
    const strict = { ...DEFAULT_THRESHOLDS, excellent: 0.001, good: 0.002 };
    expect(classifyMove(base({ uci: 'a2a3', thresholds: strict, after: an('y', [{ cp: 25, pv: ['e7e5'] }]) })).classification).toBe('inaccuracy');
  });
});

describe('Brilliant heuristic', () => {
  // White queen sacrifice Qxh7+ style: queen on d3, black king g8; white plays Qh7+ into capture (simplified).
  const fenBefore = '6k1/5ppp/8/8/8/3Q4/5PPP/6K1 w - - 0 1';
  const fenAfterSac = '6k1/5ppQ/8/8/8/8/5PPP/6K1 b - - 0 1'; // queen on h7 can be taken by king
  it('requires a real sacrifice, near-best play and a good position', () => {
    const ctx = base({
      uci: 'd3h7',
      fenBefore,
      fenAfter: fenAfterSac,
      before: an('x', [{ cp: 250, pv: ['d3h7'] }, { cp: 40, pv: ['g2g3'] }]),
      after: an('y', [{ cp: 250, pv: ['g8h7'] }]),
    });
    const m = { epBest: 0.71, epPlayed: 0.71, secondEp: 0.54, loss: 0, isEngineBest: true, playedLineIndex: 0 };
    expect(isBrilliant(ctx, m).brilliant).toBe(true);
    expect(isBrilliant(ctx, { ...m, epPlayed: 0.3 }).brilliant).toBe(false); // bad position afterwards
    expect(isBrilliant({ ...ctx, rating: 2200 }, { ...m, loss: 0.025 }).brilliant).toBe(false); // strict for strong players
    expect(isBrilliant({ ...ctx, rating: 1000 }, { ...m, loss: 0.04 }).brilliant).toBe(true); // generous for newer players
    expect(isBrilliant(ctx, { ...m, loss: 0.08 }).brilliant).toBe(false); // not near-best
    expect(isBrilliant(ctx, { ...m, secondEp: 0.99 }).brilliant).toBe(false); // already completely winning
    const quiet = base({ uci: 'g2g3', fenBefore, fenAfter: '6k1/5ppp/8/8/8/3Q2P1/5P1P/6K1 b - - 0 1' });
    expect(isBrilliant(quiet, m).brilliant).toBe(false); // no sacrifice
  });
});

describe('Great heuristic', () => {
  const m = { epBest: 0.55, epPlayed: 0.55, secondEp: 0.2, loss: 0, isEngineBest: true, playedLineIndex: 0 };
  it('detects only-moves and rejects ordinary best moves', () => {
    expect(isGreat(base({}), m)).toBe(true);
    expect(isGreat(base({}), { ...m, secondEp: 0.53 })).toBe(false);
    expect(isGreat(base({}), { ...m, epBest: 0.1, secondEp: 0.0 })).toBe(false); // still lost
    expect(isGreat(base({ prev: { loss: 0.3, epMoverBefore: 0.4, captureSquare: 'e4' } }), m)).toBe(false); // recapture
  });
  it('detects punishing an opponent error', () => {
    const ctx = base({ prev: { loss: 0.25, epMoverBefore: 0.45 } });
    expect(isGreat(ctx, { ...m, epBest: 0.8, secondEp: 0.68 })).toBe(true);
  });
});

describe('Miss detection', () => {
  it('flags failing to exploit an opponent error', () => {
    const ctx = base({ prev: { loss: 0.3, epMoverBefore: 0.5 } });
    expect(isMiss(ctx, { epBest: 0.85, epPlayed: 0.5, loss: 0.35, isEngineBest: false, playedLineIndex: -1 })).toBe(true);
    // No opponent error -> not a miss
    expect(isMiss(base({ prev: { loss: 0.02, epMoverBefore: 0.5 } }), { epBest: 0.85, epPlayed: 0.5, loss: 0.35, isEngineBest: false, playedLineIndex: -1 })).toBe(false);
    // Worse than before the opponent's error -> plain blunder
    expect(isMiss(ctx, { epBest: 0.85, epPlayed: 0.2, loss: 0.65, isEngineBest: false, playedLineIndex: -1 })).toBe(false);
  });
});

describe('Accuracy (Lichess method)', () => {
  it('uses the published Win% and move-accuracy formulas', () => {
    expect(winPercentWhite({ cp: 0, mate: null })).toBeCloseTo(50);
    expect(winPercentWhite({ cp: 100, mate: null })).toBeCloseTo(59.1, 0);
    expect(moveAccuracyFromWin(60, 60)).toBe(100);
    expect(moveAccuracyFromWin(50, 40)).toBeCloseTo(103.1668 * Math.exp(-0.04354 * 10) - 3.1669 + 1, 1);
    expect(moveAccuracyFromWin(100, 0)).toBe(0);
    expect(moveAccuracy(0)).toBe(100);
    expect(moveAccuracy(0.05)).toBeGreaterThan(moveAccuracy(0.1));
  });
  it('weights by volatility and blends with the harmonic mean', () => {
    const series = Array.from({ length: 41 }, (_, i) => 50 + (i > 30 ? 30 : 0));
    const w = volatilityWeights(series);
    expect(w.length).toBe(40);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...w)).toBeLessThanOrEqual(12);
    const mk = (accuracy: number) => ({ color: 'w' as const, accuracy, weight: 1 });
    const clean = gameAccuracy(Array.from({ length: 30 }, () => mk(95))).w!;
    const oneBlunder = gameAccuracy([...Array.from({ length: 29 }, () => mk(95)), mk(5)]).w!;
    expect(clean).toBeCloseTo(95);
    expect(oneBlunder).toBeLessThan(clean - 10);
    expect(gameAccuracy([]).w).toBeNull();
  });
});

describe('Game phases & Elo estimate', () => {
  it('divides opening / middlegame / endgame like the Lichess divider', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const mid = 'r2q1rk1/pp3ppp/2n5/3p4/3P4/2N5/PP3PPP/R2Q1RK1 w - - 0 15';
    const end = '6k1/5ppp/8/3r4/8/8/5PPP/3R2K1 w - - 0 40';
    const d = dividePhases([start, start, mid, mid, end]);
    expect(d).toEqual({ middlegameStart: 2, endgameStart: 4 });
    expect(phaseOfPly(0, d)).toBe('opening');
    expect(phaseOfPly(3, d)).toBe('middlegame');
    expect(phaseOfPly(4, d)).toBe('endgame');
  });
  it('maps accuracy to an approximate rating', () => {
    expect(estimateElo(76.5, 30)).toBe(1000);
    expect(estimateElo(84, 30)).toBe(2000);
    expect(estimateElo(92.5, 30)).toBe(2850);
    expect(estimateElo(90, 3)).toBeNull();
    expect(estimateElo(null, 30)).toBeNull();
  });
});

describe('Critical moments & explanations', () => {
  it('collects notable moves and turning points', () => {
    const mv = (ply: number, classification: MoveReview['classification'], epBefore: number, epAfter: number) =>
      ({ ply, nodeId: `n${ply}`, color: ply % 2 ? 'w' : 'b', san: 'x', moveNumber: 1, classification, epBefore, epAfter, evaluationBefore: { cp: 0, mate: null }, evaluationAfter: { cp: 0, mate: null } }) as unknown as MoveReview;
    const km = findCriticalMoments([mv(1, 'best', 0.5, 0.5), mv(2, 'blunder', 0.5, 0.1), mv(3, 'good', 0.75, 0.3)]);
    expect(km.map((k) => k.kind)).toEqual(['classification', 'turning-point']);
  });
  it('explains blunders factually from engine output', () => {
    const fenBefore = '4k3/8/8/8/8/8/3Q4/4K3 w - - 0 1';
    const fenAfter = '4k3/8/4p3/3Q4/8/8/8/4K3 b - - 0 1';
    const text = explainMove({
      classification: 'blunder',
      color: 'w',
      san: 'Qd5',
      fenBefore,
      fenAfter,
      before: an(fenBefore, [{ cp: 900, pv: ['d2d7'] }]),
      after: an(fenAfter, [{ cp: 0, pv: ['e6d5'] }]),
      bestMoveSan: 'Qd7+',
      bestLineSan: ['Qd7+', 'Kf8'],
      sacrifice: 0,
    });
    expect(text).toMatch(/from \+9\.00 to 0\.00/);
    expect(text).toMatch(/can win by force/);
    expect(text).toMatch(/Better was Qd7\+/);
  });
});

describe('Opening book', () => {
  it('recognizes real opening positions from the bundled dataset', () => {
    const data = JSON.parse(readFileSync('public/data/openings.json', 'utf8')) as OpeningData;
    const book = createOpeningBook(data);
    expect(book.size).toBeGreaterThan(5000);
    const p = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 *');
    const ml = collectMainline(p.tree);
    expect(book.isBook(ml.moves[4].fenAfter)).toBe(true);
    expect(book.lookup(ml.moves[4].fenAfter)?.name).toMatch(/Ruy Lopez/);
  });
});

describe('Review pipeline with real Stockfish', () => {
  const procs: { kill: () => void }[] = [];
  afterAll(() => procs.forEach((p) => p.kill()));
  it('reviews a short game: finds the blunder and the mate', async () => {
    const m = new StockfishManager({
      cache: new AnalysisCache(),
      engineBaseUrl: '/engine',
      flavors: ['lite-single'],
      threads: 1,
      hashMb: 16,
      createWorker: () => {
        const w = createNodeWorker();
        procs.push(w.proc);
        return w as WorkerLike;
      },
    });
    await m.start();
    const p = parsePgn('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0');
    const input = collectMainline(p.tree);
    const book = createOpeningBook(JSON.parse(readFileSync('public/data/openings.json', 'utf8')) as OpeningData);
    const progress: string[] = [];
    const review = await runReview(m, input, { ...DEFAULT_REVIEW_SETTINGS, quickDepth: 10, deepDepth: 14 }, { book, onProgress: (pr) => progress.push(pr.phase) });
    const cls = review.moves.map((x) => x.classification);
    expect(cls[5]).toBe('blunder'); // 3...Nf6??
    expect(review.moves[5].explanation).toMatch(/forced mate in 1/);
    expect(review.moves[5].bestMoveSan).toMatch(/g6|Qe7|Qf6/);
    expect(['best', 'great']).toContain(cls[6]); // 4.Qxf7#
    expect(cls[0]).toBe('book');
    expect(review.accuracy.b!).toBeLessThan(review.accuracy.w!);
    expect(review.keyMoments.some((k) => k.ply === 6)).toBe(true);
    expect(review.positions.length).toBe(8);
    expect(review.positions[7].terminal).toBe('checkmate');
    expect(progress).toContain('quick');
    expect(progress).toContain('deep');
    m.dispose();
  });
});
