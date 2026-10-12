/**
 * 2D avatar creator: a layered, bone-driven character drawn on canvas with
 * procedural animations. Body parts (skin, build, head, hair, eyes, mouth) and
 * costume pieces (hat, face, top, gloves, bottom, shoes, back, held item) are
 * independent slots, so any combination composes. Every piece is drawn in the
 * local space of the bone it belongs to — a hat in head space, a sleeve in arm
 * space, a cape in torso space — so it follows every animation for free.
 *
 * Usage:
 *   const avatar = createAvatar(mountEl, { skin: '#e8b894', top: 'hoodie' });
 *   avatar.setAnimation('run');
 *   avatar.setConfig({ hat: 'crown', accent: '#ffd166' });
 *   avatar.randomize(); avatar.applyPreset('knight');
 *   avatar.render(1.25);   // draw one frame at t = 1.25s (handy when rAF is paused)
 *   avatar.config; avatar.animation; LIBRARY; ANIMATIONS; PRESETS
 */

export const PALETTE = [
  '#e63946', '#f4a261', '#ffd166', '#06d6a0', '#118ab2',
  '#8338ec', '#ff5da2', '#f1f1f1', '#2b2d42', '#8d6e63',
];

export const LIBRARY = {
  skin: ['#f8d9c4', '#efc3a4', '#d9a07f', '#b87c5a', '#8c5a3c', '#5a3a28'],
  hairColor: ['#2a1b12', '#6b3e1e', '#c6873a', '#efd27c', '#c9ccd6', '#e34234', '#6a4bd6', '#2bb3a6'],
  build: ['slim', 'average', 'broad'],
  headShape: ['round', 'oval', 'square'],
  hair: ['bald', 'short', 'spiky', 'long', 'bun', 'curly', 'mohawk'],
  eyes: ['round', 'happy', 'sleepy', 'wide'],
  mouth: ['smile', 'grin', 'neutral', 'open'],
  hat: ['none', 'cap', 'beanie', 'topHat', 'crown', 'helmet', 'wizard', 'bandana'],
  face: ['none', 'glasses', 'sunglasses', 'eyepatch', 'mask'],
  top: ['tee', 'hoodie', 'suit', 'armor', 'robe', 'vest', 'none'],
  gloves: ['none', 'gloves', 'gauntlets'],
  bottom: ['jeans', 'shorts', 'greaves', 'skirt', 'pirate', 'none'],
  shoes: ['sneakers', 'boots', 'sandals', 'sabatons', 'none'],
  back: ['none', 'cape', 'backpack', 'wings'],
  item: ['none', 'sword', 'staff', 'umbrella', 'shield'],
  topColor: PALETTE,
  bottomColor: PALETTE,
  accent: PALETTE,
};
const COLOR_KEYS = new Set(['skin', 'hairColor', 'topColor', 'bottomColor', 'accent']);

export const ANIMATIONS = ['idle', 'walk', 'run', 'jump', 'wave', 'dance'];

export const PRESETS = {
  casual: { hat: 'cap', face: 'sunglasses', top: 'tee', gloves: 'none', bottom: 'jeans', shoes: 'sneakers', back: 'none', item: 'none', topColor: '#06d6a0', bottomColor: '#2b2d42', accent: '#e63946' },
  knight: { hat: 'helmet', face: 'none', top: 'armor', gloves: 'gauntlets', bottom: 'greaves', shoes: 'sabatons', back: 'cape', item: 'sword', topColor: '#118ab2', bottomColor: '#8d6e63', accent: '#e63946' },
  wizard: { hat: 'wizard', face: 'glasses', top: 'robe', gloves: 'none', bottom: 'jeans', shoes: 'sandals', back: 'none', item: 'staff', topColor: '#8338ec', bottomColor: '#2b2d42', accent: '#ffd166' },
  pirate: { hat: 'bandana', face: 'eyepatch', top: 'vest', gloves: 'none', bottom: 'pirate', shoes: 'boots', back: 'none', item: 'sword', topColor: '#8d6e63', bottomColor: '#f1f1f1', accent: '#e63946' },
  formal: { hat: 'topHat', face: 'none', top: 'suit', gloves: 'gloves', bottom: 'jeans', shoes: 'boots', back: 'none', item: 'umbrella', topColor: '#2b2d42', bottomColor: '#2b2d42', accent: '#f1f1f1' },
  hero: { hat: 'none', face: 'mask', top: 'tee', gloves: 'gloves', bottom: 'jeans', shoes: 'boots', back: 'cape', item: 'shield', topColor: '#e63946', bottomColor: '#118ab2', accent: '#ffd166' },
};

const DEFAULTS = {
  skin: LIBRARY.skin[1], hairColor: LIBRARY.hairColor[1], build: 'average', headShape: 'round',
  hair: 'short', eyes: 'round', mouth: 'smile',
  hat: 'none', face: 'none', top: 'tee', gloves: 'none', bottom: 'jeans', shoes: 'sneakers', back: 'none', item: 'none',
  topColor: '#118ab2', bottomColor: '#2b2d42', accent: '#e63946',
};

/** "topHat" → "Top hat" for UI labels. */
export const label = (id) => String(id)
  .replace(/([a-z])([A-Z])/g, (_, a, b) => `${a} ${b.toLowerCase()}`)
  .replace(/^./, (ch) => ch.toUpperCase());

const TAU = Math.PI * 2;
const OUT = '#1b1f33';
const METAL = '#b9c2cf';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = (r) => (r * 180) / Math.PI;

/** Mix a #rrggbb colour toward white (k > 0) or black (k < 0). */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const t = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  const ch = (c) => Math.round(c + (t - c) * a);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------- dimensions
const BUILDS = {
  slim: { torsoW: 46, armW: 12, legW: 15 },
  average: { torsoW: 54, armW: 15, legW: 18 },
  broad: { torsoW: 66, armW: 19, legW: 21 },
};
const HEADS = {
  round: { rx: 33, ry: 33, r: 33 },
  oval: { rx: 30, ry: 37, r: 30 },
  square: { rx: 32, ry: 33, r: 13 },
};
function makeDims(cfg) {
  const b = BUILDS[cfg.build] || BUILDS.average;
  const h = HEADS[cfg.headShape] || HEADS.round;
  return {
    ...b,
    torsoLen: 66, upper: 40, fore: 36, handR: 9, thigh: 44, shin: 40, hipX: 11,
    shoulderX: b.torsoW / 2 - 1, shoulderY: -66 + 9,
    headRx: h.rx, headRy: h.ry, headR: h.r, headCy: -h.ry + 4, headShape: cfg.headShape,
  };
}

// ---------------------------------------------------------------- primitives
function rrPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); rrPath(ctx, x, y, w, h, r); }
function fillStroke(ctx, fill, stroke = OUT, lw = 3, rule) {
  if (fill) { ctx.fillStyle = fill; rule ? ctx.fill(rule) : ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function circle(ctx, x, y, r, fill, stroke = OUT, lw = 3) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fillStroke(ctx, fill, stroke, lw);
}
function ellipse(ctx, x, y, rx, ry, fill, stroke = OUT, lw = 3) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); fillStroke(ctx, fill, stroke, lw);
}
function line(ctx, x1, y1, x2, y2, color = OUT, lw = 3) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
}
/** A capsule limb from the bone origin down to `len`, outlined. */
function limb(ctx, len, w, fill, from = 0) {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, from); ctx.lineTo(0, len);
  ctx.strokeStyle = OUT; ctx.lineWidth = w + 3; ctx.stroke();
  ctx.strokeStyle = fill; ctx.lineWidth = w; ctx.stroke();
}
function star(ctx, x, y, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath(); fillStroke(ctx, fill, OUT, 1.5);
}
function stripes(ctx, len, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'butt';
  for (let y = 8; y < len - 4; y += 10) { ctx.beginPath(); ctx.moveTo(-w / 2 + 1, y); ctx.lineTo(w / 2 - 1, y); ctx.stroke(); }
}
function headPath(ctx, d) {
  if (d.headShape === 'square') rr(ctx, -d.headRx, d.headCy - d.headRy, 2 * d.headRx, 2 * d.headRy, d.headR);
  else { ctx.beginPath(); ctx.ellipse(0, d.headCy, d.headRx, d.headRy, 0, 0, TAU); }
}
/** The top of the head as a cap (hair, hats): the upper arc, closed by a chord. */
function hairCap(ctx, d, color, lift = 0.3, grow = 3) {
  ctx.beginPath();
  ctx.ellipse(0, d.headCy, d.headRx + grow, d.headRy + grow, 0, Math.PI + lift, TAU - lift);
  ctx.closePath(); fillStroke(ctx, color);
}
function torsoPath(ctx, d, pad = 0, extra = 0) {
  rr(ctx, -d.torsoW / 2 - pad, -d.torsoLen - pad, d.torsoW + 2 * pad, d.torsoLen + pad + extra, 14);
}
const eyePos = (d) => ({ ex: d.headRx * 0.36, ey: d.headCy - 3 });

// ---------------------------------------------------------------- face & hair
function drawEyes(ctx, d, c, style, blink) {
  const { ex, ey } = eyePos(d);
  for (const s of [-1, 1]) {
    const x = s * ex;
    if (blink) { line(ctx, x - 5, ey, x + 5, ey, OUT, 3); continue; }
    switch (style) {
      case 'happy':
        ctx.beginPath(); ctx.arc(x, ey + 2, 5.5, Math.PI + 0.15, TAU - 0.15);
        ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
        break;
      case 'sleepy':
        circle(ctx, x, ey, 5.5, '#fff');
        circle(ctx, x + s * 0.5, ey + 1.5, 2.6, OUT, null);
        ctx.beginPath(); ctx.arc(x, ey, 5.5, Math.PI + 0.05, TAU - 0.05); ctx.closePath();
        fillStroke(ctx, c.skin, null);
        line(ctx, x - 6, ey - 0.5, x + 6, ey - 0.5, OUT, 3);
        break;
      case 'wide':
        circle(ctx, x, ey, 7, '#fff');
        circle(ctx, x + s, ey + 1, 3.6, OUT, null);
        circle(ctx, x + s + 1.4, ey - 1, 1.4, '#fff', null);
        break;
      default:
        circle(ctx, x, ey, 5.5, '#fff');
        circle(ctx, x + s * 0.6, ey + 1, 2.8, OUT, null);
        circle(ctx, x + s * 1.6, ey - 0.5, 1, '#fff', null);
    }
  }
}
function drawMouth(ctx, d, style) {
  const my = d.headCy + 13;
  switch (style) {
    case 'grin':
      ctx.beginPath(); ctx.arc(0, my - 2, 9, 0.1, Math.PI - 0.1); ctx.closePath(); fillStroke(ctx, '#4a1d24');
      ctx.beginPath(); ctx.rect(-7, my - 2, 14, 3.5); ctx.fillStyle = '#fff'; ctx.fill();
      break;
    case 'neutral': line(ctx, -6, my, 6, my, OUT, 3); break;
    case 'open':
      ellipse(ctx, 0, my + 1, 5.5, 6.5, '#4a1d24');
      ellipse(ctx, 0, my + 5, 3.2, 2.2, '#e8657a', null);
      break;
    default:
      ctx.beginPath(); ctx.arc(0, my - 3, 8, 0.2, Math.PI - 0.2);
      ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
  }
}

const HAIR = {
  bald: {},
  short: { front(ctx, d, c) { hairCap(ctx, d, c.hair, 0.35, 3); } },
  spiky: {
    front(ctx, d, c) {
      hairCap(ctx, d, c.hair, 0.35, 3);
      const top = d.headCy - d.headRy - 2;
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        const x = i * d.headRx * 0.38;
        ctx.moveTo(x - 9, top + 7); ctx.lineTo(x, top - 15 - (i === 0 ? 5 : 0)); ctx.lineTo(x + 9, top + 7); ctx.closePath();
      }
      fillStroke(ctx, c.hair);
    },
  },
  long: {
    back(ctx, d, c) { rr(ctx, -d.headRx - 5, d.headCy - d.headRy + 4, 2 * d.headRx + 10, d.headRy * 2 + 44, 20); fillStroke(ctx, c.hair); },
    front(ctx, d, c) { hairCap(ctx, d, c.hair, 0.3, 3); },
  },
  bun: { front(ctx, d, c) { hairCap(ctx, d, c.hair, 0.35, 3); circle(ctx, 0, d.headCy - d.headRy - 8, 11, c.hair); } },
  curly: {
    front(ctx, d, c) {
      hairCap(ctx, d, c.hair, 0.35, 4);
      for (let i = 0; i < 7; i++) {
        const a = Math.PI + 0.25 + (i / 6) * (Math.PI - 0.5);
        circle(ctx, Math.cos(a) * (d.headRx + 2), d.headCy + Math.sin(a) * (d.headRy + 2), 8, c.hair);
      }
    },
  },
  mohawk: {
    front(ctx, d, c) {
      const top = d.headCy - d.headRy;
      rr(ctx, -7, top - 20, 14, 34, 6); fillStroke(ctx, c.hair);
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) { const x = i * 7; ctx.moveTo(x - 5, top - 17); ctx.lineTo(x, top - 31); ctx.lineTo(x + 5, top - 17); ctx.closePath(); }
      fillStroke(ctx, c.hair);
    },
  },
};

const FACE = {
  none: null,
  glasses(ctx, d) {
    const { ex, ey } = eyePos(d);
    for (const s of [-1, 1]) circle(ctx, s * ex, ey, 8.5, null, OUT, 2.5);
    line(ctx, -ex + 8.5, ey - 1, ex - 8.5, ey - 1, OUT, 2.5);
    line(ctx, -ex - 8.5, ey - 1, -d.headRx, ey - 4, OUT, 2.5);
    line(ctx, ex + 8.5, ey - 1, d.headRx, ey - 4, OUT, 2.5);
  },
  sunglasses(ctx, d) {
    const { ex, ey } = eyePos(d);
    for (const s of [-1, 1]) { rr(ctx, s * ex - 9, ey - 6, 18, 12, 5); fillStroke(ctx, '#15172a'); }
    line(ctx, -ex + 9, ey - 2, ex - 9, ey - 2, OUT, 2.5);
    line(ctx, -ex - 9, ey - 2, -d.headRx, ey - 5, OUT, 2.5);
    line(ctx, ex + 9, ey - 2, d.headRx, ey - 5, OUT, 2.5);
  },
  eyepatch(ctx, d) {
    const { ex, ey } = eyePos(d);
    line(ctx, -d.headRx + 2, ey - 14, d.headRx - 2, ey + 4, OUT, 2.5);
    circle(ctx, ex, ey, 9, '#15172a');
  },
  mask(ctx, d, c, redrawEyes) {
    const { ex, ey } = eyePos(d);
    rr(ctx, -ex - 13, ey - 9, 2 * ex + 26, 19, 9); fillStroke(ctx, c.accent);
    redrawEyes();
  },
};

const HAT = {
  none: null,
  cap(ctx, d, c) {
    hairCap(ctx, d, c.accent, 0.2, 4);
    const y = d.headCy - d.headRy * 0.42;
    rr(ctx, -d.headRx - 7, y - 2, 2 * d.headRx + 14, 9, 4.5); fillStroke(ctx, shade(c.accent, -0.2));
    circle(ctx, 0, d.headCy - d.headRy - 3, 3, shade(c.accent, -0.25), OUT, 2);
  },
  beanie(ctx, d, c) {
    hairCap(ctx, d, c.accent, 0.05, 5);
    const y = d.headCy - d.headRy * 0.2;
    rr(ctx, -d.headRx - 6, y - 10, 2 * d.headRx + 12, 13, 6); fillStroke(ctx, shade(c.accent, -0.2));
    circle(ctx, 0, d.headCy - d.headRy - 7, 8, shade(c.accent, 0.35));
  },
  topHat(ctx, d, c) {
    const top = d.headCy - d.headRy;
    ellipse(ctx, 0, top + 6, d.headRx + 12, 7, '#15172a');
    rr(ctx, -d.headRx * 0.82, top - 42, d.headRx * 1.64, 48, 5); fillStroke(ctx, '#15172a');
    rr(ctx, -d.headRx * 0.82, top - 6, d.headRx * 1.64, 9, 2); fillStroke(ctx, c.accent, OUT, 2);
  },
  crown(ctx, d, c) {
    const top = d.headCy - d.headRy, w = d.headRx * 0.9;
    ctx.beginPath();
    ctx.moveTo(-w, top + 12); ctx.lineTo(-w, top - 16); ctx.lineTo(-w / 2, top - 2); ctx.lineTo(0, top - 20);
    ctx.lineTo(w / 2, top - 2); ctx.lineTo(w, top - 16); ctx.lineTo(w, top + 12); ctx.closePath();
    fillStroke(ctx, '#f5c542');
    for (const x of [-w / 2, 0, w / 2]) circle(ctx, x, top + 5, 3, c.accent, OUT, 1.5);
  },
  helmet(ctx, d, c) {
    const cy = d.headCy, top = cy - d.headRy;
    ctx.beginPath();
    rrPath(ctx, -d.headRx - 6, top - 8, 2 * d.headRx + 12, d.headRy * 1.9, 24);
    rrPath(ctx, -d.headRx * 0.62, cy - 14, d.headRx * 1.24, 30, 8); // visor opening
    fillStroke(ctx, METAL, OUT, 3, 'evenodd');
    line(ctx, 0, top - 6, 0, cy - 16, shade(METAL, -0.3), 2);
    ctx.beginPath(); ctx.moveTo(-3, top - 6); ctx.quadraticCurveTo(-26, top - 30, -6, top - 42);
    ctx.quadraticCurveTo(10, top - 28, 3, top - 6); ctx.closePath(); fillStroke(ctx, c.accent);
  },
  wizard(ctx, d, c) {
    const top = d.headCy - d.headRy;
    ellipse(ctx, 0, top + 8, d.headRx + 18, 8, c.accent);
    ctx.beginPath(); ctx.moveTo(-d.headRx * 0.75, top + 8);
    ctx.quadraticCurveTo(-4, top - 20, 14, top - 66);
    ctx.quadraticCurveTo(10, top - 24, d.headRx * 0.75, top + 8); ctx.closePath(); fillStroke(ctx, c.accent);
    star(ctx, 2, top - 24, 6, '#ffd166');
  },
  bandana(ctx, d, c) {
    hairCap(ctx, d, c.accent, 0.15, 3);
    const x = d.headRx + 1, y = d.headCy - d.headRy * 0.45;
    ctx.beginPath();
    ctx.moveTo(x - 4, y); ctx.lineTo(x + 16, y - 4); ctx.lineTo(x + 8, y + 10); ctx.closePath();
    ctx.moveTo(x - 4, y + 2); ctx.lineTo(x + 18, y + 12); ctx.lineTo(x + 4, y + 14); ctx.closePath();
    fillStroke(ctx, c.accent);
    circle(ctx, x - 2, y + 2, 4, shade(c.accent, -0.2), OUT, 2);
  },
};

// ---------------------------------------------------------------- costume slots
// Each piece is a set of hooks drawn in a bone's local space:
//   torso-space: behind (before the body), torso, over (after the arms), skirt (root space, after the legs)
//   limb-space:  upper / fore (arm segments), thigh / shin, foot, hand
const TOP = {
  none: {},
  tee: {
    torso(ctx, d, c) { torsoPath(ctx, d, 1); fillStroke(ctx, c.top); line(ctx, -6, -d.torsoLen + 2, 6, -d.torsoLen + 2, shade(c.top, -0.3), 2); },
    upper(ctx, d, c) { limb(ctx, d.upper * 0.5, d.armW + 3, c.top); },
  },
  hoodie: {
    behind(ctx, d, c) { rr(ctx, -d.torsoW * 0.42, -d.torsoLen - 28, d.torsoW * 0.84, 40, 16); fillStroke(ctx, shade(c.top, -0.18)); },
    torso(ctx, d, c) {
      torsoPath(ctx, d, 2); fillStroke(ctx, c.top);
      rr(ctx, -d.torsoW * 0.32, -d.torsoLen * 0.42, d.torsoW * 0.64, d.torsoLen * 0.32, 6); fillStroke(ctx, shade(c.top, -0.12), OUT, 2);
      line(ctx, -5, -d.torsoLen + 4, -7, -d.torsoLen + 26, '#f1f1f1', 2);
      line(ctx, 5, -d.torsoLen + 4, 7, -d.torsoLen + 26, '#f1f1f1', 2);
    },
    upper(ctx, d, c) { limb(ctx, d.upper, d.armW + 4, c.top); },
    fore(ctx, d, c) { limb(ctx, d.fore, d.armW + 3, c.top); },
  },
  suit: {
    torso(ctx, d, c) {
      const L = d.torsoLen;
      torsoPath(ctx, d, 1); fillStroke(ctx, c.top);
      ctx.beginPath(); ctx.moveTo(-12, -L); ctx.lineTo(12, -L); ctx.lineTo(0, -L + 30); ctx.closePath(); fillStroke(ctx, '#f6f6f8', OUT, 2);
      ctx.beginPath();
      ctx.moveTo(-12, -L); ctx.lineTo(-3, -L + 30); ctx.lineTo(-16, -L + 22); ctx.closePath();
      ctx.moveTo(12, -L); ctx.lineTo(3, -L + 30); ctx.lineTo(16, -L + 22); ctx.closePath();
      fillStroke(ctx, shade(c.top, -0.2), OUT, 2);
      ctx.beginPath(); ctx.moveTo(0, -L + 6); ctx.lineTo(4, -L + 12); ctx.lineTo(2, -L + 36); ctx.lineTo(0, -L + 40); ctx.lineTo(-2, -L + 36); ctx.lineTo(-4, -L + 12); ctx.closePath();
      fillStroke(ctx, c.accent, OUT, 1.5);
      for (const y of [-26, -16]) circle(ctx, 0, y, 1.8, OUT, null);
    },
    upper(ctx, d, c) { limb(ctx, d.upper, d.armW + 3, c.top); },
    fore(ctx, d, c) { limb(ctx, d.fore, d.armW + 2, c.top); },
  },
  armor: {
    torso(ctx, d, c) {
      torsoPath(ctx, d, 2); fillStroke(ctx, METAL);
      rr(ctx, -d.torsoW * 0.3, -d.torsoLen + 10, d.torsoW * 0.6, d.torsoLen * 0.55, 10); fillStroke(ctx, shade(METAL, 0.25), OUT, 2);
      rr(ctx, -d.torsoW / 2 - 2, -14, d.torsoW + 4, 12, 5); fillStroke(ctx, c.top, OUT, 2);
    },
    upper(ctx, d) { limb(ctx, d.upper, d.armW + 3, shade(METAL, -0.15)); },
    fore(ctx, d) { limb(ctx, d.fore, d.armW + 2, shade(METAL, -0.15)); },
    over(ctx, d) { for (const s of [-1, 1]) circle(ctx, s * (d.shoulderX + 2), d.shoulderY - 2, d.armW * 0.75 + 5, METAL); },
  },
  robe: {
    torso(ctx, d, c) {
      torsoPath(ctx, d, 3); fillStroke(ctx, c.top);
      line(ctx, 0, -d.torsoLen + 6, 0, -6, shade(c.top, -0.25), 2);
      rr(ctx, -d.torsoW / 2 - 3, -16, d.torsoW + 6, 11, 4); fillStroke(ctx, c.accent, OUT, 2);
    },
    skirt(ctx, d, c) {
      const hem = d.thigh + d.shin * 0.75;
      ctx.beginPath(); ctx.moveTo(-d.torsoW / 2 - 3, -8); ctx.lineTo(d.torsoW / 2 + 3, -8); ctx.lineTo(d.torsoW * 0.78, hem);
      ctx.quadraticCurveTo(0, hem + 8, -d.torsoW * 0.78, hem); ctx.closePath(); fillStroke(ctx, c.top);
      line(ctx, 0, -4, 0, hem + 2, shade(c.top, -0.25), 2);
    },
    upper(ctx, d, c) { limb(ctx, d.upper, d.armW + 5, c.top); },
    fore(ctx, d, c) {
      ctx.beginPath(); ctx.moveTo(-d.armW / 2 - 3, 0); ctx.lineTo(d.armW / 2 + 3, 0); ctx.lineTo(d.armW / 2 + 9, d.fore + 4);
      ctx.lineTo(-d.armW / 2 - 9, d.fore + 4); ctx.closePath(); fillStroke(ctx, c.top);
    },
  },
  vest: {
    torso(ctx, d, c) {
      torsoPath(ctx, d, 1); fillStroke(ctx, '#f6f6f8');
      for (const s of [-1, 1]) { rr(ctx, s > 0 ? 5 : -d.torsoW / 2 - 1, -d.torsoLen - 1, d.torsoW / 2 - 4, d.torsoLen + 1, 10); fillStroke(ctx, c.top); }
      line(ctx, -10, -d.torsoLen + 2, 10, -d.torsoLen + 2, '#ddd', 2);
    },
    upper(ctx, d) { limb(ctx, d.upper * 0.45, d.armW + 3, '#f6f6f8'); },
  },
};

const BOTTOM = {
  none: {},
  jeans: {
    thigh(ctx, d, c) { limb(ctx, d.thigh, d.legW + 3, c.bottom); line(ctx, 0, 6, 0, d.thigh - 4, shade(c.bottom, 0.25), 1.5); },
    shin(ctx, d, c) { limb(ctx, d.shin, d.legW + 2, c.bottom); },
  },
  shorts: { thigh(ctx, d, c) { limb(ctx, d.thigh * 0.85, d.legW + 5, c.bottom); } },
  greaves: {
    thigh(ctx, d) { limb(ctx, d.thigh, d.legW + 3, shade(METAL, -0.1)); },
    shin(ctx, d, c) {
      limb(ctx, d.shin, d.legW + 2, shade(METAL, -0.1));
      circle(ctx, 0, 2, d.legW * 0.42, METAL, OUT, 2);
      rr(ctx, -d.legW / 2 - 2, d.shin * 0.45, d.legW + 4, 7, 3); fillStroke(ctx, c.bottom, OUT, 2);
    },
  },
  skirt: {
    skirt(ctx, d, c) {
      const hem = d.thigh * 0.95;
      ctx.beginPath(); ctx.moveTo(-d.torsoW / 2 - 2, -6); ctx.lineTo(d.torsoW / 2 + 2, -6); ctx.lineTo(d.torsoW / 2 + 16, hem);
      ctx.lineTo(-d.torsoW / 2 - 16, hem); ctx.closePath(); fillStroke(ctx, c.bottom);
      for (const x of [-0.5, 0, 0.5]) line(ctx, x * d.torsoW * 0.5, -4, x * d.torsoW * 0.7, hem - 2, shade(c.bottom, -0.25), 1.5);
    },
  },
  pirate: {
    thigh(ctx, d, c) { limb(ctx, d.thigh, d.legW + 6, c.bottom); stripes(ctx, d.thigh, d.legW + 6, c.accent); },
    shin(ctx, d, c) { limb(ctx, d.shin * 0.8, d.legW + 5, c.bottom); stripes(ctx, d.shin * 0.8, d.legW + 5, c.accent); },
  },
};

const SHOES = {
  none: {},
  sneakers: {
    foot(ctx, d, c) {
      ellipse(ctx, 0, 7, d.legW * 0.8, 7.5, '#f6f6f8');
      line(ctx, -d.legW * 0.6, 8, d.legW * 0.6, 8, c.accent, 2.5);
      line(ctx, -d.legW * 0.7, 12, d.legW * 0.7, 12, OUT, 2);
    },
  },
  boots: {
    foot(ctx, d, c) {
      rr(ctx, -d.legW / 2 - 2, -16, d.legW + 4, 22, 5); fillStroke(ctx, shade(c.accent, -0.35));
      ellipse(ctx, 0, 7, d.legW * 0.82, 7.5, shade(c.accent, -0.35));
      line(ctx, -d.legW * 0.7, 12, d.legW * 0.7, 12, OUT, 2);
    },
  },
  sandals: {
    foot(ctx, d, c) {
      ellipse(ctx, 0, 7, d.legW * 0.78, 7, c.skin);
      line(ctx, -d.legW * 0.5, 4, d.legW * 0.5, 4, c.accent, 2.5);
      line(ctx, 0, 0, 0, 8, c.accent, 2.5);
    },
  },
  sabatons: {
    foot(ctx, d) {
      ellipse(ctx, 0, 7, d.legW * 0.85, 8, METAL);
      line(ctx, -d.legW * 0.6, 5, d.legW * 0.6, 5, shade(METAL, -0.3), 1.5);
      line(ctx, -d.legW * 0.7, 9, d.legW * 0.7, 9, shade(METAL, -0.3), 1.5);
    },
  },
};

const GLOVES = {
  none: {},
  gloves: {
    hand(ctx, d, c) {
      circle(ctx, 0, d.handR * 0.6, d.handR + 1, c.accent);
      rr(ctx, -d.armW / 2 - 2, -6, d.armW + 4, 7, 3); fillStroke(ctx, shade(c.accent, -0.2), OUT, 2);
    },
  },
  gauntlets: {
    hand(ctx, d) {
      circle(ctx, 0, d.handR * 0.6, d.handR + 1.5, METAL);
      rr(ctx, -d.armW / 2 - 4, -12, d.armW + 8, 12, 4); fillStroke(ctx, shade(METAL, -0.1), OUT, 2);
    },
  },
};

const BACK = {
  none: {},
  cape: {
    draw(ctx, d, c, t, flutter) {
      const hem = d.thigh + d.shin * 0.6, w = d.torsoW / 2 + 8;
      const sway = Math.sin(t * 7) * 6 * flutter + Math.sin(t * 3.1) * 3 * flutter;
      ctx.beginPath(); ctx.moveTo(-w, d.shoulderY); ctx.lineTo(w, d.shoulderY);
      ctx.quadraticCurveTo(w + 14 + sway, hem * 0.5, w + 10 + sway * 1.6, hem);
      ctx.quadraticCurveTo(w * 0.5 + sway, hem - 10, sway * 0.8, hem + 2);
      ctx.quadraticCurveTo(-w * 0.5 + sway, hem - 10, -w - 10 + sway * 1.6, hem);
      ctx.quadraticCurveTo(-w - 14 + sway, hem * 0.5, -w, d.shoulderY); ctx.closePath();
      fillStroke(ctx, c.accent);
      rr(ctx, -w, d.shoulderY - 4, 2 * w, 8, 4); fillStroke(ctx, shade(c.accent, -0.25), OUT, 2);
    },
  },
  backpack: {
    draw(ctx, d, c) {
      rr(ctx, -d.torsoW * 0.42, -d.torsoLen + 4, d.torsoW * 0.84, d.torsoLen * 0.85, 12); fillStroke(ctx, shade(c.accent, -0.15));
      rr(ctx, -d.torsoW * 0.3, -d.torsoLen + 30, d.torsoW * 0.6, 16, 6); fillStroke(ctx, c.accent, OUT, 2);
    },
    over(ctx, d, c) { for (const s of [-1, 1]) line(ctx, s * d.torsoW * 0.28, -d.torsoLen + 2, s * d.torsoW * 0.3, -12, shade(c.accent, -0.35), 5); },
  },
  wings: {
    draw(ctx, d, c, t, flutter) {
      const flap = Math.sin(t * 5) * 0.18 * (0.5 + flutter);
      for (const s of [-1, 1]) {
        ctx.save(); ctx.translate(s * 8, d.shoulderY + 6); ctx.rotate(-s * (0.35 + flap));
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(s * 40, -30, s * 80, -18); ctx.quadraticCurveTo(s * 60, 0, s * 70, 14);
        ctx.quadraticCurveTo(s * 45, 6, s * 52, 28); ctx.quadraticCurveTo(s * 25, 16, 0, 22); ctx.closePath();
        fillStroke(ctx, '#f6f6f8');
        ctx.restore();
      }
    },
  },
};

// Held items live in the right hand's space (origin at the wrist).
const ITEM = {
  none: null,
  sword(ctx, d, c) {
    const hy = d.handR * 0.6;
    rr(ctx, -3, hy - 4, 6, 16, 2); fillStroke(ctx, '#8d6e63', OUT, 2);
    rr(ctx, -11, hy - 9, 22, 5, 2); fillStroke(ctx, c.accent, OUT, 2);
    ctx.beginPath(); ctx.moveTo(-4.5, hy - 9); ctx.lineTo(4.5, hy - 9); ctx.lineTo(3, hy - 62); ctx.lineTo(0, hy - 72); ctx.lineTo(-3, hy - 62); ctx.closePath();
    fillStroke(ctx, shade(METAL, 0.2));
    line(ctx, 0, hy - 12, 0, hy - 60, shade(METAL, -0.35), 1.5);
  },
  staff(ctx, d, c) {
    const hy = d.handR * 0.6;
    rr(ctx, -2.5, hy - 78, 5, 104, 2.5); fillStroke(ctx, '#8d6e63', OUT, 2);
    ctx.save(); ctx.shadowColor = c.accent; ctx.shadowBlur = 14; circle(ctx, 0, hy - 84, 9, c.accent); ctx.restore();
    circle(ctx, -2, hy - 86, 2.5, '#fff', null);
  },
  umbrella(ctx, d, c) {
    const hy = d.handR * 0.6, cy = hy - 76;
    rr(ctx, -1.5, cy, 3, 92, 1.5); fillStroke(ctx, '#15172a', OUT, 1.5);
    ctx.beginPath(); ctx.arc(0, cy, 34, Math.PI, TAU); ctx.closePath(); fillStroke(ctx, c.top);
    for (let i = -2; i <= 2; i++) line(ctx, 0, cy, i * 15, cy - Math.sqrt(Math.max(0, 34 * 34 - (i * 15) ** 2)), shade(c.top, -0.3), 1.5);
    ctx.beginPath(); ctx.arc(-4, hy + 16, 4, 0, Math.PI); ctx.strokeStyle = '#15172a'; ctx.lineWidth = 3; ctx.stroke();
  },
  shield(ctx, d, c) {
    const hy = d.handR * 0.6;
    circle(ctx, 0, hy + 2, 22, c.accent, OUT, 3);
    circle(ctx, 0, hy + 2, 16, shade(c.accent, 0.2), OUT, 2);
    circle(ctx, 0, hy + 2, 6, c.top, OUT, 2);
  },
};

// ---------------------------------------------------------------- animations
// A pose is a flat bag of numbers. Limb angles are "outward from the body" so one
// value serves both sides; the renderer mirrors the sign for the right side.
const BASE = () => ({
  rootX: 0, rootY: 0, rootRot: 0, torsoRot: 0, torsoSy: 1, headRot: 0,
  armL: 0.12, foreL: 0.1, armR: 0.12, foreR: 0.1, armLSy: 1, armRSy: 1,
  legL: 0.05, shinL: 0, legR: 0.05, shinR: 0, legLSy: 1, legRSy: 1, footL: 0, footR: 0,
});
const smooth = (x) => x * x * (3 - 2 * x);

const ANIM = {
  idle(t) {
    const s = Math.sin((TAU * t) / 3);
    return { torsoSy: 1 + 0.012 * s, rootY: 1.2 * s, armL: 0.12 + 0.03 * s, armR: 0.12 + 0.03 * s, headRot: 0.02 * Math.sin((TAU * t) / 5) };
  },
  walk(t) {
    const p = (TAU * t) / 0.9, s = Math.sin(p);
    const liftL = Math.max(0, s), liftR = Math.max(0, -s);
    return {
      rootY: -3 * (0.5 - 0.5 * Math.cos(2 * p)), torsoRot: 0.025 * s, headRot: -0.03 * s,
      legL: 0.05 + 0.1 * liftL, legLSy: 1 - 0.32 * liftL, shinL: -0.1 * liftL, footL: -0.35 * liftL,
      legR: 0.05 + 0.1 * liftR, legRSy: 1 - 0.32 * liftR, shinR: -0.1 * liftR, footR: -0.35 * liftR,
      armL: 0.14 + 0.08 * s, armR: 0.14 - 0.08 * s, foreL: 0.25, foreR: 0.25,
      armLSy: 1 - 0.1 * liftR, armRSy: 1 - 0.1 * liftL,
    };
  },
  run(t) {
    const p = (TAU * t) / 0.55, s = Math.sin(p);
    const liftL = Math.max(0, s), liftR = Math.max(0, -s);
    return {
      rootY: -7 * (0.5 - 0.5 * Math.cos(2 * p)) - 2, torsoRot: 0.05 * s, torsoSy: 0.97, headRot: -0.06 * s,
      legL: 0.08 + 0.18 * liftL, legLSy: 1 - 0.5 * liftL, shinL: -0.15 * liftL, footL: -0.5 * liftL,
      legR: 0.08 + 0.18 * liftR, legRSy: 1 - 0.5 * liftR, shinR: -0.15 * liftR, footR: -0.5 * liftR,
      armL: 0.3 + 0.2 * s, armR: 0.3 - 0.2 * s, foreL: 1.1, foreR: 1.1,
      armLSy: 1 - 0.2 * liftR, armRSy: 1 - 0.2 * liftL,
    };
  },
  jump(t) {
    const T = 1.8, u = (t % T) / T;
    let crouch = 0, air = 0;
    if (u < 0.2) crouch = smooth(u / 0.2);
    else if (u < 0.3) crouch = 1 - smooth((u - 0.2) / 0.1);
    else if (u < 0.78) air = Math.sin((Math.PI * (u - 0.3)) / 0.48);
    else if (u < 0.88) crouch = 0.9 * smooth((u - 0.78) / 0.1);
    else crouch = 0.9 * (1 - smooth((u - 0.88) / 0.12));
    const leg = 0.05 + 0.25 * crouch + 0.2 * air, legSy = 1 - 0.3 * crouch - 0.35 * air;
    const shin = -0.35 * crouch - 0.45 * air, arm = 0.12 + 0.55 * crouch + 2.5 * air, fore = 0.1 + 0.4 * crouch - 0.3 * air;
    return {
      rootY: 12 * crouch - 64 * air, torsoSy: 1 - 0.05 * crouch,
      legL: leg, legR: leg, legLSy: legSy, legRSy: legSy, shinL: shin, shinR: shin, footL: -0.2 * air, footR: -0.2 * air,
      armL: arm, armR: arm, foreL: fore, foreR: fore,
    };
  },
  wave(t) {
    const s = Math.sin((TAU * t) / 0.55), b = Math.sin((TAU * t) / 3);
    return { torsoSy: 1 + 0.01 * b, rootY: b, headRot: 0.06, torsoRot: -0.03, armR: 2.5, foreR: 0.9 + 0.5 * s, armL: 0.12 + 0.03 * b };
  },
  dance(t) {
    const p = (TAU * t) / 1.1, s = Math.sin(p);
    return {
      rootX: 7 * s, rootY: -3 * Math.abs(s), rootRot: 0.04 * s, torsoRot: 0.08 * s, headRot: -0.12 * s,
      armL: 1.3 + 0.9 * s, armR: 1.3 - 0.9 * s, foreL: -0.9, foreR: -0.9,
      legL: 0.18 + 0.12 * s, legR: 0.18 - 0.12 * s,
      shinL: -0.25 * Math.max(0, -s), shinR: -0.25 * Math.max(0, s),
      legLSy: 1 - 0.1 * Math.max(0, -s), legRSy: 1 - 0.1 * Math.max(0, s),
    };
  },
};
const FLUTTER = { idle: 0.25, walk: 0.55, run: 1, jump: 0.8, wave: 0.3, dance: 0.6 };

// ---------------------------------------------------------------- the avatar
export function createAvatar(container, options = {}) {
  const cfg = { ...DEFAULTS };
  const api = new EventTarget();
  const emit = (type, detail = {}) => api.dispatchEvent(new CustomEvent(type, { detail }));

  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const W = 320, H = 420, ROOT_Y = 262, GROUND_Y = 362;
  let dpr = 1, scale = 1, ox = 0, oy = 0, cssW = 0, cssH = 0;
  let anim = ANIMATIONS.includes(options.animation) ? options.animation : 'idle';
  let prevAnim = null, animStart = 0, prevStart = 0, blendStart = 0;
  let clock = 0, lastTs = null, speed = 1, raf = 0, running = false;

  function sanitize(next) {
    const out = {};
    for (const [k, v] of Object.entries(next || {})) {
      if (!(k in LIBRARY)) continue;
      if (COLOR_KEYS.has(k)) { if (/^#[0-9a-f]{6}$/i.test(String(v))) out[k] = String(v).toLowerCase(); }
      else if (LIBRARY[k].includes(v)) out[k] = v;
    }
    return out;
  }
  Object.assign(cfg, sanitize(options));

  function fit() {
    const rect = container.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 8 || h < 8) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    if (w === cssW && h === cssH && ratio === dpr) return;
    cssW = w; cssH = h; dpr = ratio;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    scale = Math.min(w / W, h / H);
    ox = (w - W * scale) / 2; oy = (h - H * scale) / 2;
    draw(clock);
  }

  const poseAt = (name, t) => ({ ...BASE(), ...ANIM[name](t) });
  function currentPose() {
    const cur = poseAt(anim, clock - animStart);
    if (prevAnim == null) return cur;
    const k = clamp((clock - blendStart) / 0.35, 0, 1);
    if (k >= 1) { prevAnim = null; return cur; }
    const prev = poseAt(prevAnim, clock - prevStart), s = smooth(k), out = {};
    for (const key in cur) out[key] = prev[key] + (cur[key] - prev[key]) * s;
    return out;
  }

  // World matrices per bone. Foreshortening (sy) is applied to a bone's own
  // drawing only; children hang off the scaled length, not the scaled frame.
  function bones(p, d) {
    const base = new DOMMatrix([dpr, 0, 0, dpr, 0, 0]).translate(ox, oy).scale(scale, scale);
    const root = base.translate(W / 2 + p.rootX, ROOT_Y + p.rootY).rotate(deg(p.rootRot));
    const torsoA = root.rotate(deg(p.torsoRot));
    const B = { base, root, torso: torsoA.scale(1, p.torsoSy), head: torsoA.translate(0, -d.torsoLen * p.torsoSy).rotate(deg(p.headRot)) };
    for (const [s, sign] of [['L', 1], ['R', -1]]) {
      const armA = torsoA.translate(-sign * d.shoulderX, d.shoulderY * p.torsoSy).rotate(deg(sign * p[`arm${s}`]));
      B[`arm${s}`] = armA.scale(1, p[`arm${s}Sy`]);
      B[`fore${s}`] = armA.translate(0, d.upper * p[`arm${s}Sy`]).rotate(deg(sign * p[`fore${s}`]));
      B[`hand${s}`] = B[`fore${s}`].translate(0, d.fore);
      const legA = root.translate(-sign * d.hipX, 0).rotate(deg(sign * p[`leg${s}`]));
      B[`leg${s}`] = legA.scale(1, p[`leg${s}Sy`]);
      B[`shin${s}`] = legA.translate(0, d.thigh * p[`leg${s}Sy`]).rotate(deg(sign * p[`shin${s}`]));
      B[`foot${s}`] = B[`shin${s}`].translate(0, d.shin).rotate(deg(sign * p[`foot${s}`]));
    }
    return B;
  }

  function draw(t) {
    if (cssW < 8) return;
    const p = currentPose(), d = makeDims(cfg);
    const c = { skin: cfg.skin, hair: cfg.hairColor, top: cfg.topColor, bottom: cfg.bottomColor, accent: cfg.accent };
    const B = bones(p, d);
    const use = (m) => ctx.setTransform(m);
    const top = TOP[cfg.top] || {}, bottom = BOTTOM[cfg.bottom] || {}, shoes = SHOES[cfg.shoes] || {};
    const gloves = GLOVES[cfg.gloves] || {}, back = BACK[cfg.back] || {}, hair = HAIR[cfg.hair] || {};

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = 'round';

    // Floor + a shadow that shrinks and fades as the character leaves the ground.
    use(B.base);
    ellipse(ctx, W / 2, GROUND_Y + 3, 118, 17, 'rgba(255,255,255,0.045)', null);
    const lift = clamp(-p.rootY / 64, 0, 1);
    ellipse(ctx, W / 2 + p.rootX * 0.6, GROUND_Y, 42 * (1 - 0.45 * lift), 9 * (1 - 0.45 * lift), `rgba(0,0,0,${0.35 * (1 - 0.5 * lift)})`, null);

    const flutter = FLUTTER[anim] ?? 0.3;
    use(B.torso); back.draw?.(ctx, d, c, t, flutter);
    use(B.head); hair.back?.(ctx, d, c);

    for (const s of ['L', 'R']) {
      use(B[`leg${s}`]); limb(ctx, d.thigh, d.legW, c.skin); bottom.thigh?.(ctx, d, c);
      use(B[`shin${s}`]); limb(ctx, d.shin, d.legW, c.skin); bottom.shin?.(ctx, d, c);
      use(B[`foot${s}`]); ellipse(ctx, 0, 7, d.legW * 0.75, 7, c.skin); shoes.foot?.(ctx, d, c);
    }
    use(B.root); bottom.skirt?.(ctx, d, c); top.skirt?.(ctx, d, c);

    use(B.torso);
    top.behind?.(ctx, d, c);
    rr(ctx, -7, -d.torsoLen - 8, 14, 14, 4); fillStroke(ctx, c.skin); // neck
    torsoPath(ctx, d); fillStroke(ctx, c.skin);
    top.torso?.(ctx, d, c);
    back.over?.(ctx, d, c);

    for (const s of ['L', 'R']) {
      use(B[`arm${s}`]); limb(ctx, d.upper, d.armW, c.skin); top.upper?.(ctx, d, c);
      use(B[`fore${s}`]); limb(ctx, d.fore, d.armW, c.skin); top.fore?.(ctx, d, c);
      use(B[`hand${s}`]); circle(ctx, 0, d.handR * 0.6, d.handR, c.skin); gloves.hand?.(ctx, d, c);
    }
    use(B.torso); top.over?.(ctx, d, c);

    use(B.head);
    headPath(ctx, d); fillStroke(ctx, c.skin);
    const blink = (t + 1.3) % 3.4 < 0.13;
    const eyes = () => drawEyes(ctx, d, c, cfg.eyes, blink);
    eyes(); drawMouth(ctx, d, cfg.mouth);
    hair.front?.(ctx, d, c);
    FACE[cfg.face]?.(ctx, d, c, eyes);
    HAT[cfg.hat]?.(ctx, d, c);

    use(B.handR); ITEM[cfg.item]?.(ctx, d, c);
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (lastTs != null) clock += Math.min(0.05, (ts - lastTs) / 1000) * speed;
    lastTs = ts;
    draw(clock);
  }
  function start() { if (running) return; running = true; lastTs = null; raf = requestAnimationFrame(loop); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  const onVis = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVis);

  const observer = new ResizeObserver(fit);
  observer.observe(container);
  fit();
  start();

  Object.assign(api, {
    canvas,
    setAnimation(name) {
      if (!ANIM[name] || name === anim) return;
      prevAnim = anim; prevStart = animStart;
      anim = name; animStart = clock; blendStart = clock;
      emit('animation', { name });
      draw(clock);
    },
    setConfig(next) {
      Object.assign(cfg, sanitize(next));
      emit('change', { config: { ...cfg } });
      draw(clock);
    },
    applyPreset(name) { if (PRESETS[name]) api.setConfig(PRESETS[name]); },
    randomize() {
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const next = {};
      for (const k of Object.keys(LIBRARY)) next[k] = pick(LIBRARY[k]);
      api.setConfig(next);
    },
    setSpeed(v) { speed = clamp(Number(v) || 1, 0.1, 4); },
    /** Draw a single frame at clock time `t` — deterministic, no rAF needed. */
    render(t) { clock = Number(t) || 0; draw(clock); },
    start, stop,
    destroy() { stop(); observer.disconnect(); document.removeEventListener('visibilitychange', onVis); canvas.remove(); },
  });
  Object.defineProperties(api, {
    config: { get: () => ({ ...cfg }), enumerable: true },
    animation: { get: () => anim, enumerable: true },
    speed: { get: () => speed, enumerable: true },
    time: { get: () => clock, enumerable: true },
  });
  return api;
}
