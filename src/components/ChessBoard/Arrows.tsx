export type ArrowKind = 'best' | 'alt' | 'user' | 'hover' | 'played' | 'solution';

export interface BoardArrow {
  from: string;
  to: string;
  kind: ArrowKind;
  /** 0..1 strength (alt lines fade with rank). */
  weight?: number;
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
  const head = width * 2.6;
  const headLen = width * 2.4;
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
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * (width / 2);
    const ny = (dx / l) * (width / 2);
    left.push([pts[i][0] + nx, pts[i][1] + ny]);
    right.push([pts[i][0] - nx, pts[i][1] - ny]);
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
      {arrows.map((a, i) => {
        if (a.from === a.to) return null;
        const st = STYLE[a.kind];
        const [x1, y1] = center(a.from, orientation);
        const [x2, y2] = center(a.to, orientation);
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const knight = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
        // Start slightly off-center so pieces stay readable.
        const start = (tx: number, ty: number): [number, number] => {
          const l = Math.hypot(tx - x1, ty - y1);
          return [x1 + ((tx - x1) / l) * 0.28, y1 + ((ty - y1) / l) * 0.28];
        };
        const end: [number, number] = [x2, y2];
        let pts: [number, number][];
        if (knight) {
          const corner: [number, number] = dx > dy ? [x2, y1] : [x1, y2];
          pts = [start(corner[0], corner[1]), corner, end];
        } else pts = [start(x2, y2), end];
        const opacity = st.opacity * (a.weight ?? 1);
        return (
          <path
            key={`${a.kind}-${a.from}${a.to}-${i}`}
            d={arrowPath(pts, st.width)}
            fill={st.color}
            opacity={opacity}
            className={`arrow arrow-${a.kind}`}
          />
        );
      })}
    </svg>
  );
}
