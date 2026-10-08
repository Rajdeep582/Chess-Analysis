import { parseHeaders } from '../chess/pgn';
import { sameUser } from './query';
import type { GameHit } from './types';

export class SearchError extends Error {
  constructor(message: string, public readonly kind: 'not-found' | 'network' | 'rate-limit' | 'other' = 'other') {
    super(message);
    this.name = 'SearchError';
  }
}

const elo = (v?: string | number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function countPlies(pgn: string): number {
  const body = pgn.replace(/\[[^\]]*\]/g, '').replace(/\{[^}]*\}/g, '');
  return body.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).length;
}

// ------------------------------------------------------------------ Lichess

interface LichessGame {
  id: string;
  rated: boolean;
  speed: string;
  perf: string;
  createdAt: number;
  status: string;
  winner?: 'white' | 'black';
  players: { white: { user?: { name: string }; rating?: number; aiLevel?: number }; black: { user?: { name: string }; rating?: number; aiLevel?: number } };
  opening?: { eco: string; name: string };
  clock?: { initial: number; increment: number };
  pgn?: string;
  moves?: string;
}

/** Lichess public API: /api/games/user/{username} (free, CORS-enabled, ~20 games/s anonymously). */
export async function searchLichess(user: string, opponent: string | undefined, max: number, signal?: AbortSignal): Promise<GameHit[]> {
  const params = new URLSearchParams({ max: String(max), pgnInJson: 'true', opening: 'true', clocks: 'false', evals: 'false' });
  if (opponent) params.set('vs', opponent);
  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?${params}`, {
      headers: { Accept: 'application/x-ndjson' },
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new SearchError('Lichess could not be reached. Check your connection.', 'network');
  }
  if (res.status === 404) throw new SearchError(`No Lichess account named “${user}”.`, 'not-found');
  if (res.status === 429) throw new SearchError('Lichess is rate-limiting requests. Wait a minute and try again.', 'rate-limit');
  if (!res.ok) throw new SearchError(`Lichess returned an error (${res.status}).`);
  const text = await res.text();
  const hits: GameHit[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let g: LichessGame;
    try {
      g = JSON.parse(line) as LichessGame;
    } catch {
      continue;
    }
    if (!g.pgn) continue;
    const name = (p: LichessGame['players']['white']) => p.user?.name ?? (p.aiLevel ? `Stockfish level ${p.aiLevel}` : 'Anonymous');
    const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : g.status === 'started' ? '*' : '1/2-1/2';
    hits.push({
      id: `li:${g.id}`,
      source: 'lichess',
      white: name(g.players.white),
      black: name(g.players.black),
      whiteElo: g.players.white.rating,
      blackElo: g.players.black.rating,
      result,
      date: new Date(g.createdAt).toISOString().slice(0, 10),
      event: `${g.rated ? 'Rated' : 'Casual'} ${g.perf}`,
      timeControl: g.clock ? `${Math.round(g.clock.initial / 60)}+${g.clock.increment}` : g.speed,
      eco: g.opening?.eco,
      opening: g.opening?.name,
      plies: countPlies(g.pgn),
      url: `https://lichess.org/${g.id}`,
      pgn: g.pgn,
    });
  }
  return hits;
}

// ------------------------------------------------------------------ Chess.com

interface ChessComGame {
  url: string;
  pgn?: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  eco?: string;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new SearchError('Chess.com could not be reached. Check your connection.', 'network');
  }
  if (res.status === 404) throw new SearchError('not found', 'not-found');
  if (res.status === 429) throw new SearchError('Chess.com is rate-limiting requests. Try again shortly.', 'rate-limit');
  if (!res.ok) throw new SearchError(`Chess.com returned an error (${res.status}).`);
  return (await res.json()) as T;
}

function formatTc(tc: string): string {
  const [base, inc] = tc.split('+');
  if (tc.includes('/')) return 'daily';
  const m = Number(base) / 60;
  return `${m >= 1 ? Math.round(m) : m.toFixed(1)}+${inc ?? 0}`;
}

/**
 * Chess.com Published-Data API (free, CORS-enabled): monthly archives, newest first.
 * When an opponent is given, scans back up to `maxMonths` months for matching games.
 */
export async function searchChessCom(
  user: string,
  opponent: string | undefined,
  max: number,
  signal?: AbortSignal,
  onProgress?: (scanned: number, total: number) => void,
): Promise<GameHit[]> {
  const u = user.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  let archives: string[];
  try {
    archives = (await getJson<{ archives: string[] }>(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`, signal)).archives;
  } catch (e) {
    if (e instanceof SearchError && e.kind === 'not-found') throw new SearchError(`No Chess.com account named “${user}”.`, 'not-found');
    throw e;
  }
  const months = [...archives].reverse().slice(0, opponent ? 48 : 6);
  const hits: GameHit[] = [];
  let scanned = 0;
  for (const url of months) {
    if (hits.length >= max) break;
    const { games } = await getJson<{ games: ChessComGame[] }>(url, signal);
    scanned++;
    onProgress?.(scanned, months.length);
    for (const g of [...games].reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      if (opponent && !sameUser(sameUser(g.white.username, u) ? g.black.username : g.white.username, opponent)) continue;
      const h = parseHeaders(g.pgn.replace(/\r\n?/g, '\n')).headers;
      hits.push({
        id: `cc:${g.url.split('/').pop()}`,
        source: 'chesscom',
        white: g.white.username,
        black: g.black.username,
        whiteElo: g.white.rating,
        blackElo: g.black.rating,
        result: h.Result ?? '*',
        date: h.Date?.replace(/\./g, '-'),
        event: `${g.rated ? 'Rated' : 'Casual'} ${g.time_class}`,
        timeControl: formatTc(g.time_control),
        eco: h.ECO,
        opening: h.ECOUrl ? decodeURIComponent(h.ECOUrl.split('/').pop() ?? '').replace(/-/g, ' ').replace(/\s*\.{3}.*$|\s+\d+\..*$/, '').trim() : undefined,
        plies: countPlies(g.pgn),
        url: g.url,
        pgn: g.pgn,
      });
      if (hits.length >= max) break;
    }
  }
  return hits;
}

export { elo };
