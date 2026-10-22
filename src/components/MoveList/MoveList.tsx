import { memo, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { mainline } from '../../chess/tree';
import type { GameTree, MoveNode } from '../../chess/types';
import { nagToText } from '../../chess/pgn';
import type { MoveReview } from '../../review/types';
import { useApp, useController } from '../../state/context';
import { ClassificationIcon } from '../ClassificationBadge/ClassificationBadge';
import { Icon } from '../common/Icon';

function MoveButton({ node, current, review, showCls, onClick, withNumber }: { node: MoveNode; current: boolean; review?: MoveReview; showCls: boolean; onClick: (id: string) => void; withNumber?: boolean }) {
  const nags = (node.nags ?? []).map(nagToText).filter(Boolean).join('');
  return (
    <button
      type="button"
      className={`mv ${current ? 'current' : ''} ${review && showCls ? `cls-${review.classification}` : ''}`}
      data-node={node.id}
      aria-current={current ? 'true' : undefined}
      onClick={() => onClick(node.id)}
    >
      {withNumber && <span className="mv-num">{node.color === 'w' ? `${node.moveNumber}.` : `${node.moveNumber}…`}</span>}
      <span className="mv-san">{node.san}</span>
      {nags && <span className="mv-nag">{nags}</span>}
      {review && showCls && (
        <ClassificationIcon c={review.classification} size={14} />
      )}
    </button>
  );
}

function Variation({ tree, startId, currentId, onClick, depth }: { tree: GameTree; startId: string; currentId: string; onClick: (id: string) => void; depth: number }) {
  const items: ReactElement[] = [];
  let node: MoveNode | undefined = tree.nodes[startId];
  let first = true;
  while (node) {
    const parent: MoveNode = tree.nodes[node.parentId!];
    items.push(<MoveButton key={node.id} node={node} current={node.id === currentId} showCls={false} onClick={onClick} withNumber={first || node.color === 'w'} />);
    first = false;
    if (node.id !== startId && parent.children[0] === node.id && parent.children.length > 1) {
      for (const alt of parent.children.slice(1)) {
        items.push(<Variation key={`v-${alt}`} tree={tree} startId={alt} currentId={currentId} onClick={onClick} depth={depth + 1} />);
      }
      first = true;
    }
    node = node.children[0] ? tree.nodes[node.children[0]] : undefined;
  }
  return <span className={`variation depth-${Math.min(depth, 3)}`}>{items}</span>;
}

function MoveListImpl() {
  const c = useController();
  const tree = useApp((s) => s.tree);
  const currentId = useApp((s) => s.currentId);
  const review = useApp((s) => s.review);
  const showCls = useApp((s) => s.settings.review.showClassifications);
  const headers = useApp((s) => s.headers);
  const scroller = useRef<HTMLDivElement>(null);

  const reviewByNode = useMemo(() => new Map((review?.moves ?? []).map((m) => [m.nodeId, m])), [review]);
  const ml = useMemo(() => mainline(tree), [tree]);
  const onClick = (id: string) => c.goTo(id);

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-node="${currentId}"]`);
    const box = scroller.current;
    if (!el || !box) return;
    // Position relative to the scroller itself (independent of offsetParent).
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop + 8 || top > box.scrollTop + box.clientHeight - 40) {
      const smooth = !document.documentElement.classList.contains('reduce-motion');
      box.scrollTo({ top: top - box.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
    }
  }, [currentId]);

  const rows: ReactElement[] = [];
  const root = tree.nodes[tree.rootId];
  const pushVariations = (parent: MoveNode, key: string) => {
    if (parent.children.length > 1) {
      rows.push(
        <div className="var-row" key={key}>
          {parent.children.slice(1).map((alt) => (
            <Variation key={alt} tree={tree} startId={alt} currentId={currentId} onClick={onClick} depth={1} />
          ))}
        </div>,
      );
    }
  };
  if (root.comment) rows.push(<div className="mv-comment" key="rc">{root.comment}</div>);
  let i = 1;
  while (i < ml.length) {
    const a = tree.nodes[ml[i]];
    const parentA = tree.nodes[a.parentId!];
    const altsA = parentA.children.length > 1;
    const rv = (n: MoveNode) => (
      <MoveButton node={n} current={n.id === currentId} review={reviewByNode.get(n.id)} showCls={showCls} onClick={onClick} />
    );
    if (a.color === 'w') {
      const b = i + 1 < ml.length ? tree.nodes[ml[i + 1]] : null;
      const showB = !!b && !a.comment && !altsA;
      rows.push(
        <div className="mv-row" key={a.id}>
          <span className="mv-no">{a.moveNumber}.</span>
          {rv(a)}
          {showB ? rv(b!) : <span className="mv-gap" />}
        </div>,
      );
      if (a.comment) rows.push(<div className="mv-comment" key={`c-${a.id}`}>{a.comment}</div>);
      if (altsA) pushVariations(parentA, `v-${a.id}`);
      if (showB) {
        if (b!.comment) rows.push(<div className="mv-comment" key={`c-${b!.id}`}>{b!.comment}</div>);
        if (a.children.length > 1) pushVariations(a, `v-${b!.id}`);
        i += 2;
      } else i += 1;
    } else {
      rows.push(
        <div className="mv-row" key={a.id}>
          <span className="mv-no">{a.moveNumber}.</span>
          <span className="mv-gap">…</span>
          {rv(a)}
        </div>,
      );
      if (a.comment) rows.push(<div className="mv-comment" key={`c-${a.id}`}>{a.comment}</div>);
      if (altsA) pushVariations(parentA, `v-${a.id}`);
      i += 1;
    }
  }
  const result = headers.Result && headers.Result !== '*' ? headers.Result : null;

  return (
    <div className="movelist" ref={scroller} role="list" aria-label="Moves">
      {ml.length === 1 && root.children.length === 0 ? (
        <div className="empty">
          <Icon name="info" />
          <p>No moves yet. Play a move on the board to start exploring.</p>
        </div>
      ) : (
        rows
      )}
      {result && <div className="mv-result">{result}</div>}
    </div>
  );
}

export const MoveList = memo(MoveListImpl);
