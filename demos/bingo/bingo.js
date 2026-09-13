/**
 * Scratch Bingo: a grid of scratch-off cells laid over a bingo card. Every cell
 * is its own mini scratch card (it reuses the scratcher primitive) hiding either
 * a BINGO star — a "hit" — or a dud icon. Reveal a full line (any row, any
 * column, or a diagonal on a square grid) of stars to score a BINGO.
 *
 * Three knobs:
 *   - scratchLimit: how many cells you may commit to. Touching a cell commits it
 *     (so you can't peek for free); once the limit is used the rest lock.
 *   - rows / cols: the grid shape. Diagonals only count when it is square.
 *   - result: 'random' | 'win' (a star line is guaranteed) | 'lose' (no line can
 *     ever complete).
 *
 * The scratcher factory is injected so the page can cache-bust both modules:
 *   createBingo(el, { createScratcher, rows, cols, scratchLimit, result });
 *
 * Events: deal {rows,cols,limit,total}, commit {used,limit}, reveal
 *   {revealed,total}, bingo {lines,cells}, exhausted {used,limit}, reset.
 */

const HIT = '⭐';
const DUDS = ['🍒', '🔔', '💎', '🍋', '🍀', '🍇', '🎈', '🪙', '🍊', '🃏'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createBingo(container, options = {}) {
  const makeScratcher = options.createScratcher;
  if (typeof makeScratcher !== 'function') {
    throw new Error('createBingo needs options.createScratcher');
  }

  const cfg = {
    rows: 5,
    cols: 5,
    scratchLimit: 12,
    result: 'random', // 'random' | 'win' | 'lose'
    brushRadius: 16,
    completeAt: 0.55,
    ...options,
  };

  const api = new EventTarget();
  const emit = (type, detail = {}) => api.dispatchEvent(new CustomEvent(type, { detail }));

  let cells = []; // { el, face, scratcher, hit, started, revealed, i }
  let used = 0;
  let revealedCount = 0;
  let won = false;
  let revealingAll = false;

  Object.assign(container.style, { display: 'grid', gap: 'clamp(4px, 1.4vw, 10px)' });

  // Every winning line, as arrays of flat cell indices.
  function lines() {
    const R = cfg.rows, C = cfg.cols, out = [];
    for (let r = 0; r < R; r++) out.push(Array.from({ length: C }, (_, c) => r * C + c));
    for (let c = 0; c < C; c++) out.push(Array.from({ length: R }, (_, r) => r * C + c));
    if (R === C) {
      out.push(Array.from({ length: R }, (_, k) => k * C + k));
      out.push(Array.from({ length: R }, (_, k) => k * C + (C - 1 - k)));
    }
    return out;
  }
  const lineMin = () => Math.min(cfg.rows, cfg.cols);

  // Decide which cells hide a star, honouring the predetermined result.
  function generateHits() {
    const R = cfg.rows, C = cfg.cols, n = R * C;
    const hits = new Array(n).fill(false);
    const L = lines();

    if (cfg.result === 'win') {
      const line = L[Math.floor(Math.random() * L.length)];
      for (const idx of line) hits[idx] = true;
      // A light sprinkle of extra stars so the winning line isn't the only one lit.
      for (let i = 0; i < n; i++) if (!hits[i] && Math.random() < 0.14) hits[i] = true;
    } else if (cfg.result === 'lose') {
      for (let i = 0; i < n; i++) hits[i] = Math.random() < 0.42;
      // Clear a cell from any complete line until none remain. We only ever
      // remove stars, so this strictly decreases and always terminates.
      for (let guard = 0; guard < 1000; guard++) {
        const bad = L.find((line) => line.every((idx) => hits[idx]));
        if (!bad) break;
        hits[bad[Math.floor(bad.length / 2)]] = false;
      }
    } else {
      for (let i = 0; i < n; i++) hits[i] = Math.random() < 0.35;
    }
    return hits;
  }

  function onProgress(cell, fraction) {
    if (revealingAll || won || cell.started || fraction <= 0) return;
    if (used >= cfg.scratchLimit) return; // untouched cells are already locked
    cell.started = true; // touching a cell commits it — no free peeking
    used++;
    emit('commit', { used, limit: cfg.scratchLimit });
    if (used >= cfg.scratchLimit) lockUntouched();
  }

  function onComplete(cell) {
    if (cell.revealed) return;
    cell.revealed = true;
    revealedCount++;
    emit('reveal', { revealed: revealedCount, total: cells.length });
    checkBingo();
  }

  function lockUntouched() {
    for (const cell of cells) {
      if (!cell.started && !cell.revealed) lock(cell);
    }
    if (!won) emit('exhausted', { used, limit: cfg.scratchLimit });
  }

  function lock(cell) {
    cell.el.classList.add('is-locked');
    cell.scratcher.canvas.style.pointerEvents = 'none';
  }

  function checkBingo() {
    if (won) return;
    const winners = lines().filter((line) => line.every((idx) => cells[idx].revealed && cells[idx].hit));
    if (!winners.length) return;
    won = true;
    const winCells = new Set(winners.flat());
    for (const idx of winCells) cells[idx].el.classList.add('is-win');
    for (const cell of cells) if (!cell.revealed) lock(cell); // round over
    emit('bingo', { lines: winners, cells: [...winCells] });
  }

  function build() {
    for (const cell of cells) cell.scratcher.destroy();
    container.replaceChildren();
    cells = [];
    used = 0;
    revealedCount = 0;
    won = false;

    container.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;
    const hits = generateHits();
    const n = cfg.rows * cfg.cols;

    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'bingo-cell';
      const face = document.createElement('div');
      face.className = 'bingo-face' + (hits[i] ? ' is-hit' : '');
      face.textContent = hits[i] ? HIT : DUDS[(i * 7 + Math.floor(i / cfg.cols) * 3) % DUDS.length];
      el.appendChild(face);
      container.appendChild(el);

      const scratcher = makeScratcher(el, {
        brushRadius: cfg.brushRadius,
        completeAt: cfg.completeAt,
        label: '',
        speckles: 120,
      });
      const cell = { el, face, scratcher, hit: hits[i], started: false, revealed: false, i };
      scratcher.addEventListener('progress', (e) => onProgress(cell, e.detail.fraction));
      scratcher.addEventListener('complete', () => onComplete(cell));
      cells.push(cell);
    }

    emit('deal', { rows: cfg.rows, cols: cfg.cols, limit: cfg.scratchLimit, total: n });
    emit('commit', { used, limit: cfg.scratchLimit });
    emit('reveal', { revealed: revealedCount, total: n });
  }

  function revealAll() {
    revealingAll = true;
    for (const cell of cells) {
      cell.el.classList.remove('is-locked');
      cell.scratcher.reveal(); // fires 'complete' → onComplete → checkBingo
    }
    revealingAll = false;
    checkBingo();
  }

  function setConfig(next = {}) {
    Object.assign(cfg, next);
    cfg.rows = clamp(Math.round(cfg.rows), 3, 6);
    cfg.cols = clamp(Math.round(cfg.cols), 3, 6);
    cfg.scratchLimit = clamp(Math.round(cfg.scratchLimit), 1, cfg.rows * cfg.cols);
    build(); // any change deals a fresh card
  }

  build();

  Object.assign(api, {
    setConfig,
    revealAll,
    newCard: build,
    reset: build,
    destroy() {
      for (const cell of cells) cell.scratcher.destroy();
      container.replaceChildren();
      cells = [];
    },
  });
  Object.defineProperties(api, {
    rows: { get: () => cfg.rows, enumerable: true },
    cols: { get: () => cfg.cols, enumerable: true },
    limit: { get: () => cfg.scratchLimit, enumerable: true },
    lineMin: { get: () => lineMin(), enumerable: true },
    used: { get: () => used, enumerable: true },
    revealed: { get: () => revealedCount, enumerable: true },
    total: { get: () => cells.length, enumerable: true },
    won: { get: () => won, enumerable: true },
  });
  return api;
}
