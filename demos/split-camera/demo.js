/**
 * Test room for the split-screen camera: a large room, up to four players
 * (keyboard, gamepad or bot), a swarm for load, mini maps, and a control panel.
 * The camera logic itself lives in split-camera.js; this file only draws and drives it.
 *
 * Rendering uses PixiJS. The page passes in the PixiJS module and the camera
 * module, so this file has no imports of its own.
 */
const WORLD = 6000;
const ZOOM = 1;
const PLAYER_SPEED = 420;
const MAX_PLAYERS = 4;
const COLORS = [0x4cc9f0, 0xf72585, 0xffd166, 0x80ed99];
const KEYSETS = [
  ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
  ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'],
  ['KeyI', 'KeyJ', 'KeyK', 'KeyL'],
  ['Numpad8', 'Numpad4', 'Numpad5', 'Numpad6'],
];
const KEYSET_NAMES = ['W A S D', 'Arrow keys', 'I J K L', 'Numpad 8 4 5 6'];
/** Most corners a screen region can have: four screen corners plus one per other player. */
const CELL_VERTS = 8;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export async function start({ PIXI, splitCamera, host, panel }) {
  const { Application, Container, Graphics, Mesh, MeshGeometry, RenderTexture, Sprite, Text } = PIXI;
  const { EDGE_FIXED, SplitCamera, params } = splitCamera;
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#0c1016',
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);
  // ---------------------------------------------------------------- world
  // The world is never added to the stage. It is drawn once per distinct camera
  // into a texture, and each player's screen region shows the matching texture.
  const world = new Container();
  const rand = mulberry32(7);
  const ground = new Graphics();
  ground.rect(0, 0, WORLD, WORLD).fill(0x182230);
  for (let i = 0; i <= WORLD; i += 125) {
    const major = i % 1000 === 0;
    ground.moveTo(i, 0).lineTo(i, WORLD).stroke({ width: major ? 4 : 1, color: major ? 0x3b4d66 : 0x243246 });
    ground.moveTo(0, i).lineTo(WORLD, i).stroke({ width: major ? 4 : 1, color: major ? 0x3b4d66 : 0x243246 });
  }
  ground.rect(0, 0, WORLD, WORLD).stroke({ width: 16, color: 0x7a8ba3 });
  world.addChild(ground);
  // Scattered landmarks and zone labels, so it is obvious where each view is looking.
  const props = new Graphics();
  const propColors = [0x35506e, 0x4a3f6b, 0x2f5d50, 0x6b4a3f, 0x5a5a2f];
  for (let i = 0; i < 260; i++) {
    const x = 100 + rand() * (WORLD - 200);
    const y = 100 + rand() * (WORLD - 200);
    const size = 20 + rand() * 60;
    const color = propColors[Math.floor(rand() * propColors.length)];
    if (rand() < 0.5)
      props.circle(x, y, size / 2).fill(color);
    else
      props.roundRect(x - size / 2, y - size / 2, size, size * (0.6 + rand() * 0.8), 6).fill(color);
  }
  world.addChild(props);
  for (let gx = 0; gx < WORLD / 1000; gx++) {
    for (let gy = 0; gy < WORLD / 1000; gy++) {
      const label = new Text({
        text: `${String.fromCharCode(65 + gx)}${gy + 1}`,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 120, fontWeight: '700', fill: 0xffffff },
      });
      label.alpha = 0.08;
      label.anchor.set(0.5);
      label.position.set(gx * 1000 + 500, gy * 1000 + 500);
      world.addChild(label);
    }
  }
  // ---------------------------------------------------------------- swarm
  const swarmLayer = new Container();
  world.addChild(swarmLayer);
  const dot = new Graphics().circle(8, 8, 7).fill(0xd94f4f).stroke({ width: 2, color: 0x5c1a1a });
  const swarmTexture = app.renderer.generateTexture(dot);
  const swarm = [];
  let swarmCount = 0;
  const swarmRand = mulberry32(99);
  function setSwarm(count) {
    swarmCount = count;
    while (swarm.length < count) {
      const sprite = new Sprite(swarmTexture);
      sprite.anchor.set(0.5);
      sprite.position.set(swarmRand() * WORLD, swarmRand() * WORLD);
      swarmLayer.addChild(sprite);
      swarm.push({ sprite, speed: 60 + swarmRand() * 70, phase: swarmRand() * Math.PI * 2 });
    }
    while (swarm.length > count)
      swarm.pop().sprite.destroy();
  }
  // ---------------------------------------------------------------- players
  const playerLayer = new Container();
  world.addChild(playerLayer);
  const players = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const node = new Container();
    const ring = new Graphics().circle(0, 0, 30).stroke({ width: 4, color: COLORS[i] });
    ring.alpha = 0;
    const body = new Graphics().circle(0, 0, 20).fill(COLORS[i]).stroke({ width: 3, color: 0xffffff });
    const pointer = new Graphics().poly([20, -7, 34, 0, 20, 7]).fill(0xffffff);
    const tag = new Text({
      text: `P${i + 1}`,
      style: { fontFamily: 'system-ui, sans-serif', fontSize: 18, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x000000, width: 4 } },
    });
    tag.anchor.set(0.5, 1);
    tag.position.set(0, -26);
    node.addChild(ring, pointer, body, tag);
    playerLayer.addChild(node);
    const x = WORLD / 2 + (i - 1.5) * 70;
    const y = WORLD / 2;
    players.push({ x, y, control: i === 0 ? 'keys' : 'bot', node, ring, pointer, pulse: 0, target: { x, y } });
  }
  let playerCount = 4;
  const active = () => players.slice(0, playerCount);
  // ---------------------------------------------------------------- screen
  const viewLayer = new Container();
  const dividers = new Graphics();
  const debug = new Graphics();
  // Mini maps. Each one is the world drawn small into its own texture, with markers on top.
  //  - The overview shows the whole room: in the spare panel, or as one shared map.
  //  - Local maps show the surroundings of one player (fixed grid) or one group (dynamic split).
  /** World units across a local map. */
  const LOCAL_MAP_SPAN = 2600;
  const mapBack = new Graphics();
  const mapLayer = new Container();
  const mapOverlay = new Graphics();
  const mapTitle = new Text({
    text: 'MAP',
    style: { fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: '700', fill: 0x8b98a9, letterSpacing: 2 },
  });
  const makeMap = () => {
    const texture = RenderTexture.create({ width: 64, height: 64, resolution: app.renderer.resolution });
    const sprite = new Sprite(texture);
    sprite.visible = false;
    mapLayer.addChild(sprite);
    return { texture, sprite };
  };
  const overviewMap = makeMap();
  const localMaps = [0, 1, 2, 3].map(makeMap);
  /** Screen corner each player's group map last used, so maps do not hop between corners. */
  const mapCorner = [0, 0, 0, 0];
  app.stage.addChild(viewLayer, dividers, mapBack, mapLayer, mapOverlay, mapTitle, debug);
  /**
  * Draw the world into a mini map at screen position (x, y). `centre` is the world
  * point in the middle and `span` is how many world units fit across. Returns the scale.
  */
  function renderMap(map, x, y, size, centre, span, alpha = 1) {
    if (map.texture.width !== size) {
      // A fresh texture, because resizing one in place left it drawing at its old size.
      map.texture.destroy(true);
      map.texture = RenderTexture.create({ width: size, height: size, resolution: app.renderer.resolution });
      map.sprite.texture = map.texture;
    }
    const scale = size / span;
    world.scale.set(scale);
    world.position.set(size / 2 - centre.x * scale, size / 2 - centre.y * scale);
    app.renderer.render({ container: world, target: map.texture, clear: true });
    map.sprite.visible = true;
    map.sprite.alpha = alpha;
    map.sprite.position.set(x, y);
    map.sprite.setSize(size, size);
    return scale;
  }
  const renderTextures = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    renderTextures.push(RenderTexture.create({ width: app.screen.width, height: app.screen.height, resolution: app.renderer.resolution }));
  }
  // One mesh per player, shaped like that player's screen region and textured
  // with their camera's picture. Each region is a convex polygon drawn as a fan.
  const fan = [];
  for (let i = 1; i < CELL_VERTS - 1; i++)
    fan.push(0, i, i + 1);
  const meshes = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const geometry = new MeshGeometry({
      positions: new Float32Array(CELL_VERTS * 2),
      uvs: new Float32Array(CELL_VERTS * 2),
      indices: new Uint32Array(fan),
    });
    const mesh = new Mesh({ geometry, texture: renderTextures[0] });
    viewLayer.addChild(mesh);
    meshes.push(mesh);
  }
  // ---------------------------------------------------------------- input
  const keys = new Set();
  const handled = new Set(KEYSETS.flat());
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLSelectElement)
      return;
    keys.add(e.code);
    if (handled.has(e.code))
      e.preventDefault();
    if (e.code === 'Tab') {
      e.preventDefault();
      toggleOverlayMap();
    }
    if (e.code === 'KeyH')
      panel.classList.toggle('hidden');
    if (e.code === 'KeyM')
      setMode(mode === 'dynamic' ? 'fixed' : 'dynamic');
    if (e.code === 'KeyG')
      setDebug(!showDebug);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('gamepadconnected', (e) => {
    // Hand a newly connected gamepad to the first player still run by a bot.
    const id = `pad${e.gamepad.index}`;
    if (e.gamepad.index > 3 || players.some((p) => p.control === id))
      return;
    const free = active().find((p) => p.control === 'bot');
    if (free) {
      free.control = id;
      buildPanel();
    }
  });
  function readMove(i) {
    const p = players[i];
    if (p.control === 'keys') {
      const k = KEYSETS[i];
      return {
        x: (keys.has(k[3]) ? 1 : 0) - (keys.has(k[1]) ? 1 : 0),
        y: (keys.has(k[2]) ? 1 : 0) - (keys.has(k[0]) ? 1 : 0),
      };
    }
    if (p.control !== 'bot') {
      const pad = navigator.getGamepads()[Number(p.control.slice(3))];
      if (!pad)
        return { x: 0, y: 0 };
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      return Math.hypot(x, y) < 0.2 ? { x: 0, y: 0 } : { x, y };
    }
    const dx = p.target.x - p.x;
    const dy = p.target.y - p.y;
    const d = Math.hypot(dx, dy);
    return d < 12 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
  }
  // ---------------------------------------------------------------- bots
  // Bots regroup every few seconds into a new random arrangement (all together,
  // pairs, three and one, everyone apart), so one person can judge every
  // kind of split and merge. A bot grouped with a human follows that human.
  const botRand = mulberry32(2026);
  let botTimer = 0;
  let botPhase = 0;
  let botGroups = [0, 0, 0, 0];
  let botWaypoints = [];
  function newFormation() {
    botPhase++;
    const n = playerCount;
    const together = botPhase % 3 === 0;
    const groups = together ? 1 : 2 + Math.floor(botRand() * Math.max(1, n - 1));
    botGroups = players.map((_, i) => (together ? 0 : i < groups ? i : Math.floor(botRand() * groups)));
    const c = { x: 0, y: 0 };
    for (const p of active()) {
      c.x += p.x / n;
      c.y += p.y / n;
    }
    botWaypoints = [];
    for (let g = 0; g < MAX_PLAYERS; g++) {
      const angle = botRand() * Math.PI * 2;
      const radius = together ? 300 + botRand() * 500 : 500 + botRand() * 1100;
      botWaypoints.push({
        x: Math.min(WORLD - 300, Math.max(300, c.x + Math.cos(angle) * radius)),
        y: Math.min(WORLD - 300, Math.max(300, c.y + Math.sin(angle) * radius)),
      });
    }
  }
  function updateBots(dt) {
    botTimer -= dt;
    if (botTimer <= 0) {
      botTimer = 6.5;
      newFormation();
    }
    for (let i = 0; i < playerCount; i++) {
      const p = players[i];
      if (p.control !== 'bot')
        continue;
      const leader = active().find((q) => q.control !== 'bot' && botGroups[players.indexOf(q)] === botGroups[i]);
      const base = leader ?? botWaypoints[botGroups[i]];
      const a = (i / MAX_PLAYERS) * Math.PI * 2;
      p.target = { x: base.x + Math.cos(a) * 60, y: base.y + Math.sin(a) * 60 };
    }
  }
  // ---------------------------------------------------------------- settings
  let mode = 'dynamic';
  let layout = 'columns';
  let showDebug = false;
  let mapMode = 'own';
  /** Whether the on-player map is currently showing. Tab toggles it. */
  let overlayOpen = true;
  let paused = false;
  const camera = new SplitCamera();
  const stats = {
    fps: 0,
    frameMs: 0,
    worstFrameMs: 0,
    /** Largest movement of any avatar across the screen in one frame, in pixels. */
    maxJump: 0,
    regroups: 0,
  };
  let frames = 0;
  let frameClock = 0;
  let worstInWindow = 0;
  let prevSites = [];
  function resetStats() {
    stats.maxJump = 0;
    stats.worstFrameMs = 0;
    stats.regroups = 0;
    worstInWindow = 0;
    camera.regroupCount = 0;
  }
  let statsEl;
  function setMode(m) {
    mode = m;
    buildPanel();
  }
  function setMapQuadrant(q) {
    params.mapQuadrant = q;
    buildPanel();
  }
  function setLayout(l) {
    layout = l;
    buildPanel();
  }
  function setMapMode(m) {
    mapMode = m;
    if (m === 'onPlayer')
      overlayOpen = true;
    buildPanel();
  }
  /** Tab, or Back/Select on a gamepad: show or hide the map in the middle of each player's screen. */
  function toggleOverlayMap() {
    if (mapMode !== 'onPlayer')
      setMapMode('onPlayer');
    else
      overlayOpen = !overlayOpen;
  }
  let padToggleHeld = false;
  function pollPadToggle() {
    let held = false;
    for (const pad of navigator.getGamepads())
      if (pad?.buttons[8]?.pressed)
        held = true;
    if (held && !padToggleHeld)
      toggleOverlayMap();
    padToggleHeld = held;
  }
  function setDebug(on) {
    showDebug = on;
    buildPanel();
  }
  function setPlayerCount(n) {
    playerCount = n;
    players.forEach((p, i) => (p.node.visible = i < n));
    prevSites = [];
    buildPanel();
  }
  function buildPanel() {
    panel.innerHTML = '';
    const add = (parent, tag, text = '', cls = '') => {
      const el = document.createElement(tag);
      el.textContent = text;
      if (cls)
        el.className = cls;
      parent.appendChild(el);
      return el;
    };
    const buttons = (title, options, current, pick) => {
      add(panel, 'h2', title);
      const row = add(panel, 'div', '', 'row');
      for (const [label, value] of options) {
        const b = add(row, 'button', label, value === current ? 'on' : '');
        b.onclick = () => {
          pick(value);
          b.blur();
        };
      }
    };
    const back = add(panel, 'a', '← Lab', 'back-inline');
    back.href = '../../';
    add(panel, 'h1', 'Split-Screen Camera');
    buttons('Players', [['1', 1], ['2', 2], ['3', 3], ['4', 4]], playerCount, setPlayerCount);
    add(panel, 'h2', 'Controls');
    for (let i = 0; i < playerCount; i++) {
      const row = add(panel, 'div', '', 'row');
      const label = add(row, 'label', `P${i + 1}`);
      label.style.color = `#${COLORS[i].toString(16).padStart(6, '0')}`;
      const select = add(row, 'select');
      const options = [
        ['bot', 'Bot'],
        ['keys', `Keyboard: ${KEYSET_NAMES[i]}`],
        ['pad0', 'Gamepad 1'],
        ['pad1', 'Gamepad 2'],
        ['pad2', 'Gamepad 3'],
        ['pad3', 'Gamepad 4'],
      ];
      for (const [value, text] of options) {
        const o = add(select, 'option', text);
        o.value = value;
      }
      select.value = players[i].control;
      select.onchange = () => {
        players[i].control = select.value;
        select.blur();
      };
    }
    buttons('Camera', [['Dynamic split', 'dynamic'], ['Fixed grid', 'fixed']], mode, setMode);
    if (mode === 'fixed' && (playerCount === 2 || playerCount === 3)) {
      const options = [['Side by side', 'columns'], ['Stacked', 'rows']];
      if (playerCount === 3)
        options.push(['4 panels + map', 'quad']);
      const current = layout === 'quad' && playerCount !== 3 ? 'columns' : layout;
      buttons('Fixed grid layout', options, current, setLayout);
      if (current === 'quad') {
        buttons('Map panel position', [['Top left', 0], ['Top right', 1], ['Bottom left', 2], ['Bottom right', 3]], params.mapQuadrant, setMapQuadrant);
      }
    }
    buttons('Swarm size', [['0', 0], ['250', 250], ['1000', 1000], ['3000', 3000]], swarmCount, (n) => {
      setSwarm(n);
      buildPanel();
    });
    buttons('Mini map', [[mode === 'fixed' ? 'Per player' : 'Per group', 'own'], ['Shared', 'shared'], [mode === 'fixed' ? 'Centred (Tab)' : 'On player (Tab)', 'onPlayer'], ['Off', 'off']], mapMode, setMapMode);
    buttons('Overlay', [['Off', false], ['Show regions', true]], showDebug, setDebug);
    add(panel, 'h2', 'Measurements');
    statsEl = add(panel, 'pre');
    statsEl.id = 'stats';
    const row = add(panel, 'div', '', 'row');
    add(row, 'button', 'Reset measurements').onclick = resetStats;
    add(panel, 'h2', 'Keys');
    const help = add(panel, 'p', 'Tab: show or hide the pop-up map. M: switch camera mode. G: show regions. H: hide this panel.');
    help.id = 'help';
  }
  // ---------------------------------------------------------------- frame
  function simulate(dt) {
    updateBots(dt);
    for (let i = 0; i < playerCount; i++) {
      const p = players[i];
      const move = readMove(i);
      const len = Math.hypot(move.x, move.y);
      if (len > 0.01) {
        const scale = PLAYER_SPEED * dt * (len > 1 ? 1 / len : 1);
        p.x = Math.min(WORLD - 30, Math.max(30, p.x + move.x * scale));
        p.y = Math.min(WORLD - 30, Math.max(30, p.y + move.y * scale));
        p.pointer.rotation = Math.atan2(move.y, move.x);
      }
      p.node.position.set(p.x, p.y);
    }
    const list = active();
    for (const s of swarm) {
      let best = list[0];
      let bestD = Infinity;
      for (const p of list) {
        const d = (p.x - s.sprite.x) ** 2 + (p.y - s.sprite.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      s.phase += dt * 2;
      const angle = Math.atan2(best.y - s.sprite.y, best.x - s.sprite.x) + Math.sin(s.phase) * 0.9;
      if (bestD > 70 * 70) {
        s.sprite.x += Math.cos(angle) * s.speed * dt;
        s.sprite.y += Math.sin(angle) * s.speed * dt;
      }
    }
  }
  function draw(dt) {
    const W = app.screen.width;
    const H = app.screen.height;
    if (renderTextures[0].width !== W || renderTextures[0].height !== H) {
      // Fresh textures on a window resize, for the same reason as the mini map below.
      for (let i = 0; i < renderTextures.length; i++) {
        renderTextures[i].destroy(true);
        renderTextures[i] = RenderTexture.create({ width: W, height: H, resolution: app.renderer.resolution });
      }
    }
    const list = active();
    camera.update(list, W, H, ZOOM, dt, mode, layout);
    // Highlight a player briefly when their group changes, so they are easy to find.
    for (const i of camera.regrouped)
      players[i].pulse = 1;
    for (const p of list) {
      p.pulse = Math.max(0, p.pulse - dt * 1.6);
      p.ring.alpha = p.pulse;
      p.ring.scale.set(1 + (1 - p.pulse) * 1.8);
    }
    // Draw the world once per distinct camera.
    world.scale.set(ZOOM);
    for (let v = 0; v < camera.views.length; v++) {
      world.position.set(W / 2 - camera.views[v].x * ZOOM, H / 2 - camera.views[v].y * ZOOM);
      app.renderer.render({ container: world, target: renderTextures[v], clear: true });
    }
    // Mini maps.
    const misc = camera.miscRect;
    mapBack.clear();
    mapOverlay.clear();
    overviewMap.sprite.visible = false;
    for (const m of localMaps)
      m.sprite.visible = false;
    mapTitle.visible = false;
    const frame = (x, y, size, color) => mapBack.rect(x - 3, y - 3, size + 6, size + 6).fill({ color: 0x0c1016, alpha: 0.92 }).stroke({ width: 2, color });
    const marker = (x, y, i, radius) => mapOverlay.circle(x, y, radius).fill(COLORS[i]).stroke({ width: 1.5, color: 0xffffff });
    // The whole room, with every player marked.
    const drawOverview = (x, y, size) => {
      const scale = renderMap(overviewMap, x, y, size, { x: WORLD / 2, y: WORLD / 2 }, WORLD);
      for (let i = 0; i < list.length; i++) {
        if (mode === 'fixed') {
          // Outline the area this player's panel shows.
          const cell = camera.cells[i];
          const vw = (cell[1].x - cell[0].x) / ZOOM;
          const vh = (cell[2].y - cell[1].y) / ZOOM;
          mapOverlay
            .rect(x + (list[i].x - vw / 2) * scale, y + (list[i].y - vh / 2) * scale, vw * scale, vh * scale)
            .stroke({ width: 1.5, color: COLORS[i], alpha: 0.8 });
        }
        marker(x + list[i].x * scale, y + list[i].y * scale, i, 5);
      }
    };
    // The surroundings of `centre`. Players out of range are pinned to the edge,
    // so the map always shows which way the others are.
    const drawLocal = (map, x, y, size, centre, owners, alpha = 1) => {
      const scale = renderMap(map, x, y, size, centre, LOCAL_MAP_SPAN, alpha);
      const half = size / 2 - 5;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < list.length; i++) {
          const own = owners.includes(i);
          if (own !== (pass === 1))
            continue; // owners are drawn last, on top
          const dx = (list[i].x - centre.x) * scale;
          const dy = (list[i].y - centre.y) * scale;
          const reach = Math.max(Math.abs(dx), Math.abs(dy));
          const f = reach > half ? half / reach : 1;
          marker(x + size / 2 + dx * f, y + size / 2 + dy * f, i, own ? 5 : reach > half ? 3 : 4);
        }
      }
    };
    if (misc) {
      // The spare panel is filled even with maps off, so it never shows stale pixels.
      const px = misc[0] * W, py = misc[1] * H, pw = (misc[2] - misc[0]) * W, ph = (misc[3] - misc[1]) * H;
      mapBack.rect(px, py, pw, ph).fill(0x0c1016);
      if (mapMode !== 'off') {
        const size = Math.round(Math.min(pw, ph) * 0.86);
        drawOverview(Math.round(px + (pw - size) / 2), Math.round(py + (ph - size) / 2), size);
        mapTitle.visible = true;
        mapTitle.position.set(px + 14, py + 10);
      }
    }
    else if (mapMode === 'shared') {
      const size = Math.round(Math.max(110, Math.min(W, H) * 0.24));
      // Four fixed panels meet at the centre, the spot furthest from every player.
      const centred = mode === 'fixed' && list.length === 4;
      const x = centred ? Math.round((W - size) / 2) : W - size - 14;
      const y = centred ? Math.round((H - size) / 2) : 14;
      frame(x, y, size, 0x7a8ba3);
      drawOverview(x, y, size);
    }
    if (mapMode === 'onPlayer' && overlayOpen) {
      // A see-through local map.
      //  - Fixed grid: it stays in the middle of each player's panel.
      //  - Dynamic split: it follows the character, since regions keep changing shape.
      //    Players sharing a view share one map, centred on the group.
      const groups = mode === 'fixed' ? list.map((_, i) => [i]) : camera.clusters;
      groups.forEach((members, k) => {
        // Middle and area of the group's screen region (its members' regions together).
        let area = 0, mx = 0, my = 0;
        for (const i of members) {
          const cell = camera.cells[i];
          for (let v = 0; v < cell.length; v++) {
            const p = cell[v];
            const q = cell[(v + 1) % cell.length];
            const cross = p.x * q.y - q.x * p.y;
            area += cross / 2;
            mx += ((p.x + q.x) * cross) / 6;
            my += ((p.y + q.y) * cross) / 6;
          }
        }
        if (Math.abs(area) < 1)
          return;
        mx /= area;
        my /= area;
        let size = Math.min(Math.min(W, H) * 0.34, Math.sqrt(Math.abs(area)) * 0.6);
        if (mode === 'fixed') {
          const cell = camera.cells[members[0]];
          size = Math.min(cell[1].x - cell[0].x, cell[2].y - cell[1].y) * 0.7;
        }
        size = Math.round(size);
        // The map still shows the surroundings of the player or group.
        const centre = { x: 0, y: 0 };
        let sx = 0, sy = 0;
        for (const i of members) {
          centre.x += list[i].x / members.length;
          centre.y += list[i].y / members.length;
          sx += camera.sites[i].x / members.length;
          sy += camera.sites[i].y / members.length;
        }
        if (mode === 'dynamic') {
          mx = sx;
          my = sy;
        }
        const x = Math.round(Math.min(W - size - 4, Math.max(4, mx - size / 2)));
        const y = Math.round(Math.min(H - size - 4, Math.max(4, my - size / 2)));
        mapBack.rect(x, y, size, size).stroke({ width: 2, color: members.length === 1 ? COLORS[members[0]] : 0x7a8ba3, alpha: 0.8 });
        drawLocal(localMaps[k], x, y, size, centre, members, 0.55);
      });
    }
    if (mapMode === 'own' && mode === 'fixed') {
      // One local map per player, in the top-right corner of their own panel.
      for (let i = 0; i < list.length; i++) {
        const cell = camera.cells[i];
        const pw = cell[1].x - cell[0].x;
        const ph = cell[2].y - cell[1].y;
        const size = Math.round(Math.min(190, Math.max(70, Math.min(pw, ph) * 0.3)));
        const x = Math.round(cell[1].x - size - 12);
        const y = Math.round(cell[0].y + 12);
        frame(x, y, size, COLORS[i]);
        drawLocal(localMaps[i], x, y, size, list[i], [i]);
      }
    }
    else if (mapMode === 'own') {
      // One local map per group, in the screen corner nearest that group's region.
      const size = Math.round(Math.max(90, Math.min(W, H) * 0.2));
      const m = 12;
      const corners = [[W - size - m, m], [m, m], [W - size - m, H - size - m], [m, H - size - m]];
      const groups = camera.clusters;
      const chosen = [];
      if (groups.length === 1)
        chosen[0] = 0;
      else {
        const sticky = Math.hypot(W, H) * 0.2;
        const cost = (k, c) => {
          let sx = 0, sy = 0;
          for (const i of groups[k]) {
            sx += camera.sites[i].x / groups[k].length;
            sy += camera.sites[i].y / groups[k].length;
          }
          const d = Math.hypot(sx - corners[c][0] - size / 2, sy - corners[c][1] - size / 2);
          return d - (mapCorner[groups[k][0]] === c ? sticky : 0);
        };
        const usedCorner = new Set();
        for (let n = 0; n < groups.length; n++) {
          let bestK = -1, bestC = -1, best = Infinity;
          for (let k = 0; k < groups.length; k++) {
            if (chosen[k] !== undefined)
              continue;
            for (let c = 0; c < 4; c++) {
              if (usedCorner.has(c))
                continue;
              const v = cost(k, c);
              if (v < best) {
                best = v;
                bestK = k;
                bestC = c;
              }
            }
          }
          chosen[bestK] = bestC;
          usedCorner.add(bestC);
        }
      }
      for (let k = 0; k < groups.length; k++) {
        const [x, y] = corners[chosen[k]];
        const centre = { x: 0, y: 0 };
        for (const i of groups[k]) {
          centre.x += list[i].x / groups[k].length;
          centre.y += list[i].y / groups[k].length;
          mapCorner[i] = chosen[k];
        }
        frame(x, y, size, 0x7a8ba3);
        drawLocal(localMaps[k], x, y, size, centre, groups[k]);
        // Coloured tabs along the top show whose map this is.
        const tab = size / groups[k].length;
        groups[k].forEach((i, j) => mapBack.rect(x - 3 + j * (tab + 6 / groups[k].length), y - 7, tab + 6 / groups[k].length, 4).fill(COLORS[i]));
      }
    }
    // Shape each player's mesh to their screen region.
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const mesh = meshes[i];
      const cell = i < list.length ? camera.cells[i] : [];
      mesh.visible = cell.length >= 3;
      if (!mesh.visible)
        continue;
      mesh.texture = renderTextures[camera.viewOf[i]];
      const positions = mesh.geometry.positions;
      const uvs = mesh.geometry.uvs;
      for (let k = 0; k < CELL_VERTS; k++) {
        const vert = cell[Math.min(k, cell.length - 1)];
        positions[k * 2] = vert.x;
        positions[k * 2 + 1] = vert.y;
        uvs[k * 2] = vert.x / W;
        uvs[k * 2 + 1] = vert.y / H;
      }
      mesh.geometry.getBuffer('aPosition').update();
      mesh.geometry.getBuffer('aUV').update();
    }
    // Dividers fade in as two neighbouring views drift apart, and vanish when
    // the views line up again.
    dividers.clear();
    for (let i = 0; i < list.length; i++) {
      const cell = camera.cells[i];
      for (let k = 0; k < cell.length; k++) {
        const a = cell[k];
        const b = cell[(k + 1) % cell.length];
        let alpha = 0;
        if (a.edge === EDGE_FIXED)
          alpha = 1;
        else if (a.edge > i)
          alpha = smoothstep(2, 40, camera.camDiffPx(i, a.edge, ZOOM));
        if (alpha <= 0.01)
          continue;
        dividers.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 9, color: 0x05070a, alpha: alpha * 0.75 });
        dividers.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: 0xe8eef7, alpha });
      }
    }
    debug.clear();
    if (showDebug) {
      for (let i = 0; i < list.length; i++) {
        const cell = camera.cells[i];
        if (cell.length >= 3) {
          debug.poly(cell.flatMap((v) => [v.x, v.y])).fill({ color: COLORS[i], alpha: 0.1 }).stroke({ width: 1, color: COLORS[i], alpha: 0.7 });
        }
        debug.circle(camera.sites[i].x, camera.sites[i].y, 44).stroke({ width: 2, color: COLORS[i], alpha: 0.9 });
      }
    }
    // Measurements.
    // Frames after a hitch are skipped: they measure the hitch, not the camera.
    if (prevSites.length === list.length && dt < 0.03) {
      for (let i = 0; i < list.length; i++) {
        const jump = Math.hypot(camera.sites[i].x - prevSites[i].x, camera.sites[i].y - prevSites[i].y);
        stats.maxJump = Math.max(stats.maxJump, jump);
      }
    }
    prevSites = camera.sites.map((s) => ({ ...s }));
    stats.regroups = camera.regroupCount;
  }
  app.ticker.add((ticker) => {
    const rawMs = ticker.elapsedMS;
    const dt = Math.min(rawMs / 1000, 0.05);
    pollPadToggle();
    if (!paused)
      simulate(dt);
    draw(dt);
    frames++;
    frameClock += rawMs;
    worstInWindow = Math.max(worstInWindow, rawMs);
    if (frameClock >= 500) {
      stats.fps = (frames * 1000) / frameClock;
      stats.frameMs = frameClock / frames;
      stats.worstFrameMs = Math.max(stats.worstFrameMs, worstInWindow);
      frames = 0;
      frameClock = 0;
      worstInWindow = 0;
      const groups = camera.clusters.map((c) => `[${c.map((i) => `P${i + 1}`).join(' ')}]`).join(' ');
      statsEl.textContent =
        `Frames per second  ${stats.fps.toFixed(0)}\n` +
          `Frame time         ${stats.frameMs.toFixed(1)} ms\n` +
          `Worst frame        ${stats.worstFrameMs.toFixed(1)} ms\n` +
          `Views drawn        ${camera.views.length}\n` +
          `Groups             ${groups}\n` +
          `Regroups           ${stats.regroups}\n` +
          `Biggest view jump  ${stats.maxJump.toFixed(1)} px`;
    }
  });
  setSwarm(250);
  buildPanel();
  // Handles for checking the camera from the browser console.
  Object.assign(window, {
    cameraTest: {
      camera,
      players,
      stats,
      resetStats,
      setMode,
      setLayout,
      setMapQuadrant,
      setMapMode,
      toggleOverlayMap,
      setPlayerCount,
      setSwarm,
      setPaused: (p) => (paused = p),
      /** Simulate and draw a number of frames back to back. Returns average milliseconds per frame (processor time only). */
      benchmark(count) {
        const t0 = performance.now();
        for (let i = 0; i < count; i++) {
          simulate(1 / 60);
          draw(1 / 60);
          app.render();
        }
        prevSites = [];
        return (performance.now() - t0) / count;
      },
      /** Advance the simulation without waiting for real time. Returns the biggest view jump seen. */
      fastForward(seconds, step = 1 / 60) {
        let worst = 0;
        let prev = [];
        const W = app.screen.width;
        const H = app.screen.height;
        for (let t = 0; t < seconds; t += step) {
          simulate(step);
          const list = active();
          camera.update(list, W, H, ZOOM, step, mode);
          if (prev.length === list.length) {
            for (let i = 0; i < list.length; i++) {
              worst = Math.max(worst, Math.hypot(camera.sites[i].x - prev[i].x, camera.sites[i].y - prev[i].y));
            }
          }
          prev = camera.sites.map((s) => ({ ...s }));
        }
        prevSites = [];
        return worst;
      },
    },
  });
}
