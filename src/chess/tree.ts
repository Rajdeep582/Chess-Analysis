import { Chess, type Move } from 'chess.js';
import { fullMoveNumber, sideToMove } from './fen';
import type { GameTree, MoveInput, MoveNode, PieceSymbol } from './types';

export function createTree(startFen: string): GameTree {
  const root: MoveNode = {
    id: 'root',
    parentId: null,
    children: [],
    ply: 0,
    moveNumber: fullMoveNumber(startFen),
    color: sideToMove(startFen),
    san: '',
    uci: '',
    fen: startFen,
  };
  return { rootId: 'root', startFen, nodes: { root }, nextId: 1 };
}

export function moveToUci(m: { from: string; to: string; promotion?: string }): string {
  return `${m.from}${m.to}${m.promotion ?? ''}`;
}

export function uciToMoveInput(uci: string): MoveInput {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: (uci.length > 4 ? uci[4] : undefined) as PieceSymbol | undefined,
  };
}

/** Applies a move (SAN or coordinates) to a FEN. Returns null if illegal. */
export function applyMove(fen: string, move: string | MoveInput, strict = false): { move: Move; fen: string } | null {
  const chess = new Chess(fen);
  try {
    const m = typeof move === 'string' ? chess.move(move, { strict }) : chess.move(move);
    return { move: m, fen: chess.fen() };
  } catch {
    return null;
  }
}

/**
 * Adds a move as a child of `parentId`. If an identical child already exists it is reused.
 * Returns a new tree object (structural sharing) and the id of the resulting node.
 */
export function addMove(
  tree: GameTree,
  parentId: string,
  move: string | MoveInput,
  extra?: { comment?: string; nags?: number[] },
  strict = false,
): { tree: GameTree; nodeId: string } | null {
  const parent = tree.nodes[parentId];
  if (!parent) return null;
  const applied = applyMove(parent.fen, move, strict);
  if (!applied) return null;
  const uci = moveToUci(applied.move);
  const existing = parent.children.find((cid) => tree.nodes[cid].uci === uci);
  if (existing) {
    if (extra?.comment || extra?.nags?.length) {
      const n = tree.nodes[existing];
      const updated = { ...n, comment: extra.comment ?? n.comment, nags: extra.nags?.length ? extra.nags : n.nags };
      return { tree: { ...tree, nodes: { ...tree.nodes, [existing]: updated } }, nodeId: existing };
    }
    return { tree, nodeId: existing };
  }
  const id = `n${tree.nextId}`;
  const node: MoveNode = {
    id,
    parentId,
    children: [],
    ply: parent.ply + 1,
    moveNumber: fullMoveNumber(parent.fen),
    color: sideToMove(parent.fen),
    san: applied.move.san,
    uci,
    fen: applied.fen,
    from: applied.move.from,
    to: applied.move.to,
    promotion: applied.move.promotion as PieceSymbol | undefined,
    piece: applied.move.piece as PieceSymbol,
    captured: applied.move.captured as PieceSymbol | undefined,
    comment: extra?.comment,
    nags: extra?.nags?.length ? extra.nags : undefined,
  };
  const nodes = { ...tree.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } };
  return { tree: { ...tree, nodes, nextId: tree.nextId + 1 }, nodeId: id };
}

/** Node ids of the main line, starting with the root. */
export function mainline(tree: GameTree): string[] {
  const ids: string[] = [];
  let cur: MoveNode | undefined = tree.nodes[tree.rootId];
  while (cur) {
    ids.push(cur.id);
    cur = cur.children.length ? tree.nodes[cur.children[0]] : undefined;
  }
  return ids;
}

export function pathTo(tree: GameTree, id: string): string[] {
  const path: string[] = [];
  let cur: MoveNode | undefined = tree.nodes[id];
  while (cur) {
    path.push(cur.id);
    cur = cur.parentId ? tree.nodes[cur.parentId] : undefined;
  }
  return path.reverse();
}

export function isMainline(tree: GameTree, id: string): boolean {
  let cur = tree.nodes[id];
  while (cur && cur.parentId) {
    const parent = tree.nodes[cur.parentId];
    if (parent.children[0] !== cur.id) return false;
    cur = parent;
  }
  return true;
}

/** The deepest mainline node that is an ancestor of (or equal to) `id`. */
export function mainlineAncestor(tree: GameTree, id: string): string {
  const path = pathTo(tree, id);
  let last = tree.rootId;
  for (const pid of path) {
    if (isMainline(tree, pid)) last = pid;
    else break;
  }
  return last;
}

export function nextNodeId(tree: GameTree, id: string): string | null {
  const n = tree.nodes[id];
  return n && n.children.length ? n.children[0] : null;
}

export function prevNodeId(tree: GameTree, id: string): string | null {
  return tree.nodes[id]?.parentId ?? null;
}

/** Last node following first children from `id`. */
export function lineEnd(tree: GameTree, id: string): string {
  let cur = tree.nodes[id];
  while (cur.children.length) cur = tree.nodes[cur.children[0]];
  return cur.id;
}

/** Removes a node and its whole subtree. */
export function deleteNode(tree: GameTree, id: string): GameTree {
  const node = tree.nodes[id];
  if (!node || !node.parentId) return tree;
  const nodes = { ...tree.nodes };
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    stack.push(...nodes[cur].children);
    delete nodes[cur];
  }
  const parent = nodes[node.parentId];
  nodes[node.parentId] = { ...parent, children: parent.children.filter((c) => c !== id) };
  return { ...tree, nodes };
}

/** Moves the branch containing `id` one step towards being the main continuation at each fork. */
export function promoteVariation(tree: GameTree, id: string): GameTree {
  const nodes = { ...tree.nodes };
  let cur = nodes[id];
  while (cur && cur.parentId) {
    const parent = nodes[cur.parentId];
    const idx = parent.children.indexOf(cur.id);
    if (idx > 0) {
      const children = [...parent.children];
      children.splice(idx, 1);
      children.unshift(cur.id);
      nodes[parent.id] = { ...parent, children };
      return { ...tree, nodes };
    }
    cur = parent;
  }
  return tree;
}

export function treeFromMoves(startFen: string, moves: string[]): GameTree {
  let tree = createTree(startFen);
  let parent = tree.rootId;
  for (const mv of moves) {
    const res = addMove(tree, parent, /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(mv) ? uciToMoveInput(mv) : mv);
    if (!res) throw new Error(`Illegal move ${mv}`);
    tree = res.tree;
    parent = res.nodeId;
  }
  return tree;
}

export function moveLabel(node: MoveNode): string {
  if (!node.san) return 'Start';
  return node.color === 'w' ? `${node.moveNumber}. ${node.san}` : `${node.moveNumber}… ${node.san}`;
}
