import { memo, useMemo } from 'react';
import { uciLineToSan } from '../../chess/uci';
import { formatAnalysisEval, formatNodes, formatScore } from '../../engine/evalUtils';
import type { EngineAnalysis } from '../../engine/types';
import { useApp, useController } from '../../state/context';
import { DEPTH_PRESETS, type DepthPreset } from '../../state/settings';
import { Icon } from '../common/Icon';
import { HelpDot } from '../common/Tooltip';

const DEPTH_HELP =
  'Depth is the engine’s search iteration (counted in plies, with selective extensions and pruning). It is not literally the number of moves it looks ahead. Each extra level costs roughly 1.5–2× more time; deeper results are more reliable.';

function LineRow({ fen, line, index, onPlayTo, onHover, onApply, onPlayLine }: {
  fen: string;
  line: EngineAnalysis['lines'][number];
  index: number;
  onPlayTo: (lineIdx: number, moveIdx: number) => void;
  onHover: (h: { fen: string; uci: string } | null) => void;
  onApply: (lineIdx: number) => void;
  onPlayLine: (lineIdx: number) => void;
}) {
  const sans = useMemo(() => uciLineToSan(fen, line.pv, 14), [fen, line.pv]);
  const parts = fen.split(' ');
  let num = Number(parts[5]) || 1;
  let white = parts[1] === 'w';
  const score = formatScore(line.score);
  const positive = line.score.mate !== null ? line.score.mate > 0 : (line.score.cp ?? 0) >= 0;
  return (
    <div className={`eline ${index === 0 ? 'primary' : ''}`}>
      <span className={`eline-score ${positive ? 'pos' : 'neg'}`}>{score}</span>
      <div className="eline-moves">
        {sans.map((san, i) => {
          const label = white ? `${num}.` : i === 0 ? `${num}…` : '';
          const el = (
            <span key={i} className="eline-mv-wrap">
              {label && <span className="eline-num">{label}</span>}
              <button
                type="button"
                className="eline-mv"
                onClick={() => onPlayTo(index, i)}
                onMouseEnter={() => i === 0 && onHover({ fen, uci: line.pv[0] })}
                onMouseLeave={() => onHover(null)}
                onFocus={() => i === 0 && onHover({ fen, uci: line.pv[0] })}
                onBlur={() => onHover(null)}
              >
                {san}
              </button>
            </span>
          );
          if (!white) num++;
          white = !white;
          return el;
        })}
      </div>
      <div className="eline-actions">
        <button type="button" className="chip-btn" onClick={() => onApply(index)} title="Apply the first move of this line">
          Apply
        </button>
        <button type="button" className="chip-btn" onClick={() => onPlayLine(index)} title="Play through this line on the board">
          <Icon name="play" size={12} /> Line
        </button>
      </div>
    </div>
  );
}

function EnginePanelImpl() {
  const c = useController();
  const engine = useApp((s) => s.engine);
  const engineOn = useApp((s) => s.engineOn);
  const fen = useApp((s) => s.tree.nodes[s.currentId].fen);
  const live = useApp((s) => s.live);
  const settings = useApp((s) => s.settings.engine);
  const lowPower = useApp((s) => s.settings.performance.lowPower);
  const reviewing = useApp((s) => !!s.reviewProgress);
  const retryHidden = useApp((s) => !!s.retry && s.retry.status !== 'correct' && !s.retry.revealed);

  const analysis = live && live.fen === fen ? live : null;
  const searching = engine.status === 'analyzing' && engineOn && !reviewing;
  const targetDepth = settings.mode === 'depth' ? (lowPower ? Math.min(16, settings.depth) : settings.depth) : null;

  const setPreset = (preset: DepthPreset) =>
    c.updateSettings((s) => ({ ...s, engine: { ...s.engine, preset, depth: preset === 'custom' ? s.engine.depth : DEPTH_PRESETS[preset].depth, mode: 'depth' } }));
  const setMultipv = (v: number) => c.updateSettings((s) => ({ ...s, engine: { ...s.engine, multipv: Math.min(5, Math.max(1, v)) } }));

  let status: string;
  if (engine.status === 'loading') status = 'Loading engine…';
  else if (engine.status === 'error') status = 'Engine unavailable';
  else if (!engineOn) status = 'Paused';
  else if (reviewing) status = 'Busy with game review';
  else if (retryHidden) status = 'Hidden during retry';
  else if (analysis?.terminal) status = analysis.terminal === 'checkmate' ? 'Checkmate' : analysis.terminal === 'stalemate' ? 'Stalemate' : 'Draw';
  else if (analysis?.complete) status = 'Analysis complete';
  else if (searching) status = 'Analyzing…';
  else if (analysis?.source === 'cache') status = 'From cache';
  else status = 'Ready';

  return (
    <section className="panel engine-panel" aria-label="Engine">
      <header className="panel-head">
        <div className="engine-id">
          <span className={`engine-dot ${searching ? 'live' : ''} ${engine.status}`} aria-hidden="true" />
          <div>
            <div className="engine-name">{engine.info?.name ?? 'Stockfish 19 (WASM)'}</div>
            <div className="engine-status" aria-live="polite">
              {status}
              {engine.info && engine.status !== 'error' && (
                <span className="muted">
                  {' '}
                  · WASM{engine.info.flavor === 'lite-multi' ? ' MT' : ''} · {engine.info.threads}T · {engine.info.hashMb} MB
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`switch ${engineOn ? 'on' : ''}`}
          role="switch"
          aria-checked={engineOn}
          aria-label={engineOn ? 'Stop analysis' : 'Start analysis'}
          title={engineOn ? 'Stop analysis' : 'Start analysis'}
          onClick={() => c.toggleEngine()}
        >
          <span />
        </button>
      </header>

      {engine.status === 'error' && (
        <div className="callout error" role="alert">
          <p>{engine.error}</p>
          <button type="button" className="btn small" onClick={() => c.restartEngine()}>
            Retry
          </button>
        </div>
      )}

      {retryHidden ? (
        <div className="engine-hidden">
          <Icon name="target" size={22} />
          <p>Engine output is hidden while you look for the better move.</p>
        </div>
      ) : (
        <>
          <div className="engine-readout">
            <div className={`engine-eval ${analysis ? '' : 'pending'}`}>{analysis ? formatAnalysisEval(analysis) : engineOn && engine.status !== 'error' ? '…' : '—'}</div>
            <dl className="engine-stats">
              <div>
                <dt>
                  Depth <HelpDot text={DEPTH_HELP} />
                </dt>
                <dd title={analysis?.seldepth ? `Selective depth ${analysis.seldepth}` : undefined}>
                  {analysis && !analysis.terminal ? analysis.depth : '—'}
                  {targetDepth && analysis && !analysis.terminal ? <span className="muted">/{targetDepth}</span> : null}
                </dd>
              </div>
              <div>
                <dt>Nodes</dt>
                <dd>{formatNodes(analysis?.nodes)}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>{analysis?.nps ? `${formatNodes(analysis.nps)}/s` : '—'}</dd>
              </div>
            </dl>
          </div>
          {searching && targetDepth && analysis && !analysis.terminal && (
            <div className="depth-progress" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (analysis.depth / targetDepth) * 100)}%` }} />
            </div>
          )}

          <div className="engine-lines" aria-live="off">
            {analysis?.terminal ? (
              <p className="muted center">The game is over in this position — there is nothing to analyze.</p>
            ) : analysis && analysis.lines.length ? (
              analysis.lines.map((l, i) => (
                <LineRow
                  key={l.multipv}
                  fen={fen}
                  line={l}
                  index={i}
                  onPlayTo={(li, mi) => c.playPvTo(li, mi)}
                  onHover={(h) => c.setPvHover(h)}
                  onApply={(li) => c.applyEngineMove(li)}
                  onPlayLine={(li) => c.playLine(li)}
                />
              ))
            ) : (
              Array.from({ length: Math.min(3, settings.multipv) }, (_, i) => (
                <div className="eline skeleton" key={i}>
                  <span className="sk sk-score" />
                  <span className="sk sk-line" />
                </div>
              ))
            )}
          </div>
        </>
      )}

      <div className="engine-controls">
        <div className="seg" role="radiogroup" aria-label="Analysis depth">
          {(Object.keys(DEPTH_PRESETS) as (keyof typeof DEPTH_PRESETS)[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={settings.mode === 'depth' && settings.preset === k}
              className={settings.mode === 'depth' && settings.preset === k ? 'active' : ''}
              onClick={() => setPreset(k)}
              title={`Depth ${DEPTH_PRESETS[k].depth}`}
            >
              {k === 'very-deep' ? 'Deep+' : DEPTH_PRESETS[k].label}
              <small>{DEPTH_PRESETS[k].depth}</small>
            </button>
          ))}
        </div>
        <div className="stepper" aria-label="Number of engine lines">
          <span>Lines</span>
          <button type="button" aria-label="Fewer lines" onClick={() => setMultipv(settings.multipv - 1)} disabled={settings.multipv <= 1}>
            −
          </button>
          <output>{settings.multipv}</output>
          <button type="button" aria-label="More lines" onClick={() => setMultipv(settings.multipv + 1)} disabled={settings.multipv >= 5}>
            +
          </button>
        </div>
      </div>
      {settings.mode !== 'depth' && (
        <p className="muted small">
          Mode: {settings.mode === 'time' ? `${(settings.movetimeMs / 1000).toFixed(0)} s per position` : 'infinite (until stopped)'} — change in Settings.
        </p>
      )}
    </section>
  );
}

export const EnginePanel = memo(EnginePanelImpl);
