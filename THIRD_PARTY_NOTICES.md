# Third-party notices

## Stockfish (GPL-3.0)
Outpost runs the Stockfish chess engine, compiled to WebAssembly, inside your browser.

- Stockfish — Copyright (C) T. Romstad, M. Costalba, J. Kiiski, G. Linscott and the Stockfish developers (see AUTHORS).
  Source: https://github.com/official-stockfish/Stockfish
- Stockfish.js (WASM build, npm package `stockfish` v19) — Copyright (c) 2026 Chess.com, LLC, by Nathan Rugg.
  Source: https://github.com/nmrugg/stockfish.js
- NNUE network for the lite builds by Chris Bao (sscg13).

Licensed under the GNU General Public License v3. The full license text is shipped with every build at
`engine/STOCKFISH-LICENSE.txt` (copied from the package's `Copying.txt`). Because the engine is distributed
with this application, Outpost itself is released under GPL-3.0-or-later; the complete corresponding source is
this repository.

## Opening names (CC0-1.0)
`public/data/openings.json` is generated (`npm run build:openings`) from
https://github.com/lichess-org/chess-openings, dedicated to the public domain under CC0-1.0.

## Chess pieces — "Classic" set (GPLv2+)
`public/pieces/cburnett/*.svg` — Colin M.L. Burnett (https://en.wikipedia.org/wiki/User:Cburnett),
licensed GPLv2 or later (used here under GPLv3). Obtained from https://github.com/lichess-org/lila (public/piece/cburnett).

## Libraries
- chess.js — BSD-2-Clause — https://github.com/jhlywa/chess.js
- React / React DOM — MIT
- idb — ISC — https://github.com/jakearchibald/idb
- lz-string — MIT — https://github.com/pieroxy/lz-string
- Workbox (workbox-precaching, via vite-plugin-pwa) — MIT
- Manrope and JetBrains Mono fonts (via Fontsource) — SIL Open Font License 1.1

## Original assets
The logo, UI icons, classification icons, the "Outpost" and "Tokens" piece sets, board themes and color palette
are original to this project. No third-party chess-site branding or artwork is used.
