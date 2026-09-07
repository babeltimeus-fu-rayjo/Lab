/**
 * Slot machine reels: a row of spinning columns whose symbols blur, roll and
 * settle with a staggered stop. Purely visual — there are no paylines, bets or
 * scoring. The demo page owns the cabinet chrome and the settings controls;
 * this module owns the reels and the spin animation.
 *
 * The number of reels, the rows visible per reel and the symbol set are all
 * configurable at runtime via setConfig().
 *
 * Usage:
 *   const slots = createSlotMachine(mountEl, { reels: 3, rows: 3, symbols: ['🍒','🍋','⭐'] });
 *   slots.addEventListener('spinstart', () => ...);
 *   slots.addEventListener('spinend', (e) => console.log(e.detail.grid));
 *   slots.spin();
 *   slots.setConfig({ reels: 5, rows: 3, symbols: ['A','B','C'] });
 *   slots.spinning;  // boolean
 *   slots.destroy();
 */

const STYLE_ID = 'slot-machine-css';
const STRUCTURAL_CSS = `
.slot-reels { display: flex; gap: var(--slot-gap, 8px); justify-content: center; }
.slot-reel {
  position: relative;
  width: var(--slot-cell);
  height: calc(var(--slot-cell) * var(--slot-rows));
  overflow: hidden;
}
.slot-strip { display: flex; flex-direction: column; will-change: transform; }
.slot-strip.is-blur { filter: blur(1px); }
.slot-cell {
  flex: 0 0 var(--slot-cell);
  width: var(--slot-cell);
  height: var(--slot-cell);
  display: grid;
  place-items: center;
  font-size: calc(var(--slot-cell) * 0.58);
  line-height: 1;
  user-select: none;
  -webkit-user-select: none;
}`;

function injectCSS() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STRUCTURAL_CSS;
  document.head.appendChild(style);
}

export function createSlotMachine(container, options = {}) {
  injectCSS();

  const cfg = {
    reels: 3,
    rows: 3,
    symbols: ['🍒', '🍋', '🍊', '🍇', '🔔', '⭐', '💎', '7️⃣'],
    baseDuration: 1500, // ms for the first reel
    stagger: 340, // extra ms per reel (scaled down for many reels)
    minCell: 44,
    maxCell: 104,
    gap: 8,
    ...options,
  };
  cfg.symbols = cfg.symbols.slice();

  const api = new EventTarget();
  const root = document.createElement('div');
  root.className = 'slot-reels';
  container.appendChild(root);
  container.style.setProperty('--slot-gap', `${cfg.gap}px`);

  let reels = []; // { reelEl, stripEl, current: string[] }
  let spinning = false;
  let cellPx = cfg.maxCell;

  const randSym = () => cfg.symbols[(Math.random() * cfg.symbols.length) | 0];
  const pick = (n) => Array.from({ length: n }, randSym);

  function makeCell(sym) {
    const c = document.createElement('div');
    c.className = 'slot-cell';
    c.textContent = sym;
    return c;
  }
  const setCells = (strip, syms) => strip.replaceChildren(...syms.map(makeCell));

  function layout() {
    const w = container.clientWidth || root.clientWidth || 320;
    const raw = Math.floor((w - cfg.gap * (cfg.reels + 1)) / cfg.reels);
    cellPx = Math.max(cfg.minCell, Math.min(cfg.maxCell, raw));
    container.style.setProperty('--slot-cell', `${cellPx}px`);
    container.style.setProperty('--slot-rows', String(cfg.rows));
  }

  function build() {
    root.replaceChildren();
    reels = [];
    for (let i = 0; i < cfg.reels; i++) {
      const reelEl = document.createElement('div');
      reelEl.className = 'slot-reel';
      const stripEl = document.createElement('div');
      stripEl.className = 'slot-strip';
      const current = pick(cfg.rows);
      setCells(stripEl, current);
      reelEl.appendChild(stripEl);
      root.appendChild(reelEl);
      reels.push({ reelEl, stripEl, current });
    }
    layout();
  }

  function spinReel(reel, index) {
    return new Promise((resolve) => {
      const rows = cfg.rows;
      const effStagger = Math.min(cfg.stagger, 1300 / Math.max(1, cfg.reels - 1));
      const duration = cfg.baseDuration + index * effStagger + Math.random() * 160;
      const fill = 14 + index * 5 + ((Math.random() * 6) | 0);

      const finalSyms = pick(rows);
      const cells = [...reel.current, ...pick(fill), ...finalSyms, randSym()]; // trailing buffer
      const strip = reel.stripEl;

      strip.style.transition = 'none';
      strip.style.transform = 'translateY(0)';
      setCells(strip, cells);
      void strip.offsetHeight; // reflow so the next transform animates

      strip.classList.add('is-blur');
      const distance = (rows + fill) * cellPx; // brings finalSyms into the window
      strip.style.transition = `transform ${duration}ms cubic-bezier(0.18, 0.72, 0.16, 1)`;
      strip.style.transform = `translateY(${-distance}px)`;

      const unblur = setTimeout(() => strip.classList.remove('is-blur'), Math.max(0, duration - 240));
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        clearTimeout(unblur);
        clearTimeout(fallback);
        strip.removeEventListener('transitionend', onEnd);
        strip.classList.remove('is-blur');
        strip.style.transition = 'none';
        strip.style.transform = 'translateY(0)';
        setCells(strip, finalSyms);
        reel.current = finalSyms;
        reel.reelEl.classList.remove('just-stopped');
        void reel.reelEl.offsetWidth;
        reel.reelEl.classList.add('just-stopped');
        resolve();
      };
      const onEnd = (e) => {
        if (e.target === strip && e.propertyName === 'transform') settle();
      };
      strip.addEventListener('transitionend', onEnd);
      const fallback = setTimeout(settle, duration + 140);
    });
  }

  async function spin() {
    if (spinning || cfg.symbols.length === 0) return;
    spinning = true;
    layout();
    api.dispatchEvent(new CustomEvent('spinstart'));
    await Promise.all(reels.map((reel, i) => spinReel(reel, i)));
    spinning = false;
    api.dispatchEvent(new CustomEvent('spinend', { detail: { grid: reels.map((r) => r.current.slice()) } }));
  }

  function setConfig(next = {}) {
    if (spinning) return;
    if (Array.isArray(next.symbols)) next = { ...next, symbols: next.symbols.slice() };
    Object.assign(cfg, next);
    if (!cfg.symbols.length) cfg.symbols = ['❔'];
    cfg.reels = Math.max(1, Math.round(cfg.reels));
    cfg.rows = Math.max(1, Math.round(cfg.rows));
    build();
  }

  const observer = new ResizeObserver(() => { if (!spinning) layout(); });
  observer.observe(container);
  build();

  Object.assign(api, {
    root,
    spin,
    setConfig,
    destroy() {
      observer.disconnect();
      root.remove();
    },
  });
  Object.defineProperties(api, {
    spinning: { get: () => spinning, enumerable: true },
    config: { get: () => ({ reels: cfg.reels, rows: cfg.rows, symbols: cfg.symbols.slice() }), enumerable: true },
  });
  return api;
}
