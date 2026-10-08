import type { Color } from '../chess/types';
import type { EngineAnalysis } from '../engine/types';
import { isBrilliant, sacrificeOf } from './brilliant';
import { epFor, lineEpFor } from './expectedPoints';
import { isGreat } from './great';
import { isMiss } from './miss';
import type { ClassificationThresholds, MoveClassification } from './types';

export interface PreviousMoveInfo {
  /** Expected-point loss of the opponent's previous move. */
  loss: number;
  /** Expected points for the current mover before the opponent's previous move. */
  epMoverBefore: number;
  /** Square the opponent captured on with the previous move, if any. */
  captureSquare?: string;
}

export interface MoveContext {
  color: Color;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  before: EngineAnalysis;
  after: EngineAnalysis;
  thresholds: ClassificationThresholds;
  legalMoves: number;
  inCheckBefore: boolean;
  isBook: boolean;
  prev?: PreviousMoveInfo;
  /** Rating-based logistic factor (1 = neutral). */
  factor?: number;
  /** Mover's rating if known (Chess.com scales some rules by rating). */
  rating?: number;
}

export interface MoveMetrics {
  epBest: number;
  epPlayed: number;
  secondEp?: number;
  loss: number;
  isEngineBest: boolean;
  playedLineIndex: number;
}

export function computeMetrics(ctx: MoveContext): MoveMetrics {
  const f = ctx.factor ?? 1;
  const epBest = epFor(ctx.before, ctx.color, f);
  const idx = ctx.before.lines.findIndex((l) => l.pv[0] === ctx.uci);
  const isEngineBest = !!ctx.before.bestMove && ctx.before.bestMove === ctx.uci;
  let epPlayed: number;
  if (ctx.after.terminal === 'checkmate') epPlayed = ctx.after.winner === ctx.color ? 1 : 0;
  else if (isEngineBest || idx === 0) epPlayed = epBest;
  else if (idx > 0) {
    // Same search as the best line: the most consistent comparison. Blend with the
    // dedicated analysis of the resulting position to reduce MultiPV noise.
    const lineEp = lineEpFor(ctx.before.lines[idx], ctx.color, f);
    const afterEp = epFor(ctx.after, ctx.color, f);
    epPlayed = ctx.after.depth >= ctx.before.lines[idx].depth ? Math.min(lineEp, afterEp) : lineEp;
  } else epPlayed = epFor(ctx.after, ctx.color, f);
  const second = ctx.before.lines[1];
  const secondEp = second ? lineEpFor(second, ctx.color, f) : undefined;
  const loss = isEngineBest ? 0 : Math.max(0, epBest - epPlayed);
  return { epBest, epPlayed, secondEp, loss, isEngineBest, playedLineIndex: idx };
}

export function baseClassification(loss: number, isBest: boolean, t: ClassificationThresholds): MoveClassification {
  if (isBest || loss <= t.best + 1e-4) return 'best';
  if (loss <= t.excellent) return 'excellent';
  if (loss <= t.good) return 'good';
  if (loss <= t.inaccuracy) return 'inaccuracy';
  if (loss <= t.mistake) return 'mistake';
  return 'blunder';
}

export interface ClassificationResult {
  classification: MoveClassification;
  metrics: MoveMetrics;
  forced: boolean;
  sacrifice: number;
}

export function classifyMove(ctx: MoveContext): ClassificationResult {
  const metrics = computeMetrics(ctx);
  const t = ctx.thresholds;
  const forced = ctx.legalMoves === 1;
  if (forced) return { classification: 'best', metrics: { ...metrics, loss: 0 }, forced, sacrifice: 0 };
  const sacrifice = sacrificeOf(ctx);
  if (ctx.isBook && metrics.loss <= t.good) return { classification: 'book', metrics, forced, sacrifice };

  let classification = baseClassification(metrics.loss, metrics.isEngineBest, t);
  if (isBrilliant(ctx, metrics, sacrifice).brilliant) classification = 'brilliant';
  else if (metrics.loss <= t.excellent && isGreat(ctx, metrics)) classification = 'great';
  else if (classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder') {
    if (isMiss(ctx, metrics)) classification = 'miss';
  }
  return { classification, metrics, forced, sacrifice };
}
