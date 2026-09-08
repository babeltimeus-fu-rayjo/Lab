/**
 * Spinning prize wheel: a canvas wheel of N slices that spins and eases to a
 * stop under a fixed pointer at the top. Slice count, per-slice width and the
 * spin speed are all configurable. The wheel is drawn once at rest and spun by
 * a CSS transform, so the animation stays smooth and survives a hidden tab.
 *
 * Usage:
 *   const wheel = createWheel(mountEl, { slices: 6, spinSpeed: 5 });
 *   wheel.addEventListener('spinstart', () => ...);
 *   wheel.addEventListener('result', (e) => console.log(e.detail.index, e.detail.label));
 *   wheel.spin();
 *   wheel.setConfig({ slices: 8, weights: [1,2,1,1,3,1,1,1], spinSpeed: 8 });
 *   wheel.spinning; wheel.destroy();
 */

const TAU = Math.PI * 2;
const mod = (a, m) => ((a % m) + m) % m;

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899',
];

function textColorFor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1a1a1a' : '#ffffff';
}

export function createWheel(container, options = {}) {
  const cfg = {
    slices: 6,
    weights: null, // array of positive numbers; defaults to all-equal
    spinSpeed: 5, // 1..10
    labels: null, // array; defaults to "1".."N"
    palette: PALETTE,
    ...options,
  };

  const api = new EventTarget();
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    transformOrigin: '50% 50%',
    willChange: 'transform',
    borderRadius: '50%',
    cursor: 'pointer',
  });
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let weights = [];
  let labels = [];
  let size = 0;
  let dpr = 1;
  let cx = 0;
  let cy = 0;
  let R = 0;
  let rotation = 0; // degrees currently applied via CSS transform
  let spinning = false;
  let result = null;
  let highlight = -1;

  const emit = (type, detail = {}) => api.dispatchEvent(new CustomEvent(type, { detail }));
  const totalWeight = () => weights.reduce((a, b) => a + b, 0) || 1;

  function normalizeConfig() {
    const n = Math.max(2, Math.round(cfg.slices));
    weights = Array.from({ length: n }, (_, i) => {
      const w = cfg.weights?.[i];
      return Number.isFinite(w) && w > 0 ? w : 1;
    });
    labels = Array.from({ length: n }, (_, i) => cfg.labels?.[i] ?? String(i + 1));
  }

  // Cumulative slice boundaries in degrees, measured clockwise from the top.
  function bounds() {
    const total = totalWeight();
    const out = [];
    let acc = 0;
    for (const w of weights) {
      const span = (w / total) * 360;
      out.push([acc, acc + span]);
      acc += span;
    }
    return out;
  }

  function fit() {
    const rect = container.getBoundingClientRect();
    const s = Math.round(Math.min(rect.width, rect.height));
    if (s < 8) return; // not laid out yet (or hidden); a later resize will size it
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (s === size && ratio === dpr) return;
    size = s;
    dpr = ratio;
    canvas.width = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = s / 2;
    cy = s / 2;
    R = s / 2 - Math.max(3, s * 0.015);
    draw();
  }

  function draw() {
    if (R <= 0) return;
    ctx.clearRect(0, 0, size, size);
    const segs = bounds();
    const fontPx = Math.max(10, R * 0.085);

    segs.forEach(([start, end], i) => {
      const a0 = (start * Math.PI) / 180 - Math.PI / 2;
      const a1 = (end * Math.PI) / 180 - Math.PI / 2;
      const fill = cfg.palette[i % cfg.palette.length];

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.006);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();

      if (i === highlight) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();
        ctx.restore();
      }

      // Label, drawn radially at the slice's mid-angle.
      const mid = ((start + end) / 2) * (Math.PI / 180) - Math.PI / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.fillStyle = textColorFor(fill);
      ctx.font = `800 ${fontPx}px ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(labels[i]), R * 0.64, 0);
      ctx.restore();
    });

    // Outer rim.
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.lineWidth = Math.max(3, R * 0.04);
    ctx.strokeStyle = '#1b2138';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, TAU);
    ctx.lineWidth = Math.max(1, R * 0.01);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.stroke();

    // Hub.
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.14, 0, TAU);
    ctx.fillStyle = '#e9edf6';
    ctx.fill();
    ctx.lineWidth = Math.max(2, R * 0.015);
    ctx.strokeStyle = '#aab2c6';
    ctx.stroke();
  }

  function sliceAtPointer() {
    const a = mod(-rotation, 360); // drawn angle sitting under the top pointer
    const segs = bounds();
    for (let i = 0; i < segs.length; i++) {
      if (a >= segs[i][0] && a < segs[i][1]) return i;
    }
    return segs.length - 1;
  }

  function spin(targetSlice) {
    if (spinning) return;
    spinning = true;
    highlight = -1;
    result = null;
    draw();
    emit('spinstart', {});

    const speed = Math.max(1, Math.min(10, cfg.spinSpeed));
    const turns = 3 + speed; // faster → more full turns
    const duration = Math.max(2600, Math.round(6800 - speed * 400)); // faster → shorter
    const base = rotation + turns * 360;

    // A predetermined slice lands the pointer at that slice's centre; otherwise random.
    let finalRot;
    if (Number.isInteger(targetSlice) && targetSlice >= 0 && targetSlice < weights.length) {
      const seg = bounds()[targetSlice];
      const desired = mod(-(seg[0] + seg[1]) / 2, 360); // pointer angle == slice centre
      finalRot = base + mod(desired - base, 360);
    } else {
      finalRot = base + Math.random() * 360;
    }

    canvas.style.transition = `transform ${duration}ms cubic-bezier(0.15, 0.78, 0.12, 1)`;
    void canvas.offsetWidth; // apply the (possibly just-cleared) transition
    canvas.style.transform = `rotate(${finalRot}deg)`;
    rotation = finalRot;

    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      canvas.removeEventListener('transitionend', onEnd);
      rotation = mod(rotation, 360); // keep the number bounded; same position
      canvas.style.transition = 'none';
      canvas.style.transform = `rotate(${rotation}deg)`;
      spinning = false;
      const idx = sliceAtPointer();
      result = idx;
      highlight = idx;
      draw();
      emit('result', { index: idx, label: labels[idx] });
    };
    const onEnd = (e) => { if (e.propertyName === 'transform') settle(); };
    canvas.addEventListener('transitionend', onEnd);
    const fallback = setTimeout(settle, duration + 150);
  }

  function setConfig(next = {}) {
    if (spinning) return;
    Object.assign(cfg, next);
    if (Array.isArray(next.weights)) cfg.weights = next.weights.slice();
    if (Array.isArray(next.labels)) cfg.labels = next.labels.slice();
    highlight = -1;
    result = null;
    normalizeConfig();
    draw();
  }

  const observer = new ResizeObserver(() => { if (!spinning) fit(); });
  observer.observe(container);
  normalizeConfig();
  fit();

  Object.assign(api, {
    canvas,
    spin,
    setConfig,
    destroy() {
      observer.disconnect();
      canvas.remove();
    },
  });
  Object.defineProperties(api, {
    spinning: { get: () => spinning, enumerable: true },
    result: { get: () => result, enumerable: true },
    palette: { get: () => cfg.palette.slice(), enumerable: true },
  });
  return api;
}
