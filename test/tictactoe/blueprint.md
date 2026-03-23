# Tic-Tac-Toe

A single-file HTML tic-tac-toe game.

## Requirements

- One file: `index.html` containing all HTML, CSS, and JavaScript.
- A 3×3 grid of clickable cells.
- Two players alternate turns: X and O. X goes first.
- Clicking a cell places the current player's mark. Occupied cells cannot be overwritten.
- The game detects a win (three in a row horizontally, vertically, or diagonally) and displays which player won.
- The game detects a draw (all cells filled, no winner) and displays a draw message.
- A "New Game" button resets the board.
- No external dependencies — no frameworks, no CDN links.

## Verification

After creating `index.html`, start an HTTP server to serve it:

```
npx serve . -l 3000
```

Then open the URL in the preview browser.
