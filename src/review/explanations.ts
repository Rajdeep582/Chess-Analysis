import { Chess } from 'chess.js';
import { lineMaterialSwing, PIECE_NAMES, quiescenceGain } from '../chess/material';
import type { Color, PieceSymbol } from '../chess/types';
import { formatLine } from '../chess/uci';
import { formatScore } from '../engine/evalUtils';
import type { EngineAnalysis } from '../engine/types';
import { scoreOf } from './expectedPoints';
import type { MoveClassification } from './types';
import { CLASS_LABEL } from './criticalMoments';

export interface ExplainInput {
  classification: MoveClassification;
  color: Color;
  san: string;
  fenBefore: string;
  fenAfter: string;
  before: EngineAnalysis;
  after: EngineAnalysis;
  bestMoveSan: string | null;
  bestLineSan: string[];
  sacrifice: number;
  prevLoss?: number;
  opening?: string;
  forced?: boolean;
}

const sideName = (c: Color) => (c === 'w' ? 'White' : 'Black');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Deterministic explanation layer. Every statement is derived from engine output
 * (scores, principal variations) or from exact material counting — no invented strategy.
 */
export function explainMove(i: ExplainInput): string {
  const opp: Color = i.color === 'w' ? 'b' : 'w';
  const out: string[] = [];
  const evBefore = formatScore(scoreOf(i.before), { terminal: i.before.terminal, winner: i.before.winner });
  const evAfter = formatScore(scoreOf(i.after), { terminal: i.after.terminal, winner: i.after.winner });

  if (i.forced) return `${i.san} was the only legal move.`;
  if (i.after.terminal === 'checkmate') return `${i.san} delivers checkmate.`;
  if (i.classification === 'book') return `A known opening move${i.opening ? ` (${i.opening})` : ''}.`;

  const bestInfo = describeBest(i);

  switch (i.classification) {
    case 'brilliant':
      out.push(
        `${i.san} gives up about ${plural(Math.round(i.sacrifice), 'point')} of material, and the engine confirms it is the strongest continuation (${evAfter}).`,
      );
      break;
    case 'great': {
      const second = i.before.lines[1];
      if (second) {
        const secondSan = sanOf(i.fenBefore, second.pv[0]);
        out.push(
          `A critical find: the next best option${secondSan ? ` (${secondSan})` : ''} is evaluated at ${formatScore(second.score)}, while ${i.san} keeps ${evAfter}.`,
        );
      } else out.push(`${i.san} is the engine's top choice in a critical position.`);
      break;
    }
    case 'best':
      out.push(`${i.san} is the engine's top choice. Evaluation: ${evAfter}.`);
      break;
    case 'excellent':
    case 'good':
      out.push(`${CLASS_LABEL[i.classification]} move. The evaluation changed only slightly (${evBefore} → ${evAfter}).`);
      if (bestInfo) out.push(`The engine slightly preferred ${bestInfo}.`);
      break;
    default: {
      out.push(`This move changed the evaluation from ${evBefore} to ${evAfter}.`);
      const consequences = describeConsequences(i, opp);
      out.push(...consequences);
      if (i.classification === 'miss') {
        out.push(`${sideName(opp)}'s previous move was an error that this move did not take advantage of.`);
      }
      if (bestInfo) out.push(`Better was ${bestInfo}.`);
      if (i.bestLineSan.length > 1) out.push(`Engine continuation: ${formatLine(i.fenBefore, i.bestLineSan.slice(0, 8))}`);
    }
  }
  return out.join('\n');
}

function sanOf(fen: string, uci?: string): string | null {
  if (!uci) return null;
  try {
    const c = new Chess(fen);
    return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return null;
  }
}

function describeBest(i: ExplainInput): string | null {
  const top = i.before.lines[0];
  if (!top || !i.bestMoveSan) return null;
  const parts: string[] = [i.bestMoveSan];
  const mateForMover = top.score.mate !== null && (i.color === 'w' ? top.score.mate > 0 : top.score.mate < 0);
  try {
    const c = new Chess(i.fenBefore);
    const m = c.move({ from: top.pv[0].slice(0, 2), to: top.pv[0].slice(2, 4), promotion: top.pv[0][4] });
    if (m.captured) parts.push(`capturing the ${PIECE_NAMES[m.captured as PieceSymbol]} on ${m.to}`);
  } catch {
    /* ignore */
  }
  if (mateForMover) parts.push(`which forces mate in ${Math.abs(top.score.mate!)}`);
  else {
    const swing = lineMaterialSwing(i.fenBefore, top.pv, i.color, 8);
    if (swing >= 2) parts.push(`which wins material in the engine line (about ${plural(Math.round(swing), 'point')})`);
    else parts.push(`(${formatScore(top.score)})`);
  }
  return parts.join(', ').replace(', (', ' (');
}

function describeConsequences(i: ExplainInput, opp: Color): string[] {
  const out: string[] = [];
  const a = i.after;
  const mateForOpp = a.mate !== null && (opp === 'w' ? a.mate > 0 : a.mate < 0);
  if (mateForOpp) {
    out.push(`It allows ${sideName(opp)} a forced mate in ${Math.abs(a.mate!)}.`);
    return out;
  }
  const hanging = quiescenceGain(i.fenAfter);
  if (hanging >= 2) {
    out.push(`It leaves material that ${sideName(opp)} can win by force with captures (about ${plural(Math.round(hanging), 'point')}).`);
    return out;
  }
  if (a.principalVariation.length) {
    const swing = lineMaterialSwing(i.fenAfter, a.principalVariation, opp, 10);
    if (swing >= 2) {
      out.push(`In the engine's main line ${sideName(opp)} wins about ${plural(Math.round(swing), 'point')} of material through a tactical sequence.`);
      return out;
    }
  }
  const bestMate = i.before.lines[0]?.score.mate;
  if (bestMate !== null && bestMate !== undefined && (i.color === 'w' ? bestMate > 0 : bestMate < 0)) {
    out.push(`A forced mate was available.`);
  }
  return out;
}
