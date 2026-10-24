import { parseBestMove, parseInfoLine, parseOptionLine } from './uciParser';
import type { EngineAnalysis, EngineFlavor, EngineInfo, EngineLine, SearchLimit, WorkerIn, WorkerOut } from './types';

interface Search {
  id: number;
  fen: string;
  turn: 'w' | 'b';
  limit: SearchLimit;
  multipv: number;
  lines: Map<number, EngineLine>;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  hashfull?: number;
  seldepth?: number;
  stopRequested: boolean;
  lastEmit: number;
}

type AnalyzeMsg = Extract<WorkerIn, { type: 'analyze' }>;

const NAME_BY_FLAVOR: Record<EngineFlavor, string> = {
  'full-multi': 'Stockfish 19',
  'full-single': 'Stockfish 19',
  'lite-multi': 'Stockfish 19 Lite',
  'lite-single': 'Stockfish 19 Lite',
  asm: 'Stockfish 19 (asm.js)',
};

/**
 * UCI session logic, independent of the transport so it can run inside a Web Worker
 * (browser) or against a child process (tests). Owns search sequencing: at most one
 * search runs at a time; a new request stops the current search first.
 */
export class EngineSession {
  private state: 'off' | 'booting' | 'configuring' | 'idle' | 'searching' | 'stopping' = 'off';
  private current: Search | null = null;
  private pending: AnalyzeMsg | null = null;
  private multipvSet = 1;
  private threadsMax = 1;
  private engineName = 'Stockfish';
  private flavor: EngineFlavor = 'lite-single';
  private wantThreads = 1;
  private wantHash = 16;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private pokeTimer: ReturnType<typeof setInterval> | null = null;
  private heardFromEngine = false;

  constructor(
    private readonly send: (cmd: string) => void,
    private readonly emit: (msg: WorkerOut) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get isReady(): boolean {
    return this.state === 'idle' || this.state === 'searching' || this.state === 'stopping';
  }

  boot(flavor: EngineFlavor, threads: number, hashMb: number, timeoutMs = 30000): void {
    this.flavor = flavor;
    this.wantThreads = Math.max(1, threads);
    this.wantHash = Math.max(1, hashMb);
    this.state = 'booting';
    this.bootTimer = setTimeout(() => {
      if (this.state === 'booting' || this.state === 'configuring') {
        this.state = 'off';
        if (this.pokeTimer) clearInterval(this.pokeTimer);
        this.emit({ type: 'error', fatal: true, message: 'The engine did not respond while starting up.' });
      }
    }, timeoutMs);
    this.send('uci');
    // Some builds (multi-threaded) drop commands posted before their message handler is
    // installed. Repeat the handshake until the engine says anything.
    this.pokeTimer = setInterval(() => {
      if (this.heardFromEngine || this.state !== 'booting') {
        if (this.pokeTimer) clearInterval(this.pokeTimer);
        this.pokeTimer = null;
        return;
      }
      this.send('uci');
    }, 750);
  }

  handle(msg: WorkerIn): void {
    switch (msg.type) {
      case 'analyze':
        this.requestAnalysis(msg);
        break;
      case 'stop':
        this.requestStop(msg.id);
        break;
      case 'setoption':
        if (this.state === 'idle') this.send(`setoption name ${msg.name} value ${msg.value}`);
        break;
      case 'newgame':
        if (this.state === 'idle') {
          this.send('ucinewgame');
          this.send('isready');
        }
        break;
      case 'quit':
        this.send('quit');
        this.state = 'off';
        break;
      default:
        break;
    }
  }

  onLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    this.heardFromEngine = true;
    if (this.state === 'booting') {
      if (line.startsWith('id name ')) this.engineName = line.slice(8);
      const opt = parseOptionLine(line);
      if (opt?.name === 'Threads' && opt.max) this.threadsMax = opt.max;
      if (line === 'uciok') {
        this.state = 'configuring';
        const threads = Math.min(this.wantThreads, this.threadsMax);
        this.wantThreads = threads;
        if (this.threadsMax > 1) this.send(`setoption name Threads value ${threads}`);
        this.send(`setoption name Hash value ${this.wantHash}`);
        this.send('setoption name MultiPV value 1');
        this.multipvSet = 1;
        this.send('isready');
      }
      return;
    }
    if (this.state === 'configuring') {
      if (line === 'readyok') {
        if (this.bootTimer) clearTimeout(this.bootTimer);
        if (this.pokeTimer) clearInterval(this.pokeTimer);
        this.state = 'idle';
        const info: EngineInfo = {
          name: this.engineName.includes('Stockfish') ? NAME_BY_FLAVOR[this.flavor] : this.engineName,
          flavor: this.flavor,
          threadsMax: this.threadsMax,
          threads: this.wantThreads,
          hashMb: this.wantHash,
        };
        this.emit({ type: 'ready', info });
        this.startPending();
      }
      return;
    }
    if (line.startsWith('info ')) {
      this.onInfo(line);
      return;
    }
    const bm = parseBestMove(line);
    if (bm) this.onBestMove(bm.bestmove);
  }

  private requestAnalysis(msg: AnalyzeMsg): void {
    if (this.pending) this.emitEmptyDone(this.pending);
    this.pending = msg;
    if (this.state === 'idle') this.startPending();
    else if (this.state === 'searching') this.stopCurrent();
  }

  private requestStop(id?: number): void {
    if (this.pending && (id === undefined || this.pending.id === id)) {
      this.emitEmptyDone(this.pending);
      this.pending = null;
    }
    if (this.current && this.state === 'searching' && (id === undefined || this.current.id === id)) this.stopCurrent();
  }

  private stopCurrent(): void {
    if (!this.current) return;
    this.current.stopRequested = true;
    this.state = 'stopping';
    this.send('stop');
  }

  private startPending(): void {
    if (this.state !== 'idle' || !this.pending) return;
    const msg = this.pending;
    this.pending = null;
    const turn = msg.fen.split(' ')[1] === 'b' ? 'b' : 'w';
    this.current = {
      id: msg.id,
      fen: msg.fen,
      turn,
      limit: msg.limit,
      multipv: msg.multipv,
      lines: new Map(),
      stopRequested: false,
      lastEmit: 0,
    };
    if (msg.multipv !== this.multipvSet) {
      this.send(`setoption name MultiPV value ${msg.multipv}`);
      this.multipvSet = msg.multipv;
    }
    this.send(`position fen ${msg.fen}`);
    const l = msg.limit;
    this.send(l.kind === 'depth' ? `go depth ${l.depth}${l.maxTimeMs ? ` movetime ${Math.round(l.maxTimeMs)}` : ''}` : l.kind === 'time' ? `go movetime ${l.movetimeMs}` : 'go infinite');
    this.state = 'searching';
  }

  private onInfo(line: string): void {
    const s = this.current;
    if (!s) return;
    const info = parseInfoLine(line);
    if (!info || info.depth === undefined) return;
    if (info.nodes !== undefined) s.nodes = info.nodes;
    if (info.nps !== undefined) s.nps = info.nps;
    if (info.time !== undefined) s.timeMs = info.time;
    if (info.hashfull !== undefined) s.hashfull = info.hashfull;
    if (!info.pv.length || (info.cp === undefined && info.mate === undefined)) return;
    const existing = s.lines.get(info.multipv);
    if (info.bound && existing) return;
    const sign = s.turn === 'w' ? 1 : -1;
    s.lines.set(info.multipv, {
      multipv: info.multipv,
      depth: info.depth,
      seldepth: info.seldepth,
      score: {
        cp: info.cp !== undefined ? info.cp * sign : null,
        mate: info.mate !== undefined ? info.mate * sign : null,
      },
      bound: info.bound,
      pv: info.pv,
    });
    if (info.multipv === 1 && info.seldepth) s.seldepth = info.seldepth;
    const t = this.now();
    const lastOfDepth = info.multipv >= Math.min(s.multipv, s.lines.size);
    if ((lastOfDepth && t - s.lastEmit > 40) || t - s.lastEmit > 200) {
      s.lastEmit = t;
      this.emit({ type: 'update', id: s.id, analysis: this.snapshot(s, false, null) });
    }
  }

  private onBestMove(best: string | null): void {
    const s = this.current;
    this.current = null;
    if (this.state === 'searching' || this.state === 'stopping') this.state = 'idle';
    if (s) {
      const complete = !s.stopRequested && s.limit.kind !== 'infinite';
      this.emit({ type: 'done', id: s.id, analysis: this.snapshot(s, complete, best), stopped: s.stopRequested });
    }
    this.startPending();
  }

  private snapshot(s: Search, complete: boolean, best: string | null): EngineAnalysis {
    const lines = [...s.lines.values()].sort((a, b) => a.multipv - b.multipv).slice(0, s.multipv);
    const top = lines[0];
    return {
      fen: s.fen,
      depth: top?.depth ?? 0,
      seldepth: s.seldepth,
      evaluation: top ? top.score.cp : null,
      mate: top ? top.score.mate : null,
      bestMove: best ?? top?.pv[0] ?? null,
      principalVariation: top?.pv ?? [],
      lines,
      nodes: s.nodes,
      nps: s.nps,
      timeMs: s.timeMs,
      hashfull: s.hashfull,
      multipv: s.multipv,
      complete,
      source: 'engine',
      engine: NAME_BY_FLAVOR[this.flavor],
    };
  }

  private emitEmptyDone(msg: AnalyzeMsg): void {
    this.emit({
      type: 'done',
      id: msg.id,
      stopped: true,
      analysis: {
        fen: msg.fen,
        depth: 0,
        evaluation: null,
        mate: null,
        bestMove: null,
        principalVariation: [],
        lines: [],
        multipv: msg.multipv,
        complete: false,
        source: 'engine',
      },
    });
  }
}
