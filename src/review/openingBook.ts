/**
 * Opening book backed by the lichess-org/chess-openings dataset (CC0-1.0), bundled as a lazily
 * loaded JSON chunk. A position counts as "book" only if it appears in that dataset.
 */
export interface OpeningInfo {
  eco: string;
  name: string;
}

export interface OpeningBook {
  isBook(fen: string): boolean;
  lookup(fen: string): OpeningInfo | null;
  readonly size: number;
}

export interface OpeningData {
  named: Record<string, [string, string]>;
  book: string[];
}

const keyOf = (fen: string) => fen.split(' ').slice(0, 3).join(' ');

export function createOpeningBook(data: OpeningData): OpeningBook {
  const set = new Set(data.book);
  for (const k of Object.keys(data.named)) set.add(k);
  return {
    isBook: (fen) => set.has(keyOf(fen)),
    lookup: (fen) => {
      const v = data.named[keyOf(fen)];
      return v ? { eco: v[0], name: v[1] } : null;
    },
    size: set.size,
  };
}

let loading: Promise<OpeningBook> | null = null;

/** Loads the bundled opening data (served as a static asset, cached offline by the PWA). */
export function loadOpeningBook(baseUrl = import.meta.env.BASE_URL): Promise<OpeningBook> {
  if (!loading) {
    loading = fetch(`${baseUrl.replace(/\/?$/, '/')}data/openings.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<OpeningData>;
      })
      .then(createOpeningBook);
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Finds the most specific named opening along a sequence of positions. */
export function identifyOpening(book: OpeningBook, fens: string[]): (OpeningInfo & { ply: number }) | null {
  let found: (OpeningInfo & { ply: number }) | null = null;
  fens.forEach((fen, ply) => {
    const o = book.lookup(fen);
    if (o) found = { ...o, ply };
  });
  return found;
}
