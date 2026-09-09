/**
 * Drop-to-win (Plinko) board: balls fall from the top, bounce through a
 * staggered peg field and land in prize slots along the bottom. The board's
 * width (columns / slots), height (peg rows), the number of balls per drop and
 * the drop position across the top are all configurable. Simple 2D physics on a
 * canvas — gravity, peg and wall collisions with restitution and a little
 * jitter so no two balls match.
 *
 * Usage:
 *   const game = createDropGame(mountEl, { width: 9, height: 12, ballCount: 25 });
 *   game.addEventListener('land', (e) => console.log(e.detail.slot, e.detail.value));
 *   game.drop();               // drop `ballCount` balls at the current drop position
 *   game.drop(1, 0.2);         // drop one ball 20% across the top (e.g. from a click)
 *   game.setDropX(0.75);       // move the release point to 75% across
 *   game.setConfig({ width: 7, height: 10 });
 *   game.reset();
 *   game.dropped; game.total; game.dropX; game.busy; game.destroy();
 */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Slot heat colour from cool (low multiplier) to hot (high multiplier).
function heat(t) {
  const stops = [
    [56, 189, 248], // sky
    [52, 211, 153], // green
    [250, 204, 21], // amber
    [249, 115, 22], // orange
    [239, 68, 68], // red
  ];
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(i + 1, stops.length - 1)];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function multipliers(n) {
  const mid = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => {
    const d = mid === 0 ? 0 : Math.abs(i - mid) / mid; // 0 centre → 1 edge
    const v = 0.3 + Math.pow(d, 2.3) * 14;
    return Math.round(v * 10) / 10;
  });
}

// Small seeded PRNG so a predetermined ball can replay one specific NATURAL run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FIXED_DT = 1 / 300; // physics step used to pre-compute a predetermined ball's path

export function createDropGame(container, options = {}) {
  const cfg = {
    width: 9, // number of slots / columns
    height: 12, // number of peg rows
    ballCount: 25, // balls per drop
    dropX: 0.5, // fraction across the top where balls are released (0 = left, 1 = right)
    targetSlot: null, // predetermined landing slot index, or null for natural physics
    maxBalls: 300, // safety cap on live balls
    gravity: 2000,
    restitution: 0.5,
    substeps: 6, // physics steps per frame — enough that fast balls never tunnel through pegs
    spawnInterval: 70, // ms between staggered spawns
    ...options,
  };

  const api = new EventTarget();
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W = 0;
  let H = 0;
  let dpr = 1;
  let pegs = [];
  let pegRows = []; // pegs grouped by row, so collisions only check the nearby row(s)
  let pegRowGap = 1;
  let dividers = []; // x positions of slot walls
  let slots = []; // { x0, x1, value, count, flash }
  let balls = [];
  let pegR = 4;
  let ballR = 6;
  let binW = 40;
  let pegAreaTop = 0;
  let pegAreaBottom = 0;

  let dropped = 0;
  let total = 0;
  let maxCount = 0;
  let spawnQueue = []; // x-fractions of balls waiting to be released
  let spawnAccum = 0;
  let running = false;
  let rafId = 0;
  let lastT = 0;

  const emit = (type, detail = {}) => api.dispatchEvent(new CustomEvent(type, { detail }));

  function buildBoard() {
    const n = Math.max(2, Math.round(cfg.width));
    const rows = Math.max(1, Math.round(cfg.height));
    binW = W / n;
    pegR = clamp(binW * 0.11, 2, 10);
    ballR = clamp(binW * 0.17, 3, 16);
    pegAreaTop = H * 0.11;
    pegAreaBottom = H * 0.84;

    // Quincunx peg field: rows alternate between bin edges and bin centres.
    pegs = [];
    pegRows = [];
    pegRowGap = (pegAreaBottom - pegAreaTop) / rows;
    for (let r = 0; r < rows; r++) {
      const y = pegAreaTop + (r + 0.5) * pegRowGap;
      const row = [];
      if (r % 2 === 0) {
        for (let c = 1; c < n; c++) row.push({ x: c * binW, y }); // edges
      } else {
        for (let c = 0; c < n; c++) row.push({ x: (c + 0.5) * binW, y }); // centres
      }
      pegRows.push(row);
      for (const p of row) pegs.push(p);
    }

    dividers = [];
    for (let c = 0; c <= n; c++) dividers.push(c * binW);

    const vals = multipliers(n);
    slots = vals.map((value, i) => ({ x0: i * binW, x1: (i + 1) * binW, value, count: 0, flash: 0 }));
    maxCount = 0;
  }

  function fit() {
    const rect = container.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 8 || h < 8) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (w === W && h === H && ratio === dpr) return;
    W = w;
    H = h;
    dpr = ratio;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildBoard();
    draw();
  }

  function spawnBall(xFraction) {
    if (balls.length >= cfg.maxBalls) return;
    const target = Number.isInteger(cfg.targetSlot) ? clamp(cfg.targetSlot, 0, slots.length - 1) : null;
    if (target != null) {
      // Predetermined: replay a genuine run — dropped from the chosen position — that
      // happens to land in the target, so the ball goes where it visibly bounces.
      const path = findNaturalPath(target, clamp(xFraction, 0, 1));
      balls.push({ mode: 'play', path, t: 0, target, x: path[0].x, y: path[0].y, hue: Math.random() });
    } else {
      const x = clamp(xFraction, 0, 1) * W + (Math.random() - 0.5) * binW * 0.5;
      balls.push({
        mode: 'physics',
        x: clamp(x, ballR, W - ballR),
        y: pegAreaTop - ballR * 1.5,
        vx: (Math.random() - 0.5) * 30,
        vy: 0,
        hue: Math.random(),
      });
    }
  }

  /**
   * Simulate one ball headlessly with a seeded RNG, recording its path (fixed step).
   * `biasC` (0 = pure natural) gently pulls the ball toward the target column so a
   * far-from-the-drop target becomes reachable while the ball still bounces off pegs.
   */
  function simulatePath(baseXf, seed, target, biasC) {
    const rng = mulberry32(seed);
    const g = cfg.gravity;
    const e = cfg.restitution;
    const targetX = (target + 0.5) * binW;
    let x = clamp(baseXf * W + (rng() - 0.5) * binW * 0.5, ballR, W - ballR);
    let y = pegAreaTop - ballR * 1.5;
    let vx = (rng() - 0.5) * 30;
    let vy = 0;
    const path = [{ x, y }];
    for (let step = 0; step < 3000; step++) {
      vy += g * FIXED_DT;
      x += vx * FIXED_DT;
      y += vy * FIXED_DT;
      const min = ballR + pegR;
      const r0 = Math.max(0, Math.floor((y - min - pegAreaTop) / pegRowGap - 0.5));
      const r1 = Math.min(pegRows.length - 1, Math.ceil((y + min - pegAreaTop) / pegRowGap - 0.5));
      for (let rr = r0; rr <= r1; rr++) {
        const row = pegRows[rr];
        for (let pi = 0; pi < row.length; pi++) {
          const p = row[pi];
          const dx = x - p.x;
          const dy = y - p.y;
          if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
          const dist = Math.hypot(dx, dy) || 0.0001;
          if (dist < min) {
            const nx = dx / dist;
            const ny = dy / dist;
            x = p.x + nx * min;
            y = p.y + ny * min;
            const vn = vx * nx + vy * ny;
            if (vn < 0) { vx -= (1 + e) * vn * nx; vy -= (1 + e) * vn * ny; }
            vx += (rng() - 0.5) * 40;
            // Nudge the bounce toward the target. Only applied at pegs, so free-fall
            // stays perfectly straight — the ball just favours target-ward bounces.
            if (biasC) vx += (targetX < x ? -biasC : biasC);
          }
        }
      }
      if (x < ballR) { x = ballR; vx = Math.abs(vx) * e; }
      if (x > W - ballR) { x = W - ballR; vx = -Math.abs(vx) * e; }
      if (y > pegAreaBottom - ballR) {
        for (const d of dividers) {
          if (Math.abs(x - d) < ballR) { x = d + Math.sign(x - d || 1) * ballR; vx = -vx * e * 0.5; }
        }
      }
      path.push({ x, y });
      if (y + ballR >= H) return { slot: clamp(Math.floor(x / binW), 0, slots.length - 1), path };
    }
    return { slot: clamp(Math.floor(x / binW), 0, slots.length - 1), path };
  }

  /**
   * Find a natural path from the chosen drop column that lands in `target`, trying
   * seeds. Pure physics first (looks fully natural); if the target is too far from the
   * drop column to reach naturally, a gentle then firmer lean is allowed.
   */
  function findNaturalPath(target, dropXf) {
    const baseXf = clamp(dropXf, 0, 1);
    const dropCol = clamp(Math.floor(baseXf * slots.length), 0, slots.length - 1);
    const dist = Math.abs(target - dropCol);
    // Use the GENTLEST lean that still finds a path cheaply. The minimal bias
    // needed is small even for the far corner (measured ≤ ~5), so near targets fall
    // pure-natural and far ones lean only slightly — believable, not homing — while
    // the seed search stays a few tries (no per-spawn FPS hitch).
    // The per-bounce kick needed scales with bin width (px to cross per column),
    // so base it on binW; the search still escalates if a board needs a touch more.
    const baseBias = dist <= 5 ? 0 : clamp((dist - 5) * binW * 0.3, 8, 65);
    const schedule = [[baseBias, 90], [baseBias + 25, 110], [baseBias + 55, 250]];
    let best = null;
    for (const [biasC, budget] of schedule) {
      for (let tries = 0; tries < budget; tries++) {
        const r = simulatePath(baseXf, (Math.random() * 4294967296) >>> 0, target, biasC);
        if (r.slot === target) return r.path;
        if (!best || Math.abs(r.slot - target) < Math.abs(best.slot - target)) best = r;
      }
    }
    // Astronomically rare fallback (a target column that never lands in itself): ease the
    // closest path's tail into the target bin so the result is still guaranteed.
    const path = best.path;
    const targetX = (target + 0.5) * binW;
    const tail = Math.min(12, path.length);
    for (let k = 0; k < tail; k++) {
      const idx = path.length - tail + k;
      const f = tail > 1 ? k / (tail - 1) : 1;
      path[idx] = { x: path[idx].x + (targetX - path[idx].x) * f, y: path[idx].y };
    }
    return path;
  }

  function landBall(b, i, slotOverride) {
    const idx = slotOverride != null ? slotOverride : clamp(Math.floor(b.x / binW), 0, slots.length - 1);
    const slot = slots[idx];
    slot.count += 1;
    slot.flash = 1;
    maxCount = Math.max(maxCount, slot.count);
    dropped += 1;
    total += slot.value;
    balls.splice(i, 1);
    emit('land', { slot: idx, value: slot.value, total, dropped });
  }

  function integrate(dt) {
    const g = cfg.gravity;
    const e = cfg.restitution;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.mode !== 'physics') continue; // predetermined balls follow a pre-computed path
      b.vy += g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Pegs — only the row(s) the ball is passing can collide.
      const min = ballR + pegR;
      const r0 = Math.max(0, Math.floor((b.y - min - pegAreaTop) / pegRowGap - 0.5));
      const r1 = Math.min(pegRows.length - 1, Math.ceil((b.y + min - pegAreaTop) / pegRowGap - 0.5));
      for (let rr = r0; rr <= r1; rr++) {
        const row = pegRows[rr];
        for (let pi = 0; pi < row.length; pi++) {
          const p = row[pi];
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
          const dist = Math.hypot(dx, dy) || 0.0001;
          if (dist < min) {
            const nx = dx / dist;
            const ny = dy / dist;
            b.x = p.x + nx * min;
            b.y = p.y + ny * min;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
              b.vx -= (1 + e) * vn * nx;
              b.vy -= (1 + e) * vn * ny;
            }
            // Tangential jitter so paths diverge.
            b.vx += (Math.random() - 0.5) * 40;
          }
        }
      }

      // Side walls.
      if (b.x < ballR) { b.x = ballR; b.vx = Math.abs(b.vx) * e; }
      if (b.x > W - ballR) { b.x = W - ballR; b.vx = -Math.abs(b.vx) * e; }

      // Slot dividers guide the ball into whatever bin it arrives over.
      if (b.y > pegAreaBottom - ballR) {
        for (const dxWall of dividers) {
          if (Math.abs(b.x - dxWall) < ballR) {
            b.x = dxWall + Math.sign(b.x - dxWall || 1) * ballR;
            b.vx = -b.vx * e * 0.5;
          }
        }
      }

      // Landed on the floor.
      if (b.y + ballR >= H) landBall(b, i);
    }
  }

  /** Advance predetermined balls along their pre-computed path (independent of frame rate). */
  function advancePlayback(dt) {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.mode !== 'play') continue;
      b.t += dt;
      const f = b.t / FIXED_DT;
      if (f >= b.path.length - 1) {
        const last = b.path[b.path.length - 1];
        b.x = last.x;
        b.y = last.y;
        landBall(b, i, b.target);
      } else {
        const i0 = Math.floor(f);
        const frac = f - i0;
        const a = b.path[i0];
        const c = b.path[i0 + 1];
        b.x = a.x + (c.x - a.x) * frac;
        b.y = a.y + (c.y - a.y) * frac;
      }
    }
  }

  function draw() {
    if (W <= 0) return;
    ctx.clearRect(0, 0, W, H);

    // Drop marker showing where the next batch is released.
    const mx = clamp(cfg.dropX, 0, 1) * W;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 212, 94, 0.28)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, pegAreaTop);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd45e';
    ctx.beginPath();
    ctx.moveTo(mx, pegAreaTop - 3);
    ctx.lineTo(mx - 6, pegAreaTop - 14);
    ctx.lineTo(mx + 6, pegAreaTop - 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Slots (fill bars + heat + multiplier).
    const n = slots.length;
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      const t = n === 1 ? 0 : Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
      const color = heat(t);
      const fillH = maxCount ? (s.count / maxCount) * (H - pegAreaBottom - 4) : 0;
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(s.x0 + 1, pegAreaBottom, binW - 2, H - pegAreaBottom);
      if (fillH > 0) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(s.x0 + 1, H - fillH, binW - 2, fillH);
        ctx.globalAlpha = 1;
      }
      if (s.flash > 0) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25 * s.flash;
        ctx.fillRect(s.x0 + 1, pegAreaBottom, binW - 2, H - pegAreaBottom);
        ctx.globalAlpha = 1;
        s.flash = Math.max(0, s.flash - 0.05);
      }
      // Multiplier label.
      ctx.fillStyle = color;
      ctx.font = `800 ${clamp(binW * 0.26, 9, 18)}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${s.value}×`, (s.x0 + s.x1) / 2, pegAreaBottom + (H - pegAreaBottom) * 0.42);
      if (s.count > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `600 ${clamp(binW * 0.18, 8, 13)}px ui-rounded, system-ui, sans-serif`;
        ctx.fillText(String(s.count), (s.x0 + s.x1) / 2, pegAreaBottom + (H - pegAreaBottom) * 0.78);
      }
    }
    // Divider ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (const dx of dividers) {
      ctx.beginPath();
      ctx.moveTo(dx, pegAreaBottom);
      ctx.lineTo(dx, H);
      ctx.stroke();
    }

    // Pegs.
    ctx.fillStyle = '#aab2c6';
    for (const p of pegs) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, pegR, 0, TAU);
      ctx.fill();
    }

    // Balls.
    for (const b of balls) {
      const col = heat(b.hue);
      ctx.beginPath();
      ctx.arc(b.x, b.y, ballR, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x - ballR * 0.3, b.y - ballR * 0.3, ballR * 0.35, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }
  }

  function loop(t) {
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    dt = clamp(dt, 0, 0.033);

    // Staggered spawns from the queue.
    if (spawnQueue.length > 0) {
      spawnAccum += dt * 1000;
      while (spawnAccum >= cfg.spawnInterval && spawnQueue.length > 0) {
        spawnAccum -= cfg.spawnInterval;
        spawnBall(spawnQueue.shift());
      }
    }

    // Sub-step the integration so fast balls never tunnel through pegs.
    const sub = cfg.substeps;
    for (let s = 0; s < sub; s++) integrate(dt / sub);
    advancePlayback(dt);
    draw();

    if (balls.length > 0 || spawnQueue.length > 0) {
      rafId = requestAnimationFrame(loop);
    } else {
      running = false;
      rafId = 0;
      lastT = 0;
      draw();
      emit('idle', { total, dropped });
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(loop);
  }

  function drop(n, xFraction) {
    const count = Number.isFinite(n) ? Math.round(n) : cfg.ballCount;
    if (count <= 0) return;
    const xf = Number.isFinite(xFraction) ? clamp(xFraction, 0, 1) : cfg.dropX;
    for (let i = 0; i < count; i++) spawnQueue.push(xf);
    emit('dropstart', { count, dropX: xf });
    startLoop();
  }

  function setDropX(fraction) {
    cfg.dropX = clamp(Number(fraction) || 0, 0, 1);
    draw();
  }

  function reset() {
    balls = [];
    spawnQueue = [];
    dropped = 0;
    total = 0;
    for (const s of slots) { s.count = 0; s.flash = 0; }
    maxCount = 0;
    draw();
    emit('idle', { total: 0, dropped: 0 });
  }

  function setConfig(next = {}) {
    Object.assign(cfg, next);
    balls = [];
    spawnQueue = [];
    dropped = 0;
    total = 0;
    buildBoard();
    draw();
    emit('idle', { total: 0, dropped: 0 });
  }

  const observer = new ResizeObserver(fit);
  observer.observe(container);
  fit();

  Object.assign(api, {
    canvas,
    drop,
    reset,
    setConfig,
    setDropX,
    destroy() {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      canvas.remove();
    },
  });
  Object.defineProperties(api, {
    dropped: { get: () => dropped, enumerable: true },
    total: { get: () => Math.round(total * 10) / 10, enumerable: true },
    dropX: { get: () => cfg.dropX, enumerable: true },
    targetSlot: { get: () => cfg.targetSlot, enumerable: true },
    busy: { get: () => running, enumerable: true },
    slotValues: { get: () => slots.map((s) => s.value), enumerable: true },
  });
  return api;
}
