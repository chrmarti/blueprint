# Game of Life

A browser-based implementation of [Conway's Game of Life](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life).

## Folder Structure

```
src/           ← TypeScript source files
dist/          ← build output — not checked in
```

## Tech Stack

- **TypeScript** — source language
- **esbuild** — bundler (IIFE for browser)

## Build

```
npm run build   # bundle src/main.ts → dist/app.js
npm start       # open dist/index.html in the default browser
```

## Rules

The universe is a two-dimensional grid of cells. Each cell is either **alive** or **dead**.
At each step, the following rules apply:

1. Any live cell with fewer than two live neighbours dies (underpopulation).
2. Any live cell with two or three live neighbours lives on.
3. Any live cell with more than three live neighbours dies (overpopulation).
4. Any dead cell with exactly three live neighbours becomes alive (reproduction).

## Architecture

### `src/grid.ts` — Grid Model

- `Grid` class holding a `width × height` boolean array.
- `get(x, y)` / `set(x, y, alive)` — cell access with wrapping (toroidal topology).
- `countNeighbours(x, y)` — returns the count of live neighbours (0–8).
- `step()` — returns a new `Grid` with the next generation applied.
- `randomize(density)` — fills the grid randomly with the given alive probability.
- `clear()` — sets all cells to dead.

### `src/renderer.ts` — Canvas Renderer

- `Renderer` class that takes a `<canvas>` element and a `Grid`.
- `draw(grid)` — renders the grid to the canvas. Live cells are filled, dead cells are background.
- `cellSize` — configurable pixel size per cell (default: 8).
- `colors` — configurable alive/dead/grid colors.
- `getCellAt(canvasX, canvasY)` — converts canvas pixel coordinates to grid coordinates (for click-to-toggle).

### `src/main.ts` — Application Entry Point

- Creates a `Grid` (default 80×60) and a `Renderer`.
- Provides UI controls:
  - **Start/Stop** button to toggle the simulation loop.
  - **Step** button to advance one generation.
  - **Clear** button to kill all cells.
  - **Random** button to randomize the grid.
  - **Speed** slider to control the step interval (50ms–500ms).
  - **Generation counter** showing the current generation number.
- Click on the canvas to toggle individual cells.
- Starts paused so the user can set up a pattern before running.
- **Presets** dropdown to load well-known patterns (see below), centered on the grid.

## Presets

The following classic patterns should be available from a dropdown in the control bar.
Each preset clears the grid, places the pattern in the center, and resets the generation counter.

### Still Lifes
- **Block** — 2×2 square
- **Beehive** — 6 cells in a hexagonal shape
- **Loaf** — 7-cell stable pattern

### Oscillators
- **Blinker** — 3 cells in a line (period 2)
- **Toad** — 6 cells (period 2)
- **Pulsar** — 48 cells (period 3)
- **Pentadecathlon** — 12 cells (period 15)

### Spaceships
- **Glider** — 5-cell pattern that moves diagonally
- **LWSS** (Lightweight Spaceship) — 9 cells, moves horizontally
- **MWSS** (Middleweight Spaceship) — 11 cells, moves horizontally

### Methuselahs
- **R-pentomino** — 5 cells, stabilizes after 1103 generations
- **Diehard** — 7 cells, dies after 130 generations
- **Acorn** — 7 cells, stabilizes after 5206 generations

### `src/index.html` — HTML Shell

- Minimal HTML page with a `<canvas>` element and a control bar.
- Loads `app.js` (the bundled output).
- Dark background, centered canvas with a subtle border.

### `build.mjs` — Build Script

- Bundles `src/main.ts` → `dist/app.js` (IIFE, ES2020, sourcemap).
- Copies `src/index.html` → `dist/index.html`.

### `package.json`

- `name`: `game-of-life`
- Scripts: `build`, `start` (opens `dist/index.html`).
- Dev dependencies: `esbuild`, `typescript`.
- No runtime dependencies.
