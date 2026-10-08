import { useRef } from 'react';
import { evalBarFraction, formatAnalysisEval } from '../../engine/evalUtils';

/** Short label that fits the narrow bar: one decimal, or none from ±10. */
function compact(label: string): string {
  const m = label.match(/^([+−-]?)(\d+)\.(\d+)$/);
  if (!m) return label;
  const v = Number(`${m[2]}.${m[3]}`);
  return `${m[1]}${v >= 10 ? Math.round(v) : v.toFixed(1)}`;
}
import type { EngineAnalysis } from '../../engine/types';

/** Minimum depth before a streaming result moves the bar (avoids jitter from shallow iterations). */
const MIN_DEPTH = 8;

export function EvaluationBar({ analysis, orientation, hidden, pending }: { analysis: EngineAnalysis | null; orientation: 'w' | 'b'; hidden?: boolean; pending?: boolean }) {
  const last = useRef<{ frac: number; label: string }>({ frac: 0.5, label: '0.00' });
  const usable = !!analysis && (analysis.terminal || analysis.complete || analysis.source !== 'engine' || analysis.depth >= MIN_DEPTH);
  if (!hidden && usable) last.current = { frac: evalBarFraction(analysis), label: formatAnalysisEval(analysis) };
  // Keep the previous value while the next position is being analyzed so the bar glides instead of snapping to 0.
  const frac = hidden ? 0.5 : last.current.frac;
  const label = hidden ? '?' : last.current.label;
  const whiteAhead = frac >= 0.5;
  return (
    <div
      className={`evalbar ${orientation === 'b' ? 'flipped' : ''} ${pending || !usable ? 'pending' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(frac * 100)}
      aria-label={`Evaluation ${label}`}
    >
      <div className="evalbar-white" style={{ transform: `scaleY(${frac.toFixed(4)})` }} />
      <div className="evalbar-mid" />
      <span className={`evalbar-label ${whiteAhead ? 'on-white' : 'on-black'}`} title={label}>
        {compact(label)}
      </span>
    </div>
  );
}
