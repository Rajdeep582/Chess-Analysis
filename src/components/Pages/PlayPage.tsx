import { Chess, type Move } from 'chess.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playSound, soundForMove } from '../../audio/sounds';
import type { MoveInput } from '../../chess/types';
import { START_FEN } from '../../chess/types';
import { formatScore } from '../../engine/evalUtils';
import type { EngineAnalysis } from '../../engine/types';
import { useApp, useController } from '../../state/context';
import { ChessBoard } from '../ChessBoard/ChessBoard';
import type { BoardArrow } from '../ChessBoard/Arrows';
import { Icon } from '../common/Icon';
import { MiniMoves, PageHead, useBoardPrefs } from './common';

/**
 * Stockfish strength levels. Strength is limited on our side (search depth + choosing among the
 * engine's top lines with a level-dependent chance), so engine options stay untouched for analysis.
 */
const LEVELS = [
  { depth: 1, multipv: 4, weights: [0.25, 0.25, 0.25, 0.25], elo: '~600' },
  { depth: 2, multipv: 4, weights: [0.4, 0.25, 0.2, 0.15], elo: '~900' },
  { depth: 4, multipv: 3, weights: [0.5, 0.3, 0.2], elo: '~1200' },
  { depth: 6, multipv: 3, weights: [0.65, 0.25, 0.1], elo: '~1500' },
  { depth: 8, multipv: 2, weights: [0.8, 0.2], elo: '~1800' },
  { depth: 11, multipv: 2, weights: [0.9, 0.1], elo: '~2100' },
  { depth: 14, multipv: 2, weights: [0.97, 0.03], elo: '~2400' },
  { depth: 18, multipv: 1, weights: [1], elo: '2800+' },
];

type ColorChoice = 'w' | 'b' | 'random';
const PREFS_KEY = 'nocturne64.play';

function loadPrefs(): { level: number; color: ColorChoice } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { level: Math.min(8, Math.max(1, Number(p.level) || 3)), color: p.color === 'b' || p.color === 'random' ? p.color : 'w' };
  } catch {
    return { level: 3, color: 'w' };
  }
}

function pick(a: EngineAnalysis, weights: number[]): string | null {
  const lines = a.lines.filter((l) => l.pv[0]);
  if (!lines.length) return a.bestMove;
  const w = weights.slice(0, lines.length);
  const total = w.reduce((s, x) => s + x, 0);
  let r = Math.random() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return lines[i].pv[0];
  }
  return lines[0].pv[0];
}

function resultText(c: Chess, player: 'w' | 'b'): { title: string; detail: string; tone: 'win' | 'loss' | 'draw' } | null {
  if (c.isCheckmate()) {
    const loser = c.turn();
    return loser === player
      ? { title: 'Checkmate — Stockfish wins', detail: 'Review the game to see where it turned.', tone: 'loss' }
      : { title: 'Checkmate — you win!', detail: 'Nicely done.', tone: 'win' };
  }
  if (c.isStalemate()) return { title: 'Draw by stalemate', detail: 'No legal moves, but no check.', tone: 'draw' };
  if (c.isThreefoldRepetition()) return { title: 'Draw by repetition', detail: 'The same position appeared three times.', tone: 'draw' };
  if (c.isInsufficientMaterial()) return { title: 'Draw — insufficient material', detail: 'Neither side can mate.', tone: 'draw' };
  if (c.isDraw()) return { title: 'Draw (50-move rule)', detail: '50 moves without a capture or pawn move.', tone: 'draw' };
  return null;
}

export default function PlayPage() {
  const c = useController();
  const prefs = useBoardPrefs();
  const playFen = useApp((s) => s.playFen);
  const engineError = useApp((s) => s.engine.status === 'error');
  const sound = useApp((s) => s.settings.sound);
  const [{ level, color }, setPrefs] = useState(loadPrefs);
  const startFen = useRef(playFen ?? START_FEN);
  const game = useRef(new Chess(startFen.current));
  const editorFen = playFen && playFen !== START_FEN ? playFen : null;
  // From the editor you play the side to move; otherwise your chosen colour.
  const [player, setPlayer] = useState<'w' | 'b'>(() =>
    editorFen ? (editorFen.split(' ')[1] === 'b' ? 'b' : 'w') : color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : color,
  );
  const [fen, setFen] = useState(game.current.fen());
  const [history, setHistory] = useState<Move[]>([]);
  const [thinking, setThinking] = useState(false);
  const [resigned, setResigned] = useState(false);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [evalText, setEvalText] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<'w' | 'b'>(player);
  const token = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ level, color }));
    } catch {
      /* storage unavailable */
    }
  }, [level, color]);

  useEffect(() => {
    void c.engine.start().catch(() => undefined);
    return () => c.engine.cancelGroup('play');
  }, [c]);

  const sync = useCallback(() => {
    setFen(game.current.fen());
    setHistory(game.current.history({ verbose: true }));
  }, []);

  const over = useMemo(() => (resigned ? { title: 'You resigned', detail: 'Stockfish wins this one.', tone: 'loss' as const } : resultText(new Chess(fen), player)), [fen, resigned, player]);
  const turn = fen.split(' ')[1] as 'w' | 'b';

  const sfx = useCallback(
    (m: Move) => {
      if (sound?.enabled) playSound(soundForMove(m.san, !!m.captured), sound.volume, 0.1);
    },
    [sound],
  );

  // Engine reply whenever it is Stockfish's turn.
  useEffect(() => {
    if (over || turn === player || engineError) return;
    const my = ++token.current;
    setThinking(true);
    const cfg = LEVELS[level - 1];
    const started = performance.now();
    const job = c.engine.analyze({ fen, limit: { kind: 'depth', depth: cfg.depth, maxTimeMs: 2500 }, multipv: cfg.multipv }, { priority: 0, group: 'play', useCache: level < 8 ? false : undefined });
    void job.promise
      .then(async (a) => {
        // A short natural pause so instant replies don't feel robotic.
        const wait = Math.max(0, 450 - (performance.now() - started));
        if (wait) await new Promise((r) => setTimeout(r, wait));
        if (my !== token.current) return;
        const uci = pick(a, cfg.weights);
        if (!uci) return;
        const m = game.current.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        if (m) {
          sfx(m);
          sync();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (my === token.current) setThinking(false);
      });
    return () => {
      token.current++;
      job.cancel();
    };
  }, [fen, turn, player, over, level, c, engineError, sync, sfx]);

  const onMove = (mv: MoveInput, meta?: { dragged: boolean }) => {
    if (over || turn !== player || thinking) return false;
    try {
      const m = game.current.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      if (!m) return false;
      if (sound?.enabled) playSound(soundForMove(m.san, !!m.captured), sound.volume, meta?.dragged ? 0 : 0.1);
      setHint(null);
      setEvalText(null);
      sync();
      return true;
    } catch {
      return false;
    }
  };

  const newGame = (nextColor: ColorChoice = color, fromFen = START_FEN) => {
    token.current++;
    c.engine.cancelGroup('play');
    const p = nextColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : nextColor;
    startFen.current = fromFen;
    game.current = new Chess(fromFen);
    setPlayer(p);
    setOrientation(p);
    setResigned(false);
    setHint(null);
    setEvalText(null);
    setThinking(false);
    sync();
  };

  const takeBack = () => {
    token.current++;
    c.engine.cancelGroup('play');
    setThinking(false);
    // Undo the engine reply and your move, so it is your turn again.
    game.current.undo();
    if (game.current.turn() !== player) game.current.undo();
    setResigned(false);
    setHint(null);
    setEvalText(null);
    sync();
  };

  const askHint = () => {
    if (over || turn !== player) return;
    void c.engine
      .analyze({ fen, limit: { kind: 'depth', depth: 14, maxTimeMs: 2000 }, multipv: 1 }, { priority: 0, group: 'play' })
      .promise.then((a) => {
        const u = a.bestMove ?? a.lines[0]?.pv[0];
        if (u) setHint({ from: u.slice(0, 2), to: u.slice(2, 4), kind: 'solution' });
        setEvalText(formatScore({ cp: a.evaluation, mate: a.mate }));
      })
      .catch(() => undefined);
  };

  const pgn = () => {
    const g = new Chess(startFen.current);
    g.header('Event', 'Nocturne64 vs Stockfish', 'White', player === 'w' ? 'You' : `Stockfish L${level}`, 'Black', player === 'b' ? 'You' : `Stockfish L${level}`);
    if (startFen.current !== START_FEN) {
      g.header('SetUp', '1', 'FEN', startFen.current);
    }
    for (const m of history) g.move(m.san);
    const res = over ? (over.tone === 'draw' ? '1/2-1/2' : (over.tone === 'win') === (player === 'w') ? '1-0' : '0-1') : '*';
    g.header('Result', res);
    return g.pgn();
  };

  const last = history[history.length - 1];
  const sans = history.map((m) => m.san);
  const cfg = LEVELS[level - 1];
  const startColor = startFen.current.split(' ')[1] === 'b' ? 'b' : 'w';
  const startNumber = Number(startFen.current.split(' ')[5]) || 1;

  return (
    <main className="page play-page" id="main">
      <PageHead icon="swords" title="Play vs Stockfish" subtitle="Eight strength levels, from beginner to engine-perfect. Runs on your device." />
      <div className="page-grid">
        <section className="page-board-col" aria-label="Board">
          <div className="pb-player top">
            <span className={`side-chip ${player === 'w' ? 'b' : 'w'}`} />
            <b>Stockfish</b>
            <span className="pb-tag">Level {level}</span>
            {thinking && (
              <span className="pb-thinking" aria-live="polite">
                <i />
                <i />
                <i /> thinking
              </span>
            )}
          </div>
          <div className="page-board">
            <ChessBoard
              fen={fen}
              orientation={orientation}
              lastMove={last ? { from: last.from, to: last.to } : null}
              arrows={hint ? [hint] : []}
              interactive={!over && turn === player && !thinking}
              onMove={onMove}
              {...prefs}
            />
            {over && (
              <div className={`board-result ${over.tone}`} role="status">
                <b>{over.title}</b>
                <span>{over.detail}</span>
                <div className="row">
                  <button type="button" className="btn primary small" onClick={() => newGame()}>
                    <Icon name="plus" size={14} /> New game
                  </button>
                  <button type="button" className="btn small" onClick={() => c.openText(pgn(), 'pgn')}>
                    <Icon name="star" size={14} /> Review
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="pb-player bottom">
            <span className={`side-chip ${player}`} />
            <b>You</b>
            {turn === player && !over && <span className="pb-tag accent">Your move</span>}
          </div>
        </section>

        <aside className="page-side" aria-label="Game controls">
          <div className="card side-card">
            <div className="side-label">Strength</div>
            <div className="level-pick" role="radiogroup" aria-label="Stockfish level">
              {LEVELS.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={level === i + 1}
                  className={level === i + 1 ? 'active' : ''}
                  onClick={() => setPrefs((p) => ({ ...p, level: i + 1 }))}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div className="level-meta">
              <span>
                Level {level} · <b>{cfg.elo}</b>
              </span>
              <span className="muted">depth {cfg.depth}</span>
            </div>
            <div className="side-label">Play as</div>
            <div className="color-pick" role="radiogroup" aria-label="Your color">
              {(['w', 'random', 'b'] as ColorChoice[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={color === k}
                  className={color === k ? 'active' : ''}
                  onClick={() => setPrefs((p) => ({ ...p, color: k }))}
                  title={k === 'w' ? 'White' : k === 'b' ? 'Black' : 'Random'}
                >
                  {k === 'random' ? <Icon name="shuffle" size={16} /> : <span className={`king-chip ${k}`} />}
                  <span>{k === 'w' ? 'White' : k === 'b' ? 'Black' : 'Random'}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn primary block" onClick={() => newGame()}>
              <Icon name="plus" size={16} /> New game
            </button>
            {editorFen && (
              <button type="button" className="btn ghost small block" onClick={() => newGame(editorFen.split(' ')[1] === 'b' ? 'b' : 'w', editorFen)}>
                Restart from the editor position
              </button>
            )}
          </div>

          <div className="card side-card">
            <div className="tool-row">
              <button type="button" className="tool-btn" onClick={takeBack} disabled={!history.length || thinking}>
                <Icon name="undo" size={16} />
                <span>Take back</span>
              </button>
              <button type="button" className="tool-btn" onClick={askHint} disabled={!!over || turn !== player}>
                <Icon name="bulb" size={16} />
                <span>Hint</span>
              </button>
              <button type="button" className="tool-btn" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))}>
                <Icon name="flip" size={16} />
                <span>Flip</span>
              </button>
              <button type="button" className="tool-btn danger" onClick={() => setResigned(true)} disabled={!!over || !history.length}>
                <Icon name="flag" size={16} />
                <span>Resign</span>
              </button>
            </div>
            {evalText && (
              <p className="hint-line">
                <Icon name="bulb" size={14} /> Best move shown on the board · eval <b>{evalText}</b>
              </p>
            )}
            <MiniMoves sans={sans} current={sans.length - 1} startColor={startColor} startNumber={startNumber} />
            <button type="button" className="btn small block" onClick={() => c.openText(pgn(), 'pgn')} disabled={!history.length}>
              <Icon name="chart" size={14} /> Analyze this game
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
