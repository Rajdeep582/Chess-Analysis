import type { PieceSymbol } from '../chess/types';

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

/**
 * Game-phase division in the spirit of the Lichess "Divider":
 *  - the middlegame starts once minor+major pieces ≤ 10, or either back rank is sparse
 *    (fewer than 4 pieces left on the home rank);
 *  - the endgame starts once minor+major pieces ≤ 6.
 */
export function phaseFeatures(fen: string) {
  const rows = fen.split(' ')[0].split('/');
  let majorsMinors = 0;
  for (const ch of rows.join('')) if (/[nbrqNBRQ]/.test(ch)) majorsMinors++;
  const count = (row: string, upper: boolean) => [...row].filter((c) => /[a-zA-Z]/.test(c) && (upper ? c === c.toUpperCase() : c === c.toLowerCase())).length;
  const whiteBack = count(rows[7], true);
  const blackBack = count(rows[0], false);
  return { majorsMinors, backrankSparse: whiteBack < 4 || blackBack < 4 };
}

export interface PhaseDivision {
  middlegameStart: number | null;
  endgameStart: number | null;
}

/** `fens[i]` is the position after ply i (index 0 = start). Returns ply indices. */
export function dividePhases(fens: string[]): PhaseDivision {
  let middlegameStart: number | null = null;
  let endgameStart: number | null = null;
  fens.forEach((fen, i) => {
    const f = phaseFeatures(fen);
    if (middlegameStart === null && (f.majorsMinors <= 10 || f.backrankSparse)) middlegameStart = i;
    if (endgameStart === null && f.majorsMinors <= 6) endgameStart = i;
  });
  if (endgameStart !== null && (middlegameStart === null || middlegameStart > endgameStart)) middlegameStart = endgameStart;
  return { middlegameStart, endgameStart };
}

/** Phase of the move played from position index `ply - 1`. */
export function phaseOfPly(beforeIndex: number, d: PhaseDivision): GamePhase {
  if (d.endgameStart !== null && beforeIndex >= d.endgameStart) return 'endgame';
  if (d.middlegameStart !== null && beforeIndex >= d.middlegameStart) return 'middlegame';
  return 'opening';
}

export type { PieceSymbol };
