/// <reference lib="webworker" />
/**
 * Dedicated engine worker. It hosts the Stockfish WASM build in a nested worker
 * (the Emscripten build is itself a worker script), speaks UCI to it and posts
 * structured analysis results back to the UI thread.
 */
import { EngineSession } from './engineCore';
import type { WorkerIn, WorkerOut } from './types';

declare const self: DedicatedWorkerGlobalScope;

let engine: Worker | null = null;
let session: EngineSession | null = null;

const post = (msg: WorkerOut) => self.postMessage(msg);

function start(msg: Extract<WorkerIn, { type: 'init' }>) {
  try {
    engine = new Worker(msg.engineUrl);
  } catch (e) {
    post({ type: 'error', fatal: true, message: `Could not start the engine: ${(e as Error).message}` });
    return;
  }
  const debug = !!msg.debug;
  session = new EngineSession((cmd) => {
    if (debug) post({ type: 'log', line: `> ${cmd}` });
    engine?.postMessage(cmd);
  }, post);
  engine.onmessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (debug) post({ type: 'log', line: `< ${String(data).slice(0, 160)}` });
    if (typeof data === 'string') session?.onLine(data);
  };
  engine.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    post({ type: 'error', fatal: true, message: ev.message || 'The engine failed to load (WebAssembly error).' });
  };
  session.boot(msg.flavor, msg.threads, msg.hashMb, msg.timeoutMs);
}

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    if (!engine) start(msg);
    return;
  }
  if (msg.type === 'quit') {
    session?.handle(msg);
    engine?.terminate();
    engine = null;
    session = null;
    self.close();
    return;
  }
  session?.handle(msg);
};
