import type { Color } from '../chess/types';
import { expectedPointsWhite } from '../engine/evalUtils';
import type { EngineScore } from '../engine/types';
import type { AccuracyResult } from './types';

/**
 * Accuracy model following the method published by Lichess (lichess.org/page/accuracy):
 *  - Win% = 50 + 50·(2 / (1 + e^(−0.00368208·cp)) − 1)
 *  - move accuracy = 103.1668·e^(−0.04354·ΔWin%) − 3.1669 (+1 uncertainty bonus), clamped 0..100
 *  - game accuracy = average of a volatility-weighted mean (sliding windows of Win%,
 *    std-dev clamped to [0.5, 12]) and the harmonic mean of the move accuracies.
 * Chess.com's CAPS2 is not public; this is the closest openly documented equivalent.
 */

/** Win% for White (0..100). Mates map to 0/100. */
export function winPercentWhite(score: EngineScore, terminal?: 'checkmate' | 'stalemate' | 'draw', winner?: Color): number {
  if (terminal === 'checkmate') return winner === 'w' ? 100 : 0;
  if (terminal) return 50;
  return expectedPointsWhite(score) * 100;
}

export function moveAccuracyFromWin(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const diff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * diff) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

/** Convenience: accuracy from an expected-points loss (0..1). */
export function moveAccuracy(loss: number): number {
  return loss <= 0 ? 100 : moveAccuracyFromWin(100, 100 - loss * 100);
}

function stdDev(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

/**
 * Volatility weight for each move. `whiteWin` has one entry per position (n moves → n+1 entries);
 * returns n weights.
 */
export function volatilityWeights(whiteWin: number[]): number[] {
  const n = whiteWin.length - 1;
  if (n <= 0) return [];
  const windowSize = Math.max(2, Math.min(8, Math.floor(whiteWin.length / 10)));
  const windows: number[][] = [];
  const first = whiteWin.slice(0, windowSize);
  for (let i = 0; i < Math.min(windowSize - 2, n); i++) windows.push(first);
  for (let i = 0; i + windowSize <= whiteWin.length && windows.length < n; i++) windows.push(whiteWin.slice(i, i + windowSize));
  while (windows.length < n) windows.push(whiteWin.slice(-windowSize));
  return windows.map((w) => Math.max(0.5, Math.min(12, stdDev(w))));
}

export interface AccuracyInputMove {
  color: Color;
  accuracy: number;
  weight: number;
  forced?: boolean;
}

/** (volatility-weighted mean + harmonic mean) / 2 over the given moves. */
export function aggregateAccuracy(moves: AccuracyInputMove[]): number | null {
  const own = moves.filter((m) => !m.forced);
  if (!own.length) return null;
  let ws = 0;
  let wa = 0;
  let inv = 0;
  for (const m of own) {
    ws += m.weight;
    wa += m.weight * m.accuracy;
    inv += 1 / Math.max(1, m.accuracy);
  }
  const weighted = wa / ws;
  const harmonic = own.length / inv;
  return Math.round(((weighted + harmonic) / 2) * 10) / 10;
}

export function gameAccuracy(moves: AccuracyInputMove[]): AccuracyResult {
  return {
    w: aggregateAccuracy(moves.filter((m) => m.color === 'w')),
    b: aggregateAccuracy(moves.filter((m) => m.color === 'b')),
  };
}
