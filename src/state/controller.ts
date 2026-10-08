import { Chess } from 'chess.js';
import { looksLikeFen, validateFen, fenKey } from '../chess/fen';
import { exportPgn, gameInfo, parsePgn, PgnError, looksLikePgn } from '../chess/pgn';
import {
  addMove,
  createTree,
  deleteNode,
  isMainline,
  lineEnd,
  mainline,
  mainlineAncestor,
  nextNodeId,
  prevNodeId,
  promoteVariation,
  uciToMoveInput,
} from '../chess/tree';
import { START_FEN, type GameTree, type MoveInput, type PgnHeaders } from '../chess/types';
import { uciToSan } from '../chess/uci';
import { AnalysisCache } from '../engine/analysisCache';
import { analysisExpectedWhite } from '../engine/evalUtils';
import { autoHashMb, autoThreads, StockfishManager, type AnalysisJob, type ManagerState } from '../engine/StockfishManager';
import type { EngineAnalysis, EngineScore, SearchLimit } from '../engine/types';
import { epFor, lineEpFor, scoreOf } from '../review/expectedPoints';
import { loadOpeningBook, type OpeningBook } from '../review/openingBook';
import { collectMainline, ReviewCancelled, runReview, DEFAULT_REVIEW_SETTINGS } from '../review/reviewPipeline';
import { DEFAULT_THRESHOLDS, NEGATIVE_CLASSES, type GameReview, type MoveClassification, type ReviewProgress } from '../review/types';
import { buildReportHtml } from '../sharing/report';
import { buildShareUrl, decodeShare, MAX_RECOMMENDED_URL } from '../sharing/urlState';
import { idbCachePersistence } from '../storage/indexedDB';
import {
  deleteAnalysis,
  duplicateAnalysis,
  getAnalysis,
  listAnalyses,
  renameAnalysis,
  saveAnalysis,
  type SavedAnalysisSummary,
} from '../storage/savedAnalyses';
import { copyText, downloadText, safeFilename } from '../utils/download';
import { DEFAULT_SETTINGS, effectiveEngine, loadSettings, persistSettings, REVIEW_STRENGTH, type Settings } from './settings';
import { Store } from './store';
import { playSound, soundForMove } from '../audio/sounds';

export interface RetryState {
  moveIndex: number;
  nodeIdBefore: string;
  fenBefore: string;
  playedSan: string;
  classification: MoveClassification;
  status: 'waiting' | 'checking' | 'correct' | 'incorrect';
  attemptSan?: string;
  attemptFen?: string;
  attemptMove?: { from: string; to: string };
  message?: string;
  bestSan?: string;
  bestUci?: string;
  revealed?: boolean;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  detail?: string;
}

export type Modal = 'settings' | 'saved' | 'shortcuts' | 'share' | 'export' | 'save' | null;
export type PanelTab = 'engine' | 'moves' | 'review';

export interface EvalPoint {
  score: EngineScore;
  ep: number;
  depth: number;
  terminal?: EngineAnalysis['terminal'];
  winner?: 'w' | 'b';
}

export interface AppState {
  view: 'home' | 'analysis';
  tree: GameTree;
  headers: PgnHeaders;
  currentId: string;
  orientation: 'w' | 'b';
  title: string;
  savedId: string | null;
  dirty: boolean;
  live: EngineAnalysis | null;
  engine: ManagerState;
  engineOn: boolean;
  review: GameReview | null;
  reviewStale: boolean;
  reviewProgress: ReviewProgress | null;
  reviewError: string | null;
  retry: RetryState | null;
  evalHistory: Record<string, EvalPoint>;
  autoplay: boolean;
  pvHover: { fen: string; uci: string } | null;
  book: OpeningBook | null;
  toasts: Toast[];
  modal: Modal;
  shareUrl: string | null;
  panelTab: PanelTab;
  settings: Settings;
  savedList: SavedAnalysisSummary[];
  savedCorrupt: string[];
  savedLoading: boolean;
  savedError: string | null;
  warnings: string[];
}

export const CLASS_NAG: Partial<Record<MoveClassification, number>> = { brilliant: 3, great: 1, inaccuracy: 6, mistake: 2, miss: 2, blunder: 4 };

function initialState(settings: Settings): AppState {
  const tree = createTree(START_FEN);
  return {
    view: 'home',
    tree,
    headers: {},
    currentId: tree.rootId,
    orientation: 'w',
    title: '',
    savedId: null,
    dirty: false,
    live: null,
    engine: { status: 'idle', info: null, error: null, queueSize: 0, runningJob: null },
    engineOn: true,
    review: null,
    reviewStale: false,
    reviewProgress: null,
    reviewError: null,
    retry: null,
    evalHistory: {},
    autoplay: false,
    pvHover: null,
    book: null,
    toasts: [],
    modal: null,
    shareUrl: null,
    panelTab: 'engine',
    settings,
    savedList: [],
    savedCorrupt: [],
    savedLoading: false,
    savedError: null,
    warnings: [],
  };
}

export class AnalysisController {
  readonly store: Store<AppState>;
  readonly cache: AnalysisCache;
  readonly engine: StockfishManager;
  private liveJob: AnalysisJob | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private autoplayTimer: ReturnType<typeof setInterval> | null = null;
  private lineTimer: ReturnType<typeof setInterval> | null = null;
  private reviewAbort: AbortController | null = null;
  private reviewAnalyses: EngineAnalysis[] | null = null;
  private toastId = 1;

  constructor() {
    const settings = loadSettings();
    this.store = new Store(initialState(settings));
    this.cache = new AnalysisCache(2000, idbCachePersistence, 5000);
    this.cache.enabled = settings.performance.cacheAnalysis;
    const base = new URL('engine/', document.baseURI).href;
    this.engine = new StockfishManager({
      cache: this.cache,
      engineBaseUrl: base,
      threads: settings.engine.threads === 'auto' ? autoThreads() : settings.engine.threads,
      hashMb: settings.engine.hash === 'auto' ? autoHashMb() : settings.engine.hash,
      debug: new URLSearchParams(window.location.search).has('debug'),
    });
    let prevStatus = this.engine.state.status;
    this.engine.subscribe((s) => {
      this.set({ engine: s });
      if ((s.status === 'ready' || s.status === 'analyzing') && prevStatus !== 'ready' && prevStatus !== 'analyzing') this.scheduleLive();
      prevStatus = s.status;
    });
  }

  get state(): AppState {
    return this.store.getState();
  }

  private set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    this.store.setState(patch);
  }

  /** Called once on app start. */
  init(): void {
    void this.refreshSaved();
    loadOpeningBook()
      .then((book) => this.set({ book }))
      .catch(() => undefined);
    this.loadFromHash();
    window.addEventListener('hashchange', () => this.loadFromHash());
  }

  // ------------------------------------------------------------------ toasts / modals
  toast(kind: Toast['kind'], text: string, detail?: string): void {
    const id = this.toastId++;
    this.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, detail }] }));
    setTimeout(() => this.dismissToast(id), kind === 'error' ? 7000 : 3800);
  }

  dismissToast(id: number): void {
    this.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }

  openModal(modal: Modal): void {
    if (modal === 'saved') void this.refreshSaved();
    this.set({ modal });
  }

  closeModal(): void {
    this.set({ modal: null });
  }

  setPanelTab(panelTab: PanelTab): void {
    this.set({ panelTab });
  }

  // ------------------------------------------------------------------ loading
  loadFromHash(): void {
    const res = decodeShare(window.location.hash);
    if (res.ok) {
      const p = res.payload;
      const ok = p.pgn ? this.loadText(p.pgn, 'pgn', { silent: true }) : this.loadText(p.fen!, 'fen', { silent: true });
      if (ok.ok) {
        if (p.orientation) this.set({ orientation: p.orientation });
        if (typeof p.ply === 'number') {
          const ml = mainline(this.state.tree);
          const id = ml[Math.min(Math.max(0, p.ply), ml.length - 1)];
          this.goTo(id);
        }
        this.toast('success', 'Shared analysis loaded');
      } else this.toast('error', 'Could not open the shared analysis.', ok.detail ?? ok.error);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } else if (res.error) {
      this.toast('error', res.error);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  /** Loads PGN or FEN text. Returns a human-readable error on failure (never throws). */
  loadText(text: string, kind: 'auto' | 'pgn' | 'fen' = 'auto', opts: { silent?: boolean } = {}): { ok: boolean; error?: string; detail?: string } {
    const t = text.trim();
    if (!t) return { ok: false, error: 'Paste a PGN or a FEN first — the input is empty.' };
    const asFen = kind === 'fen' || (kind === 'auto' && looksLikeFen(t));
    if (asFen) {
      const v = validateFen(t);
      if (!v.ok) return { ok: false, error: 'Unable to load this FEN.', detail: v.error };
      this.loadGame(createTree(v.fen!), { SetUp: '1', FEN: v.fen! }, { title: 'Position analysis' });
      return { ok: true };
    }
    if (kind === 'auto' && !looksLikePgn(t)) {
      return { ok: false, error: 'This doesn’t look like a PGN or a FEN.', detail: 'A PGN starts with tags like [Event "…"] or moves like "1. e4 e5"; a FEN looks like "rnbqkbnr/pppppppp/8/… w KQkq - 0 1".' };
    }
    try {
      const p = parsePgn(t);
      this.loadGame(p.tree, p.headers, {});
      if (p.warnings.length && !opts.silent) p.warnings.forEach((w) => this.toast('info', w));
      this.set({ warnings: p.warnings });
      return { ok: true };
    } catch (e) {
      if (e instanceof PgnError) return { ok: false, error: e.message, detail: e.detail };
      return { ok: false, error: 'Unable to load this PGN.', detail: 'The text could not be read as a chess game.' };
    }
  }

  newBoard(): void {
    this.loadGame(createTree(START_FEN), {}, { title: 'New analysis' });
  }

  loadGame(
    tree: GameTree,
    headers: PgnHeaders,
    opts: { title?: string; savedId?: string | null; currentId?: string; review?: GameReview | null; orientation?: 'w' | 'b' },
  ): void {
    this.stopTimers();
    this.cancelReview(true);
    this.engine.cancelGroup('live');
    this.reviewAnalyses = null;
    const info = gameInfo(headers);
    const title = opts.title ?? (headers.White || headers.Black ? `${info.white} vs ${info.black}` : 'Analysis');
    this.set({
      view: 'analysis',
      tree,
      headers,
      currentId: opts.currentId && tree.nodes[opts.currentId] ? opts.currentId : tree.rootId,
      orientation: opts.orientation ?? 'w',
      title,
      savedId: opts.savedId ?? null,
      dirty: !opts.savedId,
      live: null,
      review: opts.review ?? null,
      reviewStale: false,
      reviewProgress: null,
      reviewError: null,
      retry: null,
      evalHistory: opts.review ? historyFromReview(opts.review) : {},
      autoplay: false,
      pvHover: null,
      modal: null,
      panelTab: opts.review ? 'review' : 'engine',
      warnings: [],
    });
    void this.engine.start().catch(() => undefined);
    this.scheduleLive();
  }

  goHome(): void {
    this.stopTimers();
    this.cancelReview(true);
    this.engine.cancelGroup('live');
    this.set({ view: 'home', retry: null, modal: null });
    void this.refreshSaved();
  }

  // ------------------------------------------------------------------ navigation
  goTo(id: string, opts: { keepTimers?: boolean } = {}): void {
    const s = this.state;
    if (!s.tree.nodes[id]) return;
    if (!opts.keepTimers) this.stopTimers();
    if (s.retry && id !== s.retry.nodeIdBefore) this.set({ retry: null });
    if (id === s.currentId) return;
    this.moveSound(s.currentId, id);
    this.set({ currentId: id, pvHover: null });
    this.scheduleLive();
  }

  /** Plays the board sound for a navigation from `fromId` to `toId`. */
  private moveSound(fromId: string, toId: string): void {
    const snd = this.state.settings.sound;
    if (!snd?.enabled) return;
    const nodes = this.state.tree.nodes;
    const to = nodes[toId];
    if (!to) return;
    if (nodes[fromId]?.parentId === toId) {
      playSound('back', snd.volume);
      return;
    }
    if (!to.san) return;
    playSound(soundForMove(to.san, !!to.captured), snd.volume);
  }

  next(): void {
    const n = nextNodeId(this.state.tree, this.state.currentId);
    if (n) this.goTo(n);
  }

  prev(): void {
    const p = prevNodeId(this.state.tree, this.state.currentId);
    if (p) this.goTo(p);
  }

  first(): void {
    this.goTo(this.state.tree.rootId);
  }

  last(): void {
    this.goTo(lineEnd(this.state.tree, this.state.currentId));
  }

  goToPly(ply: number): void {
    const ml = mainline(this.state.tree);
    const id = ml[Math.max(0, Math.min(ml.length - 1, ply))];
    if (id) this.goTo(id);
  }

  flip(): void {
    this.set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' }));
  }

  returnToGame(): void {
    this.goTo(mainlineAncestor(this.state.tree, this.state.currentId));
  }

  toggleAutoplay(): void {
    if (this.autoplayTimer) {
      this.stopTimers();
      return;
    }
    if (!nextNodeId(this.state.tree, this.state.currentId)) this.first();
    this.set({ autoplay: true });
    this.autoplayTimer = setInterval(() => {
      const n = nextNodeId(this.state.tree, this.state.currentId);
      if (!n) {
        this.stopTimers();
        return;
      }
      this.goTo(n, { keepTimers: true });
    }, 1000);
  }

  private stopTimers(): void {
    if (this.autoplayTimer) clearInterval(this.autoplayTimer);
    if (this.lineTimer) clearInterval(this.lineTimer);
    this.autoplayTimer = null;
    this.lineTimer = null;
    if (this.state.autoplay) this.set({ autoplay: false });
  }

  // ------------------------------------------------------------------ moves & variations
  /** Plays a move on the board. Returns false if illegal. */
  playMove(move: MoveInput): boolean {
    const s = this.state;
    if (s.retry && (s.retry.status === 'waiting' || s.retry.status === 'incorrect')) {
      void this.retryMove(move);
      return true;
    }
    if (s.retry) return false;
    const mlBefore = mainline(s.tree);
    const res = addMove(s.tree, s.currentId, move);
    if (!res) return false;
    const mlAfter = mainline(res.tree);
    const mainlineExtended = mlAfter.length !== mlBefore.length;
    this.stopTimers();
    const played = res.tree.nodes[res.nodeId];
    if (s.settings.sound?.enabled) playSound(soundForMove(played.san, !!played.captured), s.settings.sound.volume);
    this.set({
      tree: res.tree,
      currentId: res.nodeId,
      dirty: true,
      reviewStale: s.review ? s.reviewStale || mainlineExtended : false,
      pvHover: null,
    });
    this.scheduleLive();
    return true;
  }

  /** Adds engine line moves (UCI) after the current node, returning created node ids. */
  private addLine(uciMoves: string[]): string[] {
    let tree = this.state.tree;
    let parent = this.state.currentId;
    const ids: string[] = [];
    for (const u of uciMoves) {
      const res = addMove(tree, parent, uciToMoveInput(u));
      if (!res) break;
      tree = res.tree;
      parent = res.nodeId;
      ids.push(res.nodeId);
    }
    if (ids.length) {
      const extended = mainline(tree).length !== mainline(this.state.tree).length;
      this.set((s) => ({ tree, dirty: true, reviewStale: s.review ? s.reviewStale || extended : false }));
    }
    return ids;
  }

  applyEngineMove(lineIndex = 0): void {
    const line = this.currentAnalysis()?.lines[lineIndex];
    if (!line?.pv.length) return;
    const ids = this.addLine([line.pv[0]]);
    if (ids.length) this.goTo(ids[0]);
  }

  playPvTo(lineIndex: number, moveIndex: number): void {
    const line = this.currentAnalysis()?.lines[lineIndex];
    if (!line) return;
    const ids = this.addLine(line.pv.slice(0, moveIndex + 1));
    if (ids.length) this.goTo(ids[ids.length - 1]);
  }

  playLine(lineIndex = 0): void {
    const line = this.currentAnalysis()?.lines[lineIndex];
    if (!line?.pv.length) return;
    this.stopTimers();
    const ids = this.addLine(line.pv.slice(0, 12));
    if (!ids.length) return;
    if (!this.state.settings.review.autoPlayLines || this.state.settings.performance.lowPower) {
      this.goTo(ids[ids.length - 1]);
      return;
    }
    let i = 0;
    this.goTo(ids[i++]);
    this.set({ autoplay: true });
    this.lineTimer = setInterval(() => {
      if (i >= ids.length) {
        this.stopTimers();
        return;
      }
      this.goTo(ids[i++], { keepTimers: true });
    }, 750);
  }

  setPvHover(h: { fen: string; uci: string } | null): void {
    this.set({ pvHover: h });
  }

  deleteVariation(id: string): void {
    const s = this.state;
    const node = s.tree.nodes[id];
    if (!node?.parentId) return;
    const wasMainline = isMainline(s.tree, id);
    const tree = deleteNode(s.tree, id);
    const current = tree.nodes[s.currentId] ? s.currentId : node.parentId;
    this.set({ tree, currentId: current, dirty: true });
    if (wasMainline && s.review) this.invalidateReview('The review was cleared because the main line changed.');
    this.scheduleLive();
  }

  promoteVariation(id: string): void {
    const s = this.state;
    const tree = promoteVariation(s.tree, id);
    if (tree === s.tree) return;
    this.set({ tree, dirty: true });
    if (s.review) this.invalidateReview('The review was cleared because the main line changed.');
  }

  private invalidateReview(msg: string): void {
    this.reviewAnalyses = null;
    this.set({ review: null, reviewStale: false, retry: null });
    this.toast('info', msg);
  }

  // ------------------------------------------------------------------ live engine
  currentAnalysis(): EngineAnalysis | null {
    const s = this.state;
    const fen = s.tree.nodes[s.currentId]?.fen;
    if (s.live && fen && s.live.fen === fen) return s.live;
    return null;
  }

  toggleEngine(): void {
    const on = !this.state.engineOn;
    this.set({ engineOn: on });
    if (!on) {
      this.engine.cancelGroup('live');
      this.liveJob = null;
    } else this.scheduleLive();
  }

  restartEngine(): void {
    void this.engine.restart({ resetFlavor: true }).catch(() => undefined);
  }

  scheduleLive(): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => this.runLive(), 70);
  }

  private pendingLive: EngineAnalysis | null = null;
  private liveFlush: ReturnType<typeof setTimeout> | null = null;
  private lastLiveFlush = 0;

  /** Coalesces streaming engine updates to at most ~8 renders per second (keeps the UI smooth). */
  private queueLiveUpdate(a: EngineAnalysis): void {
    this.pendingLive = a;
    if (this.liveFlush) return;
    const wait = Math.max(0, 120 - (performance.now() - this.lastLiveFlush));
    this.liveFlush = setTimeout(() => {
      this.liveFlush = null;
      this.lastLiveFlush = performance.now();
      const p = this.pendingLive;
      this.pendingLive = null;
      if (p && this.state.tree.nodes[this.state.currentId]?.fen === p.fen) this.set({ live: p });
    }, wait);
  }

  private liveLimit(): { limit: SearchLimit; multipv: number } {
    const e = effectiveEngine(this.state.settings);
    const limit: SearchLimit =
      e.mode === 'depth' ? { kind: 'depth', depth: e.depth } : e.mode === 'time' ? { kind: 'time', movetimeMs: e.movetimeMs } : { kind: 'infinite' };
    return { limit, multipv: e.multipv };
  }

  private runLive(): void {
    const s = this.state;
    if (this.liveJob) {
      this.liveJob.cancel();
      this.liveJob = null;
    }
    this.engine.cancelGroup('live');
    if (s.view !== 'analysis' || !s.engineOn || s.reviewProgress) return;
    if (s.retry && s.retry.status !== 'correct' && !s.retry.revealed) return;
    const fen = s.tree.nodes[s.currentId].fen;
    const { limit, multipv } = this.liveLimit();
    if (!s.live || s.live.fen !== fen) {
      const peek = this.cache.peekBest(fen);
      this.set({ live: peek && peek.multipv >= Math.min(multipv, peek.lines.length) ? peek : null });
    }
    const job = this.engine.analyze(
      { fen, limit, multipv },
      {
        priority: 0,
        group: 'live',
        onUpdate: (a) => {
          if (this.state.tree.nodes[this.state.currentId]?.fen !== fen) return;
          const cur = this.state.live;
          // Do not replace a deeper cached preview with a shallow early iteration.
          if (cur && cur.fen === fen && cur.source === 'cache' && cur.depth > a.depth) return;
          this.queueLiveUpdate(a);
        },
      },
    );
    this.liveJob = job;
    job.promise
      .then((a) => {
        if (this.liveJob === job) this.liveJob = null;
        if (this.state.tree.nodes[this.state.currentId]?.fen !== fen) return;
        this.pendingLive = null;
        if (!a.lines.length && !a.terminal) return;
        const cur = this.state.live;
        if (cur && cur.fen === fen && cur.depth > a.depth && !a.terminal) return;
        this.set((st) => ({ live: a, evalHistory: { ...st.evalHistory, [fenKey(fen)]: pointOf(a) } }));
      })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------------ review
  async startReview(): Promise<void> {
    const s = this.state;
    const input = collectMainline(s.tree);
    if (!input.moves.length) {
      this.toast('info', 'There are no moves to review. Play or load a game first.');
      return;
    }
    if (s.reviewProgress) return;
    this.stopTimers();
    this.engine.cancelGroup('live');
    this.liveJob = null;
    const abort = new AbortController();
    this.reviewAbort = abort;
    this.set({ reviewProgress: { phase: 'quick', done: 0, total: input.moves.length + 1, label: 'Starting engine' }, reviewError: null, retry: null, panelTab: 'review' });
    try {
      await this.engine.start();
      const book = this.state.book ?? (await loadOpeningBook().catch(() => null));
      if (book && !this.state.book) this.set({ book });
      const strength = REVIEW_STRENGTH[s.settings.review.strength];
      const info = gameInfo(s.headers);
      const low = s.settings.performance.lowPower;
      const settings = {
        ...DEFAULT_REVIEW_SETTINGS,
        quickDepth: low ? Math.min(strength.quickDepth, 10) : strength.quickDepth,
        deepDepth: low ? Math.min(strength.deepDepth, 14) : strength.deepDepth,
        maxDeepPositions: low ? Math.min(strength.maxDeepPositions, 12) : strength.maxDeepPositions,
        thresholds: DEFAULT_THRESHOLDS,
        whiteRating: s.settings.review.useRatings ? info.whiteElo : undefined,
        blackRating: s.settings.review.useRatings ? info.blackElo : undefined,
      };
      const analyses: EngineAnalysis[] = [];
      const review = await runReview(
        {
          analyze: (req, o) => {
            const job = this.engine.analyze(req, o);
            void job.promise.then((a) => {
              const idx = [input.startFen, ...input.moves.map((m) => m.fenAfter)].indexOf(req.fen);
              if (idx >= 0 && (!analyses[idx] || a.depth >= analyses[idx].depth)) analyses[idx] = a;
            });
            return job;
          },
          cancelGroup: (g) => this.engine.cancelGroup(g),
        },
        input,
        settings,
        {
          book,
          engineName: this.engine.state.info?.name,
          elo: { w: info.whiteElo, b: info.blackElo },
          result: info.result,
          signal: abort.signal,
          onProgress: (p) => this.set({ reviewProgress: p }),
          onPartial: (r) => this.set({ review: r, evalHistory: { ...this.state.evalHistory, ...historyFromReview(r) } }),
        },
      );
      if (abort.signal.aborted) return;
      this.reviewAnalyses = analyses;
      this.set((st) => ({
        review,
        reviewStale: false,
        reviewProgress: null,
        dirty: true,
        evalHistory: { ...st.evalHistory, ...historyFromReview(review) },
      }));
      this.toast('success', 'Game review complete');
    } catch (e) {
      if (e instanceof ReviewCancelled || abort.signal.aborted) {
        this.set({ reviewProgress: null });
      } else {
        this.set({ reviewProgress: null, reviewError: (e as Error).message || 'The review failed.' });
        this.toast('error', 'The review could not be completed.', (e as Error).message);
      }
    } finally {
      if (this.reviewAbort === abort) this.reviewAbort = null;
      this.scheduleLive();
    }
  }

  cancelReview(silent = false): void {
    if (!this.reviewAbort) return;
    this.reviewAbort.abort();
    this.reviewAbort = null;
    this.set({ reviewProgress: null });
    if (!silent) this.toast('info', 'Review cancelled');
  }

  // ------------------------------------------------------------------ retry
  private negativeIndices(): number[] {
    const r = this.state.review;
    if (!r) return [];
    return r.moves.map((m, i) => (NEGATIVE_CLASSES.includes(m.classification) && m.classification !== 'inaccuracy' ? i : -1)).filter((i) => i >= 0);
  }

  retryCandidates(color?: 'w' | 'b'): number[] {
    const r = this.state.review;
    if (!r) return [];
    return this.negativeIndices().filter((i) => !color || r.moves[i].color === color);
  }

  startRetry(moveIndex?: number): void {
    const s = this.state;
    const r = s.review;
    if (!r) return;
    let idx = moveIndex;
    if (idx === undefined) {
      const cur = r.moves.findIndex((m) => m.nodeId === s.currentId);
      idx = this.negativeIndices().find((i) => i >= cur) ?? this.negativeIndices()[0];
    }
    if (idx === undefined) {
      this.toast('info', 'No mistakes to retry in this game.');
      return;
    }
    const mv = r.moves[idx];
    const node = s.tree.nodes[mv.nodeId];
    if (!node?.parentId) return;
    this.stopTimers();
    this.engine.cancelGroup('live');
    this.set({
      currentId: node.parentId,
      orientation: mv.color,
      retry: {
        moveIndex: idx,
        nodeIdBefore: node.parentId,
        fenBefore: mv.fenBefore,
        playedSan: mv.san,
        classification: mv.classification,
        status: 'waiting',
        bestSan: mv.bestMoveSan ?? undefined,
        bestUci: mv.bestMove ?? undefined,
      },
      panelTab: 'review',
      pvHover: null,
    });
  }

  private async retryMove(move: MoveInput): Promise<void> {
    const s = this.state;
    const retry = s.retry;
    const review = s.review;
    if (!retry || !review) return;
    const chess = new Chess(retry.fenBefore);
    let san: string;
    let uci: string;
    try {
      const m = chess.move(move);
      san = m.san;
      uci = `${m.from}${m.to}${m.promotion ?? ''}`;
    } catch {
      return;
    }
    const attemptFen = chess.fen();
    if (s.settings.sound?.enabled) playSound(soundForMove(san, san.includes('x')), s.settings.sound.volume);
    const base = { ...retry, attemptSan: san, attemptFen, attemptMove: { from: move.from, to: move.to }, revealed: false };
    this.set({ retry: { ...base, status: 'checking', message: 'Checking your move with the engine…' } });
    const mv = review.moves[retry.moveIndex];
    const finish = (correct: boolean, message: string) => {
      if (this.state.retry?.moveIndex !== retry.moveIndex) return;
      this.set({ retry: { ...base, status: correct ? 'correct' : 'incorrect', message } });
    };
    if (uci === mv.uci) {
      finish(false, `That's the move played in the game (${mv.san}). Look for something stronger.`);
      return;
    }
    if (chess.isCheckmate()) {
      finish(true, `${san} is checkmate!`);
      return;
    }
    try {
      const good = review.settings.thresholds.good;
      let before = this.reviewAnalyses?.[retry.moveIndex];
      if (!before || before.lines.length < 2 || before.fen !== retry.fenBefore) {
        before = await this.engine.analyze({ fen: retry.fenBefore, limit: { kind: 'depth', depth: 16 }, multipv: 3 }, { priority: 0, group: 'retry' }).promise;
      }
      const epBest = epFor(before, mv.color);
      const line = before.lines.find((l) => l.pv[0] === uci);
      let loss: number;
      if (uci === before.bestMove) loss = 0;
      else if (line) loss = Math.max(0, epBest - lineEpFor(line, mv.color));
      else {
        const after = await this.engine.analyze({ fen: attemptFen, limit: { kind: 'depth', depth: Math.max(12, before.depth - 2) }, multipv: 1 }, { priority: 0, group: 'retry' }).promise;
        if (!after.lines.length && !after.terminal) throw new Error('The engine did not return an evaluation.');
        loss = Math.max(0, epBest - epFor(after, mv.color));
      }
      const bestSan = before.bestMove ? uciToSan(retry.fenBefore, before.bestMove) : mv.bestMoveSan;
      if (loss <= 1e-4) finish(true, `${san} is the engine's top choice — you found the best continuation.`);
      else if (loss <= good) finish(true, `${san} is a strong move (within ${(loss * 100).toFixed(1)}% expected points of the best, ${bestSan}).`);
      else finish(false, `Not quite. ${san} loses about ${(loss * 100).toFixed(0)}% in expected points. Try again or reveal the solution.`);
    } catch (e) {
      finish(false, `Could not check the move: ${(e as Error).message}`);
    }
  }

  retryAgain(): void {
    const r = this.state.retry;
    if (!r) return;
    this.set({ retry: { ...r, status: 'waiting', attemptSan: undefined, attemptFen: undefined, attemptMove: undefined, message: undefined, revealed: false } });
  }

  revealSolution(): void {
    const r = this.state.retry;
    if (!r) return;
    this.set({
      retry: {
        ...r,
        status: 'incorrect',
        revealed: true,
        attemptFen: undefined,
        attemptMove: undefined,
        message: r.bestSan ? `The stronger move is ${r.bestSan}.` : 'See the engine line for the best continuation.',
      },
    });
    this.scheduleLive();
  }

  nextRetry(): void {
    const r = this.state.retry;
    const list = this.negativeIndices();
    const next = list.find((i) => i > (r?.moveIndex ?? -1));
    if (next === undefined) {
      this.exitRetry();
      this.toast('success', 'You have gone through all the mistakes in this game.');
      return;
    }
    this.startRetry(next);
  }

  exitRetry(): void {
    if (!this.state.retry) return;
    this.engine.cancelGroup('retry');
    this.set({ retry: null });
    this.scheduleLive();
  }

  // ------------------------------------------------------------------ settings
  updateSettings(fn: (s: Settings) => Settings): void {
    const prev = this.state.settings;
    const next = fn(prev);
    persistSettings(next);
    this.set({ settings: next });
    this.cache.enabled = next.performance.cacheAnalysis;
    if (prev.engine.threads !== next.engine.threads || prev.engine.hash !== next.engine.hash) {
      this.engine.configure(
        next.engine.threads === 'auto' ? autoThreads() : next.engine.threads,
        next.engine.hash === 'auto' ? autoHashMb() : next.engine.hash,
      );
    }
    const e1 = effectiveEngine(prev);
    const e2 = effectiveEngine(next);
    if (e1.depth !== e2.depth || e1.multipv !== e2.multipv || e1.mode !== e2.mode || e1.movetimeMs !== e2.movetimeMs) this.scheduleLive();
  }

  resetSettings(): void {
    this.updateSettings(() => DEFAULT_SETTINGS);
  }

  async clearEngineCache(): Promise<void> {
    await this.cache.clear();
    this.toast('success', 'Engine cache cleared');
  }

  // ------------------------------------------------------------------ saving
  async refreshSaved(): Promise<void> {
    this.set({ savedLoading: true, savedError: null });
    try {
      const { items, corrupt } = await listAnalyses();
      this.set({ savedList: items, savedCorrupt: corrupt, savedLoading: false });
    } catch (e) {
      this.set({ savedLoading: false, savedError: (e as Error).message });
    }
  }

  async save(title?: string, asNew = false): Promise<void> {
    const s = this.state;
    try {
      const e = s.settings.engine;
      const rec = await saveAnalysis({
        id: asNew ? null : s.savedId,
        title: title ?? s.title,
        tree: s.tree,
        headers: s.headers,
        currentNodeId: s.currentId,
        review: s.review,
        engineSettings: { depth: e.depth, multipv: e.multipv, mode: e.mode },
      });
      this.set({ savedId: rec.id, title: rec.title, dirty: false, modal: null });
      this.toast('success', `Saved “${rec.title}”`);
      void this.refreshSaved();
    } catch (err) {
      this.toast('error', 'Could not save the analysis.', (err as Error).message);
    }
  }

  async openSaved(id: string): Promise<void> {
    try {
      const a = await getAnalysis(id);
      this.loadGame(a.tree, a.headers, { title: a.title, savedId: a.id, currentId: a.currentNodeId, review: a.review });
    } catch (e) {
      this.toast('error', (e as Error).message);
      void this.refreshSaved();
    }
  }

  async renameSaved(id: string, title: string): Promise<void> {
    try {
      await renameAnalysis(id, title);
      if (this.state.savedId === id) this.set({ title });
      await this.refreshSaved();
    } catch (e) {
      this.toast('error', 'Rename failed.', (e as Error).message);
    }
  }

  async deleteSaved(id: string): Promise<void> {
    try {
      await deleteAnalysis(id);
      if (this.state.savedId === id) this.set({ savedId: null, dirty: true });
      await this.refreshSaved();
      this.toast('info', 'Analysis deleted');
    } catch (e) {
      this.toast('error', 'Delete failed.', (e as Error).message);
    }
  }

  async duplicateSaved(id: string): Promise<void> {
    try {
      await duplicateAnalysis(id);
      await this.refreshSaved();
      this.toast('success', 'Analysis duplicated');
    } catch (e) {
      this.toast('error', 'Duplicate failed.', (e as Error).message);
    }
  }

  async exportSaved(id: string, kind: 'pgn' | 'json'): Promise<void> {
    try {
      const a = await getAnalysis(id);
      if (kind === 'pgn') downloadText(`${safeFilename(a.title)}.pgn`, exportPgn(a.tree, a.headers, { annotate: annotator(a.review) }), 'application/x-chess-pgn');
      else downloadText(`${safeFilename(a.title)}.json`, JSON.stringify(analysisJson(a.title, a.tree, a.headers, a.review), null, 2), 'application/json');
    } catch (e) {
      this.toast('error', 'Export failed.', (e as Error).message);
    }
  }

  // ------------------------------------------------------------------ export & share
  pgnText(withReview = true): string {
    const s = this.state;
    return exportPgn(s.tree, s.headers, { annotate: withReview ? annotator(s.review) : undefined });
  }

  exportPgn(withReview = true): void {
    downloadText(`${safeFilename(this.state.title)}.pgn`, this.pgnText(withReview), 'application/x-chess-pgn');
  }

  exportJson(): void {
    const s = this.state;
    downloadText(`${safeFilename(s.title)}.json`, JSON.stringify(analysisJson(s.title, s.tree, s.headers, s.review), null, 2), 'application/json');
  }

  exportReport(): void {
    const s = this.state;
    if (!s.review) {
      this.toast('info', 'Run a game review first to export a report.');
      return;
    }
    const html = buildReportHtml({ title: s.title, headers: s.headers, review: s.review, pgn: this.pgnText(true) });
    downloadText(`${safeFilename(s.title)}-review.html`, html, 'text/html');
  }

  async share(): Promise<void> {
    const s = this.state;
    const ml = mainline(s.tree);
    const hasMoves = ml.length > 1 || Object.keys(s.tree.nodes).length > 1;
    const plyIdx = ml.indexOf(s.currentId);
    const url = buildShareUrl(
      hasMoves
        ? { v: 1, pgn: exportPgn(s.tree, s.headers), ply: plyIdx >= 0 ? plyIdx : undefined, orientation: s.orientation }
        : { v: 1, fen: s.tree.startFen, orientation: s.orientation },
    );
    this.set({ shareUrl: url, modal: 'share' });
    const ok = await copyText(url);
    if (ok) this.toast('success', 'Share link copied to clipboard');
    if (url.length > MAX_RECOMMENDED_URL) this.toast('info', 'This link is long; some apps may truncate it. Export the PGN for very long games.');
  }

  setTitle(title: string): void {
    this.set({ title, dirty: true });
  }
}

function pointOf(a: EngineAnalysis): EvalPoint {
  return { score: scoreOf(a), ep: analysisExpectedWhite(a), depth: a.depth, terminal: a.terminal, winner: a.winner };
}

function historyFromReview(r: GameReview): Record<string, EvalPoint> {
  const out: Record<string, EvalPoint> = {};
  for (const p of r.positions) out[fenKey(p.fen)] = { score: p.score, ep: p.ep, depth: p.depth, terminal: p.terminal, winner: p.winner };
  return out;
}

export function annotator(review: GameReview | null) {
  if (!review) return undefined;
  const byNode = new Map(review.moves.map((m) => [m.nodeId, m]));
  return (node: { id: string }) => {
    const m = byNode.get(node.id);
    if (!m) return undefined;
    const nag = CLASS_NAG[m.classification];
    const ev = m.evaluationAfter;
    const evalTag = ev.mate !== null ? `#${ev.mate}` : ev.cp !== null ? (ev.cp / 100).toFixed(2) : null;
    const parts = [evalTag !== null ? `[%eval ${evalTag}]` : '', `${m.classification[0].toUpperCase()}${m.classification.slice(1)}.`];
    if (NEGATIVE_CLASSES.includes(m.classification) && m.bestMoveSan) parts.push(`Best was ${m.bestMoveSan}.`);
    return { nags: nag ? [nag] : undefined, comment: parts.filter(Boolean).join(' ') };
  };
}

function analysisJson(title: string, tree: GameTree, headers: PgnHeaders, review: GameReview | null) {
  return {
    format: 'outpost-analysis',
    version: 1,
    exportedAt: new Date().toISOString(),
    title,
    headers,
    startFen: tree.startFen,
    pgn: exportPgn(tree, headers),
    mainline: mainline(tree)
      .slice(1)
      .map((id) => ({ ply: tree.nodes[id].ply, san: tree.nodes[id].san, uci: tree.nodes[id].uci, fen: tree.nodes[id].fen })),
    review,
  };
}

