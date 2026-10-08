import { memo, useMemo } from 'react';
import { gameInfo } from '../../chess/pgn';
import { formatScore } from '../../engine/evalUtils';
import { CLASS_LABEL } from '../../review/criticalMoments';
import { CLASSIFICATION_ORDER, NEGATIVE_CLASSES, type MoveClassification } from '../../review/types';
import { useApp, useController } from '../../state/context';
import { REVIEW_STRENGTH, type ReviewStrength } from '../../state/settings';
import { ClassificationBadge, ClassificationIcon, CLASS_COLOR } from '../ClassificationBadge/ClassificationBadge';
import { Icon } from '../common/Icon';
import { revealBoard } from '../../utils/download';
import { eloBand } from '../../review/elo';

function phaseColor(v: number): string {
  if (v >= 90) return 'var(--c-best)';
  if (v >= 80) return 'var(--c-excellent)';
  if (v >= 70) return 'var(--c-inaccuracy)';
  if (v >= 55) return 'var(--c-mistake)';
  return 'var(--c-blunder)';
}

const VERB: Record<MoveClassification, string> = {
  brilliant: 'is brilliant',
  great: 'is a great move',
  best: 'is best',
  excellent: 'is excellent',
  good: 'is good',
  book: 'is a book move',
  inaccuracy: 'is an inaccuracy',
  mistake: 'is a mistake',
  miss: 'is a miss',
  blunder: 'is a blunder',
};

function AccuracyCard({ name, rating, value, color }: { name: string; rating?: number; value: number | null; color: 'w' | 'b' }) {
  return (
    <div className={`acc-card side-${color}`}>
      <div className="acc-who">
        <span className={`side-chip ${color}`} aria-hidden="true" />
        <span className="acc-name" title={name}>
          {name}
        </span>
        {rating ? <span className="muted small">{rating}</span> : null}
      </div>
      <div className="acc-value">
        {value === null ? '—' : value.toFixed(1)}
        <small>accuracy</small>
      </div>
      <div className="acc-meter" aria-hidden="true">
        <span style={{ width: `${value ?? 0}%` }} />
      </div>
    </div>
  );
}

function RetryCard() {
  const c = useController();
  const retry = useApp((s) => s.retry)!;
  const side = retry.fenBefore.split(' ')[1] === 'w' ? 'White' : 'Black';
  return (
    <div className={`retry-card status-${retry.status}`} role="region" aria-label="Retry mistake">
      <div className="retry-head">
        <ClassificationIcon c={retry.classification} size={22} />
        <div>
          <div className="retry-title">
            You played <b>{retry.playedSan}</b>
          </div>
          <div className="muted small">Find a better move for {side}.</div>
        </div>
      </div>
      <div className="retry-body" aria-live="polite">
        {retry.status === 'waiting' && <p>Make a move on the board.</p>}
        {retry.status === 'checking' && (
          <p className="checking">
            <span className="spinner" aria-hidden="true" /> {retry.message}
          </p>
        )}
        {retry.status === 'correct' && (
          <p className="ok">
            <Icon name="check" size={18} /> <b>Correct!</b> {retry.message}
          </p>
        )}
        {retry.status === 'incorrect' && <p className="bad">{retry.message}</p>}
      </div>
      <div className="retry-actions">
        {(retry.status === 'incorrect' || retry.status === 'correct') && !retry.revealed && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              c.retryAgain();
              revealBoard();
            }}
          >
            Try again
          </button>
        )}
        {retry.status !== 'correct' && !retry.revealed && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              c.revealSolution();
              revealBoard();
            }}
          >
            Show solution
          </button>
        )}
        <button
          type="button"
          className="btn small primary"
          onClick={() => {
            c.nextRetry();
            revealBoard();
          }}
        >
          Next mistake
        </button>
        <button type="button" className="btn small ghost" onClick={() => c.exitRetry()}>
          Exit
        </button>
      </div>
    </div>
  );
}

function ReviewPanelImpl() {
  const c = useController();
  const review = useApp((s) => s.review);
  const progress = useApp((s) => s.reviewProgress);
  const error = useApp((s) => s.reviewError);
  const stale = useApp((s) => s.reviewStale);
  const retry = useApp((s) => s.retry);
  const currentId = useApp((s) => s.currentId);
  const headers = useApp((s) => s.headers);
  const strength = useApp((s) => s.settings.review.strength);
  const showKey = useApp((s) => s.settings.review.showKeyMoves);
  const moveCount = useApp((s) => Object.keys(s.tree.nodes).length - 1);
  const info = useMemo(() => gameInfo(headers), [headers]);

  const current = useMemo(() => review?.moves.find((m) => m.nodeId === currentId) ?? null, [review, currentId]);
  const retryCount = useMemo(() => review?.moves.filter((m) => NEGATIVE_CLASSES.includes(m.classification) && m.classification !== 'inaccuracy').length ?? 0, [review]);

  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <section className="panel review-panel" aria-label="Game review" aria-busy="true">
        <div className="review-running">
          <div className="review-phase">
            <span className="phase-steps" aria-hidden="true">
              <i className={progress.phase === 'quick' ? 'active' : 'done'} />
              <i className={progress.phase === 'deep' ? 'active' : progress.phase === 'finalizing' ? 'done' : ''} />
              <i className={progress.phase === 'finalizing' ? 'active' : ''} />
            </span>
            <b>{progress.phase === 'quick' ? 'Phase 1 · Scan' : progress.phase === 'deep' ? 'Phase 2 · Deep check' : 'Phase 3 · Classify'}</b>
          </div>
          <p className="muted">{progress.label}</p>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="row between small muted">
            <span>
              {progress.done} / {progress.total} positions
            </span>
            <span>Running locally on your device</span>
          </div>
          <button type="button" className="btn ghost small" onClick={() => c.cancelReview()}>
            Cancel review
          </button>
        </div>
      </section>
    );
  }

  if (!review) {
    return (
      <section className="panel review-panel" aria-label="Game review">
        <div className="review-cta">
          <div className="cta-art" aria-hidden="true">
            {(['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'blunder'] as MoveClassification[]).map((k) => (
              <ClassificationIcon key={k} c={k} size={26} />
            ))}
          </div>
          <h3>Game Review</h3>
          <p className="muted">
            Stockfish analyzes every position on your device, then classifies each move, computes accuracy and finds the key moments. Mistakes become
            retry puzzles.
          </p>
          <div className="seg" role="radiogroup" aria-label="Review strength">
            {(Object.keys(REVIEW_STRENGTH) as ReviewStrength[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={strength === k}
                className={strength === k ? 'active' : ''}
                onClick={() => c.updateSettings((s) => ({ ...s, review: { ...s.review, strength: k } }))}
              >
                {REVIEW_STRENGTH[k].label}
                <small>
                  d{REVIEW_STRENGTH[k].quickDepth}→{REVIEW_STRENGTH[k].deepDepth}
                </small>
              </button>
            ))}
          </div>
          <button type="button" className="btn primary big" onClick={() => void c.startReview()} disabled={moveCount === 0}>
            <Icon name="star" /> Review game <kbd>R</kbd>
          </button>
          {moveCount === 0 && <p className="muted small">Load a game or play some moves first.</p>}
          {error && (
            <div className="callout error" role="alert">
              {error}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="panel review-panel" aria-label="Game review">
      {stale && (
        <div className="callout info">
          <span>New main-line moves were added after the review.</span>
          <button type="button" className="btn small" onClick={() => void c.startReview()}>
            Re-run
          </button>
        </div>
      )}
      {retry && <RetryCard />}

      {!retry && current && (
        <div className="move-card" style={{ ['--cls' as string]: CLASS_COLOR[current.classification] }}>
          <div className="move-card-head">
            <ClassificationIcon c={current.classification} size={26} />
            <div>
              <div className="move-card-title">
                <b>
                  {current.moveNumber}
                  {current.color === 'w' ? '.' : '…'} {current.san}
                </b>{' '}
                {VERB[current.classification]}
              </div>
              <div className="muted small">
                {formatScore(current.evaluationBefore)} → {formatScore(current.evaluationAfter)} · depth {Math.min(current.depthBefore, current.depthAfter)}
                {current.evaluationLoss > 0.0005 && ` · −${(current.evaluationLoss * 100).toFixed(1)}% expected points`}
              </div>
            </div>
          </div>
          {current.explanation && (
            <div className="explanation">
              {current.explanation.split('\n').map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
          <div className="move-card-actions">
            {current.bestMoveSan && current.bestMoveSan !== current.san && (
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  const node = c.state.tree.nodes[current.nodeId];
                  if (node.parentId) c.goTo(node.parentId);
                }}
              >
                <Icon name="undo" size={14} /> Position before
              </button>
            )}
            {NEGATIVE_CLASSES.includes(current.classification) && current.classification !== 'inaccuracy' && (
              <button type="button" className="btn small primary" onClick={() => {
                  c.startRetry(review.moves.indexOf(current));
                  revealBoard();
                }}>
                <Icon name="target" size={14} /> Retry
              </button>
            )}
          </div>
        </div>
      )}

      <div className="acc-grid">
        <AccuracyCard name={info.white} rating={info.whiteElo} value={review.accuracy.w} color="w" />
        <AccuracyCard name={info.black} rating={info.blackElo} value={review.accuracy.b} color="b" />
      </div>

      {review.opening && (
        <div className="opening-line">
          <span className="eco">{review.opening.eco}</span> {review.opening.name}
        </div>
      )}

      <table className="cls-table">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Classification</span>
            </th>
            <th scope="col">White</th>
            <th scope="col">Black</th>
          </tr>
        </thead>
        <tbody>
          {CLASSIFICATION_ORDER.map((k) => (
            <tr key={k} className={review.stats.w[k] + review.stats.b[k] === 0 ? 'zero' : ''}>
              <th scope="row">
                <ClassificationBadge c={k} />
              </th>
              <td>{review.stats.w[k]}</td>
              <td>{review.stats.b[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {retryCount > 0 && !retry && (
        <button
          type="button"
          className="btn wide"
          onClick={() => {
            c.startRetry();
            revealBoard();
          }}
        >
          <Icon name="target" /> Retry mistakes ({retryCount})
        </button>
      )}

      {showKey && (
        <div className="moments">
          <h4>Key moments</h4>
          {review.keyMoments.length === 0 && <p className="muted small">No critical moments — a clean game.</p>}
          <ul>
            {review.keyMoments.map((k) => (
              <li key={k.nodeId}>
                <button type="button" className={`moment ${k.nodeId === currentId ? 'current' : ''}`} onClick={() => {
                    c.goTo(k.nodeId);
                    revealBoard();
                  }}
                >
                  {k.kind === 'turning-point' ? <span className="tp-icon" aria-hidden="true">⇅</span> : <ClassificationIcon c={k.classification} size={18} />}
                  <span className="moment-move">
                    {k.moveNumber}
                    {k.color === 'w' ? '.' : '…'} {k.san}
                  </span>
                  <span className="moment-title">{k.kind === 'turning-point' ? 'Turning point' : CLASS_LABEL[k.classification]}</span>
                  <span className="moment-eval">
                    {k.evalBefore} → {k.evalAfter}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="summary">
        {review.estimatedElo && (
          <>
            <h4>Estimated playing strength</h4>
            <div className="elo-cards">
              {(['w', 'b'] as const).map((col) => {
                const elo = review.estimatedElo![col];
                return (
                  <div key={col} className={`elo-card side-${col}`}>
                    <div className="elo-who">
                      <span className={`side-chip ${col}`} aria-hidden="true" />
                      <span>{col === 'w' ? info.white : info.black}</span>
                    </div>
                    <div className="elo-caption">Played like</div>
                    <div className="elo-value">{elo ?? '—'}</div>
                    <div className="elo-band">{elo ? eloBand(elo) : 'Too few moves'}</div>
                  </div>
                );
              })}
            </div>
            <p className="muted tiny estimate-note">Single-game estimate from accuracy — not an official rating.</p>
          </>
        )}
        {review.phaseAccuracy && (
          <>
            <h4>Accuracy by phase</h4>
            <table className="phase-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Phase</span>
                  </th>
                  <th scope="col">White</th>
                  <th scope="col">Black</th>
                </tr>
              </thead>
              <tbody>
                {(['opening', 'middlegame', 'endgame'] as const).map((ph) => (
                  <tr key={ph}>
                    <th scope="row">{ph === 'opening' ? 'Opening' : ph === 'middlegame' ? 'Middlegame' : 'Endgame'}</th>
                    {(['w', 'b'] as const).map((col) => {
                      const v = review.phaseAccuracy![col][ph];
                      return (
                        <td key={col}>
                          {v === null ? (
                            <div className="phase-cell na">—</div>
                          ) : (
                            <div className="phase-cell" style={{ ['--pc' as string]: phaseColor(v) }}>
                              <i style={{ width: `${v}%` }} />
                              <b>{v.toFixed(1)}</b>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h4>Summary</h4>
        <ul>
          {review.summary.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <h4>Improvement areas</h4>
        <div className="improve">
          {(['w', 'b'] as const).map((col) => (
            <div key={col}>
              <b>{col === 'w' ? info.white : info.black}</b>
              <ul>
                {review.improvementAreas[col].length ? review.improvementAreas[col].map((x, i) => <li key={i}>{x}</li>) : <li className="muted">—</li>}
              </ul>
            </div>
          ))}
        </div>
        <p className="muted tiny">
          {review.engine} · scan depth {review.settings.quickDepth}, critical positions depth {review.settings.deepDepth}. Classifications come from an
          independent expected-points model.
        </p>
      </div>
      <button type="button" className="btn ghost small" onClick={() => void c.startReview()}>
        Run review again
      </button>
    </section>
  );
}

export const ReviewPanel = memo(ReviewPanelImpl);
