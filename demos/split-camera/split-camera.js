// Split-screen camera logic for up to four local players. No rendering here.
//
// Every player has their own camera. Players who are close together end up
// with identical cameras, so the boundary between their screen regions is
// invisible and they appear to share one view. The screen is divided into one
// region per player (each player owns the part of the screen nearest to their
// own avatar), which gives angled dividers that point toward the other group.
/** Side lies on the screen border. */
export const EDGE_SCREEN = -1;
/** Side is a fixed-grid divider, always drawn. */
export const EDGE_FIXED = -2;
const QUADS = [[0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]];
/** Distances are fractions of the screen (1 = full width or height). */
export const params = {
  /** Which quarter of the screen the shared panel takes in the four-panel layout: 0 top left, 1 top right, 2 bottom left, 3 bottom right. */
  mapQuadrant: 3,
  /** Groups merge when all their members are within this distance. */
  mergeDist: 0.26,
  /** A group breaks up when its members spread beyond this distance. */
  splitDist: 0.34,
  /** A group stays in the shared view until it is this far from the centre. */
  innerClamp: 0.25,
  /** Furthest a group's anchor may be pushed from the screen centre. */
  outerClamp: 0.36,
  /** Separate groups get anchors at least this far apart once fully split. */
  minSiteSep: 0.4,
  /** Members of a group are kept at least this far inside the screen edge. */
  memberMargin: 0.42,
  /** Roughly how long a camera takes to catch up with its target, in seconds. */
  smoothTime: 0.16,
};
function mean(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}
function clampRect(v, r) {
  const f = Math.max(Math.abs(v.x) / r, Math.abs(v.y) / r, 1);
  return { x: v.x / f, y: v.y / f };
}
/** Keep the part of a convex polygon where a.x*x + a.y*y <= c. */
function clipPolygon(poly, ax, ay, c, label) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    const dCur = ax * cur.x + ay * cur.y - c;
    const dNext = ax * next.x + ay * next.y - c;
    const curIn = dCur <= 0;
    const nextIn = dNext <= 0;
    if (curIn)
      out.push({ x: cur.x, y: cur.y, edge: cur.edge });
    if (curIn !== nextIn) {
      const t = dCur / (dCur - dNext);
      out.push({
        x: cur.x + (next.x - cur.x) * t,
        y: cur.y + (next.y - cur.y) * t,
        // Leaving the kept side: the new side follows the clip line.
        // Re-entering: the rest of the original side continues.
        edge: curIn ? label : cur.edge,
      });
    }
  }
  return out;
}
/** Fixed-grid layout as [left, top, right, bottom] fractions of the screen, one per player. */
function gridRects(n, layout) {
  if (n <= 1)
    return [[0, 0, 1, 1]];
  if (n >= 4)
    return QUADS;
  if (n === 3 && layout === 'quad')
    return QUADS.filter((_, q) => q !== params.mapQuadrant);
  const rects = [];
  for (let i = 0; i < n; i++) {
    rects.push(layout === 'rows' ? [0, i / n, 1, (i + 1) / n] : [i / n, 0, (i + 1) / n, 1]);
  }
  return rects;
}
export class SplitCamera {
  /** Groups of player indices that currently share a view. */
  clusters = [];
  /** World point at the centre of each player's view. */
  camPos = [];
  camVel = [];
  /** Distinct cameras to render this frame. */
  views = [];
  /** Which entry of `views` each player uses. */
  viewOf = [];
  /** Each player's avatar position on screen, in pixels. */
  sites = [];
  /** Each player's screen region, in pixels. */
  cells = [];
  /** Number of times the grouping has changed. */
  regroupCount = 0;
  /** Players whose group changed on the last update. */
  regrouped = [];
  /** The free panel for a shared display, as screen fractions, when the layout has one. */
  miscRect = null;
  update(players, W, H, zoom, dt, mode, layout = 'columns') {
    const n = players.length;
    const sx = W / zoom;
    const sy = H / zoom;
    this.updateClusters(players, sx, sy);
    const targets = mode === 'fixed' ? this.fixedTargets(players, sx, sy, layout) : this.dynamicTargets(players, sx, sy);
    // Ease each camera toward its target so a regroup becomes a short pan, not a
    // jump. The pan starts and ends gently (critically damped spring).
    const omega = 2 / params.smoothTime;
    const k = omega * dt;
    const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    this.camPos.length = n;
    this.camVel.length = n;
    for (let i = 0; i < n; i++) {
      const cur = this.camPos[i];
      // The fixed grid never regroups, so its cameras are locked to their players.
      if (!cur || mode === 'fixed') {
        this.camPos[i] = { ...targets[i] };
        this.camVel[i] = { x: 0, y: 0 };
        continue;
      }
      const vel = this.camVel[i];
      const dx = cur.x - targets[i].x;
      const dy = cur.y - targets[i].y;
      const tx = (vel.x + omega * dx) * dt;
      const ty = (vel.y + omega * dy) * dt;
      vel.x = (vel.x - omega * tx) * decay;
      vel.y = (vel.y - omega * ty) * decay;
      cur.x = targets[i].x + (dx + tx) * decay;
      cur.y = targets[i].y + (dy + ty) * decay;
    }
    // Cameras that have converged are treated as one view and rendered once.
    this.views = [];
    this.viewOf = [];
    for (let i = 0; i < n; i++) {
      let found = -1;
      for (let v = 0; v < this.views.length; v++) {
        const d = Math.hypot(this.views[v].x - this.camPos[i].x, this.views[v].y - this.camPos[i].y) * zoom;
        if (d < 0.75) {
          found = v;
          break;
        }
      }
      if (found < 0) {
        this.views.push({ ...this.camPos[i] });
        found = this.views.length - 1;
      }
      else {
        this.camPos[i].x = this.views[found].x;
        this.camPos[i].y = this.views[found].y;
        this.camVel[i] = { ...this.camVel[this.viewOf.indexOf(found)] };
      }
      this.viewOf[i] = found;
    }
    this.sites = players.map((p, i) => ({
      x: W / 2 + (p.x - this.camPos[i].x) * zoom,
      y: H / 2 + (p.y - this.camPos[i].y) * zoom,
    }));
    this.cells = mode === 'fixed' ? this.fixedCells(n, W, H, layout) : this.dynamicCells(W, H);
    this.miscRect = mode === 'fixed' && n === 3 && layout === 'quad' ? QUADS[params.mapQuadrant] : null;
  }
  /** How far apart two players' views are, in screen pixels. Zero means seamless. */
  camDiffPx(i, j, zoom) {
    return Math.hypot(this.camPos[i].x - this.camPos[j].x, this.camPos[i].y - this.camPos[j].y) * zoom;
  }
  updateClusters(P, sx, sy) {
    const n = P.length;
    const dist = (i, j) => Math.hypot((P[i].x - P[j].x) / sx, (P[i].y - P[j].y) / sy);
    const diameter = (c) => {
      let d = 0;
      for (let a = 0; a < c.length; a++)
        for (let b = a + 1; b < c.length; b++)
          d = Math.max(d, dist(c[a], c[b]));
      return d;
    };
    const signature = (cl) => cl.map((c) => c.join(',')).join('|');
    const before = signature(this.clusters);
    const groupOfBefore = new Map();
    for (const c of this.clusters)
      for (const i of c)
        groupOfBefore.set(i, c.join(','));
    const cl = this.clusters.map((c) => c.filter((i) => i < n)).filter((c) => c.length > 0);
    const seen = new Set(cl.flat());
    for (let i = 0; i < n; i++)
      if (!seen.has(i))
        cl.push([i]);
    // Break up groups that have spread too far: drop the member furthest from the rest.
    for (let ci = 0; ci < cl.length; ci++) {
      const c = cl[ci];
      while (c.length > 1 && diameter(c) > params.splitDist) {
        let worst = 0;
        let worstSum = -1;
        for (let a = 0; a < c.length; a++) {
          let sum = 0;
          for (let b = 0; b < c.length; b++)
            sum += dist(c[a], c[b]);
          if (sum > worstSum) {
            worstSum = sum;
            worst = a;
          }
        }
        cl.push([c[worst]]);
        c.splice(worst, 1);
      }
    }
    // Merge groups, tightest first. The merge distance is smaller than the split
    // distance, so a group cannot flicker between merged and split.
    for (;;) {
      let best = null;
      let bestD = params.mergeDist;
      for (let a = 0; a < cl.length; a++) {
        for (let b = a + 1; b < cl.length; b++) {
          const d = diameter(cl[a].concat(cl[b]));
          if (d < bestD) {
            bestD = d;
            best = [a, b];
          }
        }
      }
      if (!best)
        break;
      cl[best[0]] = cl[best[0]].concat(cl[best[1]]);
      cl.splice(best[1], 1);
    }
    for (const c of cl)
      c.sort((a, b) => a - b);
    cl.sort((a, b) => a[0] - b[0]);
    this.clusters = cl;
    this.regrouped = [];
    if (before !== '' && signature(cl) !== before) {
      this.regroupCount++;
      for (const c of cl)
        for (const i of c)
          if (groupOfBefore.get(i) !== c.join(','))
            this.regrouped.push(i);
    }
  }
  dynamicTargets(P, sx, sy) {
    const centre = mean(P);
    const K = this.clusters.length;
    const m = []; // group centre in the world
    const v = []; // where the group would sit on a single shared screen
    const s = []; // where the group's anchor actually sits on screen
    for (let k = 0; k < K; k++) {
      m[k] = mean(this.clusters[k].map((i) => P[i]));
      v[k] = { x: (m[k].x - centre.x) / sx, y: (m[k].y - centre.y) / sy };
      // Groups that fit on the shared screen keep their true position, which makes
      // every camera identical. Groups that do not fit are pulled back inside.
      s[k] = clampRect(v[k], params.innerClamp);
    }
    // Pulled-in anchors can land on top of each other. Push them apart, but never
    // further than the groups really are, so nearby groups still line up seamlessly.
    for (let it = 0; it < 8; it++) {
      for (let k = 0; k < K; k++) {
        for (let l = k + 1; l < K; l++) {
          const wx = v[k].x - v[l].x;
          const wy = v[k].y - v[l].y;
          const wd = Math.hypot(wx, wy);
          if (wd < 1e-9)
            continue;
          const target = Math.min(wd, params.minSiteSep);
          const d = Math.hypot(s[k].x - s[l].x, s[k].y - s[l].y);
          if (d < target - 1e-6) {
            const push = (target - d) / 2;
            s[k].x += (wx / wd) * push;
            s[k].y += (wy / wd) * push;
            s[l].x -= (wx / wd) * push;
            s[l].y -= (wy / wd) * push;
          }
        }
      }
      for (let k = 0; k < K; k++)
        s[k] = clampRect(s[k], params.outerClamp);
    }
    // Shift each anchor so every member of the group stays on screen.
    const margin = params.memberMargin;
    for (let k = 0; k < K; k++) {
      let minX = 0, maxX = 0, minY = 0, maxY = 0;
      for (const i of this.clusters[k]) {
        const ox = (P[i].x - m[k].x) / sx;
        const oy = (P[i].y - m[k].y) / sy;
        minX = Math.min(minX, ox);
        maxX = Math.max(maxX, ox);
        minY = Math.min(minY, oy);
        maxY = Math.max(maxY, oy);
      }
      s[k].x = Math.min(Math.max(s[k].x, -margin - minX), margin - maxX);
      s[k].y = Math.min(Math.max(s[k].y, -margin - minY), margin - maxY);
    }
    const targets = [];
    for (let k = 0; k < K; k++) {
      for (const i of this.clusters[k])
        targets[i] = { x: m[k].x - s[k].x * sx, y: m[k].y - s[k].y * sy };
    }
    return targets;
  }
  fixedTargets(P, sx, sy, layout) {
    const rects = gridRects(P.length, layout);
    return P.map((p, i) => {
      const r = rects[i];
      return { x: p.x - ((r[0] + r[2]) / 2 - 0.5) * sx, y: p.y - ((r[1] + r[3]) / 2 - 0.5) * sy };
    });
  }
  dynamicCells(W, H) {
    const n = this.sites.length;
    const cells = [];
    for (let i = 0; i < n; i++) {
      let poly = [
        { x: 0, y: 0, edge: EDGE_SCREEN },
        { x: W, y: 0, edge: EDGE_SCREEN },
        { x: W, y: H, edge: EDGE_SCREEN },
        { x: 0, y: H, edge: EDGE_SCREEN },
      ];
      const si = this.sites[i];
      for (let j = 0; j < n && poly.length > 0; j++) {
        if (j === i)
          continue;
        const sj = this.sites[j];
        const dx = sj.x - si.x;
        const dy = sj.y - si.y;
        // Avatars on the same spot share the region; their views are identical anyway.
        if (Math.hypot(dx, dy) < 1)
          continue;
        const c = (sj.x * sj.x + sj.y * sj.y - si.x * si.x - si.y * si.y) / 2;
        poly = clipPolygon(poly, dx, dy, c, j);
      }
      cells.push(poly);
    }
    return cells;
  }
  fixedCells(n, W, H, layout) {
    const onBorder = (a) => a < 1e-6 || a > 1 - 1e-6;
    return gridRects(n, layout).map((r) => [
      { x: r[0] * W, y: r[1] * H, edge: onBorder(r[1]) ? EDGE_SCREEN : EDGE_FIXED },
      { x: r[2] * W, y: r[1] * H, edge: onBorder(r[2]) ? EDGE_SCREEN : EDGE_FIXED },
      { x: r[2] * W, y: r[3] * H, edge: onBorder(r[3]) ? EDGE_SCREEN : EDGE_FIXED },
      { x: r[0] * W, y: r[3] * H, edge: onBorder(r[0]) ? EDGE_SCREEN : EDGE_FIXED },
    ]);
  }
}
