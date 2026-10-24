export type DepthPreset = 'quick' | 'normal' | 'deep' | 'very-deep' | 'custom';
export type BoardThemeId = 'slate' | 'sandstone' | 'glacier' | 'orchid' | 'graphite';
export type PieceSetId = 'classic' | 'staunty' | 'maestro' | 'tatiana' | 'california' | 'cardinal' | 'merida' | 'chessnut' | 'nocturne' | 'tokens';

/** Piece sets in the settings picker. Image sets live in public/pieces/<dir> (see README credits). */
export const PIECE_SETS: { id: PieceSetId; label: string; dir?: string }[] = [
  { id: 'classic', label: 'Classic', dir: 'cburnett' },
  { id: 'staunty', label: 'Staunty', dir: 'staunty' },
  { id: 'maestro', label: 'Maestro', dir: 'maestro' },
  { id: 'tatiana', label: 'Tatiana', dir: 'tatiana' },
  { id: 'california', label: 'California', dir: 'california' },
  { id: 'cardinal', label: 'Cardinal', dir: 'cardinal' },
  { id: 'merida', label: 'Merida', dir: 'merida' },
  { id: 'chessnut', label: 'Chessnut', dir: 'chessnut' },
  { id: 'nocturne', label: 'Nocturne' },
  { id: 'tokens', label: 'Tokens' },
];
export type ReviewStrength = 'fast' | 'standard' | 'deep';

export interface Settings {
  engine: {
    preset: DepthPreset;
    depth: number;
    multipv: number;
    threads: 'auto' | number;
    hash: 'auto' | number;
    mode: 'depth' | 'time' | 'infinite';
    movetimeMs: number;
    /** 'full' = Stockfish 19 with the full NNUE (~100 MB once, strongest); 'lite' = small NNUE. */
    build: 'lite' | 'full';
    /** True once the user picked an engine build themselves (otherwise the app starts on Lite). */
    buildChosen: boolean;
  };
  board: {
    theme: BoardThemeId;
    pieceSet: PieceSetId;
    coordinates: boolean;
    animations: boolean;
    showLegalMoves: boolean;
    showLastMove: boolean;
    showArrows: boolean;
    arrowCount: number;
  };
  review: {
    showClassifications: boolean;
    showKeyMoves: boolean;
    showGraphMarkers: boolean;
    autoPlayLines: boolean;
    strength: ReviewStrength;
    useRatings: boolean;
  };
  performance: {
    cacheAnalysis: boolean;
    reduceMotion: boolean;
    lowPower: boolean;
  };
  appearance: { theme: 'dark' | 'light' | 'system' };
  sound: { enabled: boolean; volume: number };
}

export const DEPTH_PRESETS: Record<Exclude<DepthPreset, 'custom'>, { label: string; depth: number }> = {
  quick: { label: 'Quick', depth: 12 },
  normal: { label: 'Normal', depth: 18 },
  deep: { label: 'Deep', depth: 22 },
  'very-deep': { label: 'Very deep', depth: 26 },
};

export const REVIEW_STRENGTH: Record<ReviewStrength, { label: string; quickDepth: number; deepDepth: number; maxDeepPositions: number }> = {
  fast: { label: 'Fast', quickDepth: 10, deepDepth: 15, maxDeepPositions: 16 },
  standard: { label: 'Standard', quickDepth: 12, deepDepth: 18, maxDeepPositions: 30 },
  deep: { label: 'Thorough', quickDepth: 14, deepDepth: 21, maxDeepPositions: 40 },
};

/** Engine mode switch ("Lite" / "Max"): Max = full NNUE, every CPU thread, a larger hash and Thorough reviews. */
export type EngineMode = 'lite' | 'max';

export function maxThreads(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(32, hc));
}

export function maxHashMb(): number {
  const mem = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  // deviceMemory is capped at 8 by browsers (and missing in Safari/Firefox): 256 MB is safe on anything that reports ≥ 4 GB.
  return mem === undefined || mem >= 4 ? 256 : 64;
}

/** Settings for an engine mode. Lite keeps the light, fast defaults; Max takes the strongest available setup. */
export function applyEngineMode(s: Settings, mode: EngineMode): Settings {
  return mode === 'max'
    ? {
        ...s,
        engine: { ...s.engine, build: 'full', buildChosen: true, threads: maxThreads(), hash: maxHashMb() },
        review: { ...s.review, strength: 'deep' },
      }
    : {
        ...s,
        engine: { ...s.engine, build: 'lite', buildChosen: true, threads: 'auto', hash: 'auto' },
        review: { ...s.review, strength: 'standard' },
      };
}

export const engineModeOf = (s: Settings): EngineMode => (s.engine.build === 'full' ? 'max' : 'lite');

export const DEFAULT_SETTINGS: Settings = {
  engine: { preset: 'normal', depth: 18, multipv: 3, threads: 'auto', hash: 'auto', mode: 'depth', movetimeMs: 5000, build: 'lite', buildChosen: false },
  board: {
    theme: 'slate',
    pieceSet: 'classic',
    coordinates: true,
    animations: true,
    showLegalMoves: true,
    showLastMove: true,
    showArrows: true,
    arrowCount: 3,
  },
  review: { showClassifications: true, showKeyMoves: true, showGraphMarkers: true, autoPlayLines: true, strength: 'standard', useRatings: true },
  performance: { cacheAnalysis: true, reduceMotion: false, lowPower: false },
  appearance: { theme: 'dark' },
  sound: { enabled: true, volume: 0.7 },
};

const KEY = 'nocturne64.settings.v1';
const LEGACY_KEY = 'outpost.settings.v1';

function merge<T extends object>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object') return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(base)) {
    const pv = (patch as Record<string, unknown>)[k];
    if (pv === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(v as object, pv);
    else if (typeof pv === typeof v || k === 'threads' || k === 'hash') out[k] = pv;
  }
  return out as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = merge(DEFAULT_SETTINGS, JSON.parse(raw));
    if ((s.board.pieceSet as string) === 'outpost') s.board.pieceSet = 'nocturne';
    if (!PIECE_SETS.some((p) => p.id === s.board.pieceSet)) s.board.pieceSet = 'classic';
    // The app opens on Lite unless the user switched engines themselves.
    if (!s.engine.buildChosen) s.engine = { ...s.engine, build: 'lite' };
    return s;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function persistSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings stay for this session */
  }
}

/** Effective engine parameters after low-power capping. */
export function effectiveEngine(s: Settings) {
  const low = s.performance.lowPower;
  return {
    depth: low ? Math.min(s.engine.depth, 16) : s.engine.depth,
    multipv: low ? Math.min(s.engine.multipv, 2) : s.engine.multipv,
    mode: low && s.engine.mode === 'infinite' ? ('depth' as const) : s.engine.mode,
    movetimeMs: low ? Math.min(s.engine.movetimeMs, 3000) : s.engine.movetimeMs,
  };
}
