import type { MoveClassification } from '../../review/types';
import { CLASS_LABEL } from '../../review/criticalMoments';

export const CLASS_COLOR: Record<MoveClassification, string> = {
  brilliant: 'var(--c-brilliant)',
  great: 'var(--c-great)',
  best: 'var(--c-best)',
  excellent: 'var(--c-excellent)',
  good: 'var(--c-good)',
  book: 'var(--c-book)',
  inaccuracy: 'var(--c-inaccuracy)',
  mistake: 'var(--c-mistake)',
  miss: 'var(--c-miss)',
  blunder: 'var(--c-blunder)',
};

/** Standard chess annotation symbols (!!, !, ?!, ?, ??) drawn as text. */
function Annotation({ text }: { text: string }) {
  const size = text.length > 1 ? 9.6 : 11.5;
  return (
    <text
      x="8"
      y="8"
      dy="0.36em"
      textAnchor="middle"
      fontSize={size}
      fontWeight={800}
      letterSpacing={text.length > 1 ? -0.6 : 0}
      fontFamily="'Manrope Variable', ui-sans-serif, system-ui, sans-serif"
      fill="#fff"
    >
      {text}
    </text>
  );
}

function Glyph({ c }: { c: MoveClassification }) {
  const s = { fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (c) {
    case 'brilliant':
      return <Annotation text="!!" />;
    case 'great':
      return <Annotation text="!" />;
    case 'best':
      return <path d="M4.4 8.4l2.5 2.4 4.7-5.4" {...s} strokeWidth={2.2} />;
    case 'excellent':
      // Upward chevron: an improving / near-best move (no standard annotation exists).
      return <path d="M4.6 10.2L8 6.6l3.4 3.6" {...s} strokeWidth={2.3} />;
    case 'good':
      // Solid dot: a sound, ordinary move.
      return <circle cx="8" cy="8" r="2.6" fill="#fff" />;
    case 'book':
      return <path d="M3.4 4.9c1.7-.6 3.2-.4 4.6.7v6.3c-1.4-1-2.9-1.2-4.6-.6zM12.6 4.9c-1.7-.6-3.2-.4-4.6.7v6.3c1.4-1 2.9-1.2 4.6-.6z" fill="#fff" />;
    case 'inaccuracy':
      return <Annotation text="?!" />;
    case 'mistake':
      return <Annotation text="?" />;
    case 'miss':
      return <path d="M9.3 2.6L4.9 8.9h3.2l-1.3 4.5 4.4-6.3H8z" fill="#fff" />;
    case 'blunder':
      return <Annotation text="??" />;
  }
}

export function ClassificationIcon({ c, size = 18, title, x, y }: { c: MoveClassification; size?: number; title?: string; x?: number; y?: number }) {
  return (
    <svg
      x={x}
      y={y}
      className={`cls-icon cls-${c}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={title ?? CLASS_LABEL[c]}
      style={{ color: CLASS_COLOR[c] }}
    >
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <Glyph c={c} />
    </svg>
  );
}

export function ClassificationBadge({ c, compact = false }: { c: MoveClassification; compact?: boolean }) {
  return (
    <span className={`cls-badge cls-${c}`} style={{ ['--cls' as string]: CLASS_COLOR[c] }}>
      <ClassificationIcon c={c} size={compact ? 14 : 16} />
      {!compact && <span>{CLASS_LABEL[c]}</span>}
    </span>
  );
}
