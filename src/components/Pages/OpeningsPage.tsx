import { Chess } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, soundForMove } from '../../audio/sounds';
import { START_FEN, type MoveInput } from '../../chess/types';
import { loadOpeningBook, type OpeningBook } from '../../review/openingBook';
import { useApp, useController } from '../../state/context';
import type { BoardArrow } from '../ChessBoard/Arrows';
import { ChessBoard } from '../ChessBoard/ChessBoard';
import { Icon } from '../common/Icon';
import { PageHead, useBoardPrefs } from './common';
import { loadOpeningLines, openingWiki, type OpeningLine, type WikiSummary } from './openingData';

type Tab = 'explore' | 'catalog' | 'quiz' | 'saved';
const ECO_VOLUMES = [
  { eco: 'A', label: 'Flank', hint: '1.c4, 1.Nf3, 1.f4, Dutch, Benoni…' },
  { eco: 'B', label: 'Semi-open', hint: '1.e4 without 1…e5: Sicilian, Caro-Kann…' },
  { eco: 'C', label: 'Open & French', hint: '1.e4 e5: Ruy Lopez, Italian…' },
  { eco: 'D', label: 'Closed', hint: '1.d4 d5: Queen’s Gambit, Slav…' },
  { eco: 'E', label: 'Indian', hint: '1.d4 Nf6: King’s Indian, Nimzo…' },
];
const STORE = 'nocturne64.openings';

interface Saved {
  fav: string[];
  recent: string[];
}
function loadSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { fav: Array.isArray(s.fav) ? s.fav : [], recent: Array.isArray(s.recent) ? s.recent : [] };
  } catch {
    return { fav: [], recent: [] };
  }
}

interface Branch {
  san: string;
  uci: string;
  name: string | null;
  eco: string | null;
  lines: number;
}

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const movesText = (sans: string[], max = 10) =>
  sans
    .slice(0, max)
    .map((s, i) => (i % 2 ? s : `${i / 2 + 1}.${s}`))
    .join(' ') + (sans.length > max ? ' …' : '');

export default function OpeningsPage() {
  const c = useController();
  const prefs = useBoardPrefs();
  const sound = useApp((s) => s.settings.sound);
  const [book, setBook] = useState<OpeningBook | null>(null);
  const [lines, setLines] = useState<OpeningLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [tab, setTab] = useState<Tab>('explore');
  const [orientation, setOrientation] = useState<'w' | 'b'>('w');
  const [hover, setHover] = useState<BoardArrow | null>(null);
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [popup, setPopup] = useState<{ name: string; eco: string; n: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  /** The quiz hides every opening name until you answer. */
  const [concealed, setConcealed] = useState(false);
  const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([loadOpeningBook(), loadOpeningLines()])
      .then(([b, l]) => {
        setBook(b);
        setLines(l);
      })
      .catch(() => setError('The opening database could not be loaded.'));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      /* storage unavailable */
    }
  }, [saved]);

  const stopPlay = useCallback(() => {
    if (playTimer.current) clearInterval(playTimer.current);
    playTimer.current = null;
    setPlaying(false);
  }, []);
  useEffect(() => stopPlay, [stopPlay]);

  const { fen, last, fens, sansUpTo } = useMemo(() => {
    const g = new Chess();
    const fs = [g.fen()];
    let lm: { from: string; to: string } | null = null;
    for (const san of moves.slice(0, cursor)) {
      const m = g.move(san);
      lm = { from: m.from, to: m.to };
      fs.push(g.fen());
    }
    return { fen: g.fen(), last: lm, fens: fs, sansUpTo: moves.slice(0, cursor) };
  }, [moves, cursor]);

  const lineKey = sansUpTo.join(' ');
  const exactLine = useMemo(() => lines.find((l) => l.key === lineKey) ?? null, [lines, lineKey]);
  const current = useMemo(() => {
    if (!book) return null;
    for (let i = fens.length - 1; i >= 0; i--) {
      const o = book.lookup(fens[i]);
      if (o) return { ...o, exact: i === fens.length - 1 };
    }
    return null;
  }, [book, fens]);
  const family = current ? current.name.split(':')[0].trim() : null;
  const inBook = book ? fen === START_FEN || book.isBook(fen) : false;

  // Each newly reached named opening pops up over the board.
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    if (concealed || !current?.exact || `${current.eco} ${current.name}` === lastAnnounced.current) return;
    lastAnnounced.current = `${current.eco} ${current.name}`;
    const n = Date.now();
    setPopup({ name: current.name, eco: current.eco, n });
    setSaved((s) => ({ ...s, recent: [current.name, ...s.recent.filter((x) => x !== current.name)].slice(0, 20) }));
    const t = setTimeout(() => setPopup((p) => (p?.n === n ? null : p)), 2600);
    return () => clearTimeout(t);
  }, [current, concealed]);

  const branches = useMemo<Branch[]>(() => {
    if (!book) return [];
    const g = new Chess(fen);
    const prefix = lineKey ? `${lineKey} ` : '';
    const out: Branch[] = [];
    for (const m of g.moves({ verbose: true })) {
      const ng = new Chess(fen);
      ng.move(m.san);
      if (!book.isBook(ng.fen())) continue;
      const o = book.lookup(ng.fen());
      const p = `${prefix}${m.san}`;
      let count = 0;
      for (const l of lines) if (l.key === p || l.key.startsWith(`${p} `)) count++;
      out.push({ san: m.san, uci: m.from + m.to, name: o?.name ?? null, eco: o?.eco ?? null, lines: count });
    }
    return out.sort((a, b) => b.lines - a.lines || a.san.localeCompare(b.san));
  }, [book, fen, lineKey, lines]);

  const below = useMemo(() => {
    if (!lineKey) return [];
    return lines.filter((l) => l.key.startsWith(`${lineKey} `)).sort((a, b) => a.sans.length - b.sans.length || a.name.localeCompare(b.name));
  }, [lines, lineKey]);

  const sfx = useCallback(
    (san: string) => {
      if (sound?.enabled) playSound(soundForMove(san, san.includes('x')), sound.volume, 0.1);
    },
    [sound],
  );

  const play = (san: string) => {
    stopPlay();
    const g = new Chess(fen);
    const m = g.move(san);
    sfx(m.san);
    setMoves([...moves.slice(0, cursor), m.san]);
    setCursor(cursor + 1);
    setHover(null);
  };

  const onMove = (mv: MoveInput) => {
    try {
      const g = new Chess(fen);
      const m = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      if (!m) return false;
      play(m.san);
      return true;
    } catch {
      return false;
    }
  };

  /** Puts an opening on the board and plays it through move by move. */
  const loadLine = useCallback(
    (l: { sans: string[] }, animate = true) => {
      stopPlay();
      setHover(null);
      setMoves(l.sans);
      if (!animate) {
        setCursor(l.sans.length);
        return;
      }
      setCursor(0);
      setPlaying(true);
      let i = 0;
      playTimer.current = setInterval(() => {
        i++;
        setCursor(i);
        sfx(l.sans[i - 1]);
        if (i >= l.sans.length) stopPlay();
      }, 520);
    },
    [stopPlay, sfx],
  );

  const step = (d: number) => {
    stopPlay();
    const n = Math.max(0, Math.min(moves.length, cursor + d));
    if (n > cursor) sfx(moves[n - 1]);
    setCursor(n);
  };

  const isFav = !!exactLine && saved.fav.includes(exactLine.name);
  const toggleFav = () => {
    if (!exactLine) return;
    setSaved((s) => ({ ...s, fav: s.fav.includes(exactLine.name) ? s.fav.filter((x) => x !== exactLine.name) : [exactLine.name, ...s.fav] }));
  };

  const pgnText = () => {
    const g = new Chess();
    for (const san of sansUpTo) g.move(san);
    if (current) g.header('Opening', current.name, 'ECO', current.eco);
    return g.pgn();
  };

  // ←/→ step, Home/End jump.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'ArrowLeft') stepRef.current(-1);
      else if (e.key === 'ArrowRight') stepRef.current(1);
      else if (e.key === 'Home') stepRef.current(-999);
      else if (e.key === 'End') stepRef.current(999);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const arrows: BoardArrow[] = hover
    ? [hover]
    : playing
      ? []
      : branches.slice(0, 3).map((b, i) => ({ from: b.uci.slice(0, 2), to: b.uci.slice(2, 4), kind: i === 0 ? 'best' : 'alt', rank: i }));

  return (
    <main className="page openings-page" id="main">
      <PageHead
        icon="book"
        title="Opening Explorer"
        subtitle={lines.length ? `${lines.length.toLocaleString()} openings · the complete Lichess opening database` : 'Loading the opening database…'}
      />
      <div className="page-grid">
        <section className="page-board-col" aria-label="Board">
          <div className={`opening-banner ${inBook ? '' : 'off'}`}>
            {concealed ? (
              <b>Which opening is this?</b>
            ) : current ? (
              <>
                <span className="eco">{current.eco}</span>
                <b title={current.name}>{current.name}</b>
                {!current.exact && <span className="muted small nowrap">{inBook ? '· line continues' : '· out of book'}</span>}
              </>
            ) : (
              <b>{cursor === 0 ? 'Starting position — play a move or pick an opening' : 'Unnamed position'}</b>
            )}
            <span className="spacer" />
            {exactLine && !concealed && (
              <button
                type="button"
                className={`icon-btn star-btn ${isFav ? 'on' : ''}`}
                onClick={toggleFav}
                aria-pressed={isFav}
                title={isFav ? 'Remove from saved' : 'Save this opening'}
              >
                <Icon name="star" size={17} />
              </button>
            )}
          </div>
          <div className="page-board">
            <ChessBoard fen={fen} orientation={orientation} lastMove={last} arrows={arrows} interactive onMove={onMove} {...prefs} />
            {popup && (
              <div className="name-pop" key={popup.n} role="status">
                <span className="eco">{popup.eco}</span>
                <span>{popup.name}</span>
              </div>
            )}
          </div>
          <div className="tool-row nav-row">
            <button type="button" className="tool-btn" onClick={() => step(-999)} disabled={!cursor} title="Start (Home)">
              <Icon name="first" size={16} />
            </button>
            <button type="button" className="tool-btn" onClick={() => step(-1)} disabled={!cursor} title="Back (←)">
              <Icon name="prev" size={16} />
            </button>
            <button
              type="button"
              className={`tool-btn ${playing ? 'active' : ''}`}
              onClick={() => (playing ? stopPlay() : loadLine({ sans: moves }))}
              disabled={!moves.length}
              title="Play the line from the start"
            >
              <Icon name={playing ? 'pause' : 'play'} size={16} />
            </button>
            <button type="button" className="tool-btn" onClick={() => step(1)} disabled={cursor >= moves.length} title="Forward (→)">
              <Icon name="next" size={16} />
            </button>
            <button type="button" className="tool-btn" onClick={() => step(999)} disabled={cursor >= moves.length} title="End">
              <Icon name="last" size={16} />
            </button>
            <button type="button" className="tool-btn" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))} title="Flip board">
              <Icon name="flip" size={16} />
            </button>
            <button
              type="button"
              className="tool-btn accent"
              onClick={() => c.openText(cursor ? pgnText() : START_FEN, cursor ? 'pgn' : 'fen')}
              title="Analyze with Stockfish (new tab)"
            >
              <Icon name="chart" size={16} />
              <span className="tb-label">Analyze</span>
            </button>
            <button type="button" className="tool-btn" onClick={() => c.openPage('play', { fen })} title="Play this position against Stockfish">
              <Icon name="swords" size={16} />
              <span className="tb-label">Play</span>
            </button>
          </div>
        </section>

        <aside className="page-side" aria-label="Opening tools">
          <div className="source-tabs" role="tablist">
            {(
              [
                ['explore', 'Explore', 'search'],
                ['catalog', 'Catalog', 'book'],
                ['quiz', 'Quiz', 'target'],
                ['saved', 'Saved', 'star'],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'active' : ''}
                onClick={() => {
                  setTab(id);
                  setConcealed(false);
                }}
              >
                <Icon name={icon} size={15} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          {error && <p className="callout error">{error}</p>}
          {tab === 'explore' && (
            <ExploreTab
              family={family}
              branches={branches}
              below={below}
              cursor={cursor}
              moves={moves}
              onPlay={play}
              onHover={setHover}
              onLoad={loadLine}
              onPick={(i) => {
                stopPlay();
                setCursor(i + 1);
              }}
            />
          )}
          {tab === 'catalog' && <CatalogTab lines={lines} onLoad={loadLine} />}
          {tab === 'quiz' && <QuizTab lines={lines} onShow={loadLine} onConceal={setConcealed} />}
          {tab === 'saved' && <SavedTab lines={lines} saved={saved} onLoad={loadLine} onClear={() => setSaved((s) => ({ ...s, recent: [] }))} />}
        </aside>
      </div>
    </main>
  );
}

function WikiCard({ family }: { family: string | null }) {
  const [info, setInfo] = useState<WikiSummary | null | 'loading'>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!family) {
      setInfo(null);
      return;
    }
    let live = true;
    setInfo('loading');
    setOpen(false);
    openingWiki(family)
      .then((s) => live && setInfo(s))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [family]);
  return (
    <div className="card side-card wiki-card">
      <div className="side-label">About{family ? ` · ${family}` : ''}</div>
      {!family ? (
        <p className="muted small">Play a first move — or open the Catalog — and the story of the opening appears here.</p>
      ) : info === 'loading' ? (
        <div className="wiki-sk">
          <span className="sk sk-line" />
          <span className="sk sk-line" />
          <span className="sk sk-line" style={{ width: '60%' }} />
        </div>
      ) : info ? (
        <>
          <div className={`wiki-body ${open ? 'open' : ''}`}>
            {info.thumbnail && <img src={info.thumbnail} alt="" loading="lazy" />}
            <p>{info.extract}</p>
          </div>
          <div className="row between small">
            <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
              {open ? 'Show less' : 'Read more'}
            </button>
            <a href={info.url} target="_blank" rel="noreferrer noopener" className="muted">
              Wikipedia ↗
            </a>
          </div>
        </>
      ) : (
        <p className="muted small">No encyclopedia article found for this opening.</p>
      )}
    </div>
  );
}

function ExploreTab(props: {
  family: string | null;
  branches: Branch[];
  below: OpeningLine[];
  cursor: number;
  moves: string[];
  onPlay: (san: string) => void;
  onHover: (a: BoardArrow | null) => void;
  onLoad: (l: OpeningLine) => void;
  onPick: (i: number) => void;
}) {
  const { family, branches, below, cursor, moves, onPlay, onHover, onLoad, onPick } = props;
  const max = Math.max(1, ...branches.map((b) => b.lines));
  // "Sicilian Defense: Najdorf Variation" → "Najdorf Variation" while you are already in the Sicilian.
  const short = (name: string) => {
    const i = name.indexOf(':');
    return family && i > 0 && name.slice(0, i).trim() === family ? name.slice(i + 1).trim() : name;
  };
  return (
    <>
      <div className="card side-card op-crumbs-card">
        <div className="op-crumbs" role="list" aria-label="Moves">
          <button type="button" role="listitem" className={cursor === 0 ? 'current' : ''} onClick={() => onPick(-1)}>
            Start
          </button>
          {moves.map((san, i) => (
            <button
              key={i}
              type="button"
              role="listitem"
              className={`${i === cursor - 1 ? 'current' : ''} ${i >= cursor ? 'ahead' : ''}`}
              onClick={() => onPick(i)}
            >
              {i % 2 === 0 && <small>{i / 2 + 1}.</small>}
              {san}
            </button>
          ))}
          {!moves.length && <span className="muted small">Play a move on the board or pick one below.</span>}
        </div>
      </div>
      <div className="card side-card">
        <div className="side-label">{branches.length ? `Book moves · ${branches.length}` : 'End of the book'}</div>
        <ul className="branches">
          {branches.map((b, i) => (
            <li key={b.san}>
              <button
                type="button"
                onClick={() => onPlay(b.san)}
                onMouseEnter={() => onHover({ from: b.uci.slice(0, 2), to: b.uci.slice(2, 4), kind: 'hover' })}
                onMouseLeave={() => onHover(null)}
              >
                <span className={`br-move ${i < 3 ? 'top' : ''}`}>{b.san}</span>
                <span className="br-name" title={b.name ?? undefined}>
                  {b.name ? short(b.name) : <em>continues the line</em>}
                </span>
                <span className="br-count" title={`${b.lines} named lines`}>
                  {b.lines}
                </span>
                <span className="br-bar" style={{ ['--w' as string]: `${(b.lines / max) * 100}%` }} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {!!below.length && (
          <>
            <div className="side-label">Named lines from here · {below.length}</div>
            <ul className="op-results compact">
              {below.slice(0, 40).map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => onLoad(l)} title={movesText(l.sans, 40)}>
                    <span className="eco">{l.eco}</span>
                    <span className="op-name">{short(l.name)}</span>
                    <span className="op-len">{Math.ceil(l.sans.length / 2)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <WikiCard family={family} />
    </>
  );
}

function CatalogTab({ lines, onLoad }: { lines: OpeningLine[]; onLoad: (l: OpeningLine) => void }) {
  const [query, setQuery] = useState('');
  const [vol, setVol] = useState('C');
  const [openFam, setOpenFam] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const families = useMemo(() => {
    const map = new Map<string, OpeningLine[]>();
    for (const l of lines) {
      if (q) {
        if (!(l.name.toLowerCase().includes(q) || l.eco.toLowerCase() === q || l.key.toLowerCase().startsWith(q))) continue;
      } else if (!l.eco.startsWith(vol)) continue;
      const arr = map.get(l.family) ?? [];
      arr.push(l);
      map.set(l.family, arr);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [lines, q, vol]);
  const total = families.reduce((n, [, ls]) => n + ls.length, 0);
  return (
    <div className="card side-card">
      <label className="search-field">
        <Icon name="search" size={16} />
        <input
          type="search"
          value={query}
          placeholder="Name, ECO (B90) or moves (e4 c5 Nf3)"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search openings"
        />
      </label>
      {!q && (
        <div className="eco-vols" role="tablist">
          {ECO_VOLUMES.map((v) => (
            <button
              key={v.eco}
              type="button"
              role="tab"
              aria-selected={vol === v.eco}
              className={vol === v.eco ? 'active' : ''}
              onClick={() => setVol(v.eco)}
              title={v.hint}
            >
              <b>{v.eco}</b>
              <span>{v.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="muted small">
        {total.toLocaleString()} openings · {families.length} families{!q && ` · ${ECO_VOLUMES.find((v) => v.eco === vol)?.hint}`}
      </div>
      <ul className="families">
        {families.slice(0, q ? 80 : 400).map(([fam, ls]) => {
          const open = openFam === fam || (!!q && families.length <= 3);
          return (
            <li key={fam} className={open ? 'open' : ''}>
              <button type="button" className="fam-head" onClick={() => setOpenFam(open ? null : fam)} aria-expanded={open}>
                <span className="fam-name">{fam}</span>
                <span className="fam-eco">{[...new Set(ls.map((l) => l.eco))].slice(0, 2).join(' ')}</span>
                <span className="fam-count">{ls.length}</span>
                <span className="rcfg-caret" aria-hidden="true" />
              </button>
              {open && (
                <ul className="fam-lines">
                  {ls.slice(0, 250).map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => onLoad(l)}>
                        <span className="eco">{l.eco}</span>
                        <span className="fl-text">
                          <b>{l.variation || 'Main line'}</b>
                          <small>{movesText(l.sans)}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {!families.length && <p className="muted small">No openings match.</p>}
    </div>
  );
}

function QuizTab({ lines, onShow, onConceal }: { lines: OpeningLine[]; onShow: (l: OpeningLine) => void; onConceal: (v: boolean) => void }) {
  const pool = useMemo(() => lines.filter((l) => l.sans.length >= 3 && l.sans.length <= 12), [lines]);
  const families = useMemo(() => [...new Set(pool.map((l) => l.family))], [pool]);
  const [q, setQ] = useState<{ line: OpeningLine; choices: string[] } | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });
  const next = useCallback(() => {
    if (!pool.length) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    const wrong = shuffle(families.filter((f) => f !== line.family)).slice(0, 3);
    setQ({ line, choices: shuffle([line.family, ...wrong]) });
    setAnswer(null);
    onConceal(true);
    onShow(line);
  }, [pool, families, onShow, onConceal]);
  useEffect(() => {
    if (!q && pool.length) next();
  }, [q, pool.length, next]);
  const pick = (f: string) => {
    if (!q || answer) return;
    setAnswer(f);
    onConceal(false);
    const ok = f === q.line.family;
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }));
  };
  return (
    <div className="card side-card quiz-card">
      <div className="side-label">Name that opening</div>
      <p className="muted small">Watch the moves on the board, then pick the opening.</p>
      {q && (
        <div className="quiz-choices">
          {q.choices.map((f) => (
            <button
              key={f}
              type="button"
              className={answer ? (f === q.line.family ? 'right' : f === answer ? 'wrong' : 'dim') : ''}
              onClick={() => pick(f)}
              disabled={!!answer}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      {answer && q && (
        <div className={`quiz-result ${answer === q.line.family ? 'ok' : 'bad'}`}>
          <b>{answer === q.line.family ? 'Correct!' : 'Not quite.'}</b> <span className="eco">{q.line.eco}</span> {q.line.name}
        </div>
      )}
      <div className="row between">
        <span className="small">
          Score <b>{score.right}</b>/{score.total} · streak <b>{score.streak}</b>
        </span>
        <button type="button" className="btn small primary" onClick={next}>
          {answer ? 'Next' : 'Skip'} <Icon name="next" size={14} />
        </button>
      </div>
    </div>
  );
}

function SavedTab({ lines, saved, onLoad, onClear }: { lines: OpeningLine[]; saved: Saved; onLoad: (l: OpeningLine) => void; onClear: () => void }) {
  const byName = useMemo(() => new Map(lines.map((l) => [l.name, l])), [lines]);
  const list = (names: string[]) =>
    names
      .map((n) => byName.get(n))
      .filter((l): l is OpeningLine => !!l)
      .map((l) => (
        <li key={l.id}>
          <button type="button" onClick={() => onLoad(l)}>
            <span className="eco">{l.eco}</span>
            <span className="op-name">{l.name}</span>
          </button>
        </li>
      ));
  return (
    <>
      <div className="card side-card">
        <div className="side-label">Saved openings · {saved.fav.length}</div>
        {saved.fav.length ? (
          <ul className="op-results">{list(saved.fav)}</ul>
        ) : (
          <p className="muted small">Tap the ★ next to an opening name to keep it here.</p>
        )}
      </div>
      <div className="card side-card">
        <div className="row between">
          <div className="side-label">Recently reached</div>
          {!!saved.recent.length && (
            <button type="button" className="link-btn" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        {saved.recent.length ? (
          <ul className="op-results">{list(saved.recent)}</ul>
        ) : (
          <p className="muted small">Openings you reach on the board show up here.</p>
        )}
      </div>
    </>
  );
}
