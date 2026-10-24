import { Chess } from 'chess.js';
import { listAnalyses, getAnalysis } from '../../storage/savedAnalyses';

export interface Puzzle {
  id: string;
  source: 'daily' | 'random' | 'theme' | 'classic' | 'mine';
  title: string;
  subtitle: string;
  /** Position the solver starts from (side to move solves). */
  fen: string;
  /** Moves in UCI: solver, reply, solver, … */
  solution: string[];
  /** Opponent move that led to the puzzle position (highlighted). */
  lastMove?: { from: string; to: string } | null;
  rating?: number;
  themes?: string[];
  /** Single-move puzzles from your own games: a different move that keeps the evaluation also counts. */
  engineCheck?: boolean;
}

/**
 * Finishing combinations from the legendary games on the home page. Each was checked with
 * Stockfish 19 (depth 18): every solver move is the engine's best and forces mate.
 */
export const CLASSIC_PUZZLES: Puzzle[] = [
  {
    id: 'classic-opera-2',
    source: 'classic',
    title: 'The Opera Game',
    subtitle: 'Morphy · Paris 1858 · White mates in 2',
    fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16',
    solution: ['b3b8', 'd7b8', 'd1d8'],
    lastMove: { from: 'f6', to: 'd7' },
    themes: ['sacrifice', 'mate in 2'],
  },
  {
    id: 'classic-immortal-2',
    source: 'classic',
    title: 'The Immortal Game',
    subtitle: 'Anderssen · London 1851 · White mates in 2',
    fen: 'r1bk2nr/p2p1pNp/n2B4/1p1NP2P/6P1/3P1Q2/P1P1K3/q5b1 w - - 1 22',
    solution: ['f3f6', 'g8f6', 'd6e7'],
    lastMove: { from: 'e8', to: 'd8' },
    themes: ['queen sacrifice', 'mate in 2'],
  },
  {
    id: 'classic-immortal-3',
    source: 'classic',
    title: 'The Immortal Game',
    subtitle: 'Anderssen · London 1851 · White mates in 3',
    fen: 'r1b1k1nr/p2p1ppp/n2B4/1p1NPN1P/6P1/3P1Q2/P1P1K3/q5b1 w kq - 2 21',
    solution: ['f5g7', 'e8d8', 'f3f6', 'g8f6', 'd6e7'],
    lastMove: { from: 'b8', to: 'a6' },
    themes: ['mate in 3'],
  },
  {
    id: 'classic-fischer-2',
    source: 'classic',
    title: 'The Game of the Century',
    subtitle: 'Byrne – Fischer · New York 1956 · Black mates in 2',
    fen: '1Q6/5pk1/2p3p1/1p2N2p/1b5P/1b6/r3n1P1/1K6 b - - 13 40',
    solution: ['e2c3', 'b1c1', 'a2c2'],
    lastMove: { from: 'c1', to: 'b1' },
    themes: ['smothered net', 'mate in 2'],
  },
  {
    id: 'classic-fischer-3',
    source: 'classic',
    title: 'The Game of the Century',
    subtitle: 'Byrne – Fischer · New York 1956 · Black mates in 3',
    fen: '1Q6/5pk1/2p3p1/1p2N2p/1b5P/1b4n1/r5P1/2K5 b - - 11 39',
    solution: ['g3e2', 'c1b1', 'e2c3', 'b1c1', 'a2c2'],
    lastMove: { from: 'd1', to: 'c1' },
    themes: ['mate in 3'],
  },
  {
    id: 'classic-fischer-4',
    source: 'classic',
    title: 'The Game of the Century',
    subtitle: 'Byrne – Fischer · New York 1956 · Black mates in 4',
    fen: '1Q6/5pk1/2p3p1/1p1bN2p/1b5P/6n1/r5P1/3K4 b - - 9 38',
    solution: ['d5b3', 'd1c1', 'g3e2', 'c1b1', 'e2c3', 'b1c1', 'a2c2'],
    lastMove: { from: 'e1', to: 'd1' },
    themes: ['mate in 4'],
  },
];

interface LichessPuzzleJson {
  game: { id: string; pgn: string };
  puzzle: { id: string; rating: number; solution: string[]; themes: string[]; initialPly: number };
}

const META = /^(short|long|veryLong|oneMove|master|masterVsMaster|superGM|crushing|advantage|equality)$/;
/** "mateIn2" → "mate in 2", "attackingF2F7" → "attacking f2 f7". */
export const themeWords = (t: string) =>
  t
    .replace(/In(\d)/, 'In $1')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase();

function fromLichess(j: LichessPuzzleJson, source: 'daily' | 'random' | 'theme', title?: string): Puzzle {
  const c = new Chess();
  for (const san of j.game.pgn.split(/\s+/).filter(Boolean)) c.move(san);
  const last = c.history({ verbose: true }).pop();
  const themes = j.puzzle.themes.filter((t) => !META.test(t));
  return {
    id: `lichess-${j.puzzle.id}`,
    source,
    title: title ?? (source === 'daily' ? 'Daily puzzle' : 'Lichess puzzle'),
    subtitle: `#${j.puzzle.id} · rated ${j.puzzle.rating} · ${c.turn() === 'w' ? 'White' : 'Black'} to move`,
    fen: c.fen(),
    solution: j.puzzle.solution,
    lastMove: last ? { from: last.from, to: last.to } : null,
    rating: j.puzzle.rating,
    themes,
  };
}

/** Today's Lichess puzzle (public API, called from your browser). */
export async function fetchDailyPuzzle(): Promise<Puzzle> {
  const r = await fetch('https://lichess.org/api/puzzle/daily', { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Lichess answered ${r.status}`);
  return fromLichess((await r.json()) as LichessPuzzleJson, 'daily');
}

export const DIFFICULTIES = ['easiest', 'easier', 'normal', 'harder', 'hardest'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** A random Lichess puzzle by theme ("angle") and difficulty — unlimited, straight from lichess.org. */
export async function fetchRandomPuzzle(difficulty: string, theme = 'mix', title?: string): Promise<Puzzle> {
  const q = new URLSearchParams({ difficulty });
  if (theme !== 'mix') q.set('angle', theme);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://lichess.org/api/puzzle/next?${q}`, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`Lichess answered ${r.status}`);
    return fromLichess((await r.json()) as LichessPuzzleJson, theme === 'mix' ? 'random' : 'theme', title);
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ offline theme pack */

export interface ThemeInfo {
  key: string;
  name: string;
  desc: string;
  count: number;
}
export interface PuzzlePack {
  groups: { name: string; themes: ThemeInfo[] }[];
  themes: Map<string, ThemeInfo & { ids: number[] }>;
  rows: [string, string, string, number, string, string][];
}

let packLoading: Promise<PuzzlePack> | null = null;

/** ~3,000 hand-picked Lichess puzzles (CC0) in 70+ themes — works offline, built by scripts/build-puzzles.py. */
export function loadPuzzlePack(baseUrl = import.meta.env.BASE_URL): Promise<PuzzlePack> {
  if (!packLoading) {
    packLoading = fetch(`${baseUrl.replace(/\/?$/, '/')}data/puzzles.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(
        (d: {
          groups: { name: string; themes: string[] }[];
          themes: Record<string, { name: string; desc: string; ids: number[] }>;
          puzzles: PuzzlePack['rows'];
        }) => {
          const themes = new Map(Object.entries(d.themes).map(([key, t]) => [key, { key, name: t.name, desc: t.desc, ids: t.ids, count: t.ids.length }]));
          return {
            groups: d.groups.map((g) => ({ name: g.name, themes: g.themes.map((k) => themes.get(k)!).filter(Boolean) })),
            themes,
            rows: d.puzzles,
          };
        },
      );
    packLoading.catch(() => {
      packLoading = null;
    });
  }
  return packLoading;
}

/** Lichess "difficulty" is relative to a 1500 player: −600 … +600. */
const DIFF_TARGET: Record<string, number> = { easiest: 900, easier: 1200, normal: 1500, harder: 1800, hardest: 2100 };

/** Converts a Lichess CSV row: the FEN is before the opponent's move, Moves[0] is that move. */
function fromRow(row: PuzzlePack['rows'][number], title: string): Puzzle | null {
  const [id, fen, moves, rating, themes, opening] = row;
  const uci = moves.split(' ');
  const c = new Chess(fen);
  let m;
  try {
    m = c.move({ from: uci[0].slice(0, 2), to: uci[0].slice(2, 4), promotion: uci[0][4] });
  } catch {
    return null;
  }
  return {
    id: `lichess-${id}`,
    source: 'theme',
    title,
    subtitle: `#${id} · rated ${rating} · ${c.turn() === 'w' ? 'White' : 'Black'} to move${opening ? ` · ${opening.replace(/_/g, ' ')}` : ''}`,
    fen: c.fen(),
    solution: uci.slice(1),
    lastMove: { from: m.from, to: m.to },
    rating,
    themes: themes.split(' ').filter((t) => !META.test(t)),
  };
}

/** A puzzle from the offline pack near the difficulty's rating, preferring ones you haven't done. */
export function pickPackPuzzle(pack: PuzzlePack, theme: string, difficulty: string, done: Set<string>): Puzzle | null {
  const t = pack.themes.get(theme);
  const ids = t ? t.ids : pack.rows.map((_, i) => i);
  const target = DIFF_TARGET[difficulty] ?? 1500;
  const fresh = ids.filter((i) => !done.has(`lichess-${pack.rows[i][0]}`));
  const pool = fresh.length ? fresh : ids;
  // Closest ratings first, then a random pick among the nearest few so it never repeats in order.
  const near = [...pool]
    .sort((a, b) => Math.abs(pack.rows[a][3] - target) - Math.abs(pack.rows[b][3] - target))
    .slice(0, Math.max(6, Math.ceil(pool.length / 5)));
  const row = pack.rows[near[Math.floor(Math.random() * near.length)]];
  return row ? fromRow(row, t?.name ?? 'Puzzle') : null;
}

/** Mistakes, misses and blunders from your saved, reviewed games: find the engine's move. */
export async function loadMyPuzzles(limit = 60): Promise<Puzzle[]> {
  const { items } = await listAnalyses();
  const out: Puzzle[] = [];
  for (const s of items.filter((x) => x.reviewed).slice(0, 25)) {
    try {
      const a = await getAnalysis(s.id);
      for (const m of a.review?.moves ?? []) {
        if (!['mistake', 'miss', 'blunder'].includes(m.classification) || !m.bestMove) continue;
        const prev = a.tree.nodes[a.tree.nodes[m.nodeId]?.parentId ?? ''];
        out.push({
          id: `mine-${s.id}-${m.ply}`,
          source: 'mine',
          title: a.title || `${s.players.white} vs ${s.players.black}`,
          subtitle: `Move ${m.moveNumber}${m.color === 'w' ? '' : '…'} · you played ${m.san} (${m.classification}) · ${m.color === 'w' ? 'White' : 'Black'} to move`,
          fen: m.fenBefore,
          solution: [m.bestMove],
          lastMove: prev?.from && prev?.to ? { from: prev.from, to: prev.to } : null,
          themes: [m.classification],
          engineCheck: true,
        });
        if (out.length >= limit) return out;
      }
    } catch {
      /* skip unreadable analyses */
    }
  }
  return out;
}
