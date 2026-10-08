import type { Color } from '../chess/types';
import { analysisExpectedWhite, expectedPointsWhite } from '../engine/evalUtils';
import type { EngineAnalysis, EngineLine, EngineScore } from '../engine/types';

/** Expected points for `color` from a full analysis. */
export function epFor(a: EngineAnalysis, color: Color, factor = 1): number {
  const w = analysisExpectedWhite(a, factor);
  return color === 'w' ? w : 1 - w;
}

export function lineEpFor(line: EngineLine, color: Color, factor = 1): number {
  const w = expectedPointsWhite(line.score, factor);
  return color === 'w' ? w : 1 - w;
}

export function scoreOf(a: EngineAnalysis): EngineScore {
  if (a.terminal === 'checkmate') return { cp: null, mate: 0 };
  if (a.terminal) return { cp: 0, mate: null };
  return { cp: a.evaluation, mate: a.mate };
}
