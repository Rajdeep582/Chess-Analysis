import type { ReactNode } from 'react';
import { useApp, useController } from '../../state/context';
import { Icon, type IconName } from '../common/Icon';

/** Header strip shared by the feature pages: icon, title, one-line subtitle, optional actions. */
export function PageHead({ icon, title, subtitle, children }: { icon: IconName; title: string; subtitle: string; children?: ReactNode }) {
  const c = useController();
  return (
    <header className="page-head">
      <button type="button" className="icon-btn page-back" onClick={() => c.goHome()} aria-label="Back to home" title="Home">
        <Icon name="prev" />
      </button>
      <span className="page-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div className="page-titles">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children && <div className="page-head-actions">{children}</div>}
    </header>
  );
}

/** Board look & feel from the user's settings (theme, piece set, animations). */
export function useBoardPrefs() {
  const board = useApp((s) => s.settings.board);
  const perf = useApp((s) => s.settings.performance);
  return {
    theme: board.theme,
    pieceSet: board.pieceSet,
    showCoordinates: board.coordinates,
    showLegalMoves: board.showLegalMoves,
    animate: board.animations && !perf.reduceMotion && !perf.lowPower,
  };
}

/** Compact two-column move list (1. e4 e5 …) with optional click-to-jump. */
export function MiniMoves({ sans, current, onPick, startNumber = 1, startColor = 'w' }: { sans: string[]; current?: number; onPick?: (i: number) => void; startNumber?: number; startColor?: 'w' | 'b' }) {
  const rows: { n: number; w?: number; b?: number }[] = [];
  let n = startNumber;
  let i = 0;
  if (startColor === 'b' && sans.length) {
    rows.push({ n, b: 0 });
    i = 1;
    n++;
  }
  for (; i < sans.length; i += 2) {
    rows.push({ n, w: i, b: i + 1 < sans.length ? i + 1 : undefined });
    n++;
  }
  const cell = (idx?: number) =>
    idx === undefined ? (
      <span className="mm-cell empty" />
    ) : (
      <button type="button" className={`mm-cell ${current === idx ? 'current' : ''}`} onClick={() => onPick?.(idx)} disabled={!onPick}>
        {sans[idx]}
      </button>
    );
  return (
    <div className="mini-moves" role="list" aria-label="Moves">
      {rows.map((r) => (
        <div className="mm-row" role="listitem" key={r.n}>
          <span className="mm-n">{r.n}.</span>
          {r.w === undefined && startColor === 'b' && r.n === startNumber ? <span className="mm-cell empty">…</span> : cell(r.w)}
          {cell(r.b)}
        </div>
      ))}
      {!sans.length && <p className="muted small center">No moves yet.</p>}
    </div>
  );
}
