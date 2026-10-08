import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatScore } from '../../engine/evalUtils';
import type { MoveClassification } from '../../review/types';
import type { EvalPoint } from '../../state/controller';
import { ClassificationIcon } from '../ClassificationBadge/ClassificationBadge';
import { CLASS_LABEL } from '../../review/criticalMoments';

export interface GraphMarker {
  ply: number;
  classification: MoveClassification;
}

interface Props {
  points: (EvalPoint | null)[];
  labels: string[];
  currentPly: number | null;
  markers: GraphMarker[];
  showMarkers: boolean;
  onSelect: (ply: number) => void;
  height?: number;
}

function EvaluationGraphImpl({ points, labels, currentPly, markers, showMarkers, onSelect, height = 120 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(120, entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = Math.max(1, points.length - 1);
  const pad = 6;
  const H = height;
  const xOf = (i: number) => pad + (i / n) * (width - pad * 2);
  const yOf = (ep: number) => (1 - ep) * H;

  const { area, line } = useMemo(() => {
    const segs: string[] = [];
    let cur: string[] = [];
    const areaPts: string[] = [];
    let lastX = xOf(0);
    let firstX: number | null = null;
    points.forEach((p, i) => {
      if (!p) {
        if (cur.length) segs.push(cur.join(' '));
        cur = [];
        return;
      }
      const x = xOf(i);
      const y = yOf(p.ep);
      cur.push(`${cur.length ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
      areaPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      if (firstX === null) firstX = x;
      lastX = x;
    });
    if (cur.length) segs.push(cur.join(' '));
    const area = areaPts.length > 1 ? `M${firstX},${H} L${areaPts.join(' L')} L${lastX},${H} Z` : '';
    return { area, line: segs.join(' ') };
  }, [points, width, H]);

  const pickPly = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const rel = (clientX - r.left - pad) / (r.width - pad * 2);
    return Math.max(0, Math.min(points.length - 1, Math.round(rel * n)));
  };

  const known = points.filter(Boolean).length;
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="graph" ref={ref}>
      {known < 2 && <div className="graph-empty">The evaluation graph fills in as positions are analyzed — run a Game Review to chart the whole game.</div>}
      <svg
        width={width}
        height={H}
        viewBox={`0 0 ${width} ${H}`}
        role="img"
        aria-label="Evaluation graph. Click to jump to a move."
        onPointerMove={(e) => setHover(pickPly(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => onSelect(pickPly(e.clientX))}
      >
        <rect x="0" y="0" width={width} height={H} className="graph-bg" />
        {area && <path d={area} className="graph-area" />}
        <line x1="0" x2={width} y1={H / 2} y2={H / 2} className="graph-zero" />
        {line && <path d={line} className="graph-line" />}
        {known >= 2 && currentPly !== null && currentPly < points.length && (
          <g className="graph-cursor" style={{ transform: `translateX(${xOf(currentPly)}px)` }}>
            <line x1="0" x2="0" y1="0" y2={H} />
          </g>
        )}
        {hover !== null && <line x1={xOf(hover)} x2={xOf(hover)} y1="0" y2={H} className="graph-hover" />}
        {showMarkers &&
          markers.map((m) => {
            const p = points[m.ply];
            if (!p) return null;
            const sz = currentPly === m.ply ? 16 : 13;
            const cy = Math.min(H - sz / 2 - 1, Math.max(sz / 2 + 1, yOf(p.ep)));
            return (
              <g key={m.ply} className="graph-marker">
                <circle cx={xOf(m.ply)} cy={cy} r={sz / 2 + 1.2} fill="var(--surface)" />
                <ClassificationIcon c={m.classification} size={sz} x={xOf(m.ply) - sz / 2} y={cy - sz / 2} />
              </g>
            );
          })}
      </svg>
      {hover !== null && (
        <div className="graph-tip" style={{ left: Math.min(Math.max(xOf(hover), 70), width - 70) }}>
          <b>{labels[hover] ?? ''}</b>
          <span>{hp ? formatScore(hp.score, { terminal: hp.terminal, winner: hp.winner }) : 'not analyzed'}</span>
          {markers.find((m) => m.ply === hover) && <em>{CLASS_LABEL[markers.find((m) => m.ply === hover)!.classification]}</em>}
        </div>
      )}
    </div>
  );
}

export const EvaluationGraph = memo(EvaluationGraphImpl);
