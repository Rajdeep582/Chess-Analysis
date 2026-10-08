import { lineMaterialSwing, materialBalance, sacrificeAmount } from '../chess/material';
import type { Color } from '../chess/types';
import type { MoveContext, MoveMetrics } from './classification';

/**
 * Material given up by a move, in pawns:
 *  - static: what the opponent can win by force with captures (quiescence) relative to the
 *    material before the move;
 *  - engine: material balance after the engine's expected reply sequence (first 4 plies,
 *    settled), which catches sacrifices that are accepted a move later.
 */
export function sacrificeOf(ctx: Pick<MoveContext, 'fenBefore' | 'fenAfter' | 'color' | 'after' | 'uci'>): number {
  const opp: Color = ctx.color === 'w' ? 'b' : 'w';
  const quiet = sacrificeAmount(ctx.fenBefore, ctx.fenAfter, ctx.color);
  let engine = 0;
  const pv = ctx.after.principalVariation;
  // Only count the engine line when the opponent's best reply takes the piece that just moved
  // (an accepted sacrifice), not material lost elsewhere in an already bad position.
  if (pv.length >= 1 && pv[0].slice(2, 4) === ctx.uci.slice(2, 4)) {
    const before = materialBalance(ctx.fenBefore, ctx.color);
    const afterStatic = materialBalance(ctx.fenAfter, ctx.color);
    // Opponent POV swing along the PV → mover POV balance after the sequence.
    const swingOpp = lineMaterialSwing(ctx.fenAfter, pv, opp, Math.min(4, pv.length));
    const moverAfterSeq = afterStatic - swingOpp;
    engine = Math.max(0, before - moverAfterSeq);
  }
  return Math.max(quiet, engine);
}

/** Near-best tolerance: Chess.com is more generous with Brilliant for lower-rated players. */
function nearBestTolerance(rating: number | undefined, excellent: number, good: number): number {
  if (rating === undefined) return 0.03;
  if (rating < 1200) return good;
  if (rating < 1800) return 0.03;
  return excellent;
}

/**
 * Brilliant (Chess.com's published definition): a good piece sacrifice that is the best or
 * nearly best move, after which the player is not in a bad position, and where the player was
 * not already completely winning without it.
 */
export function isBrilliant(ctx: MoveContext, m: MoveMetrics, sacrifice = sacrificeOf(ctx)): { brilliant: boolean; sacrifice: number } {
  const t = ctx.thresholds;
  const no = { brilliant: false, sacrifice };
  if (m.loss > nearBestTolerance(ctx.rating, t.excellent, t.good)) return no;
  if (ctx.uci.length > 4) return no; // promotions are not sacrifices
  if (sacrifice < t.sacrificeMin) return no;
  if (m.epPlayed < 0.45) return no; // bad position afterwards
  if (m.secondEp !== undefined && m.secondEp >= 0.97) return no; // already completely winning anyway
  return { brilliant: true, sacrifice };
}
