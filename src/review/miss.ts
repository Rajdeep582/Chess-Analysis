import type { MoveContext, MoveMetrics } from './classification';

/**
 * Miss: the opponent just made a significant error, a clear gain was available,
 * and the played move gives that opportunity back (without being worse than
 * before the opponent's error, which would be a plain mistake/blunder).
 */
export function isMiss(ctx: MoveContext, m: MoveMetrics): boolean {
  const t = ctx.thresholds;
  const prev = ctx.prev;
  if (!prev || prev.loss < t.missOpportunity) return false;
  if (m.loss <= t.good) return false;
  const opportunity = m.epBest - prev.epMoverBefore;
  if (opportunity < 0.08) return false;
  const kept = m.epPlayed - prev.epMoverBefore;
  if (kept > 0.03) return false;
  if (m.epPlayed < prev.epMoverBefore - t.inaccuracy) return false;
  return true;
}
