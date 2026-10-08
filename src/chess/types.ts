export type Color = 'w' | 'b';
export type PieceSymbol = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Square = string;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface MoveNode {
  id: string;
  parentId: string | null;
  children: string[];
  /** Half-moves from the tree root (root = 0). */
  ply: number;
  /** Full-move number of this move (1-based), taken from the parent FEN. */
  moveNumber: number;
  /** Side that made this move (for root: side to move). */
  color: Color;
  san: string;
  uci: string;
  /** Position after this move. */
  fen: string;
  from?: Square;
  to?: Square;
  promotion?: PieceSymbol;
  piece?: PieceSymbol;
  captured?: PieceSymbol;
  comment?: string;
  nags?: number[];
}

export interface GameTree {
  rootId: string;
  startFen: string;
  nodes: Record<string, MoveNode>;
  nextId: number;
}

export type PgnHeaders = Record<string, string>;

export interface ChessPosition {
  fen: string;
  turn: Color;
  inCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isGameOver: boolean;
  legalMoveCount: number;
}

export interface GameInfo {
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  event?: string;
  site?: string;
  date?: string;
  round?: string;
  eco?: string;
  opening?: string;
  timeControl?: string;
  termination?: string;
}

export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
}
