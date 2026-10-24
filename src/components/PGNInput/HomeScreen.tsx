import { useMemo, useRef, useState } from 'react';
import { parsePgn } from '../../chess/pgn';
import { mainline } from '../../chess/tree';
import { looksLikeFen } from '../../chess/fen';
import { useApp, useController } from '../../state/context';
import { SAMPLE_GAMES } from '../../state/samples';
import { ChessBoard } from '../ChessBoard/ChessBoard';
import { ClassificationIcon } from '../ClassificationBadge/ClassificationBadge';
import { Icon } from '../common/Icon';
import { GameSearch } from '../GameSearch/GameSearch';

/** Final position of the Opera Game, used as the hero illustration. */
const HERO_FEN = '1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17';

export function HomeScreen() {
  const c = useController();
  const [text, setText] = useState('');
  const [error, setError] = useState<{ error: string; detail?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const board = useApp((s) => s.settings.board);
  const trimmed = text.trim();
  const legends = useMemo(
    () =>
      SAMPLE_GAMES.map((g) => {
        const p = parsePgn(g.pgn);
        const ml = mainline(p.tree);
        const last = p.tree.nodes[ml[ml.length - 1]];
        return { ...g, finalFen: last.fen, lastMove: last.from && last.to ? { from: last.from, to: last.to } : null };
      }),
    [],
  );
  const isFen = looksLikeFen(text);

  const submit = () => {
    const r = c.openText(text, isFen ? 'fen' : 'pgn');
    if (!r.ok) setError({ error: r.error ?? 'Could not load input.', detail: r.detail });
    else setError(null);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) {
      setError({ error: 'This file is too large.', detail: 'PGN files up to 2 MB are supported.' });
      return;
    }
    // Open the tab now, during the click, so pop-up blockers allow it; fill it once the file is read.
    let pre: Window | null = null;
    try {
      pre = window.open('', '_blank');
    } catch {
      pre = null;
    }
    try {
      const t = await f.text();
      setText(t);
      const r = c.openText(t, 'pgn', pre);
      if (!r.ok) setError({ error: r.error ?? 'Could not load file.', detail: r.detail });
    } catch {
      pre?.close();
      setError({ error: 'The file could not be read.' });
    }
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setText(t);
        setError(null);
      }
    } catch {
      setError({ error: 'Clipboard access was blocked.', detail: 'Paste with Ctrl/⌘ + V into the box instead.' });
    }
  };

  return (
    <main className="home" id="main">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden="true" /> Stockfish 19 · runs on your device
          </p>
          <h1>
            Analyze your game.
            <span>Understand every move.</span>
          </h1>
          <p className="hero-sub">
            Paste a PGN or FEN and get engine lines, a full game review with move classifications and accuracy, and your mistakes turned into puzzles. No
            account. Nothing is uploaded.
          </p>
          <ul className="hero-points" aria-label="Highlights">
            <li>
              <ClassificationIcon c="brilliant" size={18} /> Move-by-move review
            </li>
            <li>
              <Icon name="chart" size={18} /> Accuracy & rating estimate
            </li>
            <li>
              <Icon name="target" size={18} /> Retry your mistakes
            </li>
          </ul>
        </div>
        <div className="hero-board" aria-hidden="true">
          <div className="hero-board-inner">
            <ChessBoard
              fen={HERO_FEN}
              orientation="w"
              interactive={false}
              showCoordinates={false}
              theme={board.theme}
              pieceSet={board.pieceSet}
              lastMove={{ from: 'd1', to: 'd8' }}
              animate={false}
            />
          </div>
          <div className="hero-board-caption">
            <b>17. Rd8#</b> <span>Morphy · Paris 1858</span>
          </div>
        </div>
      </section>

      <section
        className={`import-card ${error ? 'has-error' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFile(e.dataTransfer.files[0]);
        }}
      >
        <div className="import-head">
          <label htmlFor="pgn-input" className="import-label">
            Paste a PGN or FEN
          </label>
          {trimmed && <span className={`detect ${isFen ? 'fen' : 'pgn'}`}>{isFen ? 'FEN · single position' : 'PGN · full game'}</span>}
          <span className="spacer" />
          <button type="button" className="link-btn" onClick={() => void paste()}>
            <Icon name="copy" size={15} /> Paste
          </button>
          <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} /> Import .pgn
          </button>
          <input ref={fileRef} type="file" accept=".pgn,.txt,application/x-chess-pgn,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <textarea
          id="pgn-input"
          value={text}
          spellCheck={false}
          placeholder={'1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 …\n\nor a FEN: rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2'}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && trimmed) submit();
          }}
          aria-describedby={error ? 'import-error' : 'import-hint'}
          aria-invalid={!!error}
        />
        {error && (
          <div className="callout error" id="import-error" role="alert">
            <b>{error.error}</b>
            {error.detail && <p>{error.detail}</p>}
          </div>
        )}
        <div className="import-actions">
          <button type="button" className="btn primary big" onClick={submit} disabled={!trimmed}>
            {isFen ? 'Analyze position' : 'Analyze game'} <Icon name="next" size={16} />
          </button>
          <button type="button" className="btn ghost" onClick={() => c.openNewBoardTab()}>
            <Icon name="plus" size={16} /> Empty board
          </button>
          <span className="spacer" />
          <span className="muted tiny" id="import-hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to analyze · or drop a .pgn file here
          </span>
        </div>
      </section>

      <section className="legends" aria-labelledby="legends-title">
        <div className="legends-head">
          <h2 id="legends-title">Legendary games</h2>
          <span className="muted small">Open one and run a full review</span>
        </div>
        <ul className="deck">
          {legends.map((g, i) => (
            <li key={g.id} className="deck-item" style={{ ['--i' as string]: i }}>
              <button
                type="button"
                className="deck-card"
                onClick={() => c.openText(g.pgn, 'pgn')}
                aria-label={`Open ${g.title}: ${g.white} vs ${g.black}, ${g.year}`}
              >
                <div className="deck-board" aria-hidden="true">
                  <ChessBoard
                    fen={g.finalFen}
                    orientation={g.orientation}
                    interactive={false}
                    showCoordinates={false}
                    animate={false}
                    theme={board.theme}
                    pieceSet={board.pieceSet}
                    lastMove={g.lastMove}
                  />
                </div>
                <div className="deck-meta">
                  <span className="deck-player">{g.player}</span>
                  <span className="deck-title">{g.title}</span>
                  <span className="deck-sub">
                    {g.white} – {g.black} · {g.year}
                  </span>
                  <p className="deck-tag">{g.tagline}</p>
                  <span className="deck-cta">
                    Review game <Icon name="next" size={14} />
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <GameSearch />
    </main>
  );
}
