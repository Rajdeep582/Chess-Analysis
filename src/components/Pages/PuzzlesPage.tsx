import { Chess } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, soundForMove } from '../../audio/sounds';
import type { MoveInput } from '../../chess/types';
import { analysisExpectedWhite } from '../../engine/evalUtils';
import { useApp, useController } from '../../state/context';
import type { BoardArrow } from '../ChessBoard/Arrows';
import { ChessBoard } from '../ChessBoard/ChessBoard';
import { Icon } from '../common/Icon';
import { PageHead, useBoardPrefs } from './common';
import {
  CLASSIC_PUZZLES,
  DIFFICULTIES,
  fetchDailyPuzzle,
  fetchRandomPuzzle,
  loadMyPuzzles,
  loadPuzzlePack,
  pickPackPuzzle,
  themeWords,
  type Puzzle,
  type PuzzlePack,
} from './puzzleData';

type Source = 'theme' | 'daily' | 'classic' | 'mine';
type Status = 'solving' | 'wrong' | 'solved' | 'shown';

const STATS_KEY = 'nocturne64.puzzles';
interface Stats {
  solved: number;
  attempted: number;
  streak: number;
  best: number;
  done: string[];
}
function loadStats(): Stats {
  try {
    const s = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
    return {
      solved: s.solved || 0,
      attempted: s.attempted || 0,
      streak: s.streak || 0,
      best: s.best || 0,
      done: Array.isArray(s.done) ? s.done.slice(-500) : [],
    };
  } catch {
    return { solved: 0, attempted: 0, streak: 0, best: 0, done: [] };
  }
}

const PREFS_KEY = 'nocturne64.puzzles.prefs';
interface Prefs {
  theme: string;
  difficulty: string;
  online: boolean;
}
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      theme: typeof p.theme === 'string' ? p.theme : 'mix',
      difficulty: DIFFICULTIES.includes(p.difficulty) ? p.difficulty : 'normal',
      online: p.online !== false,
    };
  } catch {
    return { theme: 'mix', difficulty: 'normal', online: true };
  }
}

const SOURCES: { id: Source; label: string; icon: 'star' | 'puzzle' | 'fire' | 'target' }[] = [
  { id: 'theme', label: 'Themes', icon: 'puzzle' },
  { id: 'daily', label: 'Daily', icon: 'star' },
  { id: 'classic', label: 'Classics', icon: 'fire' },
  { id: 'mine', label: 'My mistakes', icon: 'target' },
];
const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');

export default function PuzzlesPage() {
  const c = useController();
  const prefs = useBoardPrefs();
  const sound = useApp((s) => s.settings.sound);
  const [source, setSource] = useState<Source>('theme');
  const [prefsState, setPrefs] = useState<Prefs>(loadPrefs);
  const { theme, difficulty, online } = prefsState;
  const [pack, setPack] = useState<PuzzlePack | null>(null);
  const [nonce, setNonce] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<Puzzle[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>(loadStats);
  const statsRef = useRef(stats);
  statsRef.current = stats;
  const puzzle = list[index] ?? null;

  const game = useRef(new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Status>('solving');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [checking, setChecking] = useState(false);
  const failed = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch {
      /* storage unavailable */
    }
  }, [stats]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefsState));
    } catch {
      /* storage unavailable */
    }
  }, [prefsState]);
  useEffect(() => {
    loadPuzzlePack()
      .then(setPack)
      .catch(() => setPack(null));
  }, []);
  useEffect(() => {
    void c.engine.start().catch(() => undefined);
    return () => {
      clearTimers();
      c.engine.cancelGroup('puzzle');
    };
  }, [c]);

  // Load the puzzle list for the chosen source.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    // Only the latest request may update the list (switching tabs mid-download must not be overwritten).
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      let next: Puzzle[];
      let note: string | null = null;
      if (source === 'classic') next = CLASSIC_PUZZLES;
      else if (source === 'mine') {
        next = await loadMyPuzzles();
        if (!next.length) note = 'No mistakes to train yet. Review a game and save it to your Library — its mistakes, misses and blunders appear here.';
      } else if (source === 'daily') next = [await fetchDailyPuzzle()];
      else {
        const pk = await loadPuzzlePack().catch(() => null);
        const name = theme === 'mix' ? 'Healthy mix' : (pk?.themes.get(theme)?.name ?? themeWords(theme));
        const offline = () => {
          if (!pk) throw new Error('offline pack not loaded');
          const p = pickPackPuzzle(pk, theme, difficulty, new Set(statsRef.current.done));
          if (!p) throw new Error('no puzzle for this theme');
          return p;
        };
        if (online) {
          try {
            next = [await fetchRandomPuzzle(difficulty, theme, name)];
          } catch {
            next = [offline()];
            note = 'Lichess is unreachable — showing a puzzle from the offline pack.';
          }
        } else next = [offline()];
      }
      if (seq !== loadSeq.current) return;
      setList(next);
      setIndex(0);
      setError(note);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setList([]);
      setError(`Couldn't load a puzzle (${e instanceof Error ? e.message : 'network error'}). Check your connection, or switch to the offline pack.`);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    // nonce: "Next" in theme mode asks for a fresh puzzle.
  }, [source, difficulty, theme, online, nonce]);
  useEffect(() => {
    void load();
  }, [load]);

  // Reset the board whenever the puzzle changes.
  useEffect(() => {
    clearTimers();
    c.engine.cancelGroup('puzzle');
    if (!puzzle) return;
    game.current = new Chess(puzzle.fen);
    setFen(puzzle.fen);
    setStep(0);
    setStatus('solving');
    setHint(null);
    setChecking(false);
    setLastMove(puzzle.lastMove ?? null);
    failed.current = false;
  }, [puzzle, c]);

  const sfx = (san: string, captured: boolean, delay = 0) => {
    if (sound?.enabled) playSound(soundForMove(san, captured), sound.volume, delay);
  };

  const finish = (ok: boolean) => {
    setStatus(ok ? 'solved' : 'shown');
    setStats((s) => {
      const first = !s.done.includes(puzzle!.id);
      const solvedClean = ok && !failed.current;
      const streak = solvedClean ? s.streak + 1 : 0;
      return {
        solved: s.solved + (first && solvedClean ? 1 : 0),
        attempted: s.attempted + (first ? 1 : 0),
        streak,
        best: Math.max(s.best, streak),
        done: first ? [...s.done, puzzle!.id] : s.done,
      };
    });
  };

  const playReply = (nextStep: number) => {
    if (!puzzle) return;
    if (nextStep >= puzzle.solution.length) {
      finish(true);
      return;
    }
    const u = puzzle.solution[nextStep];
    timers.current.push(
      setTimeout(() => {
        const m = game.current.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
        if (!m) return;
        sfx(m.san, !!m.captured, 0.1);
        setFen(game.current.fen());
        setLastMove({ from: m.from, to: m.to });
        setStep(nextStep + 1);
        if (nextStep + 1 >= puzzle.solution.length) finish(true);
      }, 420),
    );
  };

  const onMove = (mv: MoveInput, meta?: { dragged: boolean }) => {
    if (!puzzle || (status !== 'solving' && status !== 'wrong') || checking) return false;
    const expected = puzzle.solution[step];
    const trial = new Chess(game.current.fen());
    let m;
    try {
      m = trial.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    } catch {
      return false;
    }
    if (!m) return false;
    const accept = () => {
      game.current.move(m.san);
      sfx(m.san, !!m.captured, meta?.dragged ? 0 : 0.1);
      setFen(game.current.fen());
      setLastMove({ from: m.from, to: m.to });
      setHint(null);
      setStatus('solving');
      setStep(step + 1);
      if (trial.isCheckmate()) finish(true);
      else playReply(step + 1);
    };
    const reject = () => {
      failed.current = true;
      // Shake the board in place (no remount → no flicker).
      boardRef.current?.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-7px)' },
          { transform: 'translateX(6px)' },
          { transform: 'translateX(-4px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 340, easing: 'ease-out' },
      );
      setStatus('wrong');
      setStats((s) => ({ ...s, streak: 0 }));
    };
    if (uciOf(m) === expected || trial.isCheckmate()) {
      accept();
      return true;
    }
    if (puzzle.engineCheck && step === 0) {
      // Your-own-game puzzles: any move that keeps (almost) the same evaluation as the engine's best counts.
      setChecking(true);
      const before = game.current.fen();
      void Promise.all([
        c.engine.analyze({ fen: before, limit: { kind: 'depth', depth: 14, maxTimeMs: 2500 }, multipv: 1 }, { priority: 0, group: 'puzzle' }).promise,
        c.engine.analyze({ fen: trial.fen(), limit: { kind: 'depth', depth: 13, maxTimeMs: 2500 }, multipv: 1 }, { priority: 0, group: 'puzzle' }).promise,
      ])
        .then(([a, b]) => {
          const me = trial.turn() === 'w' ? 'b' : 'w';
          const epBest = me === 'w' ? analysisExpectedWhite(a) : 1 - analysisExpectedWhite(a);
          const epPlayed = me === 'w' ? analysisExpectedWhite(b) : 1 - analysisExpectedWhite(b);
          if (epBest - epPlayed <= 0.03) accept();
          else reject();
        })
        .catch(reject)
        .finally(() => setChecking(false));
      return false;
    }
    reject();
    return false;
  };

  const showHint = () => {
    if (!puzzle || status === 'solved' || status === 'shown') return;
    failed.current = true;
    const u = puzzle.solution[step];
    setHint({ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'solution' });
  };

  const showSolution = () => {
    if (!puzzle || status === 'solved' || status === 'shown') return;
    failed.current = true;
    clearTimers();
    setHint(null);
    let delay = 0;
    for (let i = step; i < puzzle.solution.length; i++) {
      const u = puzzle.solution[i];
      timers.current.push(
        setTimeout(() => {
          const m = game.current.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
          if (!m) return;
          sfx(m.san, !!m.captured, 0.1);
          setFen(game.current.fen());
          setLastMove({ from: m.from, to: m.to });
          setStep(i + 1);
        }, delay),
      );
      delay += 650;
    }
    timers.current.push(setTimeout(() => finish(false), delay));
  };

  const next = () => {
    if (source === 'theme') setNonce((n) => n + 1);
    else if (index + 1 < list.length) setIndex(index + 1);
    else setIndex(0);
  };

  const toMove = new Chess(puzzle?.fen ?? undefined).turn();
  const orientation = toMove;
  const progress = puzzle ? Math.ceil(step / 2) : 0;
  const total = puzzle ? Math.ceil(puzzle.solution.length / 2) : 0;
  const rate = stats.attempted ? Math.round((stats.solved / stats.attempted) * 100) : 0;

  return (
    <main className="page puzzles-page" id="main">
      <PageHead icon="puzzle" title="Puzzles" subtitle="Lichess puzzles by theme, the daily puzzle, legendary finishes and your own mistakes." />
      <div className="page-grid">
        <section className="page-board-col" aria-label="Puzzle board">
          <div className="pb-player top">
            <span className={`side-chip ${toMove}`} />
            <b>{puzzle ? `${toMove === 'w' ? 'White' : 'Black'} to move` : 'Puzzles'}</b>
            {puzzle?.rating && <span className="pb-tag">{puzzle.rating}</span>}
            <span className="pb-stats" title={`Best streak ${stats.best} · ${rate}% solved first try`}>
              <Icon name="fire" size={14} /> {stats.streak}
              <span className="muted">·</span> {stats.solved} solved
            </span>
          </div>
          <div className="page-board" ref={boardRef}>
            {puzzle ? (
              <ChessBoard
                fen={fen}
                orientation={orientation}
                lastMove={lastMove}
                arrows={hint ? [hint] : []}
                interactive={(status === 'solving' || status === 'wrong') && !checking && game.current.turn() === toMove}
                onMove={onMove}
                {...prefs}
              />
            ) : (
              <div className="board-placeholder">{loading ? 'Loading puzzle…' : (error ?? 'No puzzle.')}</div>
            )}
            {(status === 'solved' || status === 'shown') && (
              <div className={`board-result ${status === 'solved' ? 'win' : 'draw'}`} role="status">
                <b>{status === 'solved' ? (failed.current ? 'Solved with help' : 'Solved!') : 'Solution shown'}</b>
                <span>{status === 'solved' && !failed.current ? `Streak ${stats.streak}` : 'Try the next one.'}</span>
                <div className="row">
                  <button type="button" className="btn primary small" onClick={next}>
                    Next puzzle <Icon name="next" size={14} />
                  </button>
                  <button type="button" className="btn small" onClick={() => c.openText(puzzle!.fen, 'fen')}>
                    <Icon name="chart" size={14} /> Analyze
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className={`puzzle-feedback ${status}`} aria-live="polite">
            {checking
              ? 'Checking your move with Stockfish…'
              : status === 'wrong'
                ? 'Not the best move — try again.'
                : status === 'solving'
                  ? step === 0
                    ? `Find the best move for ${toMove === 'w' ? 'White' : 'Black'}.`
                    : 'Correct — keep going.'
                  : status === 'solved'
                    ? 'Puzzle complete.'
                    : 'Here is the solution.'}
            {puzzle && total > 1 && (
              <span className="pz-steps" aria-label={`Move ${progress} of ${total}`}>
                {Array.from({ length: total }, (_, i) => (
                  <i key={i} className={i < progress ? 'done' : ''} />
                ))}
              </span>
            )}
          </div>
        </section>

        <aside className="page-side" aria-label="Puzzle options">
          <div className="card side-card">
            <div className="source-tabs" role="tablist">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={source === s.id}
                  className={source === s.id ? 'active' : ''}
                  onClick={() => setSource(s.id)}
                >
                  <Icon name={s.icon} size={15} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
            {source === 'theme' && (
              <>
                <div className="diff-pick" role="radiogroup" aria-label="Difficulty">
                  {DIFFICULTIES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={difficulty === d}
                      className={difficulty === d ? 'active' : ''}
                      onClick={() => setPrefs((p) => ({ ...p, difficulty: d }))}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="pz-online" role="radiogroup" aria-label="Puzzle source">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={online}
                    className={online ? 'active' : ''}
                    onClick={() => setPrefs((p) => ({ ...p, online: true }))}
                  >
                    <b>Lichess live</b>
                    <small>Millions of puzzles</small>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!online}
                    className={!online ? 'active' : ''}
                    onClick={() => setPrefs((p) => ({ ...p, online: false }))}
                  >
                    <b>Offline pack</b>
                    <small>{pack ? `${pack.rows.length.toLocaleString()} puzzles` : 'Loading…'}</small>
                  </button>
                </div>
              </>
            )}
            {puzzle && (
              <div className="pz-info">
                <b>{puzzle.title}</b>
                <span className="muted small">{puzzle.subtitle}</span>
                {!!puzzle.themes?.length && (
                  <div className="pz-themes">
                    {puzzle.themes.slice(0, 6).map((t) =>
                      pack?.themes.has(t) && source === 'theme' ? (
                        <button
                          key={t}
                          type="button"
                          className={t === theme ? 'on' : ''}
                          onClick={() => setPrefs((p) => ({ ...p, theme: t }))}
                          title={`More ${pack.themes.get(t)!.name} puzzles`}
                        >
                          {pack.themes.get(t)!.name}
                        </button>
                      ) : (
                        <span key={t}>{pack?.themes.get(t)?.name ?? themeWords(t)}</span>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
            {error && puzzle && <p className="muted small">{error}</p>}
            <div className="tool-row">
              <button type="button" className="tool-btn" onClick={showHint} disabled={!puzzle || status === 'solved' || status === 'shown'}>
                <Icon name="bulb" size={16} />
                <span>Hint</span>
              </button>
              <button type="button" className="tool-btn" onClick={showSolution} disabled={!puzzle || status === 'solved' || status === 'shown'}>
                <Icon name="check" size={16} />
                <span>Solution</span>
              </button>
              <button type="button" className="tool-btn" onClick={next} disabled={loading || (source === 'daily' && list.length < 2)}>
                <Icon name="next" size={16} />
                <span>{source === 'theme' ? 'New' : 'Next'}</span>
              </button>
            </div>
            {list.length > 1 && (
              <div className="pz-list">
                {list.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`${i === index ? 'active' : ''} ${stats.done.includes(p.id) ? 'done' : ''}`}
                    onClick={() => setIndex(i)}
                    title={p.subtitle}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>

          {source === 'theme' && <ThemePicker pack={pack} theme={theme} onPick={(t) => setPrefs((p) => ({ ...p, theme: t }))} />}

          <div className="card side-card stats-card">
            <div className="stat">
              <b>{stats.streak}</b>
              <span>Streak</span>
            </div>
            <div className="stat">
              <b>{stats.best}</b>
              <span>Best</span>
            </div>
            <div className="stat">
              <b>{stats.solved}</b>
              <span>Solved</span>
            </div>
            <div className="stat">
              <b>{rate}%</b>
              <span>First try</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ThemePicker({ pack, theme, onPick }: { pack: PuzzlePack | null; theme: string; onPick: (t: string) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      (pack?.groups ?? [])
        .map((g) => ({ ...g, themes: g.themes.filter((t) => !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)) }))
        .filter((g) => g.themes.length),
    [pack, q],
  );
  const cur = pack?.themes.get(theme);
  return (
    <div className="card side-card theme-card">
      <div className="row between">
        <div className="side-label">Themes{pack ? ` · ${pack.themes.size}` : ''}</div>
        {theme !== 'mix' && (
          <button type="button" className="link-btn" onClick={() => onPick('mix')}>
            Mix all
          </button>
        )}
      </div>
      <div className="theme-current">
        <b>{theme === 'mix' ? 'Healthy mix' : (cur?.name ?? themeWords(theme))}</b>
        <span>{theme === 'mix' ? 'A bit of everything — puzzles from every theme.' : (cur?.desc ?? '')}</span>
      </div>
      <label className="search-field">
        <Icon name="search" size={16} />
        <input type="search" value={query} placeholder="Fork, mate in 2, rook endgame…" onChange={(e) => setQuery(e.target.value)} aria-label="Search themes" />
      </label>
      <div className="theme-groups">
        {!pack && <p className="muted small">Loading themes…</p>}
        {groups.map((g) => (
          <section key={g.name}>
            <h3>{g.name}</h3>
            <div className="theme-chips">
              {g.themes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={t.key === theme ? 'active' : ''}
                  onClick={() => onPick(t.key)}
                  title={t.desc}
                  aria-pressed={t.key === theme}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </section>
        ))}
        {pack && !groups.length && <p className="muted small">No theme matches.</p>}
      </div>
    </div>
  );
}
