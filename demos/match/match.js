/**
 * Scratch Match: a grid of scratch-off cells hiding symbols. Reveal X of the
 * same symbol anywhere on the card to win — a "match X" instant-win ticket.
 * Every cell is its own mini scratch card (it reuses scratcher.js).
 *
 * Knobs:
 *   - scratchLimit: how many cells you may commit to. Touching a cell commits it
 *     (no free peeking); when the limit is spent the rest lock.
 *   - rows / cols: grid shape.
 *   - matchTarget (X): how many of a kind you need.
 *   - completeAt: the per-cell scratch fraction that auto-reveals that cell.
 *   - result: 'random' | 'win' (a match is guaranteed within the limit) |
 *     'lose' (no symbol appears X times, so a match is impossible).
 *
 * The scratcher factory is injected so the page can cache-bust both modules:
 *   createMatch(el, { createScratcher, rows, cols, scratchLimit, matchTarget, result });
 *
 * Events: deal {rows,cols,limit,total,target}, commit {used,limit},
 *   reveal {revealed,total}, match {symbol,count,cells}, exhausted {used,limit}.
 */

const SYMBOLS = [
  '🍒', '🍋', '🍇', '🍊', '🍎', '🍉', '🍓', '🍑', '🍍', '🥝',
  '🔔', '💎', '🍀', '🎈', '🪙', '⭐', '🌟', '🎲', '🎸', '🚀',
  '🎁', '🔑', '👑', '💰', '🧭', '🪁', '🌈', '⚡', '🔥', '❄️',
  '🌙', '☀️', '⚽', '🏀', '🎾', '🍄', '🌻', '🐳', '🦊', '🐼',
];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export function createMatch(container, options = {}) {
  const makeScratcher = options.createScratcher;
  if (typeof makeScratcher !== 'function') {
    throw new Error('createMatch needs options.createScratcher');
  }

  const cfg = {
    rows: 5,
    cols: 5,
    scratchLimit: 12,
    matchTarget: 3,
    result: 'random', // 'random' | 'win' | 'lose'
    brushRadius: 16,
    completeAt: 0.55,
    ...options,
  };

  const api = new EventTarget();
  const emit = (type, detail = {}) => api.dispatchEvent(new CustomEvent(type, { detail }));

  let cells = []; // { el, face, scratcher, sym, started, revealed, i }
  let used = 0;
  let revealedCount = 0;
  let won = false;
  let revealingAll = false;

  Object.assign(container.style, { display: 'grid', gap: 'clamp(4px, 1.4vw, 10px)' });

  // Fill the given cell indices with symbols (never `exclude`), each used at most
  // X-1 times, so none of them can form a match on its own.
  function fillCapped(out, indices, X, exclude) {
    const pool = shuffle(SYMBOLS.filter((s) => s !== exclude));
    const need = Math.max(1, Math.ceil(indices.length / (X - 1)));
    const chosen = pool.slice(0, Math.min(need, pool.length));
    const bag = [];
    for (let i = 0; bag.length < indices.length; i++) bag.push(chosen[i % chosen.length]);
    shuffle(bag);
    indices.forEach((idx, k) => { out[idx] = bag[k]; });
  }

  // Decide the hidden symbol for every cell, honouring the predetermined result.
  function generateSymbols() {
    const total = cfg.rows * cfg.cols;
    const X = cfg.matchTarget;
    const limit = cfg.scratchLimit;
    const out = new Array(total);

    if (cfg.result === 'win') {
      // Guarantee a win by the time the whole budget is spent: draw the card from
      // at most D distinct symbols where (X-1)·D < limit, so ANY `limit` reveals
      // must contain X of a kind (pigeonhole). Spread those symbols as evenly as
      // possible (round-robin, then shuffle positions) so the winning scratch
      // lands at a varied, usually-late point — the latest it can hide is
      // (X-1)·D + 1 ≤ limit — rather than snapping shut on the first few cells.
      const dMax = Math.max(1, Math.floor((limit - 1) / (X - 1)));
      const D = clamp(dMax, 1, Math.min(SYMBOLS.length, total));
      const pool = shuffle(SYMBOLS.slice()).slice(0, D);
      const bag = [];
      for (let i = 0; bag.length < total; i++) bag.push(pool[i % D]);
      shuffle(bag);
      for (let i = 0; i < total; i++) out[i] = bag[i];
    } else if (cfg.result === 'lose') {
      // Every symbol used at most X-1 times → no match can ever complete.
      fillCapped(out, [...Array(total).keys()], X, null);
    } else {
      for (let i = 0; i < total; i++) out[i] = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    }
    return out;
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
    checkMatch();
  }

  function lockUntouched() {
    for (const cell of cells) if (!cell.started && !cell.revealed) lock(cell);
    if (!won) emit('exhausted', { used, limit: cfg.scratchLimit });
  }

  function lock(cell) {
    cell.el.classList.add('is-locked');
    cell.scratcher.canvas.style.pointerEvents = 'none';
  }

  function checkMatch() {
    if (won) return;
    const groups = new Map(); // symbol -> [revealed cell indices]
    for (const cell of cells) {
      if (!cell.revealed) continue;
      const g = groups.get(cell.sym) || [];
      g.push(cell.i);
      groups.set(cell.sym, g);
    }
    for (const [sym, idxs] of groups) {
      if (idxs.length < cfg.matchTarget) continue;
      won = true;
      for (const idx of idxs) cells[idx].el.classList.add('is-win');
      for (const cell of cells) if (!cell.revealed) lock(cell); // round over
      emit('match', { symbol: sym, count: idxs.length, cells: idxs });
      return;
    }
  }

  function build() {
    for (const cell of cells) cell.scratcher.destroy();
    container.replaceChildren();
    cells = [];
    used = 0;
    revealedCount = 0;
    won = false;

    container.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;
    const syms = generateSymbols();
    const n = cfg.rows * cfg.cols;

    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'match-cell';
      const face = document.createElement('div');
      face.className = 'match-face';
      face.textContent = syms[i];
      el.appendChild(face);
      container.appendChild(el);

      const scratcher = makeScratcher(el, {
        brushRadius: cfg.brushRadius,
        completeAt: cfg.completeAt,
        label: '',
        speckles: 120,
      });
      const cell = { el, face, scratcher, sym: syms[i], started: false, revealed: false, i };
      scratcher.addEventListener('progress', (e) => onProgress(cell, e.detail.fraction));
      scratcher.addEventListener('complete', () => onComplete(cell));
      cells.push(cell);
    }

    emit('deal', { rows: cfg.rows, cols: cfg.cols, limit: cfg.scratchLimit, total: n, target: cfg.matchTarget });
    emit('commit', { used, limit: cfg.scratchLimit });
    emit('reveal', { revealed: revealedCount, total: n });
  }

  function revealAll() {
    revealingAll = true;
    for (const cell of cells) {
      cell.el.classList.remove('is-locked');
      cell.scratcher.reveal(); // fires 'complete' → onComplete → checkMatch
    }
    revealingAll = false;
    checkMatch();
  }

  function setConfig(next = {}) {
    Object.assign(cfg, next);
    cfg.rows = clamp(Math.round(cfg.rows), 3, 6);
    cfg.cols = clamp(Math.round(cfg.cols), 3, 6);
    const total = cfg.rows * cfg.cols;
    cfg.scratchLimit = clamp(Math.round(cfg.scratchLimit), 2, total);
    cfg.matchTarget = clamp(Math.round(cfg.matchTarget), 2, Math.min(5, cfg.scratchLimit, total));
    build(); // any card setting deals a fresh card
  }

  // Per-cell reveal threshold (fraction). Applies live and to future cells.
  function setThreshold(value) {
    cfg.completeAt = clamp(Number(value) || cfg.completeAt, 0.05, 1);
    for (const cell of cells) cell.scratcher.setThreshold(cfg.completeAt);
  }

  build();

  Object.assign(api, {
    setConfig,
    setThreshold,
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
    target: { get: () => cfg.matchTarget, enumerable: true },
    threshold: { get: () => cfg.completeAt, enumerable: true },
    used: { get: () => used, enumerable: true },
    revealed: { get: () => revealedCount, enumerable: true },
    total: { get: () => cells.length, enumerable: true },
    won: { get: () => won, enumerable: true },
  });
  return api;
}
