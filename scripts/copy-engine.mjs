// Copies the browser Stockfish (WASM) builds from node_modules into public/engine
// so they are served as static assets in dev and bundled into the production build.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish');
const out = join(root, 'public', 'engine');

const FILES = [
  'stockfish-19.js',
  'stockfish-19.wasm',
  'stockfish-19-single.js',
  'stockfish-19-single.wasm',
  'stockfish-19-lite-single.js',
  'stockfish-19-lite-single.wasm',
  'stockfish-19-lite.js',
  'stockfish-19-lite.wasm',
  'stockfish-19-asm.js',
];

if (!existsSync(join(src, 'bin'))) {
  console.warn('[copy-engine] stockfish package not installed yet; skipping.');
  process.exit(0);
}
mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const from = join(src, 'bin', f);
  const to = join(out, f);
  if (!existsSync(from)) {
    console.error(`[copy-engine] missing ${f} in stockfish package`);
    process.exit(1);
  }
  // Re-copy when the package was updated (size or modification time differs).
  if (existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  copyFileSync(from, to);
}
copyFileSync(join(src, 'Copying.txt'), join(out, 'STOCKFISH-LICENSE.txt'));
console.log('[copy-engine] Stockfish WASM assets ready in public/engine');
