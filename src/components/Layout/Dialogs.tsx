import { useState } from 'react';
import { useApp, useController } from '../../state/context';
import { copyText } from '../../utils/download';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';

export function SaveDialog() {
  const c = useController();
  const title = useApp((s) => s.title);
  const savedId = useApp((s) => s.savedId);
  const hasReview = useApp((s) => !!s.review);
  const [value, setValue] = useState(title);
  return (
    <Modal
      title={savedId ? 'Save analysis' : 'Save to library'}
      onClose={() => c.closeModal()}
      footer={
        <>
          {savedId && (
            <button type="button" className="btn ghost" onClick={() => void c.save(value, true)}>
              Save as copy
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => void c.save(value)}>
            <Icon name="save" size={16} /> Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Title</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void c.save(value)} />
      </label>
      <p className="muted small">
        Saves the game, your variations{hasReview ? ', the full review (classifications, accuracy, explanations)' : ''} and engine settings in this browser’s
        IndexedDB. Nothing is uploaded.
      </p>
    </Modal>
  );
}

export function ShareDialog() {
  const c = useController();
  const url = useApp((s) => s.shareUrl) ?? '';
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Share analysis" onClose={() => c.closeModal()}>
      <p className="muted small">
        The game (moves, variations and headers) is compressed into the link itself. Opening it restores the game in any browser — no server involved. Your
        saved library and settings are never included.
      </p>
      <div className="share-box">
        <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            setCopied(await copyText(url));
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="muted tiny">{url.length.toLocaleString()} characters</p>
    </Modal>
  );
}

export function ExportDialog() {
  const c = useController();
  const hasReview = useApp((s) => !!s.review);
  const [withReview, setWithReview] = useState(true);
  return (
    <Modal title="Export" onClose={() => c.closeModal()}>
      <div className="export-grid">
        <button type="button" className="export-opt" onClick={() => c.exportPgn(withReview)}>
          <Icon name="file" size={22} />
          <b>PGN</b>
          <span className="muted small">Moves, variations and comments{hasReview ? ', plus review annotations' : ''}.</span>
        </button>
        <button type="button" className="export-opt" onClick={() => c.exportJson()}>
          <Icon name="download" size={22} />
          <b>Analysis JSON</b>
          <span className="muted small">Full structured data: positions, review, classifications.</span>
        </button>
        <button type="button" className="export-opt" onClick={() => c.exportReport()} disabled={!hasReview}>
          <Icon name="chart" size={22} />
          <b>Review report</b>
          <span className="muted small">{hasReview ? 'Printable HTML summary with graph and key moments.' : 'Run Game Review first.'}</span>
        </button>
      </div>
      {hasReview && (
        <label className="check">
          <input type="checkbox" checked={withReview} onChange={(e) => setWithReview(e.target.checked)} /> Include classifications and evaluations in the PGN
        </label>
      )}
      <details className="pgn-preview">
        <summary>Preview PGN</summary>
        <pre>{c.pgnText(withReview)}</pre>
      </details>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['←  /  →', 'Previous / next move'],
  ['Home  /  End', 'Start / end of the line'],
  ['Space', 'Play / pause through moves'],
  ['F', 'Flip board'],
  ['R', 'Start game review'],
  ['A', 'Toggle engine arrows'],
  ['E', 'Start / stop engine'],
  ['Esc', 'Close panel or dialog / exit retry'],
  ['?', 'Show this help'],
  ['Right-click drag', 'Draw your own arrows and circles'],
  ['Alt + arrows, Alt + Enter', 'Move focus on the board and play moves with the keyboard'],
];

export function ShortcutsDialog() {
  const c = useController();
  return (
    <Modal title="Keyboard shortcuts & help" onClose={() => c.closeModal()}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <th scope="row">
                <kbd>{k}</kbd>
              </th>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>About the analysis</h3>
      <ul className="small">
        <li>All computation runs locally: Stockfish 19 compiled to WebAssembly, in a Web Worker.</li>
        <li>Move classifications and accuracy use Nocturne64’s own expected-points model with adjustable thresholds; they will differ from other sites.</li>
        <li>“Book” moves come from the open lichess-org/chess-openings dataset (CC0).</li>
        <li>Explanations are generated deterministically from engine scores, principal variations and material counts.</li>
      </ul>
      <p className="muted tiny">
        Stockfish is free software licensed under the GNU GPL v3. Source: github.com/official-stockfish/Stockfish · WASM build: github.com/nmrugg/stockfish.js.{' '}
        <a href="engine/STOCKFISH-LICENSE.txt" target="_blank" rel="noreferrer">
          License text
        </a>
      </p>
    </Modal>
  );
}
