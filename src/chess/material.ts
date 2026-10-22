import { Chess, type Move } from 'chess.js';
import type { Color, PieceSymbol } from './types';

export const PIECE_VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAMES: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export interface MaterialCount {
  w: number;
  b: number;
  pieces: Record<Color, Record<PieceSymbol, number>>;
}

export function countMaterial(fen: string): MaterialCount {
  const placement = fen.split(' ')[0];
  const pieces: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const ch of placement) {
    if (!/[prnbqk]/i.test(ch)) continue;
    const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
    pieces[color][ch.toLowerCase() as PieceSymbol]++;
  }
  const sum = (c: Color) => (Object.keys(pieces[c]) as PieceSymbol[]).reduce((s, p) => s + pieces[c][p] * PIECE_VALUES[p], 0);
  return { w: sum('w'), b: sum('b'), pieces };
}

/** Material balance from `color`'s point of view. */
export function materialBalance(fen: string, color: Color): number {
  const m = countMaterial(fen);
  return color === 'w' ? m.w - m.b : m.b - m.w;
}

/** Pieces captured so far relative to a standard set (for the captured-pieces display). */
export function capturedPieces(fen: string): Record<Color, PieceSymbol[]> {
  const full: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const m = countMaterial(fen);
  const out: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  // out.w = black pieces captured by white.
  for (const victim of ['b', 'w'] as Color[]) {
    const captor: Color = victim === 'w' ? 'b' : 'w';
    for (const p of ['q', 'r', 'b', 'n', 'p'] as PieceSymbol[]) {
      const missing = Math.max(0, full[p] - m.pieces[victim][p]);
      for (let i = 0; i < missing; i++) out[captor].push(p);
    }
  }
  return out;
}

function isCaptureLike(m: Move): boolean {
  return m.flags.includes('c') || m.flags.includes('e') || m.flags.includes('p');
}

function moveGain(m: Move): number {
  let g = m.captured ? PIECE_VALUES[m.captured as PieceSymbol] : 0;
  if (m.promotion) g += PIECE_VALUES[m.promotion as PieceSymbol] - 1;
  return g;
}

/**
 * Capture-only quiescence search on material. Returns the best material gain achievable by
 * the side to move through captures (≥ 0 thanks to stand-pat), relative to the current material.
 */
const qCache = new Map<string, number>();

export function quiescenceGain(fen: string, maxDepth = 6): number {
  // Pure function of the position: memoised (reviews evaluate the same positions repeatedly).
  const key = `${maxDepth}|${fen.split(' ').slice(0, 4).join(' ')}`;
  const hit = qCache.get(key);
  if (hit !== undefined) return hit;
  const v = quiescenceGainUncached(fen, maxDepth);
  if (qCache.size > 20000) qCache.clear();
  qCache.set(key, v);
  return v;
}

function quiescenceGainUncached(fen: string, maxDepth: number): number {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return 0;
  }
  const search = (depth: number, alpha: number, beta: number): number => {
    const standPat = 0;
    if (depth === 0) return standPat;
    if (standPat >= beta) return standPat;
    let a = Math.max(alpha, standPat);
    const moves = chess.moves({ verbose: true }).filter(isCaptureLike);
    moves.sort((x, y) => moveGain(y) - moveGain(x));
    for (const m of moves) {
      const gain = moveGain(m);
      chess.move(m);
      const score = gain - search(depth - 1, -beta + gain, -a + gain);
      chess.undo();
      if (score >= beta) return score;
      if (score > a) a = score;
    }
    return a;
  };
  return search(maxDepth, -Infinity, Infinity);
}

/**
 * Material the mover can expect to keep after the opponent's best capture sequence,
 * i.e. static balance (mover POV) minus what the opponent wins by force with captures.
 */
export function settledBalanceAfterMove(fenAfter: string, mover: Color): number {
  return materialBalance(fenAfter, mover) - quiescenceGain(fenAfter);
}

/** Settled material balance for the side to move in `fen` (they may capture first). */
export function settledBalanceToMove(fen: string, side: Color): number {
  return materialBalance(fen, side) + quiescenceGain(fen);
}

/**
 * Material sacrificed by a move: how much worse the mover's material is after the
 * opponent's best capture sequence, compared with the material on the board before the move.
 * (Declining an available capture is not counted as a sacrifice.)
 */
export function sacrificeAmount(fenBefore: string, fenAfter: string, mover: Color): number {
  const before = materialBalance(fenBefore, mover);
  const after = settledBalanceAfterMove(fenAfter, mover);
  return Math.max(0, before - after);
}

/** Material change (mover POV) along a UCI line, measured at the end of the line after settling captures. */
export function lineMaterialSwing(fen: string, uciMoves: string[], mover: Color, plies = 8): number {
  const chess = new Chess(fen);
  const start = materialBalance(fen, mover);
  for (const u of uciMoves.slice(0, plies)) {
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
    } catch {
      break;
    }
  }
  const endFen = chess.fen();
  const toMove = chess.turn();
  const end = toMove === mover ? settledBalanceToMove(endFen, mover) : settledBalanceAfterMove(endFen, mover);
  return end - start;
}
