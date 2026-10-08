import { memo, useEffect, useMemo, useRef } from 'react';
import { mainline, pathTo } from '../../chess/tree';
import { useApp, useController } from '../../state/context';
import { ClassificationIcon } from '../ClassificationBadge/ClassificationBadge';

/** Compact, horizontally scrolling move line shown under the board on phones and tablets. */
function MoveStripImpl() {
  const c = useController();
  const tree = useApp((s) => s.tree);
  const currentId = useApp((s) => s.currentId);
  const review = useApp((s) => s.review);
  const showCls = useApp((s) => s.settings.review.showClassifications);
  const ref = useRef<HTMLDivElement>(null);

  // Show the line that contains the current move (main line, or the variation being explored).
  const ids = useMemo(() => {
    const path = pathTo(tree, currentId);
    let line = path;
    let cur = tree.nodes[currentId];
    while (cur?.children.length) {
      cur = tree.nodes[cur.children[0]];
      line = [...line, cur.id];
    }
    return line.length > 1 ? line.slice(1) : mainline(tree).slice(1);
  }, [tree, currentId]);
  const byNode = useMemo(() => new Map((review?.moves ?? []).map((m) => [m.nodeId, m])), [review]);

  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!box) return;
    if (!el) {
      box.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [currentId]);

  if (!ids.length) return null;
  return (
    <div className="move-strip" ref={ref} role="list" aria-label="Moves">
      {ids.map((id) => {
        const n = tree.nodes[id];
        const r = byNode.get(id);
        const cur = id === currentId;
        return (
          <button
            key={id}
            type="button"
            role="listitem"
            className={`ms-move ${cur ? 'current' : ''}`}
            aria-current={cur ? 'true' : undefined}
            onClick={() => c.goTo(id)}
          >
            {n.color === 'w' && <span className="ms-num">{n.moveNumber}.</span>}
            {n.san}
            {r && showCls && <ClassificationIcon c={r.classification} size={13} />}
          </button>
        );
      })}
    </div>
  );
}

export const MoveStrip = memo(MoveStripImpl);
