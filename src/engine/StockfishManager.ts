import { Chess } from 'chess.js';
import { AnalysisQueue } from './analysisQueue';
import type { AnalysisCache } from './analysisCache';
import type { AnalysisRequest, EngineAnalysis, EngineBuild, EngineFlavor, EngineInfo, EngineStatus, WorkerIn, WorkerOut } from './types';

export interface WorkerLike {
  postMessage(msg: WorkerIn): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerOut }) => void) | null;
  onerror: ((ev: { message?: string; preventDefault?: () => void }) => void) | null;
}

export interface ManagerState {
  status: EngineStatus;
  info: EngineInfo | null;
  error: string | null;
  queueSize: number;
  runningJob: number | null;
}

export interface AnalyzeOptions {
  /** Lower runs first. 0 = interactive, 1 = review deep, 2 = review quick. */
  priority?: number;
  group?: string;
  onUpdate?: (a: EngineAnalysis) => void;
  useCache?: boolean;
}

export interface AnalysisJob {
  id: number;
  promise: Promise<EngineAnalysis>;
  cancel(): void;
  readonly cancelled: boolean;
}

interface JobRecord {
  id: number;
  req: AnalysisRequest;
  opts: AnalyzeOptions;
  resolve: (a: EngineAnalysis) => void;
  reject: (e: Error) => void;
  cancelled: boolean;
  lastUpdate: EngineAnalysis | null;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface ManagerOptions {
  cache: AnalysisCache;
  engineBaseUrl: string;
  createWorker?: () => WorkerLike;
  flavors?: EngineFlavor[];
  build?: EngineBuild;
  threads?: number;
  hashMb?: number;
  /** Echo raw UCI traffic to the console (diagnostics). */
  debug?: boolean;
}

const ENGINE_FILES: Record<EngineFlavor, string> = {
  'full-multi': 'stockfish-19.js',
  'full-single': 'stockfish-19-single.js',
  'lite-multi': 'stockfish-19-lite.js',
  'lite-single': 'stockfish-19-lite-single.js',
  asm: 'stockfish-19-asm.js',
};

/**
 * Engine builds to try, best first. `full` = Stockfish 19 with the full-size NNUE (~100 MB, strongest);
 * `lite` = the small NNUE (~1.7 MB, loads instantly). Each falls back to the next if it fails to load.
 */
export function detectFlavors(build: EngineBuild = 'lite'): EngineFlavor[] {
  const g = globalThis as unknown as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown; navigator?: Navigator };
  const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
  const multi = wasm && g.crossOriginIsolated && typeof g.SharedArrayBuffer !== 'undefined' && (g.navigator?.hardwareConcurrency ?? 1) > 1;
  const list: EngineFlavor[] = [];
  if (build === 'full' && wasm) {
    if (multi) list.push('full-multi');
    list.push('full-single');
  }
  if (multi) list.push('lite-multi');
  if (wasm) list.push('lite-single');
  list.push('asm');
  return list;
}

const isMulti = (f: EngineFlavor) => f === 'full-multi' || f === 'lite-multi';

export function autoThreads(): number {
  const hc = (globalThis as unknown as { navigator?: Navigator }).navigator?.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(8, hc - 1));
}

export function autoHashMb(): number {
  const mem = (globalThis as unknown as { navigator?: { deviceMemory?: number } }).navigator?.deviceMemory ?? 4;
  return mem >= 8 ? 128 : mem >= 4 ? 64 : 32;
}

/** Analysis for positions where the game is already over (the engine is not consulted). */
export function terminalAnalysis(fen: string, multipv: number): EngineAnalysis | null {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  if (!c.isGameOver()) return null;
  const base = { fen, depth: 0, bestMove: null, principalVariation: [], lines: [], multipv, complete: true, source: 'terminal' as const };
  if (c.isCheckmate()) {
    const winner = c.turn() === 'w' ? 'b' : 'w';
    return { ...base, evaluation: null, mate: 0, terminal: 'checkmate', winner };
  }
  return { ...base, evaluation: 0, mate: null, terminal: c.isStalemate() ? 'stalemate' : 'draw' };
}

/**
 * Owns the engine worker. UI code talks to this manager only: it queues requests,
 * serves cache hits, runs one search at a time, cancels obsolete work and
 * recovers from worker crashes (falling back to lighter engine builds).
 */
export class StockfishManager {
  private worker: WorkerLike | null = null;
  private queue = new AnalysisQueue<JobRecord>();
  private running: JobRecord | null = null;
  private jobs = new Map<number, JobRecord>();
  private nextId = 1;
  private listeners = new Set<(s: ManagerState) => void>();
  private flavors: EngineFlavor[];
  private flavorIndex = 0;
  private crashRestarts = 0;
  private startPromise: Promise<void> | null = null;
  private startResolve: (() => void) | null = null;
  private startReject: ((e: Error) => void) | null = null;
  private threads: number;
  private hashMb: number;
  state: ManagerState = { status: 'idle', info: null, error: null, queueSize: 0, runningJob: null };

  constructor(private readonly opts: ManagerOptions) {
    this.flavors = opts.flavors ?? detectFlavors(opts.build);
    if (opts.build === 'full') opts.cache.namespace = 'full:';
    this.threads = opts.threads ?? autoThreads();
    this.hashMb = opts.hashMb ?? autoHashMb();
  }

  get cache(): AnalysisCache {
    return this.opts.cache;
  }

  subscribe(fn: (s: ManagerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<ManagerState>) {
    this.state = { ...this.state, ...patch, queueSize: this.queue.size, runningJob: this.running?.id ?? null };
    for (const l of this.listeners) l(this.state);
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    this.startPromise.catch(() => undefined);
    this.spawn();
    return this.startPromise;
  }

  private defaultWorker(): WorkerLike {
    return new Worker(new URL('./stockfish.worker.ts', import.meta.url), { type: 'module', name: 'stockfish-engine' }) as unknown as WorkerLike;
  }

  private spawn(): void {
    const flavor = this.flavors[this.flavorIndex];
    this.setState({ status: 'loading', error: null });
    let w: WorkerLike;
    try {
      w = this.opts.createWorker ? this.opts.createWorker() : this.defaultWorker();
    } catch (e) {
      this.fail(`This browser could not start a Web Worker for the engine (${(e as Error).message}).`, true);
      return;
    }
    this.worker = w;
    w.onmessage = (ev) => this.onMessage(ev.data);
    w.onerror = (ev) => {
      ev.preventDefault?.();
      this.onFatal(ev.message || 'The engine worker crashed.');
    };
    const base = this.opts.engineBaseUrl.endsWith('/') ? this.opts.engineBaseUrl : `${this.opts.engineBaseUrl}/`;
    const threads = isMulti(flavor) ? this.threads : 1;
    w.postMessage({
      type: 'init',
      engineUrl: `${base}${ENGINE_FILES[flavor]}`,
      flavor,
      threads,
      hashMb: this.hashMb,
      // The full net is a ~100 MB download on first use; give slow connections time.
      timeoutMs: flavor.startsWith('full') ? 300000 : flavor === 'asm' ? 60000 : 30000,
      debug: this.opts.debug,
    });
  }

  private onMessage(msg: WorkerOut): void {
    switch (msg.type) {
      case 'ready':
        this.crashRestarts = 0;
        this.setState({ status: 'ready', info: msg.info, error: null });
        this.startResolve?.();
        this.pump();
        break;
      case 'update': {
        const job = this.running;
        if (job && job.id === msg.id && !job.cancelled) {
          job.lastUpdate = msg.analysis;
          job.opts.onUpdate?.(msg.analysis);
        }
        break;
      }
      case 'done': {
        const job = this.jobs.get(msg.id);
        if (this.running?.id === msg.id) this.running = null;
        if (job) {
          this.jobs.delete(job.id);
          if (msg.analysis.complete && job.opts.useCache !== false) this.opts.cache.set(msg.analysis);
          job.resolve(msg.analysis.lines.length || !job.lastUpdate ? msg.analysis : { ...job.lastUpdate, complete: false });
        }
        this.setState({ status: this.queue.size ? 'analyzing' : 'ready' });
        this.pump();
        break;
      }
      case 'error':
        if (msg.fatal) this.onFatal(msg.message);
        break;
      case 'log':
        console.debug(`[engine] ${msg.line}`);
        break;
      default:
        break;
    }
  }

  private onFatal(message: string): void {
    const wasReady = this.state.status === 'ready' || this.state.status === 'analyzing';
    this.worker?.terminate();
    this.worker = null;
    if (this.running) {
      // Re-queue the interrupted job so it is retried after restart.
      const job = this.running;
      this.running = null;
      if (!job.cancelled) this.queue.enqueue(job.id, job, job.opts.priority ?? 1, job.opts.group);
    }
    if (wasReady && this.crashRestarts < 2) {
      this.crashRestarts++;
      this.spawn();
      return;
    }
    if (!wasReady && this.flavorIndex < this.flavors.length - 1) {
      this.flavorIndex++;
      this.spawn();
      return;
    }
    this.fail(`The chess engine could not run: ${message}`, false);
  }

  private fail(message: string, _hard: boolean): void {
    void _hard;
    for (const item of this.queue.clear()) {
      this.jobs.delete(item.id);
      item.payload.reject(new EngineError(message));
    }
    this.setState({ status: 'error', error: message });
    this.startReject?.(new EngineError(message));
    this.startPromise = null;
  }

  /** Restarts the engine (e.g. after an error or to apply thread/hash settings). */
  restart(opts: { threads?: number; hashMb?: number; resetFlavor?: boolean } = {}): Promise<void> {
    if (opts.threads) this.threads = opts.threads;
    if (opts.hashMb) this.hashMb = opts.hashMb;
    if (opts.resetFlavor) this.flavorIndex = 0;
    if (this.running) {
      const job = this.running;
      this.running = null;
      if (!job.cancelled) this.queue.enqueue(job.id, job, job.opts.priority ?? 1, job.opts.group);
    }
    this.worker?.terminate();
    this.worker = null;
    this.startPromise = null;
    this.crashRestarts = 0;
    return this.start();
  }

  /** Switches between the lite and full-strength engine builds (restarts the engine). */
  setBuild(build: EngineBuild): Promise<void> {
    this.flavors = detectFlavors(build);
    this.flavorIndex = 0;
    this.opts.cache.namespace = build === 'full' ? 'full:' : '';
    return this.restart();
  }

  /** The build currently running (falls back to lite if the full build could not load). */
  get activeFlavor(): EngineFlavor | undefined {
    return this.flavors[this.flavorIndex];
  }

  configure(threads: number, hashMb: number): void {
    const flavor = this.flavors[this.flavorIndex];
    const effThreads = isMulti(flavor) ? threads : 1;
    const info = this.state.info;
    if (info && (info.threads !== Math.min(effThreads, info.threadsMax) || info.hashMb !== hashMb)) {
      void this.restart({ threads, hashMb }).catch(() => undefined);
    } else {
      this.threads = threads;
      this.hashMb = hashMb;
    }
  }

  get supportsThreads(): boolean {
    return this.flavors.some(isMulti);
  }

  analyze(req: AnalysisRequest, opts: AnalyzeOptions = {}): AnalysisJob {
    const id = this.nextId++;
    let resolve!: (a: EngineAnalysis) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<EngineAnalysis>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined);
    const job: JobRecord = { id, req, opts, resolve, reject, cancelled: false, lastUpdate: null };
    const handle: AnalysisJob = {
      id,
      promise,
      cancel: () => this.cancel(id),
      get cancelled() {
        return job.cancelled;
      },
    };

    const terminal = terminalAnalysis(req.fen, req.multipv);
    if (terminal) {
      queueMicrotask(() => resolve(terminal));
      return handle;
    }
    const useCache = opts.useCache !== false && req.limit.kind === 'depth';
    const depth = req.limit.kind === 'depth' ? req.limit.depth : Infinity;
    if (useCache) {
      const hit = this.opts.cache.getSync(req.fen, depth, req.multipv);
      if (hit) {
        queueMicrotask(() => resolve(hit));
        return handle;
      }
    }
    this.jobs.set(id, job);
    const enqueue = () => {
      if (job.cancelled) return;
      this.queue.enqueue(id, job, opts.priority ?? 1, opts.group ?? 'default');
      this.setState({});
      this.pump();
    };
    if (useCache) {
      void this.opts.cache.get(req.fen, depth, req.multipv).then((hit) => {
        if (job.cancelled) return;
        if (hit) {
          this.jobs.delete(id);
          resolve(hit);
        } else enqueue();
      });
    } else enqueue();
    return handle;
  }

  private pump(): void {
    if (this.running || !this.worker) return;
    if (this.state.status !== 'ready' && this.state.status !== 'analyzing') {
      if (this.state.status === 'idle' && this.queue.size) void this.start().catch(() => undefined);
      return;
    }
    const next = this.queue.next();
    if (!next) {
      this.setState({ status: 'ready' });
      return;
    }
    const job = next.payload;
    this.running = job;
    this.worker.postMessage({ type: 'analyze', id: job.id, fen: job.req.fen, limit: job.req.limit, multipv: job.req.multipv });
    this.setState({ status: 'analyzing' });
  }

  cancel(id: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.cancelled = true;
    const queued = this.queue.remove(id);
    if (queued || this.running?.id !== id) {
      this.jobs.delete(id);
      job.resolve(job.lastUpdate ?? emptyAnalysis(job.req));
      this.setState({});
      return;
    }
    if (this.running?.id === id) this.worker?.postMessage({ type: 'stop', id });
  }

  cancelGroup(group: string): void {
    for (const item of this.queue.clearGroup(group)) {
      item.payload.cancelled = true;
      this.jobs.delete(item.id);
      item.payload.resolve(emptyAnalysis(item.payload.req));
    }
    // Jobs still waiting on an async cache lookup.
    for (const job of [...this.jobs.values()]) {
      if (job !== this.running && (job.opts.group ?? 'default') === group) {
        job.cancelled = true;
        this.jobs.delete(job.id);
        job.resolve(emptyAnalysis(job.req));
      }
    }
    if (this.running && (this.running.opts.group ?? 'default') === group) this.cancel(this.running.id);
    this.setState({});
  }

  dispose(): void {
    this.queue.clear();
    this.worker?.postMessage({ type: 'quit' });
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }
}

function emptyAnalysis(req: AnalysisRequest): EngineAnalysis {
  return {
    fen: req.fen,
    depth: 0,
    evaluation: null,
    mate: null,
    bestMove: null,
    principalVariation: [],
    lines: [],
    multipv: req.multipv,
    complete: false,
    source: 'engine',
  };
}
