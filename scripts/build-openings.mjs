// Builds src/data/openings.json from the lichess-org/chess-openings TSV files (CC0-1.0).
// Source: https://github.com/lichess-org/chess-openings
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'scripts', 'openings-src');
const key = (fen) => fen.split(' ').slice(0, 3).join(' ');

const named = {};
const book = new Set();
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.tsv')).sort()) {
  const lines = readFileSync(join(srcDir, file), 'utf8').split('\n').slice(1);
  for (const line of lines) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    const sans = pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/);
    for (const san of sans) {
      chess.move(san);
      book.add(key(chess.fen()));
    }
    const k = key(chess.fen());
    // Prefer the shortest/most general name if duplicates exist.
    if (!named[k] || named[k][1].length > name.length) named[k] = [eco, name];
  }
}
const out = { source: 'lichess-org/chess-openings (CC0-1.0)', named, book: [...book] };
writeFileSync(join(root, 'public', 'data', 'openings.json'), JSON.stringify(out));
console.log(`named=${Object.keys(named).length} book=${book.size}`);
