import { Chess } from 'chess.js';

/** Converts a list of UCI moves from a FEN into SAN. Stops at the first illegal move. */
export function uciLineToSan(fen: string, uciMoves: string[], limit = uciMoves.length): string[] {
  const out: string[] = [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return out;
  }
  for (const u of uciMoves.slice(0, limit)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

export function uciToSan(fen: string, uci: string): string {
  return uciLineToSan(fen, [uci])[0] ?? uci;
}

/** Formats SAN moves with move numbers starting from the FEN's move number/side. */
export function formatLine(fen: string, sans: string[]): string {
  const parts = fen.split(' ');
  let num = Number(parts[5]) || 1;
  let white = parts[1] !== 'b';
  const out: string[] = [];
  sans.forEach((san, i) => {
    if (white) out.push(`${num}. ${san}`);
    else out.push(i === 0 ? `${num}… ${san}` : san);
    if (!white) num++;
    white = !white;
  });
  return out.join(' ');
}

/** Plays a UCI line and returns the FEN after each move. */
export function uciLineFens(fen: string, uciMoves: string[]): string[] {
  const chess = new Chess(fen);
  const fens: string[] = [];
  for (const u of uciMoves) {
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  return fens;
}
