import { parseHeaders, splitGames } from '../chess/pgn';
import { getDb, translateStorageError } from '../storage/indexedDB';
import { nameMatches, normalizeName } from './query';
import type { DbGame, GameHit, ParsedQuery } from './types';

export const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

function toElo(v?: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function hashId(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return `g${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

/** Builds DB records from a multi-game PGN text (no move validation, so imports stay fast). */
export function pgnToRecords(text: string, collection: string): DbGame[] {
  const out: DbGame[] = [];
  for (const g of splitGames(text)) {
    const { headers } = parseHeaders(g);
    if (!headers.White && !headers.Black) continue;
    const white = headers.White ?? '?';
    const black = headers.Black ?? '?';
    const date = headers.Date && headers.Date !== '????.??.??' ? headers.Date.replace(/\.\?\?/g, '') : undefined;
    out.push({
      id: hashId(`${white}|${black}|${headers.Date}|${headers.Round}|${g.length}|${g.slice(-120)}`),
      collection,
      white,
      black,
      whiteElo: toElo(headers.WhiteElo),
      blackElo: toElo(headers.BlackElo),
      result: headers.Result ?? '*',
      date,
      event: headers.Event && headers.Event !== '?' ? headers.Event : undefined,
      site: headers.Site && headers.Site !== '?' ? headers.Site : undefined,
      eco: headers.ECO,
      opening: headers.Opening,
      search: normalizeName([white, black, headers.Event, headers.Opening, date].filter(Boolean).join(' ')),
      pgn: g.trim(),
    });
  }
  return out;
}

export async function importPgnDatabase(
  text: string,
  collection: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; total: number }> {
  const records = pgnToRecords(text, collection);
  try {
    const db = await getDb();
    const before = await db.count('games');
    const CHUNK = 2000;
    for (let i = 0; i < records.length; i += CHUNK) {
      const tx = db.transaction('games', 'readwrite');
      for (const r of records.slice(i, i + CHUNK)) void tx.store.put(r);
      await tx.done;
      onProgress?.(Math.min(records.length, i + CHUNK), records.length);
    }
    const after = await db.count('games');
    return { added: after - before, total: records.length };
  } catch (e) {
    throw translateStorageError(e);
  }
}

export async function localDbStats(): Promise<{ games: number; collections: string[] }> {
  try {
    const db = await getDb();
    const games = await db.count('games');
    const cols = new Set<string>();
    let cursor = await db.transaction('games').store.index('collection').openKeyCursor(null, 'nextunique');
    while (cursor) {
      cols.add(cursor.key as string);
      cursor = await cursor.continue();
    }
    return { games, collections: [...cols] };
  } catch {
    return { games: 0, collections: [] };
  }
}

export async function clearLocalDb(): Promise<void> {
  const db = await getDb();
  await db.clear('games');
}

export function matchesQuery(g: Pick<DbGame, 'white' | 'black' | 'date' | 'search'>, q: ParsedQuery): boolean {
  if (q.year && !(g.date ?? '').startsWith(String(q.year))) return false;
  if (q.b) {
    return (nameMatches(q.a, g.white) && nameMatches(q.b, g.black)) || (nameMatches(q.a, g.black) && nameMatches(q.b, g.white));
  }
  if (!q.a) return true;
  if (nameMatches(q.a, g.white) || nameMatches(q.a, g.black)) return true;
  // Fall back to event / opening text.
  const t = normalizeName(q.a);
  return t.length >= 3 && g.search.includes(t);
}

export async function searchLocalDb(q: ParsedQuery, max: number): Promise<GameHit[]> {
  const db = await getDb();
  const hits: GameHit[] = [];
  let cursor = await db.transaction('games').store.openCursor();
  while (cursor && hits.length < max) {
    const g = cursor.value;
    if (matchesQuery(g, q)) {
      hits.push({
        id: `db:${g.id}`,
        source: 'local',
        white: g.white,
        black: g.black,
        whiteElo: g.whiteElo,
        blackElo: g.blackElo,
        result: g.result,
        date: g.date,
        event: [g.event, g.site].filter(Boolean).join(', ') || undefined,
        eco: g.eco,
        opening: g.opening,
        pgn: g.pgn,
      });
    }
    cursor = await cursor.continue();
  }
  return hits.sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));
}
