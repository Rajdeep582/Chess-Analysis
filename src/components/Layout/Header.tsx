import { useState } from 'react';
import { useApp, useController } from '../../state/context';
import { Icon } from '../common/Icon';
import { Logo } from './Logo';

export function Header() {
  const c = useController();
  const view = useApp((s) => s.view);
  const title = useApp((s) => s.title);
  const dirty = useApp((s) => s.dirty);
  const savedId = useApp((s) => s.savedId);
  const [editing, setEditing] = useState(false);
  return (
    <header className="app-header">
      <button type="button" className="brand" onClick={() => c.goHome()} aria-label="Outpost home">
        <Logo />
        <span className="brand-name">Outpost</span>
        <span className="brand-sub">analysis lab</span>
      </button>
      {view === 'analysis' && (
        <div className="doc-title">
          {editing ? (
            <input
              autoFocus
              defaultValue={title}
              aria-label="Analysis title"
              onBlur={(e) => {
                c.setTitle(e.target.value.trim() || title);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <button type="button" className="title-btn" onClick={() => setEditing(true)} title="Rename">
              <span>{title}</span>
              {dirty && <span className="dirty-dot" aria-label={savedId ? 'Unsaved changes' : 'Not saved'} />}
            </button>
          )}
        </div>
      )}
      <nav className="header-actions" aria-label="Main">
        {view === 'analysis' && (
          <>
            <button type="button" className="hbtn" onClick={() => c.openModal('save')} aria-label="Save analysis">
              <Icon name="save" />
              <span className="hlabel">Save</span>
            </button>
            <button type="button" className="hbtn" onClick={() => void c.share()} aria-label="Share link">
              <Icon name="share" />
              <span className="hlabel">Share</span>
            </button>
            <button type="button" className="hbtn" onClick={() => c.openModal('export')} aria-label="Export">
              <Icon name="download" />
              <span className="hlabel">Export</span>
            </button>
          </>
        )}
        <button type="button" className="hbtn" onClick={() => c.openModal('saved')} aria-label="Saved analyses">
          <Icon name="folder" />
          <span className="hlabel">Library</span>
        </button>
        <button type="button" className="hbtn icon-only" onClick={() => c.openModal('shortcuts')} aria-label="Keyboard shortcuts and help">
          <Icon name="help" />
        </button>
        <button type="button" className="hbtn icon-only" onClick={() => c.openModal('settings')} aria-label="Settings">
          <Icon name="settings" />
        </button>
      </nav>
    </header>
  );
}
