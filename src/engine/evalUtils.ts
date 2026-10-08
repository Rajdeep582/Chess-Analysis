import type { EngineAnalysis, EngineScore } from './types';
import type { Color } from '../chess/types';

/** Logistic coefficient mapping centipawns to expected points (fit used by several open-source tools). */
export const BASE_K = 0.00368208;

/** Optional rating adjustment: stronger players convert advantages more reliably. */
export function ratingFactor(rating?: number): number {
  if (!rating || !Number.isFinite(rating)) return 1;
  return Math.min(1.3, Math.max(0.65, 0.75 + (rating - 1000) / 2400));
}

/** Expected points for White in [0, 1]. */
export function expectedPointsWhite(score: EngineScore, factor = 1): number {
  if (score.mate !== null) {
    if (score.mate > 0) return 1;
    if (score.mate < 0) return 0;
    return 0.5; // mate 0 handled by callers through terminal info
  }
  const cp = score.cp ?? 0;
  return 1 / (1 + Math.exp(-BASE_K * factor * cp));
}

export function expectedPointsFor(score: EngineScore, color: Color, factor = 1): number {
  const w = expectedPointsWhite(score, factor);
  return color === 'w' ? w : 1 - w;
}

/** Expected points for White from a full analysis (handles terminal positions). */
export function analysisExpectedWhite(a: EngineAnalysis, factor = 1): number {
  if (a.terminal === 'checkmate') return a.winner === 'w' ? 1 : 0;
  if (a.terminal) return 0.5;
  return expectedPointsWhite({ cp: a.evaluation, mate: a.mate }, factor);
}

export function formatScore(score: EngineScore | null | undefined, opts: { terminal?: EngineAnalysis['terminal']; winner?: 'w' | 'b' } = {}): string {
  if (opts.terminal === 'checkmate') return opts.winner === 'w' ? '1-0' : '0-1';
  if (opts.terminal) return '½-½';
  if (!score) return '…';
  if (score.mate !== null) return score.mate >= 0 ? `M${Math.abs(Math.round(score.mate))}` : `M-${Math.abs(Math.round(score.mate))}`;
  const cp = score.cp ?? 0;
  const v = cp / 100;
  if (Math.abs(v) < 0.005) return '0.00';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
}

export function formatAnalysisEval(a: EngineAnalysis | null | undefined): string {
  if (!a) return '…';
  if (a.terminal) return formatScore(null, { terminal: a.terminal, winner: a.winner });
  if (a.evaluation === null && a.mate === null) return '…';
  return formatScore({ cp: a.evaluation, mate: a.mate });
}

/** Fraction of the eval bar filled by White (0..1), with a soft cap for large evaluations. */
export function evalBarFraction(a: EngineAnalysis | null | undefined): number {
  if (!a) return 0.5;
  if (a.terminal === 'checkmate') return a.winner === 'w' ? 1 : 0;
  if (a.terminal) return 0.5;
  if (a.mate !== null) return a.mate > 0 ? 1 : a.mate < 0 ? 0 : 0.5;
  if (a.evaluation === null) return 0.5;
  // Smooth saturating curve: ±4 pawns ≈ 90 %.
  const p = a.evaluation / 100;
  const f = 0.5 + 0.5 * Math.tanh(p / 3.6);
  return Math.min(0.97, Math.max(0.03, f));
}

export function formatNodes(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
