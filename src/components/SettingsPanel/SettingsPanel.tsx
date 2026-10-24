import type { ReactNode } from 'react';
import { useApp, useController } from '../../state/context';
import { DEPTH_PRESETS, REVIEW_STRENGTH, type BoardThemeId, type DepthPreset, PIECE_SETS, type ReviewStrength, type Settings } from '../../state/settings';
import { autoHashMb, autoThreads } from '../../engine/StockfishManager';
import { Modal } from '../common/Modal';
import { playSound } from '../../audio/sounds';
import { HelpDot } from '../common/Tooltip';
import { PieceSvg } from '../ChessBoard/pieces';

function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        {label}
        {help && <HelpDot text={help} />}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

const THEMES: { id: BoardThemeId; label: string }[] = [
  { id: 'slate', label: 'Slate' },
  { id: 'sandstone', label: 'Sandstone' },
  { id: 'glacier', label: 'Glacier' },
  { id: 'orchid', label: 'Orchid' },
  { id: 'graphite', label: 'Graphite' },
];

export function SettingsPanel() {
  const c = useController();
  const s = useApp((st) => st.settings);
  const engine = useApp((st) => st.engine);
  const up = (fn: (s: Settings) => Settings) => c.updateSettings(fn);
  const threadsSupported = c.engine.supportsThreads;
  const maxThreads = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 2) - 0));

  return (
    <Modal title="Settings" onClose={() => c.closeModal()} wide>
      <div className="settings">
        <section>
          <h3>Engine</h3>
          <Row label="Engine">
            <span className="muted">{engine.info?.name ?? 'Stockfish 19 (WASM)'}</span>
          </Row>
          <Row label="Analysis mode" help="Depth stops at a target depth; Time stops after a fixed time; Infinite runs until you stop it or change position.">
            <select value={s.engine.mode} onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, mode: e.target.value as Settings['engine']['mode'] } }))}>
              <option value="depth">Depth</option>
              <option value="time">Time</option>
              <option value="infinite">Infinite</option>
            </select>
          </Row>
          {s.engine.mode === 'depth' && (
            <>
              <Row label="Preset">
                <select
                  value={s.engine.preset}
                  onChange={(e) => {
                    const preset = e.target.value as DepthPreset;
                    up((x) => ({ ...x, engine: { ...x.engine, preset, depth: preset === 'custom' ? x.engine.depth : DEPTH_PRESETS[preset].depth } }));
                  }}
                >
                  {Object.entries(DEPTH_PRESETS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label} (depth {v.depth})
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </Row>
              <Row
                label={`Depth: ${s.engine.depth}`}
                help="Search depth reported by Stockfish (UCI). Higher is slower but more reliable; it is not a literal count of moves ahead."
              >
                <input
                  type="range"
                  min={6}
                  max={40}
                  value={s.engine.depth}
                  aria-label="Depth"
                  onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, depth: Number(e.target.value), preset: 'custom' } }))}
                />
              </Row>
            </>
          )}
          {s.engine.mode === 'time' && (
            <Row label={`Time per position: ${(s.engine.movetimeMs / 1000).toFixed(0)} s`}>
              <input
                type="range"
                min={1000}
                max={60000}
                step={1000}
                value={s.engine.movetimeMs}
                aria-label="Time per position"
                onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, movetimeMs: Number(e.target.value) } }))}
              />
            </Row>
          )}
          <Row label={`Lines (MultiPV): ${s.engine.multipv}`}>
            <input
              type="range"
              min={1}
              max={5}
              value={s.engine.multipv}
              aria-label="MultiPV"
              onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, multipv: Number(e.target.value) } }))}
            />
          </Row>
          <Row
            label="Engine build"
            help="Full uses Stockfish 19's full-size neural network: strongest analysis, ~100 MB downloaded once and then cached. Lite uses the small network: loads instantly, slightly weaker."
          >
            <select
              value={s.engine.build}
              onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, build: e.target.value === 'full' ? 'full' : 'lite', buildChosen: true } }))}
            >
              <option value="full">Full NNUE (100 MB)</option>
              <option value="lite">Lite NNUE (1.7 MB)</option>
            </select>
          </Row>
          <Row
            label="Threads"
            help={
              threadsSupported
                ? 'Multi-threaded engine is active (this page is cross-origin isolated).'
                : 'This host does not enable cross-origin isolation (COOP/COEP headers), so the single-threaded engine is used. See README for headers.'
            }
          >
            <select
              disabled={!threadsSupported}
              value={String(s.engine.threads)}
              onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, threads: e.target.value === 'auto' ? 'auto' : Number(e.target.value) } }))}
            >
              <option value="auto">Auto ({threadsSupported ? autoThreads() : 1})</option>
              {threadsSupported &&
                Array.from({ length: maxThreads }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </Row>
          <Row label="Hash" help="Memory for the engine’s transposition table. Changing it restarts the engine.">
            <select
              value={String(s.engine.hash)}
              onChange={(e) => up((x) => ({ ...x, engine: { ...x.engine, hash: e.target.value === 'auto' ? 'auto' : Number(e.target.value) } }))}
            >
              <option value="auto">Auto ({autoHashMb()} MB)</option>
              {[16, 32, 64, 128, 256].map((n) => (
                <option key={n} value={n}>
                  {n} MB
                </option>
              ))}
            </select>
          </Row>
        </section>

        <section>
          <h3>Board</h3>
          <Row label="Board theme">
            <div className="theme-swatches" role="radiogroup" aria-label="Board theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={s.board.theme === t.id}
                  className={`swatch theme-${t.id} ${s.board.theme === t.id ? 'active' : ''}`}
                  title={t.label}
                  aria-label={t.label}
                  onClick={() => up((x) => ({ ...x, board: { ...x.board, theme: t.id } }))}
                >
                  <i className="sw-l" />
                  <i className="sw-d" />
                </button>
              ))}
            </div>
          </Row>
          <Row label="Piece set">
            <div className="piece-sets" role="radiogroup" aria-label="Piece set">
              {PIECE_SETS.map(({ id: p, label }) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={s.board.pieceSet === p}
                  className={`pset ${s.board.pieceSet === p ? 'active' : ''}`}
                  onClick={() => up((x) => ({ ...x, board: { ...x.board, pieceSet: p } }))}
                >
                  <PieceSvg color="w" type="n" set={p} />
                  <PieceSvg color="b" type="q" set={p} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Coordinates">
            <Toggle label="Coordinates" checked={s.board.coordinates} onChange={(v) => up((x) => ({ ...x, board: { ...x.board, coordinates: v } }))} />
          </Row>
          <Row label="Animations">
            <Toggle label="Animations" checked={s.board.animations} onChange={(v) => up((x) => ({ ...x, board: { ...x.board, animations: v } }))} />
          </Row>
          <Row label="Show legal moves">
            <Toggle
              label="Show legal moves"
              checked={s.board.showLegalMoves}
              onChange={(v) => up((x) => ({ ...x, board: { ...x.board, showLegalMoves: v } }))}
            />
          </Row>
          <Row label="Highlight last move">
            <Toggle
              label="Highlight last move"
              checked={s.board.showLastMove}
              onChange={(v) => up((x) => ({ ...x, board: { ...x.board, showLastMove: v } }))}
            />
          </Row>
          <Row label="Engine arrows">
            <Toggle label="Engine arrows" checked={s.board.showArrows} onChange={(v) => up((x) => ({ ...x, board: { ...x.board, showArrows: v } }))} />
          </Row>
          <Row label={`Arrows shown: ${s.board.arrowCount}`}>
            <input
              type="range"
              min={1}
              max={3}
              value={s.board.arrowCount}
              aria-label="Number of arrows"
              onChange={(e) => up((x) => ({ ...x, board: { ...x.board, arrowCount: Number(e.target.value) } }))}
            />
          </Row>
        </section>

        <section>
          <h3>Review</h3>
          <Row label="Review strength">
            <select value={s.review.strength} onChange={(e) => up((x) => ({ ...x, review: { ...x.review, strength: e.target.value as ReviewStrength } }))}>
              {Object.entries(REVIEW_STRENGTH).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label} · {v.quickDepth}→{v.deepDepth}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Show classifications">
            <Toggle
              label="Show classifications"
              checked={s.review.showClassifications}
              onChange={(v) => up((x) => ({ ...x, review: { ...x.review, showClassifications: v } }))}
            />
          </Row>
          <Row label="Show key moments">
            <Toggle
              label="Show key moments"
              checked={s.review.showKeyMoves}
              onChange={(v) => up((x) => ({ ...x, review: { ...x.review, showKeyMoves: v } }))}
            />
          </Row>
          <Row label="Graph markers">
            <Toggle
              label="Graph markers"
              checked={s.review.showGraphMarkers}
              onChange={(v) => up((x) => ({ ...x, review: { ...x.review, showGraphMarkers: v } }))}
            />
          </Row>
          <Row label="Auto-play engine lines" help="When you click “Line”, step through it with animation instead of jumping to the end.">
            <Toggle
              label="Auto-play lines"
              checked={s.review.autoPlayLines}
              onChange={(v) => up((x) => ({ ...x, review: { ...x.review, autoPlayLines: v } }))}
            />
          </Row>
          <Row
            label="Use player ratings"
            help="If the PGN has WhiteElo/BlackElo, the expected-points curve is adjusted for rating (stronger players convert advantages more reliably)."
          >
            <Toggle label="Use player ratings" checked={s.review.useRatings} onChange={(v) => up((x) => ({ ...x, review: { ...x.review, useRatings: v } }))} />
          </Row>
        </section>

        <section>
          <h3>Performance & appearance</h3>
          <Row label="Web Worker" help="The engine always runs in a background Web Worker so the interface never freezes. This cannot be turned off.">
            <span className="pill">Always on</span>
          </Row>
          <Row label="Cache analysis" help="Reuse previous results for positions you have already analyzed (stored in this browser, size-limited).">
            <Toggle
              label="Cache analysis"
              checked={s.performance.cacheAnalysis}
              onChange={(v) => up((x) => ({ ...x, performance: { ...x.performance, cacheAnalysis: v } }))}
            />
          </Row>
          <Row label="Reduce animation">
            <Toggle
              label="Reduce animation"
              checked={s.performance.reduceMotion}
              onChange={(v) => up((x) => ({ ...x, performance: { ...x.performance, reduceMotion: v } }))}
            />
          </Row>
          <Row label="Low power mode" help="Caps live depth at 16, at most 2 lines, shorter reviews and no animated lines — gentler on battery.">
            <Toggle
              label="Low power mode"
              checked={s.performance.lowPower}
              onChange={(v) => up((x) => ({ ...x, performance: { ...x.performance, lowPower: v } }))}
            />
          </Row>
          <Row label="Move sounds" help="Original synthesized sounds for moves, captures, castling, check and checkmate.">
            <Toggle label="Move sounds" checked={s.sound.enabled} onChange={(v) => up((x) => ({ ...x, sound: { ...x.sound, enabled: v } }))} />
          </Row>
          <Row label={`Volume: ${Math.round(s.sound.volume * 100)}%`}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.sound.volume}
              disabled={!s.sound.enabled}
              aria-label="Sound volume"
              onChange={(e) => up((x) => ({ ...x, sound: { ...x.sound, volume: Number(e.target.value) } }))}
              onMouseUp={() => playSound('move', s.sound.volume)}
            />
          </Row>
          <Row label="Theme">
            <select
              value={s.appearance.theme}
              onChange={(e) => up((x) => ({ ...x, appearance: { theme: e.target.value as Settings['appearance']['theme'] } }))}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </Row>
          <div className="row gap">
            <button type="button" className="btn small" onClick={() => void c.clearEngineCache()}>
              Clear engine cache
            </button>
            <button type="button" className="btn small ghost" onClick={() => c.resetSettings()}>
              Reset settings
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
