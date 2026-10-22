/** Score from White's point of view. Exactly one of cp / mate is set. mate = 0 means the side to move is mated. */
export interface EngineScore {
  cp: number | null;
  mate: number | null;
}

export type ScoreBound = 'lower' | 'upper';

export interface EngineLine {
  multipv: number;
  depth: number;
  seldepth?: number;
  score: EngineScore;
  bound?: ScoreBound;
  /** UCI moves. */
  pv: string[];
}

export type TerminalState = 'checkmate' | 'stalemate' | 'draw';

export interface EngineAnalysis {
  fen: string;
  depth: number;
  seldepth?: number;
  /** Centipawns, White POV (null when a mate score is reported). */
  evaluation: number | null;
  /** Mate in N, White POV (positive: White mates). */
  mate: number | null;
  bestMove: string | null;
  principalVariation: string[];
  lines: EngineLine[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
  hashfull?: number;
  multipv: number;
  /** True when the search finished (bestmove received) for a depth/time target. */
  complete: boolean;
  terminal?: TerminalState;
  /** For checkmate: which side won. */
  winner?: 'w' | 'b';
  source: 'engine' | 'cache' | 'terminal';
  engine?: string;
}

export type SearchLimit =
  | { kind: 'depth'; depth: number }
  | { kind: 'time'; movetimeMs: number }
  | { kind: 'infinite' };

export interface AnalysisRequest {
  fen: string;
  limit: SearchLimit;
  multipv: number;
}

export type EngineFlavor = 'full-multi' | 'full-single' | 'lite-multi' | 'lite-single' | 'asm';
export type EngineBuild = 'lite' | 'full';

export interface EngineInfo {
  name: string;
  flavor: EngineFlavor;
  threadsMax: number;
  threads: number;
  hashMb: number;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'analyzing' | 'error';

// ----------------------------------------------------------------- worker protocol

export type WorkerIn =
  | { type: 'init'; engineUrl: string; flavor: EngineFlavor; threads: number; hashMb: number; timeoutMs?: number; debug?: boolean }
  | { type: 'analyze'; id: number; fen: string; limit: SearchLimit; multipv: number }
  | { type: 'stop'; id?: number }
  | { type: 'setoption'; name: string; value: string | number }
  | { type: 'newgame' }
  | { type: 'quit' };

export type WorkerOut =
  | { type: 'ready'; info: EngineInfo }
  | { type: 'update'; id: number; analysis: EngineAnalysis }
  | { type: 'done'; id: number; analysis: EngineAnalysis; stopped: boolean }
  | { type: 'error'; message: string; fatal: boolean; id?: number }
  | { type: 'log'; line: string };
