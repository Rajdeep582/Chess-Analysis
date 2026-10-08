import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { assignIds, parsePieces } from '../src/components/ChessBoard/ChessBoard';

function step(fenA: string, fenB: string) {
  const a = assignIds([], parsePieces(fenA)).pieces;
  const r = assignIds(a, parsePieces(fenB));
  const idAt = (list: typeof a, sq: string) => list.find((p) => p.sq === sq)?.id;
  return { a, b: r.pieces, gone: r.gone, idAt };
}
const after = (fen: string, san: string) => {
  const c = new Chess(fen);
  c.move(san);
  return c.fen();
};

describe('board animation pairing', () => {
  it('pawn takes pawn: the capturing pawn slides, the captured one fades', () => {
    const f = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const { a, b, gone, idAt } = step(f, after(f, 'exd5'));
    expect(idAt(b, 'd5')).toBe(idAt(a, 'e4'));
    expect(gone.map((g) => g.sq)).toEqual(['d5']);
  });
  it('stepping back over a capture restores the captured piece as new and slides the captor back', () => {
    const f = 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const { a, b, gone, idAt } = step(after(f, 'exd5'), f);
    expect(idAt(b, 'e4')).toBe(idAt(a, 'd5'));
    expect(gone.length).toBe(0);
  });
  it('castling moves king and rook', () => {
    const f = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const { a, b, idAt } = step(f, after(f, 'O-O'));
    expect(idAt(b, 'g1')).toBe(idAt(a, 'e1'));
    expect(idAt(b, 'f1')).toBe(idAt(a, 'h1'));
  });
  it('promotion keeps the pawn identity', () => {
    const f = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    const { a, b, idAt } = step(f, after(f, 'a8=Q'));
    expect(idAt(b, 'a8')).toBe(idAt(a, 'a7'));
  });
});
