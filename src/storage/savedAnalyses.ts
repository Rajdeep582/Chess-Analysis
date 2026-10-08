import { exportPgn, gameInfo, parsePgn } from '../chess/pgn';
import { mainline } from '../chess/tree';
import type { GameTree, PgnHeaders } from '../chess/types';
import type { AccuracyResult, GameReview } from '../review/types';
import { getDb, StorageError, translateStorageError } from './indexedDB';

export interface SavedEngineSettings {
  depth: number;
  multipv: number;
  mode: string;
}

export interface SavedAnalysis {
  schema: 1;
  id: string;
  title: string;
  pgn: string;
  /** Start position FEN. */
  fen: string;
  /** Position the user was looking at. */
  currentFen: string;
  currentNodeId: string;
  tree: GameTree;
  headers: PgnHeaders;
  players: { white: string; black: string };
  result: string;
  date?: string;
  review: GameReview | null;
  accuracy: AccuracyResult | null;
  classifications: string[] | null;
  engineSettings: SavedEngineSettings;
  createdAt: number;
  updatedAt: number;
}

export type SavedAnalysisSummary = Pick<SavedAnalysis, 'id' | 'title' | 'players' | 'result' | 'date' | 'accuracy' | 'createdAt' | 'updatedAt'> & {
  moves: number;
  reviewed: boolean;
};

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SaveInput {
  id?: string | null;
  title: string;
  tree: GameTree;
  headers: PgnHeaders;
  currentNodeId: string;
  review: GameReview | null;
  engineSettings: SavedEngineSettings;
}

export function buildSavedAnalysis(input: SaveInput, existing?: SavedAnalysis | null): SavedAnalysis {
  const info = gameInfo(input.headers);
  const now = Date.now();
  const current = input.tree.nodes[input.currentNodeId] ?? input.tree.nodes[input.tree.rootId];
  return {
    schema: 1,
    id: input.id ?? newId(),
    title: input.title.trim() || `${info.white} vs ${info.black}`,
    pgn: exportPgn(input.tree, input.headers),
    fen: input.tree.startFen,
    currentFen: current.fen,
    currentNodeId: current.id,
    tree: input.tree,
    headers: input.headers,
    players: { white: info.white, black: info.black },
    result: info.result,
    date: info.date,
    review: input.review,
    accuracy: input.review?.accuracy ?? null,
    classifications: input.review ? input.review.moves.map((m) => m.classification) : null,
    engineSettings: input.engineSettings,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function isTreeValid(tree: unknown): tree is GameTree {
  if (!tree || typeof tree !== 'object') return false;
  const t = tree as GameTree;
  if (typeof t.rootId !== 'string' || typeof t.startFen !== 'string' || !t.nodes || typeof t.nodes !== 'object') return false;
  const root = t.nodes[t.rootId];
  if (!root || !Array.isArray(root.children)) return false;
  for (const n of Object.values(t.nodes)) {
    if (!n || typeof n.fen !== 'string' || !Array.isArray(n.children)) return false;
    for (const c of n.children) if (!t.nodes[c]) return false;
  }
  return true;
}

/** Validates (and if possible repairs) a stored record. Throws StorageError('corrupt') if unusable. */
export function validateSavedAnalysis(raw: unknown): SavedAnalysis {
  if (!raw || typeof raw !== 'object') throw new StorageError('This saved analysis is corrupt and cannot be opened.', 'corrupt');
  const r = raw as Partial<SavedAnalysis>;
  if (typeof r.id !== 'string') throw new StorageError('This saved analysis is corrupt and cannot be opened.', 'corrupt');
  let tree = r.tree;
  let headers = r.headers ?? {};
  if (!isTreeValid(tree)) {
    if (typeof r.pgn !== 'string') throw new StorageError('This saved analysis is corrupt and cannot be opened.', 'corrupt');
    try {
      const p = parsePgn(r.pgn);
      tree = p.tree;
      headers = p.headers;
    } catch {
      throw new StorageError('This saved analysis is corrupt and cannot be opened.', 'corrupt');
    }
  }
  let review = r.review ?? null;
  if (review && (!Array.isArray(review.moves) || !Array.isArray(review.positions))) review = null;
  if (review) {
    // Re-bind review moves to the stored main line.
    const ml = mainline(tree!);
    if (review.moves.length !== ml.length - 1 || review.moves.some((m, i) => tree!.nodes[ml[i + 1]].uci !== m.uci)) review = null;
    else review = { ...review, moves: review.moves.map((m, i) => ({ ...m, nodeId: ml[i + 1] })) };
  }
  const currentNodeId = r.currentNodeId && tree!.nodes[r.currentNodeId] ? r.currentNodeId : tree!.rootId;
  return {
    schema: 1,
    id: r.id,
    title: typeof r.title === 'string' ? r.title : 'Untitled analysis',
    pgn: typeof r.pgn === 'string' ? r.pgn : exportPgn(tree!, headers),
    fen: tree!.startFen,
    currentFen: tree!.nodes[currentNodeId].fen,
    currentNodeId,
    tree: tree!,
    headers,
    players: r.players ?? { white: headers.White ?? 'White', black: headers.Black ?? 'Black' },
    result: r.result ?? headers.Result ?? '*',
    date: r.date,
    review,
    accuracy: review?.accuracy ?? null,
    classifications: review ? review.moves.map((m) => m.classification) : null,
    engineSettings: r.engineSettings ?? { depth: 18, multipv: 3, mode: 'depth' },
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  };
}

export function summarize(a: SavedAnalysis): SavedAnalysisSummary {
  let moves = 0;
  try {
    moves = mainline(a.tree).length - 1;
  } catch {
    moves = 0;
  }
  return {
    id: a.id,
    title: a.title,
    players: a.players,
    result: a.result,
    date: a.date,
    accuracy: a.accuracy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    moves,
    reviewed: !!a.review,
  };
}

export async function saveAnalysis(input: SaveInput): Promise<SavedAnalysis> {
  try {
    const db = await getDb();
    const existing = input.id ? await db.get('analyses', input.id) : null;
    const record = buildSavedAnalysis(input, existing);
    await db.put('analyses', record);
    return record;
  } catch (e) {
    throw translateStorageError(e);
  }
}

export async function listAnalyses(): Promise<{ items: SavedAnalysisSummary[]; corrupt: string[] }> {
  try {
    const db = await getDb();
    const all = await db.getAll('analyses');
    const items: SavedAnalysisSummary[] = [];
    const corrupt: string[] = [];
    for (const raw of all) {
      try {
        items.push(summarize(validateSavedAnalysis(raw)));
      } catch {
        corrupt.push((raw as { id?: string })?.id ?? '?');
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return { items, corrupt };
  } catch (e) {
    throw translateStorageError(e);
  }
}

export async function getAnalysis(id: string): Promise<SavedAnalysis> {
  let raw: unknown;
  try {
    raw = await (await getDb()).get('analyses', id);
  } catch (e) {
    throw translateStorageError(e);
  }
  if (!raw) throw new StorageError('That saved analysis no longer exists.', 'not-found');
  return validateSavedAnalysis(raw);
}

export async function renameAnalysis(id: string, title: string): Promise<void> {
  const a = await getAnalysis(id);
  try {
    await (await getDb()).put('analyses', { ...a, title: title.trim() || a.title, updatedAt: Date.now() });
  } catch (e) {
    throw translateStorageError(e);
  }
}

export async function deleteAnalysis(id: string): Promise<void> {
  try {
    await (await getDb()).delete('analyses', id);
  } catch (e) {
    throw translateStorageError(e);
  }
}

export async function duplicateAnalysis(id: string): Promise<SavedAnalysis> {
  const a = await getAnalysis(id);
  const now = Date.now();
  const copy: SavedAnalysis = { ...a, id: newId(), title: `${a.title} (copy)`, createdAt: now, updatedAt: now };
  try {
    await (await getDb()).put('analyses', copy);
  } catch (e) {
    throw translateStorageError(e);
  }
  return copy;
}

/** Removes records that cannot be parsed. */
export async function deleteCorrupt(ids: string[]): Promise<void> {
  const db = await getDb();
  for (const id of ids) await db.delete('analyses', id);
}
