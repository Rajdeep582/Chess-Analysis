import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parsePgn } from '../src/chess/pgn';
import { mainline } from '../src/chess/tree';
import { SAMPLE_GAMES } from '../src/state/samples';

describe('famous sample games', () => {
  for (const g of SAMPLE_GAMES) {
    it(`${g.title} parses legally and ends as recorded`, () => {
      const p = parsePgn(g.pgn);
      const ml = mainline(p.tree);
      const last = new Chess(p.tree.nodes[ml[ml.length - 1]].fen);
      expect(p.headers.White).toBe(g.white);
      expect(ml.length).toBeGreaterThan(20);
      if (p.headers.Result !== '1/2-1/2' && /#/.test(g.pgn)) expect(last.isCheckmate()).toBe(true);
    });
  }
});
