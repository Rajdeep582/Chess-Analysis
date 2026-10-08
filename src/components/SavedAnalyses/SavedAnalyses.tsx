import { useState } from 'react';
import { useApp, useController } from '../../state/context';
import { deleteCorrupt } from '../../storage/savedAnalyses';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';

export function SavedAnalyses() {
  const c = useController();
  const list = useApp((s) => s.savedList);
  const corrupt = useApp((s) => s.savedCorrupt);
  const loading = useApp((s) => s.savedLoading);
  const error = useApp((s) => s.savedError);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const shown = list.filter((a) => `${a.title} ${a.players.white} ${a.players.black}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <Modal title="Library" onClose={() => c.closeModal()} wide>
      <div className="library">
        <div className="row gap">
          <input type="search" placeholder="Search saved analyses" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search saved analyses" className="grow" />
        </div>
        {error && <div className="callout error">{error}</div>}
        {corrupt.length > 0 && (
          <div className="callout info">
            {corrupt.length} saved record{corrupt.length > 1 ? 's are' : ' is'} corrupt and cannot be opened.
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                await deleteCorrupt(corrupt);
                await c.refreshSaved();
              }}
            >
              Remove
            </button>
          </div>
        )}
        {loading && !list.length && (
          <ul className="lib-list">
            {[0, 1, 2].map((i) => (
              <li key={i} className="lib-item skeleton">
                <span className="sk sk-line" />
              </li>
            ))}
          </ul>
        )}
        {!loading && !list.length && !error && (
          <div className="empty">
            <Icon name="folder" size={28} />
            <p>No saved analyses yet. Use “Save” while analyzing — everything is stored only in this browser.</p>
          </div>
        )}
        <ul className="lib-list">
          {shown.map((a) => (
            <li key={a.id} className="lib-item">
              <div className="lib-main">
                {renaming === a.id ? (
                  <input
                    autoFocus
                    defaultValue={a.title}
                    aria-label="New title"
                    onBlur={(e) => {
                      void c.renameSaved(a.id, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <button type="button" className="lib-open" onClick={() => void c.openSaved(a.id)}>
                    <span className="recent-title">{a.title}</span>
                    <span className="muted small">
                      {a.players.white} – {a.players.black} · {a.result} · {a.moves} plies · {new Date(a.updatedAt).toLocaleString()}
                    </span>
                  </button>
                )}
                {a.reviewed && a.accuracy && (
                  <span className="lib-acc" title="Accuracy (White / Black)">
                    {a.accuracy.w?.toFixed(1) ?? '—'} / {a.accuracy.b?.toFixed(1) ?? '—'}
                  </span>
                )}
              </div>
              {confirmDelete === a.id ? (
                <div className="lib-actions confirm">
                  <span>Delete permanently?</span>
                  <button type="button" className="btn small danger" onClick={() => { void c.deleteSaved(a.id); setConfirmDelete(null); }}>
                    Delete
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="lib-actions">
                  <button type="button" className="icon-btn" aria-label={`Open ${a.title}`} onClick={() => void c.openSaved(a.id)} data-tip="Open">
                    <Icon name="folder" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Rename ${a.title}`} onClick={() => setRenaming(a.id)} data-tip="Rename">
                    <Icon name="edit" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Duplicate ${a.title}`} onClick={() => void c.duplicateSaved(a.id)} data-tip="Duplicate">
                    <Icon name="copy" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Export ${a.title} as PGN`} onClick={() => void c.exportSaved(a.id, 'pgn')} data-tip="Export PGN">
                    <Icon name="download" size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Export ${a.title} as JSON`} onClick={() => void c.exportSaved(a.id, 'json')} data-tip="Export JSON">
                    <Icon name="file" size={16} />
                  </button>
                  <button type="button" className="icon-btn danger" aria-label={`Delete ${a.title}`} onClick={() => setConfirmDelete(a.id)} data-tip="Delete">
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
