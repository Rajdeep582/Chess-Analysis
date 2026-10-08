import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { EngineSession } from '../../src/engine/engineCore';
import type { WorkerLike } from '../../src/engine/StockfishManager';
import type { WorkerIn, WorkerOut } from '../../src/engine/types';

export const ENGINE_JS = join(process.cwd(), 'node_modules', 'stockfish', 'bin', 'stockfish-19-lite-single.js');

/** Runs the real Stockfish WASM build in a Node child process, exposing UCI lines. */
export function spawnEngine(): { proc: ChildProcessWithoutNullStreams; send: (cmd: string) => void; onLine: (fn: (l: string) => void) => void } {
  const proc = spawn(process.execPath, [ENGINE_JS], { stdio: 'pipe' });
  const handlers: ((l: string) => void)[] = [];
  let buf = '';
  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) handlers.forEach((h) => h(line));
    }
  });
  return { proc, send: (cmd) => proc.stdin.write(`${cmd}\n`), onLine: (fn) => handlers.push(fn) };
}

/** A WorkerLike that runs EngineSession (same code as the browser worker) against the real engine. */
export function createNodeWorker(): WorkerLike & { proc: ChildProcessWithoutNullStreams } {
  const eng = spawnEngine();
  const w: WorkerLike & { proc: ChildProcessWithoutNullStreams } = {
    proc: eng.proc,
    onmessage: null,
    onerror: null,
    postMessage(msg: WorkerIn) {
      if (msg.type === 'init') session.boot(msg.flavor, msg.threads, msg.hashMb, msg.timeoutMs);
      else if (msg.type === 'quit') eng.proc.kill();
      else session.handle(msg);
    },
    terminate() {
      eng.proc.kill();
    },
  };
  const session = new EngineSession(eng.send, (m: WorkerOut) => queueMicrotask(() => w.onmessage?.({ data: m })));
  eng.onLine((l) => session.onLine(l));
  eng.proc.on('exit', (code) => {
    if (code && code !== 0) w.onerror?.({ message: `engine exited ${code}` });
  });
  return w;
}
