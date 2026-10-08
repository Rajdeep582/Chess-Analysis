import { useMemo } from 'react';
import { fenKey } from '../../chess/fen';
import { capturedPieces, countMaterial } from '../../chess/material';
import { gameInfo } from '../../chess/pgn';
import { isMainline, mainline, mainlineAncestor, pathTo } from '../../chess/tree';
import type { Color, PieceSymbol } from '../../chess/types';
import type { EngineAnalysis } from '../../engine/types';
import { NEGATIVE_CLASSES } from '../../review/types';
import type { AppState, EvalPoint } from '../../state/controller';
import { useApp, useController } from '../../state/context';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { AnalysisControls } from '../AnalysisControls/AnalysisControls';
import type { BoardArrow } from '../ChessBoard/Arrows';
import { ChessBoard } from '../ChessBoard/ChessBoard';
import { PieceSvg } from '../ChessBoard/pieces';
import { EnginePanel } from '../EnginePanel/EnginePanel';
import { EvaluationBar } from '../EvaluationBar/EvaluationBar';
import { EvaluationGraph, type GraphMarker } from '../EvaluationGraph/EvaluationGraph';
import { MoveList } from '../MoveList/MoveList';
import { MoveStrip } from '../MoveList/MoveStrip';
import { ReviewPanel } from '../ReviewPanel/ReviewPanel';
import { Icon } from '../common/Icon';

function pointToAnalysis(fen: string, p: EvalPoint): EngineAnalysis {
  return {
    fen,
    depth: p.depth,
    evaluation: p.score.cp,
    mate: p.score.mate,
    bestMove: null,
    principalVariation: [],
    lines: [],
    multipv: 1,
    complete: true,
    terminal: p.terminal,
    winner: p.winner,
    source: 'cache',
  };
}

function PlayerBar({ color, name, rating, fen, toMove }: { color: Color; name: string; rating?: number; fen: string; toMove: boolean }) {
  const pieceSet = useApp((s) => s.settings.board.pieceSet);
  const caps = useMemo(() => capturedPieces(fen), [fen]);
  const mat = useMemo(() => countMaterial(fen), [fen]);
  const diff = color === 'w' ? mat.w - mat.b : mat.b - mat.w;
  const captured = caps[color];
  const opp: Color = color === 'w' ? 'b' : 'w';
  return (
    <div className={`player-bar ${toMove ? 'to-move' : ''}`}>
      <span className={`side-chip ${color}`} aria-hidden="true" />
      <span className="player-name">{name}</span>
      {rating ? <span className="player-rating">{rating}</span> : null}
      <span className="captured" aria-label={`Captured: ${captured.join(', ') || 'none'}`}>
        {captured.map((p: PieceSymbol, i) => (
          <span key={i} className="cap">
            <PieceSvg color={opp} type={p} set={pieceSet} />
          </span>
        ))}
        {diff > 0 && <span className="mat-diff">+{diff}</span>}
      </span>
    </div>
  );
}

export function AnalysisView() {
  const c = useController();
  const tree = useApp((s) => s.tree);
  const currentId = useApp((s) => s.currentId);
  const retry = useApp((s) => s.retry);
  const live = useApp((s) => s.live);
  const review = useApp((s) => s.review);
  const pvHover = useApp((s) => s.pvHover);
  const evalHistory = useApp((s) => s.evalHistory);
  const orientation = useApp((s) => s.orientation);
  const board = useApp((s) => s.settings.board);
  const reviewSettings = useApp((s) => s.settings.review);
  const perf = useApp((s) => s.settings.performance);
  const headers = useApp((s) => s.headers);
  const panelTab = useApp((s) => s.panelTab);
  const book = useApp((s) => s.book);
  const engineOn = useApp((s) => s.engineOn);
  const wide = useMediaQuery('(min-width: 1280px)');
  const info = useMemo(() => gameInfo(headers), [headers]);

  const node = tree.nodes[currentId];
  const retryHidden = !!retry && retry.status !== 'correct' && !retry.revealed;
  const boardFen = retry?.attemptFen && retry.status !== 'waiting' ? retry.attemptFen : node.fen;
  const lastMove = retry?.attemptMove && retry.attemptFen === boardFen ? retry.attemptMove : node.from && node.to ? { from: node.from, to: node.to } : null;

  const reviewByNode = useMemo(() => new Map((review?.moves ?? []).map((m) => [m.nodeId, m])), [review]);
  const nodeReview = reviewByNode.get(currentId);

  // Analysis to display for the current position: live engine, else stored review/history evaluation.
  const analysis: EngineAnalysis | null = useMemo(() => {
    if (live && live.fen === node.fen) return live;
    const p = evalHistory[fenKey(node.fen)];
    return p ? pointToAnalysis(node.fen, p) : null;
  }, [live, node.fen, evalHistory]);

  // Only the first move of each line affects arrows: key on that so deeper iterations don't re-render the board.
  const liveArrowKey = live && live.fen === node.fen ? live.lines.slice(0, board.arrowCount).map((l) => l.pv[0] ?? '').join(',') : '';
  const arrows: BoardArrow[] = useMemo(() => {
    const out: BoardArrow[] = [];
    if (retry) {
      if (retry.revealed && retry.bestUci) out.push({ from: retry.bestUci.slice(0, 2), to: retry.bestUci.slice(2, 4), kind: 'solution' });
      return out;
    }
    const negative = nodeReview && NEGATIVE_CLASSES.includes(nodeReview.classification) && nodeReview.bestMove && nodeReview.bestMove !== nodeReview.uci;
    if (negative && nodeReview.bestMove) out.push({ from: nodeReview.bestMove.slice(0, 2), to: nodeReview.bestMove.slice(2, 4), kind: 'solution' });
    if (board.showArrows && engineOn && live && live.fen === node.fen) {
      const n = negative ? 1 : board.arrowCount;
      live.lines.slice(0, n).forEach((l, i) => {
        if (l.pv[0]) out.push({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), kind: i === 0 ? 'best' : 'alt', weight: i === 0 ? 1 : i === 1 ? 0.85 : 0.65 });
      });
    }
    if (pvHover && pvHover.fen === node.fen) out.push({ from: pvHover.uci.slice(0, 2), to: pvHover.uci.slice(2, 4), kind: 'hover' });
    return out;
  }, [retry, nodeReview, board.showArrows, board.arrowCount, engineOn, liveArrowKey, node.fen, pvHover]);

  const ml = useMemo(() => mainline(tree), [tree]);
  const graphPoints = useMemo(() => ml.map((id) => evalHistory[fenKey(tree.nodes[id].fen)] ?? null), [ml, tree, evalHistory]);
  const graphLabels = useMemo(
    () => ml.map((id) => {
      const n = tree.nodes[id];
      return n.san ? `${n.moveNumber}${n.color === 'w' ? '.' : '…'} ${n.san}` : 'Start';
    }),
    [ml, tree],
  );
  const markers: GraphMarker[] = useMemo(
    () =>
      (review?.moves ?? [])
        .filter((m) => ['brilliant', 'great', 'miss', 'mistake', 'blunder', 'inaccuracy'].includes(m.classification))
        .map((m) => ({ ply: ml.indexOf(m.nodeId), classification: m.classification }))
        .filter((m) => m.ply >= 0),
    [review, ml],
  );
  const graphPly = ml.indexOf(mainlineAncestor(tree, currentId));
  const inVariation = !isMainline(tree, currentId);

  const opening = useMemo(() => {
    if (!book) return null;
    let found = null;
    for (const id of pathTo(tree, currentId)) {
      const o = book.lookup(tree.nodes[id].fen);
      if (o) found = o;
    }
    return found;
  }, [book, tree, currentId]);

  const turn = boardFen.split(' ')[1] as Color;
  const top: Color = orientation === 'w' ? 'b' : 'w';
  const bottom: Color = orientation;
  const nameOf = (col: Color) => (col === 'w' ? info.white : info.black);
  const eloOf = (col: Color) => (col === 'w' ? info.whiteElo : info.blackElo);
  const animate = board.animations && !perf.reduceMotion && !perf.lowPower;

  const graph = (
    <div className="card graph-card">
      <EvaluationGraph
        points={graphPoints}
        labels={graphLabels}
        currentPly={graphPly}
        markers={markers}
        showMarkers={reviewSettings.showGraphMarkers}
        onSelect={(ply) => c.goToPly(ply)}
        height={wide ? 92 : 84}
      />
    </div>
  );

  const tabs: { id: AppState['panelTab']; label: string }[] = wide
    ? [
        { id: 'engine', label: 'Engine' },
        { id: 'review', label: 'Review' },
      ]
    : [
        { id: 'engine', label: 'Engine' },
        { id: 'moves', label: 'Moves' },
        { id: 'review', label: 'Review' },
      ];
  const activeTab = wide && panelTab === 'moves' ? 'engine' : panelTab;

  return (
    <main className="analysis" id="main">
      {wide && (
        <aside className="col-left" aria-label="Game">
          <div className="card game-card">
            <div className="game-players">
              <span>
                <span className="side-chip w" /> {info.white}
                {info.whiteElo ? <small> {info.whiteElo}</small> : null}
              </span>
              <span>
                <span className="side-chip b" /> {info.black}
                {info.blackElo ? <small> {info.blackElo}</small> : null}
              </span>
            </div>
            <div className="muted small">
              {[info.event, info.date, info.result !== '*' ? info.result : null].filter(Boolean).join(' · ') || 'Analysis board'}
            </div>
            {opening && (
              <div className="opening-line small">
                <span className="eco">{opening.eco}</span> {opening.name}
              </div>
            )}
          </div>
          <div className="card moves-card">
            <MoveList />
          </div>
          <AnalysisControls />
        </aside>
      )}

      <section className="col-center" aria-label="Board">
        <PlayerBar color={top} name={nameOf(top)} rating={eloOf(top)} fen={boardFen} toMove={turn === top} />
        <div className="board-area">
          <EvaluationBar analysis={analysis} orientation={orientation} hidden={retryHidden} pending={!analysis} />
          <div className="board-frame">
            <ChessBoard
              fen={boardFen}
              orientation={orientation}
              lastMove={lastMove}
              arrows={arrows}
              interactive={!retry || retry.status === 'waiting' || retry.status === 'incorrect'}
              onMove={(m) => c.playMove(m)}
              showCoordinates={board.coordinates}
              showLegalMoves={board.showLegalMoves}
              showLastMove={board.showLastMove}
              animate={animate}
              theme={board.theme}
              pieceSet={board.pieceSet}
              marker={!retry && nodeReview && reviewSettings.showClassifications && node.to ? { square: node.to, classification: nodeReview.classification } : null}
            />
          </div>
        </div>
        <PlayerBar color={bottom} name={nameOf(bottom)} rating={eloOf(bottom)} fen={boardFen} toMove={turn === bottom} />
        {!wide && <MoveStrip />}
        {!wide && <AnalysisControls />}
        {!wide && opening && (
          <div className="opening-line small center">
            <span className="eco">{opening.eco}</span> {opening.name}
          </div>
        )}
        {inVariation && !retry && (
          <div className="variation-banner" role="status">
            <Icon name="info" size={16} />
            <span>Exploring a variation — the game is unchanged.</span>
            <button type="button" className="btn small" onClick={() => c.returnToGame()}>
              Return to game
            </button>
            <button type="button" className="btn small ghost" onClick={() => c.promoteVariation(currentId)} title="Make this line the main continuation">
              Promote
            </button>
            <button type="button" className="btn small ghost danger" onClick={() => c.deleteVariation(currentId)} title="Delete this move and everything after it">
              Delete
            </button>
          </div>
        )}
        {!wide && graph}
      </section>

      <aside className="col-right" aria-label="Analysis panels">
        {wide && graph}
        {!wide && (
          <div className="landscape-tools">
            <AnalysisControls />
            <MoveStrip />
            {graph}
          </div>
        )}
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={activeTab === t.id}
              className={activeTab === t.id ? 'active' : ''}
              onClick={() => c.setPanelTab(t.id)}
            >
              {t.label}
              {t.id === 'review' && review && <span className="tab-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="tab-body" role="tabpanel">
          {activeTab === 'engine' && <EnginePanel />}
          {activeTab === 'moves' && (
            <div className="card moves-card">
              <MoveList />
            </div>
          )}
          {activeTab === 'review' && <ReviewPanel />}
        </div>
      </aside>
    </main>
  );
}
