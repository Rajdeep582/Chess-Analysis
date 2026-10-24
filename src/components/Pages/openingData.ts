/** The full lichess-org/chess-openings catalogue (CC0), loaded only by the Opening Explorer. */
export interface OpeningLine {
  id: number;
  eco: string;
  name: string;
  /** Text before the first ":" — e.g. "Sicilian Defense". */
  family: string;
  /** Text after it — e.g. "Najdorf Variation" ("" for the main name). */
  variation: string;
  sans: string[];
  /** SAN moves joined by spaces (fast prefix matching). */
  key: string;
}

let loading: Promise<OpeningLine[]> | null = null;

export function loadOpeningLines(baseUrl = import.meta.env.BASE_URL): Promise<OpeningLine[]> {
  if (!loading) {
    loading = fetch(`${baseUrl.replace(/\/?$/, '/')}data/opening-lines.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ lines: [string, string, string][] }>;
      })
      .then((d) =>
        d.lines.map(([eco, name, moves], id) => {
          const i = name.indexOf(':');
          return {
            id,
            eco,
            name,
            family: i >= 0 ? name.slice(0, i).trim() : name.trim(),
            variation: i >= 0 ? name.slice(i + 1).trim() : '',
            sans: moves.split(' '),
            key: moves,
          };
        }),
      );
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  thumbnail?: string;
}

const wikiCache = new Map<string, Promise<WikiSummary | null>>();

async function summary(title: string): Promise<WikiSummary | null> {
  const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.type === 'disambiguation' || !j.extract) return null;
  return {
    title: j.title,
    extract: j.extract,
    url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    thumbnail: j.thumbnail?.source,
  };
}

/**
 * A short encyclopedia summary of an opening family (Wikipedia, CC BY-SA), e.g. "Sicilian Defense" →
 * "Sicilian Defence". Tries the British spelling and a "(chess)" suffix before giving up.
 */
export function openingWiki(family: string): Promise<WikiSummary | null> {
  let p = wikiCache.get(family);
  if (!p) {
    const british = family.replace(/Defense/g, 'Defence');
    const tries = [...new Set([british, family, `${british} (chess)`, `${british} (chess opening)`])];
    p = (async () => {
      for (const t of tries) {
        try {
          const s = await summary(t);
          // Only accept chess articles (avoid e.g. a city called "Vienna").
          if (s && /chess|opening|gambit|defen[cs]e|move/i.test(s.extract)) return s;
        } catch {
          /* try next */
        }
      }
      return null;
    })();
    wikiCache.set(family, p);
  }
  return p;
}
