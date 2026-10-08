import type { ScoreBound } from './types';

export interface UciInfo {
  depth?: number;
  seldepth?: number;
  multipv: number;
  /** Score from the side to move's point of view. */
  cp?: number;
  mate?: number;
  bound?: ScoreBound;
  nodes?: number;
  nps?: number;
  time?: number;
  hashfull?: number;
  pv: string[];
  currmove?: string;
  string?: string;
}

const INT_KEYS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull', 'tbhits', 'currmovenumber', 'cpuload']);

export function parseInfoLine(line: string): UciInfo | null {
  if (!line.startsWith('info ')) return null;
  const tokens = line.trim().split(/\s+/);
  const info: UciInfo = { multipv: 1, pv: [] };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'string') {
      info.string = tokens.slice(i + 1).join(' ');
      break;
    }
    if (t === 'pv') {
      info.pv = tokens.slice(i + 1).filter((m) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
      break;
    }
    if (t === 'score') {
      const kind = tokens[i + 1];
      const val = Number(tokens[i + 2]);
      if (kind === 'cp') info.cp = val;
      else if (kind === 'mate') info.mate = val;
      i += 2;
      if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') {
        info.bound = tokens[i + 1] === 'lowerbound' ? 'lower' : 'upper';
        i++;
      }
      continue;
    }
    if (t === 'currmove') {
      info.currmove = tokens[++i];
      continue;
    }
    if (INT_KEYS.has(t)) {
      const v = Number(tokens[++i]);
      if (Number.isFinite(v)) (info as unknown as Record<string, number>)[t] = v;
    }
  }
  return info;
}

export function parseBestMove(line: string): { bestmove: string | null; ponder?: string } | null {
  if (!line.startsWith('bestmove')) return null;
  const parts = line.trim().split(/\s+/);
  const bm = parts[1];
  return {
    bestmove: !bm || bm === '(none)' || bm === '0000' ? null : bm,
    ponder: parts[2] === 'ponder' ? parts[3] : undefined,
  };
}

export function parseOptionLine(line: string): { name: string; type: string; min?: number; max?: number; default?: string } | null {
  const m = line.match(/^option name (.+?) type (\w+)(.*)$/);
  if (!m) return null;
  const rest = m[3];
  const num = (k: string) => {
    const mm = rest.match(new RegExp(`${k} (-?\\d+)`));
    return mm ? Number(mm[1]) : undefined;
  };
  const def = rest.match(/default (\S*)/);
  return { name: m[1], type: m[2], min: num('min'), max: num('max'), default: def?.[1] };
}
