# Outpost — Chess Analysis Lab

Frontend-only chess analysis: paste a PGN or FEN, analyze with **Stockfish 19 (WebAssembly) running in a Web Worker on your own CPU**, and run a full Game Review (accuracy, move classifications, key moments, explanations, retry puzzles). No backend, no account, works offline after the first visit.

## Quick start

```bash
npm install        # also copies the Stockfish WASM builds into public/engine
npm run dev        # http://localhost:5173
npm test           # unit + integration tests (uses the real Stockfish WASM in Node)
npm run build      # type-check + production build in dist/
npm run preview    # serve dist/ with the same headers as dev
```

No manual Stockfish download is needed — the `stockfish` npm package (v19, GPL-3.0) provides the browser builds.

## Deploying (Replit or any static host)

`npm run build` produces a fully static `dist/` (relative paths, no localhost references). The included `.replit` uses a static deployment with `publicDir = "dist"`.

### Multi-threaded engine
The multi-threaded engine needs `SharedArrayBuffer`, i.e. cross-origin isolation (`COOP: same-origin`, `COEP: require-corp`).

- Dev/preview servers send these headers; `public/_headers` covers Netlify/Cloudflare Pages.
- On hosts that cannot set headers (e.g. Replit static, GitHub Pages) the bundled **service worker adds the headers** to same-origin responses. The first visit runs the single-threaded build; once the service worker controls the page (automatic reload on the empty home screen, or the next visit) the multi-threaded build is used.
- Fallback chain: multi-threaded lite → single-threaded lite → asm.js (no WebAssembly). Engine crashes trigger automatic restarts.

## Architecture

```
React UI ──► AnalysisController (src/state) ──► StockfishManager (src/engine)
                                                   ├─ AnalysisQueue  (priorities, cancel obsolete work)
                                                   ├─ AnalysisCache  (LRU memory + IndexedDB, key FEN+depth+MultiPV)
                                                   └─ stockfish.worker.ts ──► Stockfish WASM (nested worker)
```

| Folder | Contents |
|---|---|
| `src/chess` | Game tree with variations, PGN parser/exporter, FEN validation, material & quiescence helpers |
| `src/engine` | UCI parser, `EngineSession` (search sequencing, used by the worker), worker, manager, queue, cache |
| `src/review` | Expected-points model, classification (`brilliant.ts`, `great.ts`, `miss.ts`), accuracy, key moments, explanations, 3-phase review pipeline, opening book |
| `src/storage` | IndexedDB (saved analyses + engine cache), corrupt-record handling |
| `src/sharing` | lz-string URL hash sharing, printable HTML report |
| `src/components` | Board (original pieces/arrows), eval bar, graph, move list, panels, dialogs |
| `src/sw.ts` | Precache + offline + cross-origin isolation headers |

### Review model
- **Expected points / Win%**: logistic curve `Win% = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1)`, adjusted by player rating when the PGN has Elo tags (Chess.com also scales winning chances by rating).
- **Classification thresholds** (Chess.com's published expected-points loss ranges, configurable in `DEFAULT_THRESHOLDS`): Best 0 · Excellent ≤0.02 · Good ≤0.05 · Inaccuracy ≤0.10 · Mistake ≤0.20 · Blunder >0.20.
- **Brilliant** (Chess.com definition): a piece sacrifice (≥2 pawns of material lost by force — static capture search or the engine's accepted line) that is best or nearly best (tolerance widens for lower ratings), leaves the player not worse, and was not needed only because everything already wins.
- **Great**: a critical move — the only move that keeps the outcome bucket (winning / equal / losing), or the move that turns the game after the opponent's error.
- **Miss**: failing to capitalize on the opponent's mistake. **Book**: lichess-org/chess-openings positions.
- **Accuracy** (Lichess published method): move accuracy `103.1668·e^(−0.04354·ΔWin%) − 3.1669 (+1)`, game accuracy = (volatility-weighted mean + harmonic mean)/2. Also reported per phase (opening / middlegame / endgame via a Lichess-style divider).
- **Estimated rating**: accuracy mapped onto published averages of Chess.com accuracy by rating — a single-game indication only.
- Pipeline: quick scan of every position → deep re-analysis of critical moves and every sacrifice → classify. Explanations are deterministic, derived from engine scores, PVs and material counting.

Chess.com's exact algorithms (CAPS2, Classification V2, Game Rating) are not public, so results will be close but not identical. These are Outpost's own heuristics; numbers will differ from other sites.

## Keyboard
← → move · Home/End · Space play/pause · F flip · R review · A arrows · E engine on/off · Esc close/exit retry · ? help · right-drag to draw arrows.

## Known limitations
- Lite NNUE builds are used (≈1.7 MB) for fast loading; they are far stronger than any human but weaker than the 100 MB full net.
- PGN games are limited to 2 MB / 1200 half-moves; multi-game PGNs load the first game.
- Very long share links (huge annotated games) may be truncated by some messaging apps — export the PGN instead.

## License
GPL-3.0-or-later (Stockfish is GPL-3.0). See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
