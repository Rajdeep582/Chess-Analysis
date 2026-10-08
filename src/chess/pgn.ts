import { addMove, createTree, mainline } from './tree';
import { validateFen } from './fen';
import { START_FEN, type GameInfo, type GameTree, type MoveNode, type PgnHeaders } from './types';

export class PgnError extends Error {
  constructor(message: string, public readonly detail?: string) {
    super(message);
    this.name = 'PgnError';
  }
}

export interface ParsedPgn {
  headers: PgnHeaders;
  tree: GameTree;
  warnings: string[];
  gameCount: number;
}

export const MAX_PGN_BYTES = 2_000_000;
export const MAX_PLIES = 1200;

const NAG_SYMBOLS: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const NAG_TEXT: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
const RESULT_RE = /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/;

type Token =
  | { t: 'move'; v: string; nag?: number }
  | { t: 'comment'; v: string }
  | { t: 'nag'; v: number }
  | { t: 'open' }
  | { t: 'close' }
  | { t: 'result'; v: string };

/** Splits a PGN database into individual game texts. */
export function splitGames(text: string): string[] {
  const norm = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  const games: string[] = [];
  let cur: string[] = [];
  let inMoves = false;
  for (const line of norm.split('\n')) {
    const isHeader = /^\s*\[\w+\s+".*"\s*\]\s*$/.test(line);
    if (isHeader && inMoves) {
      games.push(cur.join('\n'));
      cur = [];
      inMoves = false;
    }
    if (!isHeader && line.trim()) inMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games.filter((g) => g.trim());
}

export function parseHeaders(text: string): { headers: PgnHeaders; movetext: string } {
  const headers: PgnHeaders = {};
  const lines = text.split('\n');
  const moveLines: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/);
    if (m) headers[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
    else moveLines.push(line);
  }
  return { headers, movetext: moveLines.filter((l) => !l.startsWith('%')).join('\n') };
}

export function tokenize(movetext: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = movetext;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '{') {
      const end = s.indexOf('}', i + 1);
      const close = end === -1 ? s.length : end;
      tokens.push({ t: 'comment', v: s.slice(i + 1, close).trim() });
      i = close + 1;
      continue;
    }
    if (ch === ';') {
      const end = s.indexOf('\n', i);
      const close = end === -1 ? s.length : end;
      tokens.push({ t: 'comment', v: s.slice(i + 1, close).trim() });
      i = close + 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: 'open' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'close' });
      i++;
      continue;
    }
    if (ch === '$') {
      const m = s.slice(i).match(/^\$(\d+)/);
      if (m) {
        tokens.push({ t: 'nag', v: Number(m[1]) });
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    const m = s.slice(i).match(/^[^\s{}();]+/);
    if (!m) {
      i++;
      continue;
    }
    let word = m[0];
    i += word.length;
    // Strip move numbers such as "12." "12..." possibly glued to the move ("12.e4").
    const num = word.match(/^\d+\.+/);
    if (num) {
      word = word.slice(num[0].length);
      if (!word) continue;
    }
    if (/^\d+$/.test(word)) continue;
    if (RESULT_RE.test(word)) {
      tokens.push({ t: 'result', v: word === '½-½' ? '1/2-1/2' : word });
      continue;
    }
    const suffix = word.match(/(!!|\?\?|!\?|\?!|!|\?)$/);
    let nag: number | undefined;
    if (suffix) {
      nag = NAG_SYMBOLS[suffix[0]];
      word = word.slice(0, -suffix[0].length);
    }
    word = word.replace(/[+#]+$/, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O').replace(/e\.p\.$/, '');
    if (!word) continue;
    tokens.push({ t: 'move', v: word, nag });
  }
  return tokens;
}

function cleanComment(c: string): string {
  return c.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

export function parsePgn(text: string): ParsedPgn {
  if (!text || !text.trim()) throw new PgnError('Please paste a PGN first — the input is empty.');
  if (text.length > MAX_PGN_BYTES) {
    throw new PgnError('This PGN is too large to analyze in the browser.', `Limit is ${(MAX_PGN_BYTES / 1e6).toFixed(0)} MB.`);
  }
  const games = splitGames(text);
  if (!games.length) throw new PgnError('No game was found in the PGN.');
  const warnings: string[] = [];
  if (games.length > 1) warnings.push(`The PGN contains ${games.length} games — the first one was loaded.`);

  const { headers, movetext } = parseHeaders(games[0]);
  let startFen = START_FEN;
  if (headers.FEN) {
    const v = validateFen(headers.FEN);
    if (!v.ok) throw new PgnError('Unable to load this PGN.', `The FEN header is invalid: ${v.error}`);
    startFen = v.fen!;
  }
  let tree = createTree(startFen);
  const tokens = tokenize(movetext);

  // Variation stack: each frame tracks the current node in that line.
  interface Frame {
    current: string;
    /** Node preceding the last move, used as anchor for a following "(". */
    skip: boolean;
  }
  const stack: Frame[] = [{ current: tree.rootId, skip: false }];
  let pendingComment: string | undefined;
  let plies = 0;
  let sawMove = false;

  for (const tok of tokens) {
    const frame = stack[stack.length - 1];
    switch (tok.t) {
      case 'open': {
        const anchorNode = tree.nodes[frame.current];
        const anchor = anchorNode.parentId ?? anchorNode.id;
        stack.push({ current: anchor, skip: frame.skip || !anchorNode.parentId });
        break;
      }
      case 'close':
        if (stack.length > 1) stack.pop();
        break;
      case 'comment': {
        const c = cleanComment(tok.v);
        if (!c || frame.skip) break;
        if (frame.current === tree.rootId && !sawMove) pendingComment = pendingComment ? `${pendingComment} ${c}` : c;
        else {
          const n = tree.nodes[frame.current];
          tree = { ...tree, nodes: { ...tree.nodes, [n.id]: { ...n, comment: n.comment ? `${n.comment} ${c}` : c } } };
        }
        break;
      }
      case 'nag': {
        if (frame.skip) break;
        const n = tree.nodes[frame.current];
        if (n.parentId) tree = { ...tree, nodes: { ...tree.nodes, [n.id]: { ...n, nags: [...(n.nags ?? []), tok.v] } } };
        break;
      }
      case 'result':
        if (stack.length === 1 && !headers.Result) headers.Result = tok.v;
        break;
      case 'move': {
        if (frame.skip) break;
        if (++plies > MAX_PLIES) {
          throw new PgnError('This PGN is too long to analyze.', `Games are limited to ${MAX_PLIES} half-moves including variations.`);
        }
        const res = addMove(tree, frame.current, tok.v, { nags: tok.nag ? [tok.nag] : undefined });
        if (!res) {
          const parent = tree.nodes[frame.current];
          const moveNo = Number(parent.fen.split(' ')[5]) || 1;
          const side = parent.fen.split(' ')[1] === 'w' ? '' : '…';
          if (stack.length === 1) {
            throw new PgnError(
              'Unable to load this PGN.',
              `The move sequence contains an illegal or unreadable move near move ${moveNo}${side}: "${tok.v}".`,
            );
          }
          warnings.push(`A variation near move ${moveNo} contains an illegal move ("${tok.v}") and was truncated.`);
          frame.skip = true;
          break;
        }
        tree = res.tree;
        frame.current = res.nodeId;
        sawMove = true;
        break;
      }
    }
  }
  if (!sawMove && !headers.FEN) throw new PgnError('Unable to load this PGN.', 'No moves were found in the game.');
  if (pendingComment) {
    const root = tree.nodes[tree.rootId];
    tree = { ...tree, nodes: { ...tree.nodes, [root.id]: { ...root, comment: pendingComment } } };
  }
  return { headers, tree, warnings, gameCount: games.length };
}

export function looksLikePgn(text: string): boolean {
  const t = text.trim();
  return /^\s*\[\w+\s+"/.test(t) || /(^|\s)1\.\s*\S/.test(t) || /^[a-hNBRQKO][\w+#=-]*\s+[a-hNBRQKO]/.test(t);
}

export function gameInfo(headers: PgnHeaders): GameInfo {
  const elo = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const clean = (v?: string) => (v && v !== '?' && v !== '????.??.??' ? v : undefined);
  return {
    white: clean(headers.White) ?? 'White',
    black: clean(headers.Black) ?? 'Black',
    whiteElo: elo(headers.WhiteElo),
    blackElo: elo(headers.BlackElo),
    result: headers.Result && headers.Result !== '' ? headers.Result : '*',
    event: clean(headers.Event),
    site: clean(headers.Site),
    date: clean(headers.Date)?.replace(/\.\?\?/g, ''),
    round: clean(headers.Round),
    eco: clean(headers.ECO),
    opening: clean(headers.Opening),
    timeControl: clean(headers.TimeControl),
    termination: clean(headers.Termination),
  };
}

// ---------------------------------------------------------------- export

export interface ExportOptions {
  variations?: boolean;
  comments?: boolean;
  /** Extra annotations per node (e.g. review classifications/evals). */
  annotate?: (node: MoveNode) => { nags?: number[]; comment?: string } | undefined;
}

const SEVEN_TAG = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

function escapeHeader(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function exportPgn(tree: GameTree, headers: PgnHeaders, opts: ExportOptions = {}): string {
  const { variations = true, comments = true, annotate } = opts;
  const h: PgnHeaders = { ...headers };
  for (const k of SEVEN_TAG) if (!h[k]) h[k] = k === 'Result' ? '*' : '?';
  if (tree.startFen !== START_FEN) {
    h.SetUp = '1';
    h.FEN = tree.startFen;
  } else {
    delete h.SetUp;
    delete h.FEN;
  }
  const keys = [...SEVEN_TAG, ...Object.keys(h).filter((k) => !SEVEN_TAG.includes(k))];
  const headerText = keys.map((k) => `[${k} "${escapeHeader(h[k])}"]`).join('\n');

  const out: string[] = [];
  const root = tree.nodes[tree.rootId];
  if (comments && root.comment) out.push(`{${root.comment.replace(/}/g, ')')}}`);

  const emitMove = (node: MoveNode, forceNumber: boolean) => {
    if (node.color === 'w') out.push(`${node.moveNumber}.`);
    else if (forceNumber) out.push(`${node.moveNumber}...`);
    out.push(node.san);
    const extra = annotate?.(node);
    const nags = [...(node.nags ?? []), ...(extra?.nags ?? [])].filter((v, i, a) => a.indexOf(v) === i);
    for (const n of nags) out.push(`$${n}`);
    const cmt = [comments ? node.comment : undefined, extra?.comment].filter(Boolean).join(' ');
    if (cmt) out.push(`{${cmt.replace(/}/g, ')')}}`);
  };

  const emitLine = (startId: string, forceFirst: boolean) => {
    let node: MoveNode | undefined = tree.nodes[startId];
    let force = forceFirst;
    while (node) {
      emitMove(node, force);
      force = false;
      const parent: MoveNode = tree.nodes[node.parentId!];
      // Siblings of this node (alternatives) are emitted after the move.
      if (variations && parent.children[0] === node.id && parent.children.length > 1) {
        for (const alt of parent.children.slice(1)) {
          out.push('(');
          emitLine(alt, true);
          out.push(')');
        }
        force = true;
      }
      const next: string | undefined = node.children[0];
      node = next ? tree.nodes[next] : undefined;
    }
  };

  if (root.children.length) emitLine(root.children[0], true);
  out.push(h.Result || '*');

  // Wrap at 80 columns.
  const lines: string[] = [];
  let line = '';
  for (const tok of out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')').split(' ')) {
    if ((line + ' ' + tok).trim().length > 80) {
      lines.push(line.trim());
      line = tok;
    } else line += ' ' + tok;
  }
  if (line.trim()) lines.push(line.trim());
  return `${headerText}\n\n${lines.join('\n')}\n`;
}

export function nagToText(nag: number): string | undefined {
  return NAG_TEXT[nag];
}

export function mainlineSans(tree: GameTree): string[] {
  return mainline(tree).slice(1).map((id) => tree.nodes[id].san);
}
