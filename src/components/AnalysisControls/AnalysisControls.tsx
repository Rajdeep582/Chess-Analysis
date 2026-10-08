import { useApp, useController } from '../../state/context';
import { Icon } from '../common/Icon';

export function AnalysisControls() {
  const c = useController();
  const atStart = useApp((s) => s.currentId === s.tree.rootId);
  const atEnd = useApp((s) => s.tree.nodes[s.currentId].children.length === 0);
  const autoplay = useApp((s) => s.autoplay);
  const arrows = useApp((s) => s.settings.board.showArrows);
  return (
    <div className="controls" role="toolbar" aria-label="Move navigation">
      <button type="button" className="ctl" onClick={() => c.flip()} aria-label="Flip board (F)" data-tip="Flip board · F">
        <Icon name="flip" />
      </button>
      <div className="ctl-group">
        <button type="button" className="ctl" onClick={() => c.first()} disabled={atStart} aria-label="Start position (Home)" data-tip="Start · Home">
          <Icon name="first" />
        </button>
        <button type="button" className="ctl" onClick={() => c.prev()} disabled={atStart} aria-label="Previous move (Left arrow)" data-tip="Previous · ←">
          <Icon name="prev" />
        </button>
        <button type="button" className={`ctl play ${autoplay ? 'on' : ''}`} onClick={() => c.toggleAutoplay()} aria-label={autoplay ? 'Pause (Space)' : 'Play through moves (Space)'} data-tip={autoplay ? 'Pause · Space' : 'Play · Space'}>
          <Icon name={autoplay ? 'pause' : 'play'} />
        </button>
        <button type="button" className="ctl" onClick={() => c.next()} disabled={atEnd} aria-label="Next move (Right arrow)" data-tip="Next · →">
          <Icon name="next" />
        </button>
        <button type="button" className="ctl" onClick={() => c.last()} disabled={atEnd} aria-label="Last move (End)" data-tip="End · End">
          <Icon name="last" />
        </button>
      </div>
      <button
        type="button"
        className={`ctl ${arrows ? 'on' : ''}`}
        aria-pressed={arrows}
        onClick={() => c.updateSettings((s) => ({ ...s, board: { ...s.board, showArrows: !s.board.showArrows } }))}
        aria-label="Toggle engine arrows (A)"
        data-tip="Engine arrows · A"
      >
        <Icon name="arrows" />
      </button>
    </div>
  );
}
