import { formatScore } from '../engine/evalUtils';
import type { CriticalMoment, MoveClassification, MoveReview } from './types';

export const CLASS_LABEL: Record<MoveClassification, string> = {
  brilliant: 'Brilliant',
  great: 'Great',
  best: 'Best',
  excellent: 'Excellent',
  good: 'Good',
  book: 'Book',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  miss: 'Miss',
  blunder: 'Blunder',
};

const MOMENT_CLASSES: MoveClassification[] = ['brilliant', 'great', 'miss', 'blunder', 'mistake', 'inaccuracy'];

/**
 * Key moments: notable classifications plus turning points where the expected
 * result changed hands (crossing from one side's advantage to the other's).
 */
export function findCriticalMoments(moves: MoveReview[], opts: { includeInaccuracies?: boolean } = {}): CriticalMoment[] {
  const out: CriticalMoment[] = [];
  const classes = opts.includeInaccuracies === false ? MOMENT_CLASSES.filter((c) => c !== 'inaccuracy') : MOMENT_CLASSES;
  for (const m of moves) {
    const whiteBefore = m.color === 'w' ? m.epBefore : 1 - m.epBefore;
    const whiteAfter = m.color === 'w' ? m.epAfter : 1 - m.epAfter;
    const swing = whiteAfter - whiteBefore;
    const base = {
      ply: m.ply,
      nodeId: m.nodeId,
      color: m.color,
      san: m.san,
      moveNumber: m.moveNumber,
      classification: m.classification,
      epSwing: swing,
      evalBefore: formatScore(m.evaluationBefore),
      evalAfter: formatScore(m.evaluationAfter),
    };
    if (classes.includes(m.classification)) {
      out.push({ ...base, title: CLASS_LABEL[m.classification], kind: 'classification' });
    } else {
      const crossed = (whiteBefore - 0.5) * (whiteAfter - 0.5) < 0 && Math.abs(swing) >= 0.25;
      if (crossed) out.push({ ...base, title: 'Turning point', kind: 'turning-point' });
    }
  }
  return out.sort((a, b) => a.ply - b.ply);
}

/** Positions where precision mattered most: large gap between best and second-best move. */
export function criticalPositions(moves: MoveReview[], threshold = 0.15): number[] {
  return moves
    .filter((m) => m.secondBestEp !== undefined && m.epBest - m.secondBestEp >= threshold)
    .map((m) => m.ply);
}
