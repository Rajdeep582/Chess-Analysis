import { Chess } from 'chess.js';
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { playSound, soundForMove } from '../../audio/sounds';
import { validateFen } from '../../chess/fen';
import { START_FEN, type Color, type MoveInput, type PieceSymbol } from '../../chess/types';
import { evalBarFraction, formatAnalysisEval, formatNodes, formatScore } from '../../engine/evalUtils';
import type { EngineAnalysis } from '../../engine/types';
import { useApp, useController } from '../../state/context';
import { engineModeOf } from '../../state/settings';
import type { BoardArrow } from '../ChessBoard/Arrows';
import { ChessBoard } from '../ChessBoard/ChessBoard';
import { PieceSvg } from '../ChessBoard/pieces';
import { Icon } from '../common/Icon';
import { MiniMoves, PageHead, useBoardPrefs } from './common';

type Code = `${Color}${PieceSymbol}`;
type Tool = Code | 'erase' | 'hand';
type Placement = Record<string, Code>;

const FILES = 'abcdefgh';
const SESSION_KEY = 'nocturne64.editor';
const ORDER: PieceSymbol[] = ['k', 'q', 'r', 'b', 'n', 'p'];
const NAMES: Record<PieceSymbol, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

function parsePlacement(fen: string): Placement {
  const out: Placement = {};
  fen
    .split(' ')[0]
    .split('/')
    .forEach((row, ri) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else {
          out[`${FILES[f]}${8 - ri}`] = `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toLowerCase()}` as Code;
          f++;
        }
      }
    });
  return out;
}

function placementFen(p: Placement): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (const f of FILES) {
      const code = p[`${f}${r}`];
      if (!code) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += code[0] === 'w' ? code[1].toUpperCase() : code[1];
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export default function EditorPage() {
  const c = useController();
  const board = useApp((s) => s.settings.board);
  // The position survives Analyze → Back (kept for this browser tab only).
  const [saved0] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') as { placement: Placement; turn: Color; castle: Castling } | null;
    } catch {
      return null;
    }
  });
  const [placement, setPlacement] = useState<Placement>(() => saved0?.placement ?? parsePlacement(START_FEN));
  const [turn, setTurn] = useState<Color>(saved0?.turn ?? 'w');
  const [castle, setCastle] = useState<Castling>(saved0?.castle ?? { K: true, Q: true, k: true, q: true });
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ placement, turn, castle }));
    } catch {
      /* storage unavailable */
    }
  }, [placement, turn, castle]);
  const [tool, setTool] = useState<Tool>('hand');
  const [orientation, setOrientation] = useState<Color>('w');
  const [drag, setDrag] = useState<{ from: string; code: Code; x: number; y: number } | null>(null);
  const [fenInput, setFenInput] = useState<string | null>(null);

  // Castling is only possible with king and rook on their home squares.
  const castleAllowed: Castling = {
    K: placement.e1 === 'wk' && placement.h1 === 'wr',
    Q: placement.e1 === 'wk' && placement.a1 === 'wr',
    k: placement.e8 === 'bk' && placement.h8 === 'br',
    q: placement.e8 === 'bk' && placement.a8 === 'br',
  };
  const castleStr = (['K', 'Q', 'k', 'q'] as const).filter((k) => castle[k] && castleAllowed[k]).join('') || '-';
  const fen = `${placementFen(placement)} ${turn} ${castleStr} - 0 1`;
  const check = useMemo(() => validateFen(fen), [fen]);
  // ---- analysis session: Stockfish runs right here. Moves are legal, recorded for ←/→ (not saved).
  const prefs = useBoardPrefs();
  const sound = useApp((s) => s.settings.sound);
  const engineMode = useApp((s) => engineModeOf(s.settings));
  const [session, setSession] = useState<{ base: string; moves: string[]; cursor: number } | null>(null);
  const analyzing = !!session;
  const [multipv, setMultipv] = useState(3);
  const [depthCap, setDepthCap] = useState<number | null>(null); // null = infinite
  const [result, setResult] = useState<EngineAnalysis | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);
  const goodFen = check.ok ? (check.fen ?? fen) : null;

  const pos = useMemo(() => {
    if (!session) return null;
    const g = new Chess(session.base);
    let last: { from: string; to: string } | null = null;
    for (const san of session.moves.slice(0, session.cursor)) {
      const m = g.move(san);
      last = { from: m.from, to: m.to };
    }
    return { fen: g.fen(), last, turn: g.turn() as Color, over: g.isGameOver(), mate: g.isCheckmate() };
  }, [session]);
  const targetFen = pos?.fen ?? null;

  useEffect(() => {
    setResult(null);
    if (!targetFen) return;
    setEngineErr(null);
    let job: { cancel(): void; promise: Promise<EngineAnalysis> } | null = null;
    let live = true;
    const t = setTimeout(() => {
      void c.engine
        .start()
        .then(() => {
          if (!live) return;
          job = c.engine.analyze(
            { fen: targetFen, multipv, limit: depthCap ? { kind: 'depth', depth: depthCap } : { kind: 'infinite' } },
            { priority: 0, group: 'editor', useCache: !!depthCap, onUpdate: (a) => live && setResult(a) },
          );
          job.promise.then((a) => live && setResult(a)).catch(() => undefined);
        })
        .catch((e: unknown) => live && setEngineErr(e instanceof Error ? e.message : 'Engine failed to start'));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
      job?.cancel();
    };
  }, [targetFen, multipv, depthCap, engineMode, c]);
  useEffect(() => () => c.engine.cancelGroup('editor'), [c]);

  const shown = result && targetFen && result.fen === targetFen ? result : null;
  const lines = useMemo(() => {
    if (!shown || !targetFen) return [];
    const parts = targetFen.split(' ');
    const startNo = Number(parts[5] || 1);
    const black = parts[1] === 'b';
    return [...shown.lines]
      .sort((a, b) => a.multipv - b.multipv)
      .slice(0, multipv)
      .map((l) => {
        const g = new Chess(targetFen);
        const sans: string[] = [];
        for (const u of l.pv.slice(0, 12)) {
          try {
            sans.push(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
          } catch {
            break;
          }
        }
        const text = sans
          .map((san, i) => {
            const ply = i + (black ? 1 : 0);
            const no = startNo + Math.floor(ply / 2);
            return ply % 2 === 0 ? `${no}. ${san}` : i === 0 ? `${no}… ${san}` : san;
          })
          .join(' ');
        return { score: formatScore(l.score), white: (l.score.mate ?? l.score.cp ?? 0) >= 0, text, first: l.pv[0] as string | undefined };
      });
  }, [shown, targetFen, multipv]);
  const engineArrows: BoardArrow[] = lines
    .filter((l) => l.first)
    .map((l, i) => ({ from: l.first!.slice(0, 2), to: l.first!.slice(2, 4), kind: i === 0 ? 'best' : 'alt', rank: i }));

  const sfx = (san: string, captured: boolean, dragged = false) => {
    if (sound?.enabled) playSound(soundForMove(san, captured), sound.volume, dragged ? 0 : 0.1);
  };

  const startAnalysis = () => {
    if (!goodFen) return;
    setSession({ base: goodFen, moves: [], cursor: 0 });
    // Phones: the button sits below the board — bring the board back into view.
    requestAnimationFrame(() => {
      const el = document.querySelector('.ed-main');
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };
  /** Back to editing — with the position currently on the board. */
  const stopAnalysis = () => {
    if (pos) {
      const f = pos.fen.split(' ');
      setPlacement(parsePlacement(f[0]));
      setTurn(f[1] as Color);
      setCastle({ K: f[2].includes('K'), Q: f[2].includes('Q'), k: f[2].includes('k'), q: f[2].includes('q') });
    }
    setSession(null);
    setResult(null);
    c.engine.cancelGroup('editor');
  };
  /** Plays a legal move; a new move after going back replaces the moves that followed. */
  const play = (mv: MoveInput | string, dragged = false): boolean => {
    if (!session || !pos) return false;
    const g = new Chess(pos.fen);
    let m;
    try {
      m =
        typeof mv === 'string'
          ? g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] })
          : g.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
    } catch {
      return false;
    }
    if (!m) return false;
    sfx(m.san, !!m.captured, dragged);
    const san = m.san;
    setSession((s) => (s ? { ...s, moves: s.moves[s.cursor] === san ? s.moves : [...s.moves.slice(0, s.cursor), san], cursor: s.cursor + 1 } : s));
    return true;
  };
  const stepTo = (n: number) =>
    setSession((s) => {
      if (!s) return s;
      const cur = Math.max(0, Math.min(s.moves.length, n));
      if (cur === s.cursor + 1) {
        const g = new Chess(s.base);
        s.moves.slice(0, cur - 1).forEach((x) => g.move(x));
        const m = g.move(s.moves[cur - 1]);
        sfx(m.san, !!m.captured);
      }
      return { ...s, cursor: cur };
    });
  const stepRef = useRef(stepTo);
  stepRef.current = stepTo;
  const cursorRef = useRef(0);
  cursorRef.current = session?.cursor ?? 0;
  useEffect(() => {
    if (!analyzing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const cur = cursorRef.current;
      if (e.key === 'ArrowLeft') stepRef.current(cur - 1);
      else if (e.key === 'ArrowRight') stepRef.current(cur + 1);
      else if (e.key === 'Home') stepRef.current(0);
      else if (e.key === 'End') stepRef.current(9999);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [analyzing]);

  const counts = useMemo(() => {
    const n = { w: 0, b: 0 };
    for (const code of Object.values(placement)) n[code[0] as Color]++;
    return n;
  }, [placement]);

  const squares = useMemo(() => {
    const out: string[] = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 8; col++) {
        const f = orientation === 'w' ? col : 7 - col;
        const r = orientation === 'w' ? 8 - row : row + 1;
        out.push(`${FILES[f]}${r}`);
      }
    return out;
  }, [orientation]);

  const place = (sq: string, code: Code | null) =>
    setPlacement((p) => {
      const n = { ...p };
      if (code) {
        // Only one king per side: placing a king moves it.
        if (code[1] === 'k') for (const [s, v] of Object.entries(n)) if (v === code) delete n[s];
        n[sq] = code;
      } else delete n[sq];
      return n;
    });

  const sqFromPoint = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-sq]');
    return el?.dataset.sq ?? null;
  };

  const onDown = (sq: string, e: RPointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      place(sq, null);
      return;
    }
    if (tool === 'erase') return place(sq, null);
    if (tool !== 'hand') {
      // Tap the same piece again to remove it (quick toggling while setting up).
      if (placement[sq] === tool) return place(sq, null);
      return place(sq, tool);
    }
    const code = placement[sq];
    if (!code) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ from: sq, code, x: e.clientX, y: e.clientY });
  };
  const onMoveP = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag) setDrag({ ...drag, x: e.clientX, y: e.clientY });
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const to = sqFromPoint(e.clientX, e.clientY);
    setPlacement((p) => {
      const n = { ...p };
      delete n[drag.from];
      if (to) n[to] = drag.code; // dropped off the board = removed
      return n;
    });
    setDrag(null);
  };

  const applyFen = () => {
    if (fenInput === null) return;
    const v = validateFen(fenInput);
    const raw = (v.fen ?? fenInput).trim().split(/\s+/);
    if (raw[0]?.split('/').length !== 8) return;
    setPlacement(parsePlacement(raw[0]));
    setTurn(raw[1] === 'b' ? 'b' : 'w');
    const cs = raw[2] ?? '-';
    setCastle({ K: cs.includes('K'), Q: cs.includes('Q'), k: cs.includes('k'), q: cs.includes('q') });
    setFenInput(null);
  };

  const preset = (name: 'start' | 'empty' | 'kings') => {
    if (name === 'start') {
      setPlacement(parsePlacement(START_FEN));
      setCastle({ K: true, Q: true, k: true, q: true });
    } else setPlacement(name === 'empty' ? {} : { e1: 'wk', e8: 'bk' });
    setTurn('w');
  };

  /** Mirror the position top-to-bottom and swap colours (same position for the other side). */
  const mirror = () => {
    setPlacement((p) => {
      const n: Placement = {};
      for (const [sq, code] of Object.entries(p)) n[`${sq[0]}${9 - Number(sq[1])}`] = `${code[0] === 'w' ? 'b' : 'w'}${code[1]}` as Code;
      return n;
    });
    setTurn((t) => (t === 'w' ? 'b' : 'w'));
    setCastle((cs) => ({ K: cs.k, Q: cs.q, k: cs.K, q: cs.Q }));
  };

  const palette = (color: Color, pos: 'top' | 'bottom') => (
    <div className={`ed-palette ${pos}`} role="toolbar" aria-label={`${color === 'w' ? 'White' : 'Black'} pieces`}>
      {ORDER.map((t) => {
        const code = `${color}${t}` as Code;
        return (
          <button
            key={code}
            type="button"
            className={`ed-tool ${tool === code ? 'active' : ''}`}
            onClick={() => setTool(code)}
            aria-label={`${color === 'w' ? 'White' : 'Black'} ${NAMES[t]}`}
            title={`${color === 'w' ? 'White' : 'Black'} ${NAMES[t]}`}
          >
            <PieceSvg color={color} type={t} set={board.pieceSet} />
          </button>
        );
      })}
    </div>
  );

  return (
    <main className="page editor-page" id="main">
      <PageHead icon="grid" title="Board Editor" subtitle="Set up any position, then analyze it with Stockfish or play it out against the engine." />
      <div className="page-grid">
        <section className="page-board-col ed-stage" aria-label="Editor board">
          {!analyzing && palette(orientation === 'w' ? 'b' : 'w', 'top')}
          {analyzing && pos ? (
            <div className="page-board ed-main">
              <ChessBoard
                fen={pos.fen}
                orientation={orientation}
                lastMove={pos.last}
                arrows={engineArrows}
                interactive={!pos.over}
                onMove={(m, meta) => play(m, meta?.dragged)}
                {...prefs}
              />
            </div>
          ) : (
            <div className="page-board ed-main">
              <div
                className={`board theme-${board.theme} ed-board ${tool === 'hand' ? 'hand' : 'stamp'}`}
                onPointerMove={onMoveP}
                onPointerUp={onUp}
                onContextMenu={(e) => e.preventDefault()}
                role="grid"
                aria-label="Position editor"
              >
                {squares.map((sq, i) => {
                  const light = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0; // a1 is dark
                  const code = placement[sq];
                  const lifted = drag?.from === sq;
                  return (
                    <div
                      key={sq}
                      data-sq={sq}
                      className={`sq ${light ? 'light' : 'dark'}`}
                      onPointerDown={(e) => onDown(sq, e)}
                      role="gridcell"
                      aria-label={`${sq}${code ? ` ${code[0] === 'w' ? 'white' : 'black'} ${NAMES[code[1] as PieceSymbol]}` : ''}`}
                    >
                      {board.coordinates && i % 8 === 0 && <span className="coord rank">{sq[1]}</span>}
                      {board.coordinates && i >= 56 && <span className="coord file">{sq[0]}</span>}
                      {code && !lifted && (
                        <span className="ed-piece">
                          <PieceSvg color={code[0] as Color} type={code[1] as PieceSymbol} set={board.pieceSet} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {drag && (
                <span className="ed-drag" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
                  <PieceSvg color={drag.code[0] as Color} type={drag.code[1] as PieceSymbol} set={board.pieceSet} />
                </span>
              )}
            </div>
          )}
          {!analyzing && palette(orientation, 'bottom')}
          <div className="tool-row ed-tools">
            {analyzing ? (
              <button type="button" className="tool-btn active" onClick={stopAnalysis} title="Back to setting up pieces (keeps this position)">
                <Icon name="hand" size={16} />
                <span>Edit</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`tool-btn ${tool === 'hand' ? 'active' : ''}`}
                  onClick={() => setTool('hand')}
                  title="Move pieces (drag; drop off the board to remove)"
                >
                  <Icon name="hand" size={16} />
                  <span>Move</span>
                </button>
                <button type="button" className={`tool-btn ${tool === 'erase' ? 'active' : ''}`} onClick={() => setTool('erase')} title="Erase pieces">
                  <Icon name="eraser" size={16} />
                  <span>Erase</span>
                </button>
              </>
            )}
            <button type="button" className="tool-btn" onClick={() => setOrientation((o) => (o === 'w' ? 'b' : 'w'))} title="Flip board">
              <Icon name="flip" size={16} />
              <span>Flip</span>
            </button>
          </div>
          <p className="ed-hint" aria-live="polite">
            {analyzing
              ? 'Analysis: play moves on the board (legal moves only) · ← → to step · Edit to change pieces'
              : tool === 'hand'
                ? 'Drag pieces to move them · drop off the board to remove · right-click clears a square'
                : tool === 'erase'
                  ? 'Click squares to clear them'
                  : `Click squares to place a ${tool[0] === 'w' ? 'white' : 'black'} ${NAMES[tool[1] as PieceSymbol]} · click it again to remove`}
          </p>
        </section>

        <aside className="page-side ed-side" aria-label="Position settings">
          <div className="card side-card ed-card">
            {!analyzing ? (
              <>
                <div className="ed-row">
                  <span className="side-label">To move</span>
                  <div className="ed-seg" role="radiogroup" aria-label="Side to move">
                    {(['w', 'b'] as Color[]).map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={turn === k} className={turn === k ? 'active' : ''} onClick={() => setTurn(k)}>
                        <span className={`king-chip ${k}`} />
                        {k === 'w' ? 'White' : 'Black'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ed-row">
                  <span className="side-label">Castling</span>
                  <div className="ed-seg four">
                    {(
                      [
                        ['K', 'O-O', 'White O-O'],
                        ['Q', 'O-O-O', 'White O-O-O'],
                        ['k', 'O-O', 'Black O-O'],
                        ['q', 'O-O-O', 'Black O-O-O'],
                      ] as const
                    ).map(([k, label, full]) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={castle[k] && castleAllowed[k]}
                        className={castle[k] && castleAllowed[k] ? 'active' : ''}
                        disabled={!castleAllowed[k]}
                        onClick={() => setCastle({ ...castle, [k]: !castle[k] })}
                        title={castleAllowed[k] ? full : `${full} — king and rook must be on their home squares`}
                      >
                        <span className={`king-chip ${k === k.toUpperCase() ? 'w' : 'b'}`} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ed-row">
                  <span className="side-label">Presets</span>
                  <div className="ed-seg four">
                    <button type="button" onClick={() => preset('start')}>
                      Start
                    </button>
                    <button type="button" onClick={mirror} title="Swap colours (mirror the position)">
                      Swap
                    </button>
                    <button type="button" onClick={() => preset('kings')}>
                      Kings
                    </button>
                    <button type="button" onClick={() => preset('empty')}>
                      Clear
                    </button>
                  </div>
                </div>
                <div className="ed-divider" />
                <div className="fen-row">
                  <input
                    id="ed-fen"
                    className="fen-input"
                    aria-label="FEN"
                    value={fenInput ?? fen}
                    spellCheck={false}
                    onChange={(e) => setFenInput(e.target.value)}
                    onBlur={applyFen}
                    onKeyDown={(e) => e.key === 'Enter' && applyFen()}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title="Copy FEN"
                    aria-label="Copy FEN"
                    onClick={() => void navigator.clipboard?.writeText(fen).then(() => c.toast('success', 'FEN copied'))}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                </div>
                <div className={`fen-status ${check.ok ? 'ok' : 'bad'}`} role="status">
                  <Icon name={check.ok ? 'check' : 'info'} size={14} />
                  {check.ok ? `Legal position · ${counts.w} white / ${counts.b} black pieces` : check.error}
                </div>
                <div className="ed-actions">
                  <button type="button" className="btn primary" disabled={!check.ok} onClick={startAnalysis}>
                    <Icon name="chart" size={16} /> Analyze
                  </button>
                  <button type="button" className="btn" disabled={!check.ok} onClick={() => c.openPage('play', { fen: check.fen ?? fen })}>
                    <Icon name="swords" size={16} /> Play vs Stockfish
                  </button>
                </div>
              </>
            ) : (
              session &&
              pos && (
                <>
                  <div className="ed-engine" aria-live="polite">
                    <div className="ed-eng-head">
                      <span className={`ed-eval ${shown && evalBarFraction(shown) < 0.5 ? 'b' : 'w'}`}>{formatAnalysisEval(shown)}</span>
                      <span className="ed-evalbar" aria-hidden="true">
                        <i style={{ width: `${evalBarFraction(shown) * 100}%` }} />
                      </span>
                      <span className="ed-eng-meta">
                        {engineErr ? engineErr : shown ? (shown.terminal ? shown.terminal : `d${shown.depth} · ${formatNodes(shown.nodes)}`) : 'Thinking…'}
                      </span>
                    </div>
                    <div className="ed-turn">
                      <span className={`king-chip ${pos.turn}`} />
                      {pos.mate
                        ? 'Checkmate'
                        : pos.over
                          ? 'Game over'
                          : `${pos.turn === 'w' ? 'White' : 'Black'} to move — engine suggestions for ${pos.turn === 'w' ? 'White' : 'Black'}`}
                    </div>
                    <ul className="ed-lines">
                      {lines.map((l, i) => (
                        <li key={i}>
                          <button type="button" onClick={() => l.first && play(l.first)} title="Play this move on the board">
                            <span className={`ed-score ${l.white ? 'w' : 'b'}`}>{l.score}</span>
                            <span className="ed-pv">{l.text}</span>
                          </button>
                        </li>
                      ))}
                      {!lines.length &&
                        !pos.over &&
                        Array.from({ length: multipv }, (_, i) => (
                          <li key={i} className="ed-line-sk">
                            <span className="sk sk-line" />
                          </li>
                        ))}
                    </ul>
                    <div className="ed-eng-cfg">
                      <label>
                        Lines
                        <select value={multipv} onChange={(e) => setMultipv(Number(e.target.value))}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Depth
                        <select value={depthCap ?? 0} onChange={(e) => setDepthCap(Number(e.target.value) || null)}>
                          <option value={0}>∞</option>
                          {[16, 20, 24, 30].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="ed-mode" role="radiogroup" aria-label="Engine">
                        {(['lite', 'max'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            role="radio"
                            aria-checked={engineMode === m}
                            className={engineMode === m ? 'active' : ''}
                            onClick={() => c.setEngineMode(m)}
                          >
                            {m === 'lite' ? 'Lite' : 'Max'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="ed-moves">
                    <div className="row between">
                      <span className="side-label">Moves{session.moves.length ? ` · ${session.moves.length}` : ''}</span>
                      {!!session.moves.length && (
                        <button type="button" className="link-btn" onClick={() => setSession({ ...session, moves: [], cursor: 0 })}>
                          Clear
                        </button>
                      )}
                    </div>
                    {session.moves.length ? (
                      <MiniMoves
                        sans={session.moves}
                        current={session.cursor - 1}
                        onPick={(i) => stepTo(i + 1)}
                        startNumber={Number(session.base.split(' ')[5] || 1)}
                        startColor={session.base.split(' ')[1] === 'b' ? 'b' : 'w'}
                      />
                    ) : (
                      <p className="muted small">Play a move on the board or tap an engine line.</p>
                    )}
                  </div>
                  <div className="tool-row nav-row">
                    <button type="button" className="tool-btn" onClick={() => stepTo(0)} disabled={!session.cursor} title="Start (Home)">
                      <Icon name="first" size={16} />
                    </button>
                    <button type="button" className="tool-btn" onClick={() => stepTo(session.cursor - 1)} disabled={!session.cursor} title="Back (←)">
                      <Icon name="prev" size={16} />
                    </button>
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => stepTo(session.cursor + 1)}
                      disabled={session.cursor >= session.moves.length}
                      title="Forward (→)"
                    >
                      <Icon name="next" size={16} />
                    </button>
                    <button type="button" className="tool-btn" onClick={() => stepTo(9999)} disabled={session.cursor >= session.moves.length} title="End">
                      <Icon name="last" size={16} />
                    </button>
                  </div>
                  <div className="ed-actions">
                    <button type="button" className="btn" onClick={stopAnalysis} title="Back to setting up pieces (keeps this position)">
                      <Icon name="hand" size={16} /> Edit position
                    </button>
                    <button type="button" className="btn" onClick={() => c.openPage('play', { fen: pos.fen })}>
                      <Icon name="swords" size={16} /> Play from here
                    </button>
                  </div>
                </>
              )
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
