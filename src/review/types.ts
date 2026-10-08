import type { Color } from '../chess/types';
import type { EngineAnalysis, EngineScore } from '../engine/types';

export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export const CLASSIFICATION_ORDER: MoveClassification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'inaccuracy',
  'mistake',
  'miss',
  'blunder',
];

export const NEGATIVE_CLASSES: MoveClassification[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];

/** Expected-point-loss thresholds (upper bounds, inclusive). */
export interface ClassificationThresholds {
  best: number;
  excellent: number;
  good: number;
  inaccuracy: number;
  mistake: number;
  /** Minimum material (pawns) given up for a Brilliant sacrifice. */
  sacrificeMin: number;
  /** Gap to the second-best move for a "only move" Great. */
  onlyMoveGap: number;
  /** Opponent's previous loss that opens a Miss opportunity. */
  missOpportunity: number;
}

export const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  best: 0.0,
  excellent: 0.02,
  good: 0.05,
  inaccuracy: 0.1,
  mistake: 0.2,
  sacrificeMin: 2,
  onlyMoveGap: 0.15,
  missOpportunity: 0.1,
};

export interface PositionAnalysisRef {
  fen: string;
  analysis: EngineAnalysis;
}

export interface MoveReview {
  ply: number;
  nodeId: string;
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  /** Expected points for the mover before the move (assuming best play). */
  epBefore: number;
  /** Expected points for the mover after the played move. */
  epAfter: number;
  /** Expected points of the best move. */
  epBest: number;
  evaluationBefore: EngineScore;
  evaluationAfter: EngineScore;
  evaluationLoss: number;
  bestMove: string | null;
  bestMoveSan: string | null;
  secondBestEp?: number;
  classification: MoveClassification;
  accuracy: number;
  forced: boolean;
  sacrifice: number;
  phase?: 'opening' | 'middlegame' | 'endgame';
  explanation?: string;
  principalVariation: string[];
  bestLineSan: string[];
  playedLineSan: string[];
  depthBefore: number;
  depthAfter: number;
  opening?: string;
}

export interface AccuracyResult {
  w: number | null;
  b: number | null;
}

export type ReviewStatistics = Record<Color, Record<MoveClassification, number>>;

export interface CriticalMoment {
  ply: number;
  nodeId: string;
  color: Color;
  san: string;
  moveNumber: number;
  classification: MoveClassification;
  epSwing: number;
  title: string;
  evalBefore: string;
  evalAfter: string;
  kind: 'classification' | 'turning-point';
}

export interface ReviewSettings {
  quickDepth: number;
  deepDepth: number;
  maxDeepPositions: number;
  multipv: number;
  thresholds: ClassificationThresholds;
  whiteRating?: number;
  blackRating?: number;
}

export interface GameReview {
  version: 1;
  createdAt: number;
  moves: MoveReview[];
  /** Analysis per mainline ply (index = ply, 0 = start position). */
  positions: { fen: string; score: EngineScore; ep: number; depth: number; terminal?: EngineAnalysis['terminal']; winner?: 'w' | 'b' }[];
  accuracy: AccuracyResult;
  stats: ReviewStatistics;
  keyMoments: CriticalMoment[];
  opening?: { eco: string; name: string; ply: number };
  settings: ReviewSettings;
  engine: string;
  summary: string[];
  improvementAreas: Record<Color, string[]>;
  /** Accuracy per game phase (null when the player made no moves in that phase). */
  phaseAccuracy?: Record<Color, PhaseAccuracy>;
  phases?: { middlegameStart: number | null; endgameStart: number | null };
  /** Approximate playing strength from accuracy (single-game estimate). */
  estimatedElo?: Record<Color, number | null>;
}

export interface PhaseAccuracy {
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

export interface ReviewProgress {
  phase: 'quick' | 'deep' | 'finalizing';
  done: number;
  total: number;
  label: string;
}
