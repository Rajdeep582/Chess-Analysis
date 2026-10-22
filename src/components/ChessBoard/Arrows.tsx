export type ArrowKind = 'best' | 'alt' | 'user' | 'hover' | 'played' | 'solution';

export interface BoardArrow {
  from: string;
  to: string;
  kind: ArrowKind;
  /** 0..1 strength multiplier. */
  weight?: number;
  /** Engine line rank (0 = best). Thickness and opacity step down with rank. */
  rank?: number;
}

/** Engine-line arrows by rank: best is boldest, every next line thinner and fainter. */
const RANKED: { width: number; opacity: number }[] = [
  { width: 0.24, opacity: 0.94 },
  { width: 0.165, opacity: 0.66 },
  { width: 0.125, opacity: 0.46 },
  { width: 0.1, opacity: 0.34 },
  { width: 0.085, opacity: 0.26 },
];
/** Paint order (later = on top). Engine lines paint worst first so the best arrow is never covered. */
const LAYER: Record<ArrowKind, number> = { alt: 0, best: 1, played: 2, user: 3, solution: 4, hover: 5 };
function layer(a: BoardArrow): number {
  return LAYER[a.kind] * 100 - (a.rank ?? 0);
}

const STYLE: Record<ArrowKind, { color: string; width: number; opacity: number; dash?: string }> = {
  best: { color: 'var(--arrow-best)', width: 0.2, opacity: 0.92 },
  alt: { color: 'var(--arrow-alt)', width: 0.15, opacity: 0.7 },
  user: { color: 'var(--arrow-user)', width: 0.17, opacity: 0.85 },
  hover: { color: 'var(--arrow-hover)', width: 0.16, opacity: 0.95 },
  played: { color: 'var(--arrow-played)', width: 0.16, opacity: 0.8 },
  solution: { color: 'var(--arrow-solution)', width: 0.2, opacity: 0.92 },
};

function center(sq: string, orientation: 'w' | 'b'): [number, number] {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]) - 1;
  const x = orientation === 'w' ? f : 7 - f;
  const y = orientation === 'w' ? 7 - r : r;
  return [x + 0.5, y + 0.5];
}

function arrowPath(points: [number, number][], width: number): string {
  // Builds an outline polygon: shaft along the polyline, chevron head at the end.
  // Head scales with the shaft, but never so small it becomes unreadable on thin arrows.
  const head = Math.max(0.3, width * 2.5);
  const headLen = Math.max(0.27, width * 2.2);
  const n = points.length;
  const [ex, ey] = points[n - 1];
  const [px, py] = points[n - 2];
  const len = Math.hypot(ex - px, ey - py);
  const ux = (ex - px) / len;
  const uy = (ey - py) / len;
  const baseX = ex - ux * headLen;
  const baseY = ey - uy * headLen;
  const pts = [...points.slice(0, n - 1), [baseX, baseY] as [number, number]];
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  // Unit normal of segment k (pts[k] → pts[k+1]).
  const segN = (k: number): [number, number] => {
    const dx = pts[k + 1][0] - pts[k][0];
    const dy = pts[k + 1][1] - pts[k][1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const hw = width / 2;
  for (let i = 0; i < pts.length; i++) {
    let ox: number;
    let oy: number;
    if (i === 0 || i === pts.length - 1) {
      const [nx, ny] = segN(i === 0 ? 0 : i - 1);
      ox = nx * hw;
      oy = ny * hw;
    } else {
      // Mitered joint: offset along the bisector, lengthened so the shaft keeps full width at the bend.
      const [ax, ay] = segN(i - 1);
      const [bx, by] = segN(i);
      let mx = ax + bx;
      let my = ay + by;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const k = hw / Math.max(0.2, mx * ax + my * ay);
      ox = mx * k;
      oy = my * k;
    }
    left.push([pts[i][0] + ox, pts[i][1] + oy]);
    right.push([pts[i][0] - ox, pts[i][1] - oy]);
  }
  const nx = -uy * (head / 2);
  const ny = ux * (head / 2);
  const tip: [number, number][] = [
    [baseX + nx, baseY + ny],
    [ex, ey],
    [baseX - nx, baseY - ny],
  ];
  const poly = [...left, ...tip, ...right.reverse()];
  return `M${poly.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join('L')}Z`;
}

export function ArrowLayer({ arrows, circles, orientation }: { arrows: BoardArrow[]; circles: string[]; orientation: 'w' | 'b' }) {
  return (
    <svg className="board-arrows" viewBox="0 0 8 8" aria-hidden="true">
      {circles.map((sq) => {
        const [x, y] = center(sq, orientation);
        return <circle key={`c-${sq}`} cx={x} cy={y} r={0.44} fill="none" stroke="var(--arrow-user)" strokeWidth={0.07} opacity={0.85} />;
      })}
      {[...arrows]
        .map((a, i) => ({ a, i }))
        .sort((p, q) => layer(p.a) - layer(q.a) || p.i - q.i)
        .map(({ a, i }) => {
          if (a.from === a.to) return null;
          const base = STYLE[a.kind];
          const ranked = (a.kind === 'best' || a.kind === 'alt') && a.rank != null ? RANKED[Math.min(a.rank, RANKED.length - 1)] : null;
          const width = ranked ? ranked.width : base.width;
          const [x1, y1] = center(a.from, orientation);
          const [x2, y2] = center(a.to, orientation);
          const dx = Math.abs(x2 - x1);
          const dy = Math.abs(y2 - y1);
          const knight = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
          // Start slightly off-center so the moving piece stays readable; stop just short of the target centre.
          const start = (tx: number, ty: number): [number, number] => {
            const l = Math.hypot(tx - x1, ty - y1);
            return [x1 + ((tx - x1) / l) * 0.3, y1 + ((ty - y1) / l) * 0.3];
          };
          const stop = (fx: number, fy: number): [number, number] => {
            const l = Math.hypot(x2 - fx, y2 - fy);
            return [x2 - ((x2 - fx) / l) * 0.08, y2 - ((y2 - fy) / l) * 0.08];
          };
          let pts: [number, number][];
          if (knight) {
            const corner: [number, number] = dx > dy ? [x2, y1] : [x1, y2];
            pts = [start(corner[0], corner[1]), corner, stop(corner[0], corner[1])];
          } else pts = [start(x2, y2), stop(x1, y1)];
          const opacity = (ranked ? ranked.opacity : base.opacity) * (a.weight ?? 1);
          return (
            <g key={a.kind === 'best' || a.kind === 'alt' ? `engine-${a.from}${a.to}` : `${a.kind}-${a.from}${a.to}-${i}`} className={`arrow arrow-${a.kind}`} opacity={opacity}>
              <path d={arrowPath(pts, width)} fill={base.color} stroke={base.color} strokeWidth={0.025} strokeLinejoin="round" />
            </g>
          );
        })}
    </svg>
  );
}
