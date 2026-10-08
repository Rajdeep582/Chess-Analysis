import type { JSX } from 'react';
import type { Color, PieceSymbol } from '../../chess/types';
import type { PieceSetId } from '../../state/settings';

/* Original piece artwork for Outpost. Drawn on a 45×45 grid. */

interface Palette {
  fill: string;
  stroke: string;
  detail: string;
}

const PAL: Record<Color, Palette> = {
  w: { fill: '#f7f4ee', stroke: '#1b1f27', detail: '#1b1f27' },
  b: { fill: '#262b35', stroke: '#0b0d11', detail: '#c7cdd8' },
};

function Base({ p }: { p: Palette }) {
  return <rect x="10.5" y="36" width="24" height="4" rx="2" fill={p.fill} stroke={p.stroke} strokeWidth="1.5" />;
}

const SHAPES: Record<PieceSymbol, (p: Palette) => JSX.Element> = {
  p: (p) => (
    <g stroke={p.stroke} strokeWidth="1.5" strokeLinejoin="round" fill={p.fill}>
      <path d="M17 36c.4-3.6 2-6.4 3.8-8.1-1.9-1-3.1-2.8-3.1-5 0-2.2 1.3-4.1 3.2-5a4.6 4.6 0 1 1 3.2 0c1.9.9 3.2 2.8 3.2 5 0 2.2-1.2 4-3.1 5 1.8 1.7 3.4 4.5 3.8 8.1z" />
      <Base p={p} />
    </g>
  ),
  r: (p) => (
    <g stroke={p.stroke} strokeWidth="1.5" strokeLinejoin="round" fill={p.fill}>
      <path d="M13.5 9h4v3.2h3V9h4v3.2h3V9h4v6.5l-3 2.6v11.4l3 2.9V36h-18v-4.1l3-2.9V18.1l-3-2.6z" />
      <path d="M16.5 18.1h12M16.5 29h12" fill="none" stroke={p.detail} strokeWidth="1.3" />
      <Base p={p} />
    </g>
  ),
  n: (p) => (
    <g stroke={p.stroke} strokeWidth="1.5" strokeLinejoin="round" fill={p.fill}>
      <path d="M14.2 36c-.3-5.2 1.6-9 5.4-12.2 1.3-1.1 1.6-2.4.9-3.5-1.7 1.4-3.9 2-6.2 2.1l-2.6 1.5c-1 .6-2.2.1-2.5-1l-.6-2.3c-.3-1 .1-2 .9-2.6l7.1-5.4c1-2.8 3-4.9 5.5-6l-.4-2.6 3.6 2.3c5.7 1.3 9.4 6.6 9.4 13.6 0 6-1.6 11.4-1.6 16.1z" />
      <circle cx="19.6" cy="13.6" r="1.25" fill={p.detail} stroke="none" />
      <path d="M27.4 9.6c2.8 2.9 4.2 6.9 4.1 11.8" fill="none" stroke={p.detail} strokeWidth="1.3" strokeLinecap="round" />
      <Base p={p} />
    </g>
  ),
  b: (p) => (
    <g stroke={p.stroke} strokeWidth="1.5" strokeLinejoin="round" fill={p.fill}>
      <path d="M22.5 9.6c-5.1 3.9-8 9.2-8 13.6 0 3.4 2 5.6 4.3 6.6h7.4c2.3-1 4.3-3.2 4.3-6.6 0-4.4-2.9-9.7-8-13.6z" />
      <circle cx="22.5" cy="7.4" r="2.3" />
      <path d="M25.6 15.3l-4.4 5.2" fill="none" stroke={p.detail} strokeWidth="1.4" strokeLinecap="round" />
      <rect x="16.5" y="29.8" width="12" height="3.2" rx="1.6" />
      <path d="M13.2 36c1.4-2.1 5-3 9.3-3s7.9.9 9.3 3z" />
      <Base p={p} />
    </g>
  ),
  q: (p) => (
    <g stroke={p.stroke} strokeWidth="1.5" strokeLinejoin="round" fill={p.fill}>
      <path d="M10.5 14.5l3.4 16.2h17.2l3.4-16.2-5.2 7.6-1.9-10.3-4 9.7-1-.1-4-9.6-1.9 10.3z" />
      <circle cx="10.5" cy="13" r="2" />
      <circle cx="16.4" cy="10.1" r="2" />
      <circle cx="22.5" cy="8.6" r="2" />
      <circle cx="28.6" cy="10.1" r="2" />
      <circle cx="34.5" cy="13" r="2" />
      <rect x="13.6" y="30.6" width="17.8" height="3" rx="1.5" />
      <path d="M12.6 36l1.6-2.5h16.6l1.6 2.5z" />
      <Base p={p} />
    </g>
  ),
  k: (p) => (
    <g stroke={p.stroke} strokeWidth="1.5" strokeLinejoin="round" fill={p.fill}>
      <path d="M21.2 4.5h2.6v3.1h3v2.6h-3v3.4h-2.6v-3.4h-3V7.6h3z" />
      <path d="M12.2 20.6c0-3.6 3-5.8 6.1-5.8 1.9 0 3.3.8 4.2 2 .9-1.2 2.3-2 4.2-2 3.1 0 6.1 2.2 6.1 5.8 0 3.9-2.6 7.3-4.6 10.1H16.8c-2-2.8-4.6-6.2-4.6-10.1z" />
      <path d="M22.5 17v13.7" fill="none" stroke={p.detail} strokeWidth="1.3" />
      <rect x="15" y="30.6" width="15" height="3" rx="1.5" />
      <path d="M13 36l1.6-2.5h15.8L32 36z" />
      <Base p={p} />
    </g>
  ),
};

const LETTER: Record<PieceSymbol, string> = { k: 'K', q: 'Q', r: 'R', b: 'B', n: 'N', p: '' };

function Token({ color, type }: { color: Color; type: PieceSymbol }) {
  const light = color === 'w';
  return (
    <g>
      <circle cx="22.5" cy="22.5" r={type === 'p' ? 11 : 16} fill={light ? '#f5f2ea' : '#232832'} stroke={light ? '#3a404b' : '#0b0d11'} strokeWidth="1.6" />
      {type !== 'p' && (
        <text x="22.5" y="28.2" textAnchor="middle" fontSize="16" fontWeight="700" fontFamily="'JetBrains Mono Variable', ui-monospace, monospace" fill={light ? '#1b1f27' : '#e9edf3'}>
          {LETTER[type]}
        </text>
      )}
      {type === 'p' && <circle cx="22.5" cy="22.5" r="3.4" fill={light ? '#1b1f27' : '#e9edf3'} />}
    </g>
  );
}

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

export function PieceSvg({ color, type, set }: { color: Color; type: PieceSymbol; set: PieceSetId }) {
  if (set === 'classic') {
    // Colin M.L. Burnett's set (GPLv2+), served from public/pieces/cburnett.
    return <img className="piece-svg" src={`${BASE}pieces/cburnett/${color}${type.toUpperCase()}.svg`} alt="" draggable={false} aria-hidden="true" />;
  }
  return (
    <svg viewBox="0 0 45 45" className="piece-svg" aria-hidden="true" focusable="false">
      {set === 'tokens' ? <Token color={color} type={type} /> : SHAPES[type](PAL[color])}
    </svg>
  );
}

export const PIECE_LABEL: Record<PieceSymbol, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
