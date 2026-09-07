/**
 * Scratch card: a foil-like canvas coating laid over any element's content,
 * rubbed away by dragging (mouse, touch or pen). Tracks how much has been
 * scratched and, once enough is gone, fades the rest away on its own.
 *
 * Usage:
 *   const card = document.querySelector('.scratch-card'); // position: relative, content underneath
 *   const scratcher = createScratcher(card, { brushRadius: 28, completeAt: 0.6, label: 'Scratch here!' });
 *   scratcher.addEventListener('progress', (e) => console.log(e.detail.fraction)); // 0..1 scratched
 *   scratcher.addEventListener('complete', () => console.log('revealed'));
 *   scratcher.reset(); scratcher.reveal(); scratcher.setBrush(40); scratcher.destroy();
 */
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function createScratcher(container, options = {}) {
  const opts = {
    brushRadius: 28, // CSS px
    completeAt: 0.6, // fraction scratched that triggers the auto-reveal
    label: 'Scratch here!',
    colors: ['#c9cfe0', '#8d95ae', '#c9cfe0'], // foil gradient stops
    speckles: 900,
    ...options,
  };

  const api = new EventTarget();
  const canvas = document.createElement('canvas');
  canvas.className = 'scratcher-canvas';
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    touchAction: 'none',
    cursor: 'crosshair',
    userSelect: 'none',
    webkitUserSelect: 'none',
    webkitTouchCallout: 'none',
    transition: 'opacity 0.5s ease',
  });
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let width = 0;
  let height = 0;
  let dpr = 1;
  let brush = opts.brushRadius;
  let scratching = false;
  let activePointer = null;
  let last = null;
  let fraction = 0;
  let complete = false;
  let lastMeasure = 0;

  const emit = (type, detail = {}) => api.dispatchEvent(new CustomEvent(type, { detail }));

  // ---- coating ----
  function paintCoating() {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    opts.colors.forEach((c, i) => gradient.addColorStop(i / Math.max(1, opts.colors.length - 1), c));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Foil speckles, seeded so every repaint looks identical.
    let seed = 1234567;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < opts.speckles; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, 0.35)' : 'rgba(40, 46, 70, 0.25)';
      ctx.beginPath();
      ctx.arc(rnd() * width, rnd() * height, 0.6 + rnd() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (opts.label) {
      ctx.fillStyle = 'rgba(30, 34, 55, 0.85)';
      ctx.font = `800 ${Math.max(16, Math.min(width, height) * 0.1)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.label, width / 2, height / 2);
    }
    ctx.restore();
  }

  function snapshot() {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    return copy;
  }

  /** Match the container's size; keeps existing scratches when the card resizes. */
  function fit() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (w === width && h === height && ratio === dpr) return;
    const keep = width > 1 && height > 1 ? snapshot() : null;
    width = w;
    height = h;
    dpr = ratio;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintCoating();
    if (keep) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in'; // old transparent (scratched) areas stay clear
      ctx.drawImage(keep, 0, 0, width, height);
      ctx.restore();
    }
  }

  // ---- scratching ----
  function pointAt(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (width / Math.max(1, r.width)),
      y: (e.clientY - r.top) * (height / Math.max(1, r.height)),
    };
  }

  function dab(p) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(p.x, p.y, brush, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function stroke(from, to) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  /** How much is scratched away, sampled from the alpha channel (throttled while dragging). */
  function measure(force = false) {
    const now = performance.now();
    if (!force && now - lastMeasure < 120) return;
    lastMeasure = now;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 6) {
      total++;
      if (data[i] < 40) clear++;
    }
    fraction = total ? clear / total : 0;
    emit('progress', { fraction });
    if (!complete && fraction >= opts.completeAt) reveal();
  }

  function reveal() {
    if (complete) return;
    complete = true;
    scratching = false;
    activePointer = null;
    fraction = 1;
    canvas.style.opacity = '0';
    canvas.style.pointerEvents = 'none';
    emit('progress', { fraction: 1 });
    emit('complete');
  }

  function reset() {
    complete = false;
    scratching = false;
    activePointer = null;
    last = null;
    fraction = 0;
    canvas.style.opacity = '1';
    canvas.style.pointerEvents = '';
    paintCoating();
    emit('progress', { fraction: 0 });
    emit('reset');
  }

  function onDown(e) {
    if (complete) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    scratching = true;
    activePointer = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no capturable pointer */
    }
    const p = pointAt(e);
    dab(p);
    last = p;
    measure();
  }

  function onMove(e) {
    if (!scratching || e.pointerId !== activePointer) return;
    const coalesced = e.getCoalescedEvents?.() ?? [];
    for (const ev of coalesced.length ? coalesced : [e]) {
      const p = pointAt(ev);
      stroke(last ?? p, p);
      last = p;
    }
    measure();
  }

  function onEnd(e) {
    if (!scratching || e.pointerId !== activePointer) return;
    scratching = false;
    activePointer = null;
    last = null;
    measure(true);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onEnd);
  canvas.addEventListener('pointercancel', onEnd);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const observer = new ResizeObserver(fit);
  observer.observe(container);
  fit();

  Object.assign(api, {
    canvas,
    reset,
    reveal,
    /** Brush radius in CSS px. */
    setBrush(radius) {
      brush = Math.max(1, Number(radius) || brush);
    },
    destroy() {
      observer.disconnect();
      canvas.remove();
    },
  });
  // Live read-only views of the state (Object.assign would copy them as fixed values).
  Object.defineProperties(api, {
    fraction: { get: () => fraction, enumerable: true },
    complete: { get: () => complete, enumerable: true },
  });
  return api;
}
