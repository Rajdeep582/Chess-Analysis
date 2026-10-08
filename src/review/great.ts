import type { MoveContext, MoveMetrics } from './classification';

/** Outcome bucket from expected points: 0 losing, 1 roughly equal / unclear, 2 winning. */
export function outcomeBucket(ep: number): 0 | 1 | 2 {
  if (ep >= 0.75) return 2;
  if (ep <= 0.25) return 0;
  return 1;
}

/**
 * Great (Chess.com's published definition): a move critical to the outcome — turning a losing
 * position into equal, equal into winning, or finding the only good move.
 */
export function isGreat(ctx: MoveContext, m: MoveMetrics): boolean {
  const t = ctx.thresholds;
  if (m.loss > t.excellent || ctx.legalMoves <= 1 || m.secondEp === undefined) return false;
  if (ctx.after.terminal === 'checkmate') return false; // delivering mate is simply best
  if (ctx.inCheckBefore && ctx.legalMoves <= 3) return false;
  // Obvious recapture on the square the opponent just captured on.
  if (ctx.prev?.captureSquare && ctx.uci.slice(2, 4) === ctx.prev.captureSquare) return false;
  if (m.secondEp >= 0.9) return false; // other moves win just as well
  const gap = m.epBest - m.secondEp;
  const bestBucket = outcomeBucket(m.epBest);
  // Only good move: every alternative changes the outcome (or loses a lot).
  const onlyMove = (gap >= 0.1 && outcomeBucket(m.secondEp) < bestBucket) || gap >= t.onlyMoveGap + 0.05;
  // Turning point: after the opponent's error, the precise move lifts the outcome bucket.
  const turning =
    !!ctx.prev && ctx.prev.loss >= t.missOpportunity && gap >= 0.08 && bestBucket > outcomeBucket(ctx.prev.epMoverBefore);
  return (onlyMove && m.epBest >= 0.3) || turning;
}
