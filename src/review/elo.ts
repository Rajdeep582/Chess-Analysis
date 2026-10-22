/**
 * Playing-strength estimate for one game ("Played like").
 *
 * Chess.com describes its Game Rating as comparing the quality of your moves with what is expected from
 * a player at your rating level (support.chess.com, "How is Game Rating calculated"); its formula is not
 * public and Lichess publishes no such number. This model follows that idea and is calibrated on 374 rated
 * Chess.com games (748 player-games, ratings 100–3300, blitz/rapid/daily) analysed with Stockfish 19 Lite
 * at depth 12, the same engine and formulas this app uses:
 *
 *  1. Move quality → a single quality score Q (Elo units) from engine data per move: accuracy, average
 *     centipawn loss, best-move match rate, blunder rate (≥20 Win% lost), share of near-perfect moves
 *     (<2 Win% lost) and mean Win% lost.
 *  2. With the player's own rating in the PGN (Chess.com style): rating + how far Q is above/below what
 *     that rating normally plays. Averages out to the real rating over many games.
 *  3. With only the opponent's rating: opponent rating + quality deviation + result (≈ 110 Elo error).
 *  4. With no ratings: Q alone. One game of moves is a weak signal (≈ 490 Elo error), so the range is wide.
 */

export interface StrengthInput {
  accuracy: number | null;
  opponentAccuracy: number | null;
  /** Average centipawn loss (cp clamped to ±1000 per position). */
  acpl: number | null;
  /** Share of non-forced moves that matched the engine's best move (0..1). */
  bestRate?: number;
  /** Share of non-forced moves losing ≥ 20 Win% (0..1). */
  blunderRate?: number;
  /** Share of non-forced moves losing < 2 Win% (0..1). */
  goodRate?: number;
  /** Mean Win% lost per non-forced move. */
  meanWinLoss?: number;
  ownRating?: number;
  opponentRating?: number;
  /** 1 win, 0.5 draw, 0 loss; undefined if unknown. */
  score?: number;
  moves: number;
}

export interface StrengthEstimate {
  elo: number;
  low: number;
  high: number;
  method: 'rating' | 'performance' | 'quality';
}

// Ridge regression of rating on per-game engine features (see header).
const W = { c: 2264.962, acc: 21.385, lnAcpl: -1290.237, best: 1925.906, blunder: -515.231, good: 527.678, lnWinLoss: 1252.81 };
// What Q typically is for a player of rating R: E[Q | R] = Q0 + QS·R (Q regresses towards the mean).
const Q0 = 614.1;
const QS = 0.5497;
const Q_MEAN = 1367.5;

/** Single-number move-quality score in Elo units (regressed towards the population mean). */
export function qualityScore(i: StrengthInput): number | null {
  if (i.accuracy === null || i.acpl === null) return null;
  const best = i.bestRate ?? 0.4;
  const blunder = i.blunderRate ?? 0.05;
  const good = i.goodRate ?? 0.6;
  const wl = i.meanWinLoss ?? 4;
  return W.c + W.acc * i.accuracy + W.lnAcpl * Math.log(i.acpl + 5) + W.best * best + W.blunder * blunder + W.good * good + W.lnWinLoss * Math.log(wl + 0.5);
}

/** Quality deviation from what a `rating`-level player normally plays, converted back to Elo. */
function deviationAt(q: number, rating: number): number {
  return (q - (Q0 + QS * rating)) / QS;
}

const round50 = (v: number) => Math.round(v / 50) * 50;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function estimateStrength(i: StrengthInput): StrengthEstimate | null {
  if (i.accuracy === null || i.moves < 6) return null;
  const q = qualityScore(i);
  // Fewer moves → less evidence → smaller swing away from the anchor.
  const evidence = i.moves / (i.moves + 12);
  if (i.ownRating && i.ownRating > 0 && q !== null) {
    const own = i.ownRating;
    const swing = clamp(0.3 * evidence * deviationAt(q, own), -500, 500);
    const elo = round50(clamp(own + swing, 100, 3400));
    const spread = i.moves < 15 ? 200 : 150;
    return { elo, low: round50(Math.max(100, elo - spread)), high: round50(elo + spread), method: 'rating' };
  }
  if (i.opponentRating && i.opponentRating > 0) {
    const o = i.opponentRating;
    let delta = q !== null ? 0.062 * evidence * deviationAt(q, o) : 0;
    if (i.score !== undefined) delta += 55 * (2 * i.score - 1);
    const elo = round50(clamp(o + clamp(delta, -450, 450), 100, 3400));
    const spread = i.moves < 15 ? 200 : 150;
    return { elo, low: round50(Math.max(100, elo - spread)), high: round50(elo + spread), method: 'performance' };
  }
  if (q === null) return null;
  // Stretch slightly away from the mean (fitted to equalise error across rating bands).
  const elo = round50(clamp(Q_MEAN + 1.2 * (q - Q_MEAN) + 50, 100, 3200));
  const spread = i.moves < 20 ? 500 : 450;
  return { elo, low: round50(Math.max(100, elo - spread)), high: round50(elo + spread), method: 'quality' };
}


export function eloBand(elo: number): string {
  if (elo >= 2500) return 'Grandmaster level';
  if (elo >= 2200) return 'Master level';
  if (elo >= 1800) return 'Expert';
  if (elo >= 1400) return 'Club player';
  if (elo >= 1000) return 'Intermediate';
  if (elo >= 600) return 'Improving beginner';
  return 'Beginner';
}
