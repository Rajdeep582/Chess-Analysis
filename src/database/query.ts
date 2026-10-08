import type { ParsedQuery } from './types';

/**
 * Parses "Carlsen vs Anand", "Carlsen - Anand 2013", "Kasparov v. Topalov", "hikaru".
 * A 4-digit year anywhere in the query becomes a year filter.
 */
export function parseQuery(input: string): ParsedQuery | null {
  let raw = input.trim().replace(/\s+/g, ' ');
  if (!raw) return null;
  let year: number | undefined;
  const y = raw.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  if (y) {
    year = Number(y[1]);
    raw = raw.replace(y[0], ' ').replace(/\s+/g, ' ').trim();
  }
  const parts = raw.split(/\s+(?:vs\.?|v\.?|versus|against|x)\s+|\s+[-–—]\s+|\s*\/\s*/i).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return year ? { a: '', year, raw: input.trim() } : null;
  return { a: parts[0], b: parts[1], year, raw: input.trim() };
}

/** Lowercase, strip accents and punctuation; "Carlsen, Magnus" → "carlsen magnus". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True if every token of the query name appears (as a word prefix) in the player name. */
export function nameMatches(query: string, player: string): boolean {
  const q = normalizeName(query).split(' ').filter(Boolean);
  if (!q.length) return true;
  const words = normalizeName(player).split(' ').filter(Boolean);
  // A one-letter word is an initial ("Carlsen,M"): it matches a query token starting with it.
  return q.every((t) => words.some((w) => w.startsWith(t) || (w.length === 1 && t.startsWith(w))));
}

/** Username-style comparison for online accounts. */
export function sameUser(a: string, b: string): boolean {
  return a.toLowerCase().replace(/[^a-z0-9_-]/g, '') === b.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}
