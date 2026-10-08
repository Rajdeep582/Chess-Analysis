/**
 * Approximate playing strength from game accuracy. Calibrated on published samples of average
 * Chess.com accuracy by rating (e.g. ~70 % ≈ 400, ~76.5 % ≈ 1000, ~80.5 % ≈ 1600, ~84 % ≈ 2000,
 * ~87 % ≈ 2300, ~91–92 % ≈ 2750–2850; rule of thumb Elo ≈ (accuracy − 64)·100).
 * A single game is noisy — this is an indication, not a rating.
 */
const CURVE: [number, number][] = [
  [40, 100],
  [60, 250],
  [69, 400],
  [76.5, 1000],
  [80.5, 1600],
  [84, 2000],
  [87, 2300],
  [90, 2600],
  [92.5, 2850],
  [96, 3000],
];

export function estimateElo(accuracy: number | null, moves: number): number | null {
  if (accuracy === null || moves < 6) return null;
  let elo = CURVE[0][1];
  for (let i = 1; i < CURVE.length; i++) {
    const [a0, e0] = CURVE[i - 1];
    const [a1, e1] = CURVE[i];
    if (accuracy <= a1) {
      elo = e0 + ((accuracy - a0) / (a1 - a0)) * (e1 - e0);
      break;
    }
    elo = e1;
  }
  if (accuracy < CURVE[0][0]) elo = CURVE[0][1];
  return Math.round(elo / 50) * 50;
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
