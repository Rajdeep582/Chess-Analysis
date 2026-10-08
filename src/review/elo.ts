/**
 * Playing-strength estimate for one game.
 *
 * Calibrated on 265 rated Chess.com games (530 player-games, ratings 100–3300) sampled at random
 * from country and titled-player lists and analysed with this app's own engine pipeline.
 * Findings that shape the model:
 *  - single-game accuracy alone is a weak predictor (mean error ≈ 450 Elo);
 *  - when the opponent's rating is known it is by far the best anchor (≈ 80 Elo error), with the
 *    result and the accuracy gap versus what that rating level normally plays adding a small correction.
 * So: with ratings in the PGN → performance-style estimate (tight range);
 * without ratings → quality-only estimate from accuracy and average centipawn loss (wide range).
 */

export interface StrengthInput {
  accuracy: number | null;
  opponentAccuracy: number | null;
  /** Average centipawn loss (cp clamped to ±1000 per position). */
  acpl: number | null;
  opponentRating?: number;
  /** 1 win, 0.5 draw, 0 loss; undefined if unknown. */
  score?: number;
  moves: number;
}

export interface StrengthEstimate {
  elo: number;
  low: number;
  high: number;
  method: 'performance' | 'quality';
}

/** Typical accuracy (this app's Lichess-style formula) at a given Chess.com rating, fitted on the sample. */
export function typicalAccuracy(rating: number): number {
  const r = rating / 1000;
  return 56.9 + 25.57 * r - 5.212 * r * r;
}

const ACPL_CURVE: [number, number][] = [
  [6, 3000],
  [10, 2850],
  [15, 2600],
  [22, 2200],
  [30, 1700],
  [40, 1300],
  [55, 950],
  [75, 650],
  [110, 400],
  [170, 200],
  [300, 100],
];
const ACC_CURVE: [number, number][] = [
  [35, 150],
  [45, 300],
  [55, 380],
  [65, 520],
  [72, 650],
  [77, 820],
  [82, 1050],
  [86, 1450],
  [90, 2050],
  [94, 2500],
  [97, 2850],
];

function interp(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return curve[curve.length - 1][1];
}

const round50 = (v: number) => Math.round(v / 50) * 50;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function estimateStrength(i: StrengthInput): StrengthEstimate | null {
  if (i.accuracy === null || i.moves < 6) return null;
  if (i.opponentRating && i.opponentRating > 0) {
    const o = i.opponentRating;
    const exp = typicalAccuracy(o);
    let delta = 4 * (i.accuracy - exp);
    if (i.opponentAccuracy !== null) delta -= 2 * (i.opponentAccuracy - exp);
    if (i.score !== undefined) delta += 40 * (2 * i.score - 1);
    const elo = round50(clamp(o + clamp(delta, -450, 450), 100, 3400));
    const spread = i.moves < 15 ? 200 : 100;
    return { elo, low: round50(Math.max(100, elo - spread)), high: round50(elo + spread), method: 'performance' };
  }
  const byAcc = interp(ACC_CURVE, i.accuracy);
  const byAcpl = i.acpl !== null ? interp(ACPL_CURVE, i.acpl) : byAcc;
  const elo = round50(clamp((byAcc + byAcpl) / 2, 100, 3200));
  const spread = i.moves < 20 ? 500 : 400;
  return { elo, low: round50(Math.max(100, elo - spread)), high: round50(elo + spread), method: 'quality' };
}

/** Back-compat helper: quality-only estimate from accuracy. */
export function estimateElo(accuracy: number | null, moves: number): number | null {
  return estimateStrength({ accuracy, opponentAccuracy: null, acpl: null, moves })?.elo ?? null;
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
