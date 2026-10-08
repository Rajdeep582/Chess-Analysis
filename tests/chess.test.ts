import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { exportPgn, gameInfo, parsePgn, PgnError, splitGames, tokenize } from '../src/chess/pgn';
import { looksLikeFen, validateFen } from '../src/chess/fen';
import {
  addMove,
  createTree,
  deleteNode,
  isMainline,
  lineEnd,
  mainline,
  mainlineAncestor,
  nextNodeId,
  prevNodeId,
  promoteVariation,
  treeFromMoves,
} from '../src/chess/tree';
import { capturedPieces, countMaterial, quiescenceGain, sacrificeAmount } from '../src/chess/material';
import { formatLine, uciLineToSan } from '../src/chess/uci';
import { START_FEN } from '../src/chess/types';

const OPERA = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[Round "?"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[ECO "C41"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 {This is a weak move already.} 4. dxe5 Bxf3 5. Qxf3 dxe5
6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

describe('PGN parsing', () => {
  it('parses headers, moves and result', () => {
    const p = parsePgn(OPERA);
    expect(p.headers.White).toBe('Paul Morphy');
    expect(p.headers.ECO).toBe('C41');
    const ml = mainline(p.tree);
    expect(ml.length).toBe(34); // root + 33 plies
    const last = p.tree.nodes[ml[ml.length - 1]];
    expect(last.san).toBe('Rd8#');
    expect(new Chess(last.fen).isCheckmate()).toBe(true);
    expect(p.tree.nodes[ml[6]].comment).toBe('This is a weak move already.');
    const info = gameInfo(p.headers);
    expect(info.result).toBe('1-0');
    expect(info.date).toBe('1858');
  });

  it('parses nested variations and NAGs without touching the main line', () => {
    const p = parsePgn('1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) d6) 2. Nf3!? $1 Nc6 *');
    const ml = mainline(p.tree).map((id) => p.tree.nodes[id].san);
    expect(ml).toEqual(['', 'e4', 'e5', 'Nf3', 'Nc6']);
    const e4 = p.tree.nodes[mainline(p.tree)[1]];
    expect(e4.children.length).toBe(2);
    const c5 = p.tree.nodes[e4.children[1]];
    expect(c5.san).toBe('c5');
    const nf3 = p.tree.nodes[c5.children[0]];
    expect(nf3.children.map((c) => p.tree.nodes[c].san)).toEqual(['d6']);
    expect(p.tree.nodes[c5.children[0]].san).toBe('Nf3');
    expect(c5.children.length).toBe(2);
    const mlNf3 = p.tree.nodes[mainline(p.tree)[3]];
    expect(mlNf3.nags).toEqual([5, 1]);
  });

  it('reports illegal moves with the move number', () => {
    expect(() => parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Qxf7 *')).toThrowError(PgnError);
    try {
      parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Qxf7 *');
    } catch (e) {
      expect((e as PgnError).detail).toMatch(/move 4/);
      expect((e as PgnError).detail).toMatch(/Qxf7/);
    }
  });

  it('rejects empty input and moveless games', () => {
    expect(() => parsePgn('   ')).toThrowError(/empty/);
    expect(() => parsePgn('[Event "x"]\n\n*')).toThrowError(PgnError);
  });

  it('truncates illegal variations with a warning', () => {
    const p = parsePgn('1. e4 (1. d4 Ke2) e5 *');
    expect(p.warnings.length).toBe(1);
    expect(mainline(p.tree).length).toBe(3);
  });

  it('supports FEN/SetUp headers, castling notation variants and clock comments', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const p = parsePgn(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. 0-0 0-0-0 {[%clk 0:01:00] ok} *`);
    const ml = mainline(p.tree).map((id) => p.tree.nodes[id]);
    expect(ml[1].san).toBe('O-O');
    expect(ml[2].san).toBe('O-O-O');
    expect(ml[2].comment).toBe('ok');
    expect(p.tree.startFen).toBe(fen);
  });

  it('splits multi-game databases and loads the first', () => {
    const db = `${OPERA}\n\n[Event "Second"]\n\n1. d4 d5 *`;
    expect(splitGames(db).length).toBe(2);
    const p = parsePgn(db);
    expect(p.gameCount).toBe(2);
    expect(p.warnings[0]).toMatch(/2 games/);
  });

  it('tokenizes glued move numbers and annotations', () => {
    const t = tokenize('1.e4!! e5?! 2.Nf3+ $14 ;comment\n *');
    expect(t.filter((x) => x.t === 'move').map((x) => (x as { v: string }).v)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('round-trips through export', () => {
    const p = parsePgn('[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 {main} Nc6 *');
    const text = exportPgn(p.tree, p.headers);
    expect(text).toContain('[White "A"]');
    expect(text).toContain('(1... c5 2. Nf3)');
    const again = parsePgn(text);
    expect(mainline(again.tree).length).toBe(mainline(p.tree).length);
    expect(Object.keys(again.tree.nodes).length).toBe(Object.keys(p.tree.nodes).length);
  });
});

describe('FEN', () => {
  it('validates and normalizes', () => {
    const v = validateFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2');
    expect(v.ok).toBe(true);
    expect(validateFen('8/8/8/8/8/8/8/K6k w').fen).toBe('8/8/8/8/8/8/8/K6k w - - 0 1');
  });
  it('rejects malformed positions with readable errors', () => {
    expect(validateFen('').error).toMatch(/empty/);
    expect(validateFen('8/8/8/8/8/8/8/8 w - - 0 1').error).toMatch(/king/);
    expect(validateFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1').error).toMatch(/8 ranks/);
    expect(validateFen('rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').ok).toBe(false);
    expect(validateFen('P6k/8/8/8/8/8/8/K7 w - - 0 1').error).toMatch(/Pawns/);
    // Black to move while white is in check -> impossible
    expect(validateFen('4k3/8/8/8/8/8/4r3/4K3 b - - 0 1').ok).toBe(false);
  });
  it('detects FEN-like input', () => {
    expect(looksLikeFen(START_FEN)).toBe(true);
    expect(looksLikeFen('1. e4 e5')).toBe(false);
  });
});

describe('game tree & navigation', () => {
  it('navigates main line and variations', () => {
    let tree = treeFromMoves(START_FEN, ['e4', 'e5', 'Nf3']);
    const ml = mainline(tree);
    expect(nextNodeId(tree, ml[0])).toBe(ml[1]);
    expect(prevNodeId(tree, ml[2])).toBe(ml[1]);
    expect(lineEnd(tree, ml[0])).toBe(ml[3]);
    const r = addMove(tree, ml[2], 'Nc3')!;
    tree = r.tree;
    expect(isMainline(tree, r.nodeId)).toBe(false);
    expect(mainlineAncestor(tree, r.nodeId)).toBe(ml[2]);
    // Re-adding the same move reuses the node
    expect(addMove(tree, ml[2], { from: 'b1', to: 'c3' })!.nodeId).toBe(r.nodeId);
    const promoted = promoteVariation(tree, r.nodeId);
    expect(isMainline(promoted, r.nodeId)).toBe(true);
    const deleted = deleteNode(tree, r.nodeId);
    expect(deleted.nodes[r.nodeId]).toBeUndefined();
    expect(deleted.nodes[ml[2]].children).toEqual([ml[3]]);
  });

  it('handles castling, en passant, promotion, checkmate and draws', () => {
    // Castling
    let t = createTree('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const c = addMove(t, 'root', { from: 'e1', to: 'g1' })!;
    expect(c.tree.nodes[c.nodeId].san).toBe('O-O');
    // En passant
    t = treeFromMoves(START_FEN, ['e4', 'a6', 'e5', 'd5']);
    const ep = addMove(t, lineEnd(t, 'root'), 'exd6')!;
    expect(ep.tree.nodes[ep.nodeId].captured).toBe('p');
    // Promotion
    t = createTree('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const pr = addMove(t, 'root', { from: 'a7', to: 'a8', promotion: 'q' })!;
    expect(pr.tree.nodes[pr.nodeId].san).toBe('a8=Q');
    expect(pr.tree.nodes[pr.nodeId].uci).toBe('a7a8q');
    // Illegal move rejected
    expect(addMove(t, 'root', { from: 'a1', to: 'a3' })).toBeNull();
    // Checkmate (fool's mate)
    const fm = treeFromMoves(START_FEN, ['f3', 'e5', 'g4', 'Qh4']);
    expect(new Chess(fm.nodes[lineEnd(fm, 'root')].fen).isCheckmate()).toBe(true);
    // Stalemate / insufficient material draw
    expect(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').isStalemate()).toBe(true);
    expect(new Chess('8/8/8/8/8/8/8/K6k w - - 0 1').isDraw()).toBe(true);
  });
});

describe('material & UCI helpers', () => {
  it('counts material and captured pieces', () => {
    expect(countMaterial(START_FEN).w).toBe(39);
    const cap = capturedPieces('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBN1 w Qkq - 0 1');
    expect(cap.b).toEqual(['r', 'p']);
  });
  it('detects hanging material and sacrifices', () => {
    // White queen on d5 attacked by e6 pawn
    expect(quiescenceGain('4k3/8/4p3/3Q4/8/8/8/4K3 b - - 0 1')).toBe(9);
    // Defended pawn exchange: no net gain
    expect(quiescenceGain('4k3/8/3p4/4p3/3P4/8/8/4K3 w - - 0 1')).toBe(0);
    const before = '4k3/8/4p3/8/3Q4/8/8/4K3 w - - 0 1';
    const after = '4k3/8/4p3/3Q4/8/8/8/4K3 b - - 1 1';
    expect(sacrificeAmount(before, after, 'w')).toBe(9);
  });
  it('converts UCI lines to SAN', () => {
    expect(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Nf3']);
    expect(formatLine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e5', 'Nf3'])).toBe('1… e5 2. Nf3');
  });
});
