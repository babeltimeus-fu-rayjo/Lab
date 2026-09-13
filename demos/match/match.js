/**
 * Scratch Match: a grid of scratch-off cells hiding symbols. Reveal X of the
 * same symbol anywhere on the card to win — a "match X" instant-win ticket.
 * Every cell is its own mini scratch card (it reuses scratcher.js).
 *
 * EVERY card holds a winnable set of X. What the predetermined result changes is
 * whether your budget can reach it:
 *   - 'win'    the match is scheduled to complete on scratch T, drawn from
 *              [X, limit], so it always lands — but with scratches to spare it
 *              rarely lands on the first X, and falls somewhere different each game.
 *   - 'lose'   the set is scattered as a fair card would scatter it, rejecting
 *              only the draws where every copy lands in reach — so you usually
 *              turn up one or two and just miss the last, and sometimes none of
 *              your scratches were in it. Reveal all shows what you missed.
 *   - 'random' a fixed card that always holds a set; finding it is luck.
 *
 * Because a losing card must keep X cells out of reach, the scratch limit is
 * bounded to [X, total - X].
 *
 * Knobs: rows/cols, scratchLimit (touching a cell commits it — no free peeking),
 * matchTarget (X), completeAt (per-cell reveal threshold).
 *
 * The scratcher factory is injected so the page can cache-bust both modules:
 *   createMatch(el, { createScratcher, rows, cols, scratchLimit, matchTarget, result });
 *
 * Events: deal {rows,cols,limit,total,target}, commit {used,limit},
 *   reveal {revealed,total}, match {symbol,count,cells}, missed {symbol,cells},
 *   exhausted {used,limit}.
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
  let missed = false;
  let revealingAll = false;
  // Dealt-as-you-scratch state. `plan` marks which scratch numbers show the
  // winning symbol; `keySym` is the symbol that forms the set (won on a 'win'
  // card, missed on a 'lose' one); `fillerBag` holds everything else, capped at
  // X-1 copies so only keySym can ever complete a match.
  let plan = [];
  let keySym = null;
  let fillerBag = [];
  let assigned = 0;
  let missSlots = new Set(); // lose: deals past the budget that carry the set

  Object.assign(container.style, { display: 'grid', gap: 'clamp(4px, 1.4vw, 10px)' });

  const scheduling = () => cfg.result === 'win' || cfg.result === 'lose';

  // Everything that isn't the key symbol, capped at X-1 copies each.
  function buildFillerBag(slots, X, exclude) {
    fillerBag = [];
    for (const f of shuffle(SYMBOLS.filter((s) => s !== exclude))) {
      for (let j = 0; j < X - 1 && fillerBag.length < slots; j++) fillerBag.push(f);
      if (fillerBag.length >= slots) break;
    }
    shuffle(fillerBag);
  }

  // A predetermined win: the match completes on scratch T, drawn anywhere in
  // [X, limit], so it always lands but seldom on the first X.
  function planWin() {
    const total = cfg.rows * cfg.cols;
    const X = cfg.matchTarget;
    keySym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    const T = X + Math.floor(Math.random() * (cfg.scratchLimit - X + 1)); // X..limit
    plan = new Array(cfg.scratchLimit).fill(false);
    plan[T - 1] = true; // the scratch that completes the match
    for (const i of shuffle([...Array(T - 1).keys()]).slice(0, X - 1)) plan[i] = true;
    buildFillerBag(total - X, X, keySym);
    assigned = 0;
  }

  // A predetermined loss. How many of the set fall within reach is drawn the way
  // a fair card would fall — scatter X symbols over the grid and count how many
  // land in the first `limit` deals — rejecting only the case where all X land in
  // reach, since that one is a win. So a loss is statistically indistinguishable
  // from an unlucky honest card: usually you turn up one or two of the symbol and
  // just miss the last, sometimes none of your scratches were in it at all.
  function planLose() {
    const total = cfg.rows * cfg.cols;
    const X = cfg.matchTarget;
    const limit = cfg.scratchLimit;
    keySym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

    let spots;
    do {
      spots = shuffle([...Array(total).keys()]).slice(0, X);
    } while (spots.every((p) => p < limit)); // all in reach would complete the match

    plan = new Array(limit).fill(false);
    missSlots = new Set();
    for (const p of spots) {
      if (p < limit) plan[p] = true; // turns up among the scratches you can make
      else missSlots.add(p + 1); // dealt past the budget — the one you can't get
    }
    buildFillerBag(total - X, X, keySym);
    assigned = 0;
  }

  // Scheduled cards hand out symbols as cells are opened, so the set lands where
  // the plan says regardless of which cells the player picks.
  function assignCell(cell) {
    if (cell.sym != null) return;
    const k = ++assigned;
    const isKey = cfg.result === 'win'
      ? !!plan[k - 1]
      : (k <= cfg.scratchLimit ? !!plan[k - 1] : missSlots.has(k));
    const sym = isKey ? keySym : (fillerBag.pop() ?? keySym);
    cell.sym = sym;
    cell.face.textContent = sym;
  }

  // A fixed card for 'random' — still guaranteed to hold at least one set of X.
  function generateSymbols() {
    const total = cfg.rows * cfg.cols;
    const X = cfg.matchTarget;
    const out = new Array(total);
    const P = clamp(Math.round(total / X), X, SYMBOLS.length); // repeats stay plausible
    const pool = shuffle(SYMBOLS.slice()).slice(0, P);
    for (let i = 0; i < total; i++) out[i] = pool[Math.floor(Math.random() * P)];
    ensureWinnable(out, X);
    return out;
  }

  function ensureWinnable(arr, X) {
    const count = new Map();
    for (const s of arr) count.set(s, (count.get(s) || 0) + 1);
    let best = arr[0];
    let bestC = 0;
    for (const [s, c] of count) if (c > bestC) { best = s; bestC = c; }
    if (bestC >= X) return;
    const spare = shuffle([...arr.keys()]).filter((i) => arr[i] !== best).slice(0, X - bestC);
    for (const i of spare) arr[i] = best;
  }

  function onProgress(cell, fraction) {
    if (revealingAll || won || cell.started || fraction <= 0) return;
    if (used >= cfg.scratchLimit) return; // untouched cells are already locked
    cell.started = true; // touching a cell commits it — no free peeking
    assignCell(cell); // scheduled cards decide the symbol as the cell is opened
    used++;
    emit('commit', { used, limit: cfg.scratchLimit });
    if (used >= cfg.scratchLimit) lockUntouched();
  }

  function onComplete(cell) {
    if (cell.revealed) return;
    assignCell(cell); // safety: a cell can pop open the moment the threshold drops
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
    if (won || missed) return;
    const groups = new Map(); // symbol -> [revealed cell indices]
    for (const cell of cells) {
      if (!cell.revealed) continue;
      const g = groups.get(cell.sym) || [];
      g.push(cell.i);
      groups.set(cell.sym, g);
    }
    for (const [sym, idxs] of groups) {
      if (idxs.length < cfg.matchTarget) continue;
      // A set that only turns up once everything is uncovered wasn't reachable
      // with the scratches on offer — show it as missed, not as a win. (A
      // predetermined winner is the exception: that card really is a winner.)
      if (revealingAll && cfg.result !== 'win') {
        missed = true;
        // Separate the ones you actually turned up from the ones you never got to.
        const reached = idxs.filter((i) => cells[i].started).length;
        for (const idx of idxs) {
          cells[idx].el.classList.add(cells[idx].started ? 'is-missed' : 'is-outofreach');
        }
        emit('missed', { symbol: sym, cells: idxs, reached });
        return;
      }
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
    missed = false;
    assigned = 0;

    container.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;
    const scheduled = scheduling();
    if (cfg.result === 'win') planWin();
    else if (cfg.result === 'lose') planLose();
    const syms = scheduled ? null : generateSymbols();
    const n = cfg.rows * cfg.cols;

    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'match-cell';
      const face = document.createElement('div');
      face.className = 'match-face';
      face.textContent = scheduled ? '' : syms[i];
      el.appendChild(face);
      container.appendChild(el);

      const scratcher = makeScratcher(el, {
        brushRadius: cfg.brushRadius,
        completeAt: cfg.completeAt,
        label: '',
        speckles: 120,
      });
      const cell = { el, face, scratcher, sym: scheduled ? null : syms[i], started: false, revealed: false, i };
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
    // Deal the rest of the card in a random order first, so the set that decides
    // things doesn't always surface in the same corner of the grid.
    for (const cell of shuffle(cells.slice())) assignCell(cell);
    for (const cell of cells) {
      cell.el.classList.remove('is-locked');
      cell.scratcher.reveal(); // fires 'complete' → onComplete → checkMatch
    }
    checkMatch();
    revealingAll = false;
  }

  // A losing card has to keep X cells out of reach, so the budget tops out at
  // total - X; X in turn can never exceed half the grid.
  function normalize() {
    cfg.rows = clamp(Math.round(cfg.rows), 3, 6);
    cfg.cols = clamp(Math.round(cfg.cols), 3, 6);
    const total = cfg.rows * cfg.cols;
    cfg.matchTarget = clamp(Math.round(cfg.matchTarget), 2, Math.min(5, Math.floor(total / 2)));
    cfg.scratchLimit = clamp(Math.round(cfg.scratchLimit), cfg.matchTarget, total - cfg.matchTarget);
  }

  function setConfig(next = {}) {
    Object.assign(cfg, next);
    normalize();
    build(); // any card setting deals a fresh card
  }

  // Per-cell reveal threshold (fraction). Applies live and to future cells.
  function setThreshold(value) {
    cfg.completeAt = clamp(Number(value) || cfg.completeAt, 0.05, 1);
    for (const cell of cells) cell.scratcher.setThreshold(cfg.completeAt);
  }

  normalize();
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
    missed: { get: () => missed, enumerable: true },
  });
  return api;
}
