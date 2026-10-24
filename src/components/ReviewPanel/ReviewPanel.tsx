import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { gameInfo } from '../../chess/pgn';
import { formatScore } from '../../engine/evalUtils';
import { CLASS_LABEL } from '../../review/criticalMoments';
import { CLASSIFICATION_ORDER, NEGATIVE_CLASSES, type MoveClassification } from '../../review/types';
import { useApp, useController } from '../../state/context';
import { REVIEW_STRENGTH, type ReviewStrength, engineModeOf, maxThreads } from '../../state/settings';
import { autoHashMb, autoThreads } from '../../engine/StockfishManager';
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


const HASH_STEPS = [16, 32, 64, 128, 256, 512];
function maxHashStep(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mem !== undefined && mem < 4 ? 128 : mem !== undefined && mem >= 8 ? 512 : 256;
}

/** Slider that shows its value live but only commits (restarting the engine) once the user lets go. */
function useCommitted(value: number, commit: (v: number) => void) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(value), [value]);
  const change = (v: number) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), 450);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return [draft, change] as const;
}

/** Compact engine configuration for reviews (Lichess-style): CPU threads, memory, review depth, engine lines. */
function ReviewEngineConfig({ disabled }: { disabled: boolean }) {
  const c = useController();
  const eng = useApp((s) => s.settings.engine);
  const strength = useApp((s) => s.settings.review.strength);
  const info = useApp((s) => s.engine.info);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('nocturne64.reviewConfigOpen') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem('nocturne64.reviewConfigOpen', o ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !o;
    });
  };
  const cores = maxThreads();
  const multi = c.engine.supportsThreads;
  const threadsNow = multi ? (eng.threads === 'auto' ? autoThreads() : eng.threads) : 1;
  const hashNow = eng.hash === 'auto' ? autoHashMb() : eng.hash;
  const hashMax = maxHashStep();
  const hashSteps = HASH_STEPS.filter((h) => h <= hashMax);
  const hashIdx = Math.max(0, hashSteps.findIndex((h) => h >= hashNow));

  const [threads, setThreads] = useCommitted(threadsNow, (v) => c.updateSettings((s) => ({ ...s, engine: { ...s.engine, threads: v } })));
  const [hashI, setHashI] = useCommitted(hashIdx, (i) => c.updateSettings((s) => ({ ...s, engine: { ...s.engine, hash: hashSteps[i] } })));
  const [lines, setLines] = useCommitted(eng.multipv, (v) => c.updateSettings((s) => ({ ...s, engine: { ...s.engine, multipv: v } })));
  const pct = (v: number, min: number, max: number) => `${max > min ? ((v - min) / (max - min)) * 100 : 100}%`;

  return (
    <div className={`rcfg ${open ? 'open' : ''}`}>
      <button type="button" className="rcfg-head" aria-expanded={open} onClick={toggle}>
        <Icon name="settings" size={15} />
        <span className="rcfg-chips">
          <span>{threads} CPU</span>
          <span>{hashSteps[hashI] ?? hashNow} MB</span>
          <span>{REVIEW_STRENGTH[strength].label}</span>
          <span>{lines} lines</span>
        </span>
        <span className="rcfg-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="rcfg-body">
          <label className="rcfg-row">
            <span className="rcfg-label">
              Threads <em>{threads} / {cores}</em>
            </span>
            <input
              type="range"
              min={1}
              max={multi ? cores : 1}
              value={threads}
              disabled={disabled || !multi}
              style={{ ['--fill' as string]: pct(threads, 1, multi ? cores : 1) }}
              onChange={(e) => setThreads(Number(e.target.value))}
              aria-label="CPU threads"
            />
          </label>
          {!multi && <p className="rcfg-note">This host isn't cross-origin isolated, so the engine runs single-threaded.</p>}
          <label className="rcfg-row">
            <span className="rcfg-label">
              Memory <em>{hashSteps[hashI]} MB</em>
            </span>
            <input
              type="range"
              min={0}
              max={hashSteps.length - 1}
              step={1}
              value={hashI}
              disabled={disabled}
              style={{ ['--fill' as string]: pct(hashI, 0, hashSteps.length - 1) }}
              onChange={(e) => setHashI(Number(e.target.value))}
              aria-label="Engine memory (hash)"
            />
          </label>
          <label className="rcfg-row">
            <span className="rcfg-label">
              Lines <em>{lines}</em>
            </span>
            <input
              type="range"
              min={1}
              max={5}
              value={lines}
              style={{ ['--fill' as string]: pct(lines, 1, 5) }}
              onChange={(e) => setLines(Number(e.target.value))}
              aria-label="Engine lines (MultiPV)"
            />
          </label>
          <div className="rcfg-row">
            <span className="rcfg-label">Depth</span>
            <div className="rcfg-seg" role="radiogroup" aria-label="Review depth">
              {(Object.keys(REVIEW_STRENGTH) as ReviewStrength[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={strength === k}
                  className={strength === k ? 'active' : ''}
                  disabled={disabled}
                  onClick={() => c.updateSettings((s) => ({ ...s, review: { ...s.review, strength: k } }))}
                  title={`Scan depth ${REVIEW_STRENGTH[k].quickDepth}, critical moves depth ${REVIEW_STRENGTH[k].deepDepth}`}
                >
                  {REVIEW_STRENGTH[k].label}
                  <small>
                    {REVIEW_STRENGTH[k].quickDepth}→{REVIEW_STRENGTH[k].deepDepth}
                  </small>
                </button>
              ))}
            </div>
          </div>
          <p className="rcfg-note">
            {info ? `${info.name} · ${info.flavor.endsWith('-multi') ? 'multi-threaded' : 'single-threaded'} · ${info.threads}T · ${info.hashMb} MB` : 'Engine starting…'}
            {disabled ? ' · locked during review' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

/** Lite / Max engine switch shown at the top of the review panel on every screen size. */
function EngineModeToggle({ reviewEngine }: { reviewEngine?: string }) {
  const c = useController();
  const mode = useApp((s) => engineModeOf(s.settings));
  const running = useApp((s) => !!s.reviewProgress);
  const status = useApp((s) => s.engine.status);
  const flavor = useApp((s) => s.engine.info?.flavor);
  const fellBack = mode === 'max' && status !== 'loading' && !!flavor && !flavor.startsWith('full');
  const reviewMode = reviewEngine ? (/lite|asm/i.test(reviewEngine) ? 'lite' : 'max') : null;
  return (
    <div className="engine-mode-wrap">
      <div className="engine-mode" role="radiogroup" aria-label="Review engine">
        {(['lite', 'max'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`em-opt ${m} ${mode === m ? 'active' : ''}`}
            disabled={running}
            title={
              running
                ? 'Available when the review finishes'
                : m === 'lite'
                  ? 'Stockfish 19 Lite (1.7 MB net): fast reviews'
                  : 'Stockfish 19 full NNUE, every CPU thread, larger hash, Thorough review depth'
            }
            onClick={() => c.setEngineMode(m)}
          >
            <Icon name={m === 'lite' ? 'bolt' : 'power'} size={16} />
            <span>
              <b>{m === 'lite' ? 'Lite' : 'Max'}</b>
              <small>
                {m === 'lite'
                  ? 'Fast · light net'
                  : mode === 'max' && status === 'loading'
                    ? 'Loading…'
                    : 'Strongest · full'}
              </small>
            </span>
          </button>
        ))}
      </div>
      <ReviewEngineConfig disabled={running} />
      {fellBack && <p className="em-note">The full engine could not load on this device, so Lite is running instead.</p>}
      {reviewMode && reviewMode !== mode && !running && (
        <div className="em-note action">
          <span>This review used {reviewMode === 'max' ? 'Max' : 'Lite'}.</span>
          <button type="button" className="btn small" onClick={() => void c.startReview()}>
            Re-run with {mode === 'max' ? 'Max' : 'Lite'}
          </button>
        </div>
      )}
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
  const showKey = useApp((s) => s.settings.review.showKeyMoves);
  const moveCount = useApp((s) => Object.keys(s.tree.nodes).length - 1);
  const info = useMemo(() => gameInfo(headers), [headers]);

  const current = useMemo(() => review?.moves.find((m) => m.nodeId === currentId) ?? null, [review, currentId]);
  const retryCount = useMemo(() => review?.moves.filter((m) => NEGATIVE_CLASSES.includes(m.classification) && m.classification !== 'inaccuracy').length ?? 0, [review]);

  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <section className="panel review-panel" aria-label="Game review" aria-busy="true">
        <EngineModeToggle />
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
        <EngineModeToggle />
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
      <EngineModeToggle reviewEngine={review.engine} />
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
                const st = review.strength?.[col] ?? null;
                const elo = st?.elo ?? review.estimatedElo![col];
                const oppElo = col === 'w' ? info.blackElo : info.whiteElo;
                const ownElo = col === 'w' ? info.whiteElo : info.blackElo;
                const acpl = review.acpl?.[col];
                return (
                  <div key={col} className={`elo-card side-${col}`}>
                    <div className="elo-who">
                      <span className={`side-chip ${col}`} aria-hidden="true" />
                      <span>{col === 'w' ? info.white : info.black}</span>
                    </div>
                    <div className="elo-caption">Played like</div>
                    <div className="elo-value">{elo ?? '—'}</div>
                    {st && (
                      <div className="elo-range">
                        {st.low}–{st.high}
                      </div>
                    )}
                    <div className="elo-band">{elo ? eloBand(elo) : 'Too few moves'}</div>
                    <div className="elo-basis">
                      {st?.method === 'rating' && ownElo
                        ? `rated ${ownElo} · ${review.accuracy[col]?.toFixed(1) ?? '—'}% accuracy`
                        : st?.method === 'performance' && oppElo
                          ? `vs ${oppElo}-rated opponent · ${review.accuracy[col]?.toFixed(1) ?? '—'}% accuracy`
                          : `${review.accuracy[col]?.toFixed(1) ?? '—'}% accuracy${acpl !== null && acpl !== undefined ? ` · ${Math.round(acpl)} avg cp loss` : ''}`}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="muted tiny estimate-note">
              {review.strength?.w?.method === 'rating' || review.strength?.b?.method === 'rating'
                ? 'Game rating: your engine move quality (accuracy, best-move match, blunders, centipawn loss) compared with what your rating level normally plays — the approach Chess.com describes. Calibrated on 748 rated Chess.com player-games; averages out to your real rating over many games.'
                : review.strength?.w?.method === 'performance' || review.strength?.b?.method === 'performance'
                  ? 'Performance estimate: opponent rating + result + your engine move quality relative to that level (typical error ≈ 110 Elo).'
                  : 'No ratings in the PGN, so this comes from engine move quality alone (accuracy, best-move match, blunders, centipawn loss). One game is a weak signal — typical error ≈ 490 Elo, hence the wide range.'}
            </p>
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
                      const n = review.phaseMoves?.[col][ph];
                      return (
                        <td key={col}>
                          {v === null ? (
                            <div className="phase-cell na">—</div>
                          ) : (
                            <div
                              className={`phase-cell ${n !== undefined && n < 3 ? 'few' : ''}`}
                              style={{ ['--pc' as string]: phaseColor(v) }}
                              title={n !== undefined ? `${n} move${n === 1 ? '' : 's'} in this phase` : undefined}
                            >
                              <i style={{ width: `${v}%` }} />
                              <b>{v.toFixed(1)}</b>
                              {n !== undefined && <small>{n}</small>}
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
