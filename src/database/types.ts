export type GameSource = 'lichess' | 'chesscom' | 'local' | 'legend';

/** One game found by a search, from any source. */
export interface GameHit {
  id: string;
  source: GameSource;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  date?: string;
  event?: string;
  /** e.g. "blitz 3+2", "classical" */
  timeControl?: string;
  eco?: string;
  opening?: string;
  plies?: number;
  url?: string;
  pgn: string;
}

/** Game stored in the local (IndexedDB) database. */
export interface DbGame {
  id: string;
  collection: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  result: string;
  date?: string;
  event?: string;
  site?: string;
  eco?: string;
  opening?: string;
  /** Normalized "white|black|event|opening|year" text for matching. */
  search: string;
  pgn: string;
}

export interface ParsedQuery {
  /** First player (name or username). */
  a: string;
  /** Optional opponent. */
  b?: string;
  year?: number;
  raw: string;
}
