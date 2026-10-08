import { compressToUrl, decompressFromUrl } from './compression';

/** Everything needed to restore a shared analysis. Only the game itself is shared — never local data. */
export interface SharePayload {
  v: 1;
  /** PGN (moves + headers + variations) when sharing a game. */
  pgn?: string;
  /** FEN when sharing a single position. */
  fen?: string;
  /** Main-line ply to open at. */
  ply?: number;
  orientation?: 'w' | 'b';
}

export const SHARE_PREFIX = '#a=';
export const MAX_RECOMMENDED_URL = 8000;

export function encodeShare(p: SharePayload): string {
  return SHARE_PREFIX + compressToUrl(JSON.stringify(p));
}

export function buildShareUrl(p: SharePayload, loc: { origin: string; pathname: string } = window.location): string {
  return `${loc.origin}${loc.pathname}${encodeShare(p)}`;
}

export type DecodeResult = { ok: true; payload: SharePayload } | { ok: false; error: string } | { ok: false; error: null };

/** Decodes a location hash. `error: null` means there was nothing to decode. */
export function decodeShare(hash: string): DecodeResult {
  if (!hash || !hash.startsWith(SHARE_PREFIX)) return { ok: false, error: null };
  const json = decompressFromUrl(hash.slice(SHARE_PREFIX.length));
  if (!json) return { ok: false, error: 'This share link is damaged or incomplete and could not be decoded.' };
  try {
    const p = JSON.parse(json) as SharePayload;
    if (p.v !== 1 || (typeof p.pgn !== 'string' && typeof p.fen !== 'string')) {
      return { ok: false, error: 'This share link was created by an incompatible version.' };
    }
    return { ok: true, payload: p };
  } catch {
    return { ok: false, error: 'This share link is damaged and could not be read.' };
  }
}
