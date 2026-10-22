import { useEffect, useRef, useState } from 'react';
import { clearLocalDb, importPgnDatabase, localDbStats, matchesQuery, MAX_IMPORT_BYTES, searchLocalDb } from '../../database/localDb';
import { searchChessCom, searchLichess, SearchError } from '../../database/online';
import { normalizeName, parseQuery } from '../../database/query';
import type { GameHit, GameSource, ParsedQuery } from '../../database/types';
import { useController } from '../../state/context';
import { SAMPLE_GAMES } from '../../state/samples';
import { parseHeaders } from '../../chess/pgn';
import { Icon } from '../common/Icon';

type SourceKey = 'all' | 'lichess' | 'chesscom' | 'local';

interface SourceState {
  status: 'loading' | 'done' | 'error';
  message?: string;
  count?: number;
}

const SOURCE_LABEL: Record<GameSource, string> = { lichess: 'Lichess', chesscom: 'Chess.com', local: 'My database', legend: 'Classics' };

const EXAMPLES = ['MagnusCarlsen vs Hikaru', 'Hikaru', 'Kasparov vs Topalov', 'Fischer', 'DrNykterstein'];

function legendHits(q: ParsedQuery): GameHit[] {
  return SAMPLE_GAMES.map((g) => ({ g, h: parseHeaders(g.pgn).headers }))
    .filter(({ g, h }) => matchesQuery({ white: g.white, black: g.black, date: h.Date, search: normalizeName(`${g.white} ${g.black} ${g.event} ${g.title}`) }, q))
    .map(({ g, h }) => ({
      id: `legend:${g.id}`,
      source: 'legend' as const,
      white: g.white,
      black: g.black,
      result: h.Result ?? '*',
      date: String(g.year),
      event: g.event,
      eco: h.ECO,
      opening: g.title,
      pgn: g.pgn,
    }));
}

function ResultChip({ r }: { r: string }) {
  const cls = r === '1-0' ? 'w' : r === '0-1' ? 'b' : 'd';
  return <span className={`res-chip res-${cls}`}>{r === '1/2-1/2' ? '½–½' : r}</span>;
}

/** Usernames on Lichess/Chess.com never contain spaces; a single token can be tried online. */
function isUsername(s?: string): s is string {
  return !!s && /^[A-Za-z0-9_-]{2,30}$/.test(s);
}

export function GameSearch() {
  const c = useController();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceKey>('all');
  const [hits, setHits] = useState<GameHit[]>([]);
  const [searched, setSearched] = useState<ParsedQuery | null>(null);
  const [states, setStates] = useState<Partial<Record<GameSource, SourceState>>>({});
  const [db, setDb] = useState<{ games: number; collections: string[] }>({ games: 0, collections: [] });
  const [importing, setImporting] = useState<string | null>(null);
  const [shown, setShown] = useState(15);
  const [confirmClear, setConfirmClear] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void localDbStats().then(setDb);
    return () => abortRef.current?.abort();
  }, []);

  const run = async (text = query) => {
    const q = parseQuery(text);
    if (!q || (!q.a && !q.year)) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSearched(q);
    setShown(15);
    const all: GameHit[] = [];
    setHits([]);
    const push = (list: GameHit[]) => {
      if (ctrl.signal.aborted) return;
      all.push(...list);
      setHits([...all].sort((x, y) => (y.date ?? '').localeCompare(x.date ?? '')));
    };
    const want = (s: GameSource) => source === 'all' || source === s || (s === 'legend' && source === 'local');
    const online = isUsername(q.a) && (!q.b || isUsername(q.b));
    const offlineMsg = 'Online search needs usernames without spaces (e.g. MagnusCarlsen).';
    const next: Partial<Record<GameSource, SourceState>> = {};
    if (want('legend')) next.legend = { status: 'loading' };
    if (want('local')) next.local = { status: 'loading' };
    if (want('lichess')) next.lichess = online ? { status: 'loading' } : { status: 'error', message: offlineMsg };
    if (want('chesscom')) next.chesscom = online ? { status: 'loading' } : { status: 'error', message: offlineMsg };
    setStates(next);

    const done = (s: GameSource, list: GameHit[]) => {
      const filtered = q.year ? list.filter((h) => (h.date ?? '').startsWith(String(q.year))) : list;
      push(filtered);
      if (!ctrl.signal.aborted) setStates((p) => ({ ...p, [s]: { status: 'done', count: filtered.length } }));
    };
    const fail = (s: GameSource, e: unknown) => {
      if ((e as Error).name === 'AbortError' || ctrl.signal.aborted) return;
      const notFound = e instanceof SearchError && e.kind === 'not-found';
      setStates((p) => ({ ...p, [s]: { status: notFound ? 'done' : 'error', count: 0, message: e instanceof SearchError ? e.message : 'Search failed.' } }));
    };
    const tasks: Promise<void>[] = [];
    if (next.legend) tasks.push(Promise.resolve().then(() => done('legend', legendHits(q))));
    if (next.local) tasks.push(searchLocalDb(q, 500).then((l) => done('local', l), (e) => fail('local', e)));
    if (online && next.lichess) tasks.push(searchLichess(q.a, q.b, 50, ctrl.signal).then((l) => done('lichess', l), (e) => fail('lichess', e)));
    if (online && next.chesscom) {
      tasks.push(
        searchChessCom(q.a, q.b, 50, ctrl.signal, (n, t) => {
          if (!ctrl.signal.aborted) setStates((p) => ({ ...p, chesscom: { status: 'loading', message: `month ${n}/${t}` } }));
        }).then((l) => done('chesscom', l), (e) => fail('chesscom', e)),
      );
    }
    await Promise.all(tasks);
  };

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) {
      setImporting(`“${f.name}” is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB — split it into smaller files.`);
      return;
    }
    setImporting(`Reading ${f.name}…`);
    try {
      const text = await f.text();
      const res = await importPgnDatabase(text, f.name.replace(/\.pgn$/i, ''), (d, t) => setImporting(`Importing ${d.toLocaleString()} / ${t.toLocaleString()} games…`));
      setImporting(
        `Added ${res.added.toLocaleString()} games from ${f.name}${res.added < res.total ? ` (${(res.total - res.added).toLocaleString()} were already there)` : ''}.`,
      );
      setDb(await localDbStats());
    } catch (e) {
      setImporting(`Import failed: ${(e as Error).message}`);
    }
  };

  const open = (h: GameHit) => {
    const r = c.openText(h.pgn, 'pgn');
    if (!r.ok) c.toast('error', 'This game could not be opened.', r.detail ?? r.error);
  };

  const loading = Object.values(states).some((s) => s?.status === 'loading');

  return (
    <section className="game-search" aria-labelledby="search-title">
      <div className="legends-head">
        <h2 id="search-title">Game search</h2>
        <span className="muted small">Lichess · Chess.com · your own PGN database</span>
      </div>

      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Hikaru vs MagnusCarlsen"
          aria-label="Search games by player names"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="search-sources" role="radiogroup" aria-label="Where to search">
          {(['all', 'lichess', 'chesscom', 'local'] as SourceKey[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={source === s} className={source === s ? 'active' : ''} onClick={() => setSource(s)}>
              {s === 'all' ? 'All' : s === 'local' ? 'My DB' : SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
        <button type="submit" className="btn primary search-go" disabled={!query.trim()}>
          {loading ? <span className="spinner" aria-hidden="true" /> : null} Search
        </button>
      </form>

      <div className="search-examples">
        <span className="muted tiny">Try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="example-chip"
            onClick={() => {
              setQuery(ex);
              void run(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {searched && (
        <div className="search-status" aria-live="polite">
          {(Object.keys(states) as GameSource[]).map((s) => {
            const st = states[s]!;
            return (
              <span key={s} className={`src-status ${st.status}`}>
                <span className={`src-dot src-${s}`} aria-hidden="true" />
                <b>{SOURCE_LABEL[s]}</b>
                {st.status === 'loading' && (
                  <>
                    <span className="spinner" aria-hidden="true" /> {st.message ?? 'searching…'}
                  </>
                )}
                {st.status === 'done' && (
                  <span className={st.message ? 'muted' : ''}>{st.message ?? `${st.count} game${st.count === 1 ? '' : 's'}`}</span>
                )}
                {st.status === 'error' && <span className="src-err">{st.message}</span>}
              </span>
            );
          })}
        </div>
      )}

      {searched && (
        <ul className="hit-list">
          {hits.length === 0 && !loading && (
            <li className="hit-empty">
              No games found for “{searched.raw}”. Online sources need exact usernames (e.g. <b>MagnusCarlsen</b> on Chess.com, <b>DrNykterstein</b> on
              Lichess). For historical over-the-board games, import a free PGN database below.
            </li>
          )}
          {hits.slice(0, shown).map((h) => (
            <li key={h.id}>
              <button type="button" className="hit" onClick={() => open(h)}>
                <span className={`hit-src src-${h.source}`}>{SOURCE_LABEL[h.source]}</span>
                <span className="hit-players">
                  <span className="hit-p">
                    <span className="side-chip w" aria-hidden="true" />
                    <span className="hit-name">{h.white}</span>
                    {h.whiteElo ? <small>{h.whiteElo}</small> : null}
                  </span>
                  <span className="hit-p">
                    <span className="side-chip b" aria-hidden="true" />
                    <span className="hit-name">{h.black}</span>
                    {h.blackElo ? <small>{h.blackElo}</small> : null}
                  </span>
                </span>
                <ResultChip r={h.result} />
                <span className="hit-meta">
                  <span>{[h.event, h.timeControl].filter(Boolean).join(' · ') || '—'}</span>
                  <span className="muted">{[h.date, h.eco, h.opening].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="hit-open">
                  Analyze <Icon name="next" size={14} />
                </span>
              </button>
            </li>
          ))}
          {hits.length > shown && (
            <li className="hit-more">
              <button type="button" className="btn small" onClick={() => setShown((n) => n + 25)}>
                Show more ({hits.length - shown} left)
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="db-card">
        <div className="db-info">
          <span className="db-icon" aria-hidden="true">
            <Icon name="folder" size={20} />
          </span>
          <div>
            <b>My database · {db.games.toLocaleString()} games</b>
            <p className="muted small">
              Import PGN collections to search historical master games offline — free downloads such as player files from{' '}
              <a href="https://www.pgnmentor.com/files.html" target="_blank" rel="noreferrer">
                PGN Mentor
              </a>
              , tournament games from{' '}
              <a href="https://theweekinchess.com/twic" target="_blank" rel="noreferrer">
                TWIC
              </a>{' '}
              or the{' '}
              <a href="https://database.lichess.org/" target="_blank" rel="noreferrer">
                Lichess open database
              </a>
              . Stored only in this browser.
            </p>
            {importing && <p className="small db-msg">{importing}</p>}
          </div>
        </div>
        <div className="db-actions">
          <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} /> Import PGN database
          </button>
          {db.games > 0 &&
            (confirmClear ? (
              <>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={async () => {
                    await clearLocalDb();
                    setDb(await localDbStats());
                    setConfirmClear(false);
                    setImporting('Database cleared.');
                  }}
                >
                  Delete all {db.games.toLocaleString()} games
                </button>
                <button type="button" className="btn small ghost" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn small ghost danger" onClick={() => setConfirmClear(true)}>
                Clear
              </button>
            ))}
          <input ref={fileRef} type="file" accept=".pgn,.txt" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
        </div>
      </div>
    </section>
  );
}
