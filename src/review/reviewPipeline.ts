import { Chess } from 'chess.js';
import { mainline } from '../chess/tree';
import type { Color, GameTree } from '../chess/types';
import { uciLineToSan } from '../chess/uci';
import { analysisExpectedWhite, ratingFactor } from '../engine/evalUtils';
import type { AnalysisJob, AnalyzeOptions } from '../engine/StockfishManager';
import type { AnalysisRequest, EngineAnalysis } from '../engine/types';
import { aggregateAccuracy, moveAccuracyFromWin, volatilityWeights, winPercentWhite, type AccuracyInputMove } from './accuracy';
import { estimateStrength } from './elo';
import { dividePhases, phaseOfPly, type GamePhase } from './phases';
import { classifyMove, computeMetrics, type PreviousMoveInfo } from './classification';
import { CLASS_LABEL, findCriticalMoments } from './criticalMoments';
import { explainMove } from './explanations';
import { scoreOf } from './expectedPoints';
import { identifyOpening, type OpeningBook } from './openingBook';
import {
  CLASSIFICATION_ORDER,
  DEFAULT_THRESHOLDS,
  type GameReview,
  type MoveClassification,
  type MoveReview,
  type ReviewProgress,
  type ReviewSettings,
  type ReviewStatistics,
} from './types';

export interface ReviewInputMove {
  nodeId: string;
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  captured: boolean;
  to: string;
}

export interface ReviewInput {
  startFen: string;
  moves: ReviewInputMove[];
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  quickDepth: 12,
  deepDepth: 18,
  maxDeepPositions: 30,
  multipv: 2,
  thresholds: DEFAULT_THRESHOLDS,
};

export function collectMainline(tree: GameTree): ReviewInput {
  const ids = mainline(tree);
  const moves: ReviewInputMove[] = [];
  for (let i = 1; i < ids.length; i++) {
    const n = tree.nodes[ids[i]];
    const parent = tree.nodes[ids[i - 1]];
    moves.push({
      nodeId: n.id,
      ply: n.ply,
      moveNumber: n.moveNumber,
      color: n.color,
      san: n.san,
      uci: n.uci,
      fenBefore: parent.fen,
      fenAfter: n.fen,
      captured: !!n.captured,
      to: n.to ?? n.uci.slice(2, 4),
    });
  }
  return { startFen: tree.startFen, moves };
}

function emptyStats(): ReviewStatistics {
  const one = () => Object.fromEntries(CLASSIFICATION_ORDER.map((c) => [c, 0])) as Record<MoveClassification, number>;
  return { w: one(), b: one() };
}

/**
 * Pure review computation from engine analyses. `analyses[i]` is the analysis of the
 * position before move i (index 0 = start); `analyses[moves.length]` is the final position.
 */
export function buildReview(
  input: ReviewInput,
  analyses: EngineAnalysis[],
  settings: ReviewSettings,
  opts: { book?: OpeningBook | null; engineName?: string; elo?: { w?: number; b?: number }; result?: string } = {},
): GameReview {
  const t = settings.thresholds;
  const book = opts.book ?? null;
  const moves: MoveReview[] = [];
  let inBook = !!book && input.startFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
  let prev: PreviousMoveInfo | undefined;
  const phases: GamePhase[] = [];
  const allFens = [input.startFen, ...input.moves.map((m) => m.fenAfter)];
  const division = dividePhases(allFens);
  const whiteWin = analyses.slice(0, input.moves.length + 1).map((a) => winPercentWhite(scoreOf(a), a.terminal, a.winner));
  const weights = volatilityWeights(whiteWin);
  const accInputs: AccuracyInputMove[] = [];

  input.moves.forEach((mv, i) => {
    const before = analyses[i];
    const after = analyses[i + 1];
    const chess = new Chess(mv.fenBefore);
    const legalMoves = chess.moves().length;
    const inCheckBefore = chess.inCheck();
    const moveInBook = inBook && !!book && book.isBook(mv.fenAfter);
    if (!moveInBook) inBook = false;
    const rating = mv.color === 'w' ? settings.whiteRating : settings.blackRating;
    const factor = ratingFactor(rating);
    const res = classifyMove({
      color: mv.color,
      uci: mv.uci,
      fenBefore: mv.fenBefore,
      fenAfter: mv.fenAfter,
      before,
      after,
      thresholds: t,
      legalMoves,
      inCheckBefore,
      isBook: moveInBook,
      prev,
      factor,
      rating,
    });
    const m = res.metrics;
    // Accuracy uses rating-neutral Win% (Lichess method), so recompute with factor 1.
    const neutral = factor === 1 ? m : computeMetrics({ color: mv.color, uci: mv.uci, fenBefore: mv.fenBefore, fenAfter: mv.fenAfter, before, after, thresholds: t, legalMoves, inCheckBefore, isBook: false });
    const moveAcc = res.forced || m.loss <= 0 ? 100 : moveAccuracyFromWin(neutral.epBest * 100, Math.min(neutral.epBest, neutral.epPlayed) * 100);
    const phase = phaseOfPly(i, division);
    accInputs.push({ color: mv.color, accuracy: moveAcc, weight: weights[i] ?? 1, forced: res.forced });
    const bestMove = before.bestMove ?? before.lines[0]?.pv[0] ?? null;
    const bestLineSan = uciLineToSan(mv.fenBefore, before.lines[0]?.pv ?? [], 10);
    const playedLineSan = [mv.san, ...uciLineToSan(mv.fenAfter, after.principalVariation, 9)];
    const opening = moveInBook && book ? book.lookup(mv.fenAfter)?.name : undefined;
    phases.push(phase);
    const review: MoveReview = {
      ply: mv.ply,
      nodeId: mv.nodeId,
      moveNumber: mv.moveNumber,
      color: mv.color,
      san: mv.san,
      uci: mv.uci,
      fenBefore: mv.fenBefore,
      fenAfter: mv.fenAfter,
      epBefore: m.epBest,
      epAfter: m.epPlayed,
      epBest: m.epBest,
      evaluationBefore: scoreOf(before),
      evaluationAfter: scoreOf(after),
      evaluationLoss: res.forced ? 0 : m.loss,
      bestMove,
      bestMoveSan: bestLineSan[0] ?? null,
      secondBestEp: m.secondEp,
      classification: res.classification,
      accuracy: Math.round(moveAcc * 10) / 10,
      forced: res.forced,
      sacrifice: res.sacrifice,
      phase,
      principalVariation: before.lines[0]?.pv ?? [],
      bestLineSan,
      playedLineSan,
      depthBefore: before.depth,
      depthAfter: after.depth,
      opening,
    };
    review.explanation = explainMove({
      classification: res.classification,
      color: mv.color,
      san: mv.san,
      fenBefore: mv.fenBefore,
      fenAfter: mv.fenAfter,
      before,
      after,
      bestMoveSan: review.bestMoveSan,
      bestLineSan,
      sacrifice: res.sacrifice,
      prevLoss: prev?.loss,
      opening,
      forced: res.forced,
    });
    moves.push(review);
    prev = { loss: res.forced ? 0 : m.loss, epMoverBefore: 1 - m.epBest, captureSquare: mv.captured ? mv.to : undefined };
  });

  const stats = emptyStats();
  for (const m of moves) stats[m.color][m.classification]++;
  const accuracy = {
    w: aggregateAccuracy(accInputs.filter((x) => x.color === 'w')),
    b: aggregateAccuracy(accInputs.filter((x) => x.color === 'b')),
  };
  const phaseAcc = (c: Color, p: GamePhase) => aggregateAccuracy(accInputs.filter((x, i) => x.color === c && phases[i] === p));
  const phaseCount = (c: Color, p: GamePhase) => accInputs.filter((x, i) => x.color === c && phases[i] === p && !x.forced).length;
  const phaseMoves = {
    w: { opening: phaseCount('w', 'opening'), middlegame: phaseCount('w', 'middlegame'), endgame: phaseCount('w', 'endgame') },
    b: { opening: phaseCount('b', 'opening'), middlegame: phaseCount('b', 'middlegame'), endgame: phaseCount('b', 'endgame') },
  };
  const phaseAccuracy = {
    w: { opening: phaseAcc('w', 'opening'), middlegame: phaseAcc('w', 'middlegame'), endgame: phaseAcc('w', 'endgame') },
    b: { opening: phaseAcc('b', 'opening'), middlegame: phaseAcc('b', 'middlegame'), endgame: phaseAcc('b', 'endgame') },
  };
  const countOf = (c: Color) => moves.filter((m) => m.color === c && !m.forced).length;
  // Average centipawn loss per side (cp clamped to ±1000; mates count as ±1000).
  const cpOf = (a: EngineAnalysis) =>
    a.terminal === 'checkmate' ? (a.winner === 'w' ? 1000 : -1000) : a.terminal ? 0 : a.mate !== null ? (a.mate > 0 ? 1000 : -1000) : Math.max(-1000, Math.min(1000, a.evaluation ?? 0));
  const acplOf = (c: Color) => {
    const l: number[] = [];
    input.moves.forEach((mv, i) => {
      if (mv.color !== c) return;
      const sign = c === 'w' ? 1 : -1;
      l.push(Math.max(0, sign * cpOf(analyses[i]) - sign * cpOf(analyses[i + 1])));
    });
    return l.length ? Math.round((l.reduce((s, v) => s + v, 0) / l.length) * 10) / 10 : null;
  };
  const acpl = { w: acplOf('w'), b: acplOf('b') };
  const res = opts.result;
  const resultScore = (c: Color) => (res === '1-0' ? (c === 'w' ? 1 : 0) : res === '0-1' ? (c === 'b' ? 1 : 0) : res === '1/2-1/2' ? 0.5 : undefined);
  const strength = (c: Color) =>
    estimateStrength({
      accuracy: accuracy[c],
      opponentAccuracy: accuracy[c === 'w' ? 'b' : 'w'],
      acpl: acpl[c],
      opponentRating: opts.elo?.[c === 'w' ? 'b' : 'w'],
      score: resultScore(c),
      moves: countOf(c),
    });
  const strengthEst = { w: strength('w'), b: strength('b') };
  const estimatedElo = { w: strengthEst.w?.elo ?? null, b: strengthEst.b?.elo ?? null };
  const keyMoments = findCriticalMoments(moves);
  const positions = analyses.slice(0, input.moves.length + 1).map((a) => ({
    fen: a.fen,
    score: scoreOf(a),
    ep: analysisExpectedWhite(a),
    depth: a.depth,
    terminal: a.terminal,
    winner: a.winner,
  }));
  const fens = [input.startFen, ...input.moves.map((m) => m.fenAfter)];
  const opening = book ? identifyOpening(book, fens) ?? undefined : undefined;

  return {
    version: 1,
    createdAt: Date.now(),
    moves,
    positions,
    accuracy,
    stats,
    keyMoments,
    opening,
    settings,
    engine: opts.engineName ?? 'Stockfish',
    summary: buildSummary(moves, accuracy, opening?.name),
    improvementAreas: {
      w: improvementAreas(moves, phases, 'w', phaseAccuracy.w, phaseMoves.w),
      b: improvementAreas(moves, phases, 'b', phaseAccuracy.b, phaseMoves.b),
    },
    phaseAccuracy,
    phaseMoves,
    phases: division,
    estimatedElo,
    strength: strengthEst,
    acpl,
  };
}

function buildSummary(moves: MoveReview[], acc: GameReview['accuracy'], opening?: string): string[] {
  const out: string[] = [];
  if (opening) out.push(`Opening: ${opening}.`);
  const fmt = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
  out.push(`Accuracy — White ${fmt(acc.w)}, Black ${fmt(acc.b)}.`);
  const worst = [...moves].sort((a, b) => b.evaluationLoss - a.evaluationLoss)[0];
  if (worst && worst.evaluationLoss >= 0.1) {
    out.push(
      `Largest swing: ${worst.moveNumber}${worst.color === 'w' ? '.' : '…'} ${worst.san} (${CLASS_LABEL[worst.classification].toLowerCase()}, ${(worst.evaluationLoss * 100).toFixed(0)}% expected-points loss).`,
    );
  }
  const brill = moves.filter((m) => m.classification === 'brilliant');
  if (brill.length) out.push(`Brilliant: ${brill.map((m) => `${m.moveNumber}${m.color === 'w' ? '.' : '…'} ${m.san}`).join(', ')}.`);
  return out;
}

function improvementAreas(
  moves: MoveReview[],
  phases: GamePhase[],
  color: Color,
  phaseAcc?: Record<GamePhase, number | null>,
  phaseN?: Record<GamePhase, number>,
): string[] {
  const out: string[] = [];
  const own = moves.map((m, i) => ({ m, phase: phases[i] })).filter((x) => x.m.color === color && !x.m.forced);
  if (!own.length) return out;
  const byPhase: Record<GamePhase, number[]> = { opening: [], middlegame: [], endgame: [] };
  for (const x of own) byPhase[x.phase].push(x.m.accuracy);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  // Same phase accuracies as the "Accuracy by phase" table, so the two always agree.
  const scored = (Object.keys(byPhase) as GamePhase[])
    .filter((p) => (phaseN?.[p] ?? byPhase[p].length) >= 3)
    .map((p) => ({ p, v: phaseAcc?.[p] ?? avg(byPhase[p]), n: phaseN?.[p] ?? byPhase[p].length }))
    .filter((x) => x.v !== null) as { p: GamePhase; v: number; n: number }[];
  if (scored.length > 1) {
    const low = scored.sort((a, b) => a.v - b.v)[0];
    out.push(`Lowest accuracy in the ${low.p} (${low.v.toFixed(1)}% over ${low.n} moves).`);
  }
  const count = (c: MoveClassification) => own.filter((x) => x.m.classification === c).length;
  const misses = count('miss');
  if (misses) out.push(`${misses} missed opportunit${misses === 1 ? 'y' : 'ies'} after the opponent's errors.`);
  const hangs = own.filter((x) => x.m.explanation?.includes('can win by force with captures')).length;
  if (hangs) out.push(`${hangs} move${hangs === 1 ? '' : 's'} left material capturable by force.`);
  const mates = own.filter((x) => x.m.explanation?.includes('forced mate in')).length;
  if (mates) out.push(`${mates} move${mates === 1 ? '' : 's'} allowed a forced mate.`);
  const bl = count('blunder') + count('mistake');
  if (!bl && !misses) out.push('No mistakes or blunders — solid play throughout.');
  return out;
}

// ---------------------------------------------------------------- orchestration

export interface EngineLike {
  analyze(req: AnalysisRequest, opts?: AnalyzeOptions): AnalysisJob;
  cancelGroup(group: string): void;
}

export class ReviewCancelled extends Error {
  constructor() {
    super('Review cancelled');
    this.name = 'ReviewCancelled';
  }
}

/**
 * Three-phase review: (1) quick scan of every position, (2) deeper re-analysis of the
 * positions around critical moves, (3) final classification. Interactive exploration
 * afterwards uses the normal analysis path.
 */
export async function runReview(
  engine: EngineLike,
  input: ReviewInput,
  settings: ReviewSettings,
  opts: { book?: OpeningBook | null; engineName?: string; elo?: { w?: number; b?: number }; result?: string; onProgress?: (p: ReviewProgress) => void; signal?: AbortSignal; onPartial?: (r: GameReview) => void },
): Promise<GameReview> {
  const group = 'review';
  const fens = [input.startFen, ...input.moves.map((m) => m.fenAfter)];
  const analyses: EngineAnalysis[] = new Array(fens.length);
  const abort = () => engine.cancelGroup(group);
  opts.signal?.addEventListener('abort', abort);
  const check = () => {
    if (opts.signal?.aborted) throw new ReviewCancelled();
  };
  try {
    // Phase 1
    let done = 0;
    opts.onProgress?.({ phase: 'quick', done, total: fens.length, label: `Scanning positions (depth ${settings.quickDepth})` });
    await Promise.all(
      fens.map((fen, i) =>
        engine
          .analyze({ fen, limit: { kind: 'depth', depth: settings.quickDepth }, multipv: settings.multipv }, { priority: 2, group })
          .promise.then((a) => {
            analyses[i] = a;
            done++;
            opts.onProgress?.({ phase: 'quick', done, total: fens.length, label: `Scanning positions (depth ${settings.quickDepth})` });
          }),
      ),
    );
    check();
    if (analyses.some((a) => !a || (!a.lines.length && !a.terminal))) throw new Error('The engine returned an incomplete analysis.');
    let review = buildReview(input, analyses, settings, opts);
    opts.onPartial?.(review);

    // Phase 2
    if (settings.deepDepth > settings.quickDepth && settings.maxDeepPositions > 0) {
      const candidates = review.moves
        .filter(
          (m) =>
            !m.forced &&
            m.classification !== 'book' &&
            (m.evaluationLoss > settings.thresholds.good || ['brilliant', 'great', 'miss'].includes(m.classification) || m.sacrifice >= settings.thresholds.sacrificeMin),
        )
        // Sacrifices first (Brilliant candidates need depth to be confirmed), then by loss.
        .sort((a, b) => Number(b.sacrifice >= 2) - Number(a.sacrifice >= 2) || b.evaluationLoss - a.evaluationLoss)
        .slice(0, settings.maxDeepPositions);
      const idx = new Set<number>();
      for (const c of candidates) {
        idx.add(c.ply - review.moves[0].ply);
        idx.add(c.ply - review.moves[0].ply + 1);
      }
      const targets = [...idx].filter((i) => i >= 0 && i < fens.length && !analyses[i].terminal && analyses[i].depth < settings.deepDepth);
      let deepDone = 0;
      const label = `Deep analysis of critical positions (depth ${settings.deepDepth})`;
      opts.onProgress?.({ phase: 'deep', done: 0, total: targets.length, label });
      await Promise.all(
        targets.map((i) =>
          engine
            .analyze({ fen: fens[i], limit: { kind: 'depth', depth: settings.deepDepth }, multipv: settings.multipv }, { priority: 1, group })
            .promise.then((a) => {
              if (a.lines.length && a.depth >= analyses[i].depth) analyses[i] = a;
              deepDone++;
              opts.onProgress?.({ phase: 'deep', done: deepDone, total: targets.length, label });
            }),
        ),
      );
      check();
    }
    opts.onProgress?.({ phase: 'finalizing', done: 1, total: 1, label: 'Building review' });
    review = buildReview(input, analyses, settings, opts);
    return review;
  } finally {
    opts.signal?.removeEventListener('abort', abort);
  }
}
