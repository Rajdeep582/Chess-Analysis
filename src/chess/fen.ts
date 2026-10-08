import { Chess, validateFen as cjValidate } from 'chess.js';
import type { ChessPosition, Color } from './types';

export interface FenValidation {
  ok: boolean;
  fen?: string;
  error?: string;
}

/** Normalizes a FEN (fills missing counters) and validates it for analysis. */
export function validateFen(input: string): FenValidation {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (!raw) return { ok: false, error: 'The FEN is empty.' };
  const parts = raw.split(' ');
  if (parts.length < 2 || parts.length > 6) {
    return { ok: false, error: 'A FEN needs at least the piece placement and the side to move (e.g. "… w KQkq - 0 1").' };
  }
  const defaults = ['', 'w', '-', '-', '0', '1'];
  for (let i = parts.length; i < 6; i++) parts.push(defaults[i]);
  const fen = parts.join(' ');

  const rows = parts[0].split('/');
  if (rows.length !== 8) return { ok: false, error: `The piece placement must have 8 ranks separated by "/" (found ${rows.length}).` };
  for (let r = 0; r < 8; r++) {
    let count = 0;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) count += Number(ch);
      else if (/[prnbqkPRNBQK]/.test(ch)) count += 1;
      else return { ok: false, error: `Invalid character "${ch}" on rank ${8 - r}.` };
    }
    if (count !== 8) return { ok: false, error: `Rank ${8 - r} describes ${count} squares instead of 8.` };
  }
  const wk = (parts[0].match(/K/g) || []).length;
  const bk = (parts[0].match(/k/g) || []).length;
  if (wk !== 1 || bk !== 1) return { ok: false, error: 'Each side must have exactly one king.' };
  if (/[pP]/.test(rows[0]) || /[pP]/.test(rows[7])) return { ok: false, error: 'Pawns cannot stand on the first or last rank.' };
  if (parts[1] !== 'w' && parts[1] !== 'b') return { ok: false, error: 'Side to move must be "w" or "b".' };

  const res = cjValidate(fen);
  if (!res.ok) return { ok: false, error: humanizeChessJsError(res.error ?? 'Invalid FEN.') };
  try {
    const c = new Chess(fen);
    // The side that just moved must not be in check.
    const flipped = fen.replace(/ [wb] /, (m) => (m.trim() === 'w' ? ' b ' : ' w '));
    const opp = safeChess(flipped.replace(/ [a-h][36] /, ' - '));
    if (opp && opp.inCheck()) return { ok: false, error: 'The side not to move is in check — this position is impossible.' };
    void c;
  } catch (e) {
    return { ok: false, error: humanizeChessJsError(String((e as Error).message)) };
  }
  return { ok: true, fen };
}

function safeChess(fen: string): Chess | null {
  try {
    return new Chess(fen, { skipValidation: true });
  } catch {
    return null;
  }
}

function humanizeChessJsError(msg: string): string {
  return msg.replace(/^Invalid FEN:\s*/i, '').replace(/^./, (c) => c.toUpperCase());
}

export function looksLikeFen(text: string): boolean {
  const t = text.trim();
  return /^[prnbqkPRNBQK1-8]+(\/[prnbqkPRNBQK1-8]+){7}(\s+[wb])?/.test(t) && !t.includes('[') && t.split('\n').length === 1;
}

export function fenKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

export function sideToMove(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

export function fullMoveNumber(fen: string): number {
  const n = Number(fen.split(' ')[5]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function describePosition(fen: string): ChessPosition {
  const c = new Chess(fen);
  return {
    fen,
    turn: c.turn(),
    inCheck: c.inCheck(),
    isCheckmate: c.isCheckmate(),
    isStalemate: c.isStalemate(),
    isDraw: c.isDraw(),
    isGameOver: c.isGameOver(),
    legalMoveCount: c.moves().length,
  };
}
