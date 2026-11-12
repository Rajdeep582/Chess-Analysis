import { Chess, type Square as CjSquare } from 'chess.js';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Color, MoveInput, PieceSymbol } from '../../chess/types';
import type { MoveClassification } from '../../review/types';
import type { BoardThemeId, PieceSetId } from '../../state/settings';
import { ClassificationIcon } from '../ClassificationBadge/ClassificationBadge';
import { ArrowLayer, type BoardArrow } from './Arrows';
import { PIECE_LABEL, PieceSvg } from './pieces';

interface PieceOnBoard {
  id: string;
  sq: string;
  color: Color;
  type: PieceSymbol;
}

export interface ChessBoardProps {
  fen: string;
  orientation: 'w' | 'b';
  lastMove?: { from: string; to: string } | null;
  arrows?: BoardArrow[];
  interactive?: boolean;
  /** `dragged`: the piece was dropped by hand (lands instantly, no slide). */
  onMove?: (m: MoveInput, meta?: { dragged: boolean }) => boolean;
  showCoordinates?: boolean;
  showLegalMoves?: boolean;
  showLastMove?: boolean;
  animate?: boolean;
  theme?: BoardThemeId;
  pieceSet?: PieceSetId;
  marker?: { square: string; classification: MoveClassification } | null;
  ariaLabel?: string;
}

const FILES = 'abcdefgh';

export function parsePieces(fen: string): { sq: string; color: Color; type: PieceSymbol }[] {
  const out: { sq: string; color: Color; type: PieceSymbol }[] = [];
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, ri) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        out.push({ sq: `${FILES[f]}${8 - ri}`, color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() as PieceSymbol });
        f++;
      }
    }
  });
  return out;
}

function sqXY(sq: string, orientation: 'w' | 'b'): [number, number] {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  return orientation === 'w' ? [f, 7 - r] : [7 - f, r];
}

function dist(a: string, b: string) {
  return Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]));
}

let pieceSeq = 1;
const idNum = (id: string) => Number(id.slice(1)) || 0;

/**
 * Keeps stable ids for pieces across positions so moves animate as real moves:
 *  1. pieces on squares whose occupant did not change keep their id;
 *  2. pieces that left a square are paired with same-colour/same-type pieces that appeared
 *     elsewhere (nearest first) — this handles captures (incl. pawn takes pawn), castling and
 *     stepping backwards; pawns may pair with a promoted piece on the last rank;
 *  3. anything left over is new (fades in) or gone (fades out).
 */
export function assignIds(prev: PieceOnBoard[], next: { sq: string; color: Color; type: PieceSymbol }[]): { pieces: PieceOnBoard[]; gone: PieceOnBoard[] } {
  const prevAt = new Map(prev.map((p) => [p.sq, p]));
  const out: (PieceOnBoard | null)[] = next.map(() => null);
  const used = new Set<string>();
  // 1. unchanged squares
  next.forEach((p, i) => {
    const q = prevAt.get(p.sq);
    if (q && q.color === p.color && q.type === p.type) {
      used.add(q.id);
      out[i] = { ...p, id: q.id };
    }
  });
  const sources = prev.filter((q) => !used.has(q.id));
  const pair = (allow: (q: PieceOnBoard, p: { sq: string; color: Color; type: PieceSymbol }) => boolean) => {
    // Greedy by global shortest distance for stable, natural pairings.
    const cand: { i: number; q: PieceOnBoard; d: number }[] = [];
    next.forEach((p, i) => {
      if (out[i]) return;
      for (const q of sources) if (!used.has(q.id) && allow(q, p)) cand.push({ i, q, d: dist(q.sq, p.sq) });
    });
    cand.sort((a, b) => a.d - b.d);
    for (const c of cand) {
      if (out[c.i] || used.has(c.q.id)) continue;
      used.add(c.q.id);
      out[c.i] = { ...next[c.i], id: c.q.id };
    }
  };
  // 2. moved pieces, then promotions (pawn → piece on the last rank) and un-promotions.
  pair((q, p) => q.color === p.color && q.type === p.type);
  pair((q, p) => q.color === p.color && ((q.type === 'p' && /[18]/.test(p.sq[1])) || (p.type === 'p' && /[18]/.test(q.sq[1]))));
  // 3. new pieces
  next.forEach((p, i) => {
    if (!out[i]) out[i] = { ...p, id: `p${pieceSeq++}` };
  });
  return { pieces: out as PieceOnBoard[], gone: prev.filter((q) => !used.has(q.id)) };
}

function ChessBoardImpl(props: ChessBoardProps) {
  const {
    fen,
    orientation,
    lastMove,
    arrows = [],
    interactive = true,
    onMove,
    showCoordinates = true,
    showLegalMoves = true,
    showLastMove = true,
    animate = true,
    theme = 'slate',
    pieceSet = 'classic',
    marker,
    ariaLabel,
  } = props;
  const boardRef = useRef<HTMLDivElement>(null);
  const prevPieces = useRef<PieceOnBoard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Drag state that drives rendering changes only (lift / target square). The pointer position
  // itself lives in a ref and is applied to the dragged node in rAF — no React render per pointermove.
  const [drag, setDrag] = useState<{ from: string; moved: boolean } | null>(null);
  const [overSq, setOverSq] = useState<string | null>(null);
  const dragPos = useRef<{ x: number; y: number; sx: number; sy: number; rect: DOMRect | null }>({ x: 0, y: 0, sx: 0, sy: 0, rect: null });
  const dragRaf = useRef(0);
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: Color } | null>(null);
  const [userArrows, setUserArrows] = useState<BoardArrow[]>([]);
  const [circles, setCircles] = useState<string[]>([]);
  const [focusSq, setFocusSq] = useState<string>('e2');
  // The keyboard cursor square is only shown once the user actually steers it (Alt + arrows).
  const [kbdNav, setKbdNav] = useState(false);
  const rightStart = useRef<string | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);
  const turn: Color = fen.split(' ')[1] === 'b' ? 'b' : 'w';

  const dropped = useRef<string | null>(null);
  const firstPaint = useRef(true);
  const ghostsRef = useRef<PieceOnBoard[]>([]);
  const [, setTick] = useState(0);
  // Cached per FEN so a repeated render (StrictMode, re-renders) never re-pairs against itself.
  const pairing = useRef<{ fen: string; pieces: PieceOnBoard[]; gone: PieceOnBoard[] } | null>(null);
  const pieces = useMemo(() => {
    if (pairing.current?.fen === fen) return pairing.current.pieces;
    const { pieces: next, gone } = assignIds(prevPieces.current, parsePieces(fen));
    // Render in a fixed (creation) order: React never re-inserts a DOM node mid-move.
    next.sort((a, b) => idNum(a.id) - idNum(b.id));
    prevPieces.current = next;
    // Captured / removed pieces fade out on their square (rendered in the same frame, no flicker).
    ghostsRef.current = firstPaint.current ? [] : gone;
    firstPaint.current = false;
    pairing.current = { fen, pieces: next, gone };
    return next;
  }, [fen]);
  useEffect(() => {
    if (!ghostsRef.current.length) return;
    const t = setTimeout(() => {
      ghostsRef.current = [];
      setTick((n) => n + 1);
    }, 260);
    return () => clearTimeout(t);
  }, [pieces]);

  // Piece motion via the Web Animations API (FLIP): every square change animates from where the
  // piece currently is — including mid-flight when stepping quickly — independent of CSS
  // transitions, which browsers silently drop when a node is moved or restyled in the same frame.
  const pieceEls = useRef(new Map<string, HTMLDivElement>());
  const lastPos = useRef(new Map<string, { x: number; y: number }>());
  const lastOrient = useRef(orientation);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const prev = lastPos.current;
    const next = new Map<string, { x: number; y: number }>();
    const flipped = lastOrient.current !== orientation;
    lastOrient.current = orientation;
    for (const p of pieces) {
      const [x, y] = sqXY(p.sq, orientation);
      next.set(p.id, { x, y });
      const el = pieceEls.current.get(p.id);
      if (!el || typeof el.animate !== 'function') continue;
      const old = prev.get(p.id);
      const running = el.getAnimations().filter((a) => a.id === 'move' || a.id === 'enter');
      if (!animate || flipped || dropped.current === p.sq) {
        running.forEach((a) => a.cancel());
        continue;
      }
      if (!old) {
        if (mounted.current) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }).id = 'enter';
        continue;
      }
      if (old.x === x && old.y === y) continue;
      // Start from the on-screen position if a previous move is still animating.
      const from = running.length ? getComputedStyle(el).transform : `translate3d(${old.x * 100}%, ${old.y * 100}%, 0)`;
      running.forEach((a) => a.cancel());
      const to = `translate3d(${x * 100}%, ${y * 100}%, 0)`;
      const d = Math.hypot(x - old.x, y - old.y);
      const anim = el.animate(
        [
          { transform: from, zIndex: 5 },
          { transform: to, zIndex: 5 },
        ],
        { duration: Math.round(Math.min(240, 175 + d * 9)), easing: 'cubic-bezier(0.25, 0.85, 0.3, 1)' },
      );
      anim.id = 'move';
    }
    lastPos.current = next;
    mounted.current = true;
  }, [pieces, orientation, animate]);
  // A dragged piece follows the pointer: stop any motion still running on it.
  useLayoutEffect(() => {
    if (!drag?.moved) return;
    const p = prevPieces.current.find((q) => q.sq === drag.from);
    const el = p && pieceEls.current.get(p.id);
    el?.getAnimations().forEach((a) => a.cancel());
  }, [drag?.moved, drag?.from]);
  const ghosts = animate ? ghostsRef.current : [];
  // A piece dropped by drag-and-drop should land instantly, not slide from the cursor.
  useEffect(() => {
    if (!dropped.current) return;
    const id = requestAnimationFrame(() => {
      dropped.current = null;
    });
    return () => cancelAnimationFrame(id);
  }, [pieces]);

  useEffect(() => {
    setSelected(null);
    setPromotion(null);
    setUserArrows([]);
    setCircles([]);
  }, [fen]);

  const legalTargets = useMemo(() => {
    if (!chess || !selected) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const mv of chess.moves({ square: selected as CjSquare, verbose: true })) m.set(mv.to, !!mv.captured);
    return m;
  }, [chess, selected]);

  const checkState = useMemo(() => {
    if (!chess || !chess.inCheck()) return null;
    const k = pieces.find((p) => p.type === 'k' && p.color === turn);
    return k ? { sq: k.sq, mate: chess.isCheckmate() } : null;
  }, [chess, pieces, turn]);
  const checkSquare = checkState?.sq ?? null;

  const squareFromPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const el = boardRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = Math.floor(((clientX - r.left) / r.width) * 8);
      const y = Math.floor(((clientY - r.top) / r.height) * 8);
      if (x < 0 || x > 7 || y < 0 || y > 7) return null;
      const f = orientation === 'w' ? x : 7 - x;
      const rank = orientation === 'w' ? 7 - y : y;
      return `${FILES[f]}${rank + 1}`;
    },
    [orientation],
  );

  const bySquare = useMemo(() => new Map(pieces.map((p) => [p.sq, p])), [pieces]);
  const pieceAt = useCallback((sq: string) => bySquare.get(sq), [bySquare]);

  const tryMove = useCallback(
    (from: string, to: string): boolean => {
      if (!chess || !onMove || from === to) return false;
      const moves = chess.moves({ square: from as CjSquare, verbose: true }).filter((m) => m.to === to);
      if (!moves.length) return false;
      if (moves.some((m) => m.promotion)) {
        setPromotion({ from, to, color: turn });
        return true;
      }
      const ok = onMove({ from, to }, { dragged: dropped.current === to });
      setSelected(null);
      return ok;
    },
    [chess, onMove, turn],
  );

  const dragTransform = () => {
    const { x, y, rect } = dragPos.current;
    if (!rect) return '';
    return `translate3d(${x - rect.left - rect.width / 16}px, ${y - rect.top - rect.height / 16}px, 0) scale(1.08)`;
  };
  const endDrag = () => {
    cancelAnimationFrame(dragRaf.current);
    dragRaf.current = 0;
    dragPos.current.rect = null;
    setDrag(null);
    setOverSq(null);
  };
  useEffect(() => () => cancelAnimationFrame(dragRaf.current), []);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (kbdNav) setKbdNav(false);
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) {
      rightStart.current = sq;
      return;
    }
    if (e.button !== 0) return;
    if (userArrows.length || circles.length) {
      setUserArrows([]);
      setCircles([]);
    }
    if (!interactive || promotion) return;
    const p = pieceAt(sq);
    if (selected && selected !== sq && legalTargets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (p && p.color === turn) {
      setSelected(sq);
      dragPos.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, rect: null };
      setDrag({ from: sq, moved: false });
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } else setSelected(null);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const pos = dragPos.current;
    pos.x = e.clientX;
    pos.y = e.clientY;
    if (!drag.moved) {
      if (Math.hypot(pos.x - pos.sx, pos.y - pos.sy) <= 4) return;
      pos.rect = boardRef.current?.getBoundingClientRect() ?? null;
      setDrag({ from: drag.from, moved: true });
      setOverSq(squareFromPoint(pos.x, pos.y));
      return;
    }
    if (dragRaf.current) return;
    dragRaf.current = requestAnimationFrame(() => {
      dragRaf.current = 0;
      const p = bySquare.get(drag.from);
      const el = p && pieceEls.current.get(p.id);
      if (el) el.style.transform = dragTransform();
      const over = squareFromPoint(pos.x, pos.y);
      setOverSq((cur) => (cur === over ? cur : over));
    });
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (e.button === 2 && rightStart.current) {
      const from = rightStart.current;
      rightStart.current = null;
      if (!sq) return;
      if (sq === from) setCircles((c) => (c.includes(sq) ? c.filter((x) => x !== sq) : [...c, sq]));
      else
        setUserArrows((a) =>
          a.some((x) => x.from === from && x.to === sq) ? a.filter((x) => !(x.from === from && x.to === sq)) : [...a, { from, to: sq, kind: 'user' }],
        );
      return;
    }
    if (!drag) return;
    const d = drag;
    const liftedFrom = d.moved ? dragTransform() : '';
    endDrag();
    let ok = false;
    if (d.moved && sq && sq !== d.from) {
      dropped.current = sq;
      ok = tryMove(d.from, sq);
      if (!ok) dropped.current = null;
    }
    // Illegal / cancelled drop: glide the piece back home instead of teleporting.
    if (d.moved && !ok && animate && liftedFrom) {
      const p = bySquare.get(d.from);
      const el = p && pieceEls.current.get(p.id);
      if (el && typeof el.animate === 'function') {
        const [hx, hy] = sqXY(d.from, orientation);
        el.animate([{ transform: liftedFrom, zIndex: 10 }, { transform: `translate3d(${hx * 100}%, ${hy * 100}%, 0)`, zIndex: 10 }], {
          duration: 200,
          easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
        }).id = 'move';
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const [x, y] = sqXY(focusSq, orientation);
    const move = (dx: number, dy: number) => {
      const nx = Math.min(7, Math.max(0, x + dx));
      const ny = Math.min(7, Math.max(0, y + dy));
      const f = orientation === 'w' ? nx : 7 - nx;
      const r = orientation === 'w' ? 7 - ny : ny;
      setFocusSq(`${FILES[f]}${r + 1}`);
    };
    if (!e.altKey) return; // Plain arrows are reserved for move navigation.
    if (!kbdNav) setKbdNav(true);
    if (e.key === 'ArrowLeft') move(-1, 0);
    else if (e.key === 'ArrowRight') move(1, 0);
    else if (e.key === 'ArrowUp') move(0, -1);
    else if (e.key === 'ArrowDown') move(0, 1);
    else if (e.key === 'Enter') {
      if (selected && legalTargets.has(focusSq)) tryMove(selected, focusSq);
      else if (pieceAt(focusSq)?.color === turn) setSelected(focusSq);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const squares = useMemo(() => {
    const out: { sq: string; x: number; y: number; light: boolean }[] = [];
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const f = orientation === 'w' ? x : 7 - x;
        const r = orientation === 'w' ? 7 - y : y;
        out.push({ sq: `${FILES[f]}${r + 1}`, x, y, light: (f + r) % 2 === 1 });
      }
    return out;
  }, [orientation]);

  const allArrows = useMemo(() => (userArrows.length ? [...arrows, ...userArrows] : arrows), [arrows, userArrows]);

  return (
    <div
      className={`board theme-${theme}${animate ? ' animated' : ''}${interactive ? ' interactive' : ''}${drag?.moved ? ' dragging' : ''}`}
      ref={boardRef}
      role="grid"
      aria-label={ariaLabel ?? 'Chess board'}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endDrag}
      onContextMenu={(e) => e.preventDefault()}
    >
      {squares.map(({ sq, x, y, light }) => {
        const isLast = showLastMove && lastMove && (lastMove.from === sq || lastMove.to === sq);
        const target = showLegalMoves && legalTargets.has(sq);
        const p = pieceAt(sq);
        return (
          <div
            key={sq}
            role="gridcell"
            aria-label={`${sq}${p ? ` ${p.color === 'w' ? 'white' : 'black'} ${PIECE_LABEL[p.type]}` : ''}`}
            className={[
              'sq',
              light ? 'light' : 'dark',
              isLast ? 'last' : '',
              selected === sq ? 'selected' : '',

              target ? (legalTargets.get(sq) ? 'target capture' : 'target') : '',
              kbdNav && focusSq === sq ? 'kbd-focus' : '',
              overSq === sq ? 'drag-over' : '',
            ].join(' ')}
            style={{ gridColumn: x + 1, gridRow: y + 1 }}
          >
            {showCoordinates && x === 0 && <span className="coord rank">{sq[1]}</span>}
            {showCoordinates && y === 7 && <span className="coord file">{sq[0]}</span>}
          </div>
        );
      })}
      <div className="pieces">
        {pieces.map((p) => {
          const [x, y] = sqXY(p.sq, orientation);
          const dragging = !!(drag?.moved && drag.from === p.sq && dragPos.current.rect);
          const style: React.CSSProperties = dragging
            ? { transform: dragTransform(), transition: 'none', zIndex: 10 }
            : { transform: `translate3d(${x * 100}%, ${y * 100}%, 0)` };
          if (!dragging && dropped.current === p.sq) style.transition = 'none';
          return (
            <div
              key={p.id}
              ref={(el) => {
                if (el) pieceEls.current.set(p.id, el);
                else if (pieceEls.current.get(p.id)?.isConnected === false) pieceEls.current.delete(p.id);
              }}
              className={`piece ${p.color}${p.type}${dragging ? ' lifted' : ''} ${checkSquare === p.sq && p.type === 'k' ? (checkState?.mate ? 'in-check mated' : 'in-check') : ''}`}
              style={style}
            >
              <PieceSvg color={p.color} type={p.type} set={pieceSet} />
            </div>
          );
        })}
        {ghosts.map((p) => {
          const [x, y] = sqXY(p.sq, orientation);
          return (
            <div key={`ghost-${p.id}`} className={`piece ghost ${p.color}${p.type}`} style={{ transform: `translate3d(${x * 100}%, ${y * 100}%, 0)` }}>
              <PieceSvg color={p.color} type={p.type} set={pieceSet} />
            </div>
          );
        })}
      </div>
      <ArrowLayer arrows={allArrows} circles={circles} orientation={orientation} />
      {marker && (
        <div
          className="board-marker"
          style={(() => {
            const [mx, my] = sqXY(marker.square, orientation);
            // Sit on the square's top-right corner, but never outside the board edge.
            return {
              left: `${(mx + 1) * 12.5}%`,
              top: `${my * 12.5}%`,
              transform: `translate(${mx === 7 ? '-104%' : '-55%'}, ${my === 0 ? '4%' : '-45%'})`,
            };
          })()}
        >
          <ClassificationIcon c={marker.classification} size={28} />
        </div>
      )}
      {promotion && (
        <div className="promotion" role="dialog" aria-label="Choose promotion piece" onPointerDown={(e) => e.stopPropagation()}>
          <div className="promotion-card" style={{ left: `${sqXY(promotion.to, orientation)[0] * 12.5}%` }}>
            {(['q', 'r', 'b', 'n'] as PieceSymbol[]).map((t) => (
              <button
                key={t}
                type="button"
                className="promo-btn"
                aria-label={`Promote to ${PIECE_LABEL[t]}`}
                onClick={() => {
                  onMove?.({ from: promotion.from, to: promotion.to, promotion: t }, { dragged: dropped.current === promotion.to });
                  setPromotion(null);
                  setSelected(null);
                }}
              >
                <PieceSvg color={promotion.color} type={t} set={pieceSet} />
              </button>
            ))}
            <button type="button" className="promo-cancel" aria-label="Cancel promotion" onClick={() => setPromotion(null)}>
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const ChessBoard = memo(ChessBoardImpl);
