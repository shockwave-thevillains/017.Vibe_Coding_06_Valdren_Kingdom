import * as THREE from 'three';
import { World, WATER_LEVEL, WORLD_HALF, PLAY_HALF, PLACES, SITES } from './world.js';
import { Player, FollowCamera, dampAngle } from './player.js';
import { NPCManager } from './npc.js';
import { Animals } from './animals.js';
import { Balloons } from './balloons.js';
import { Boats } from './boats.js';
import { Dragon } from './dragon.js';
import { Post } from './post.js';
import { Dialogue } from './dialogue.js';
import { Lore, Reader, Journal, Progress } from './lore.js';
import { Input } from './input.js';
import { UI } from './ui.js';

/*
 * main.js: boots the renderer, the world, its people and its secrets, then
 * runs the game loop and the state machine:
 *   title -> playing <-> paused
 *   playing <-> talking (a conversation), reading (a discovery),
 *               journal, map
 * Progress is saved to the browser as you play and restored on the next visit.
 *
 * URL options: ?debug shows the performance readout (also F3 or `),
 *              ?time=HH starts at that hour (0-24) instead of the saved one,
 *              ?quality=low|medium|high overrides the saved graphics setting.
 */

const params = new URLSearchParams(window.location.search);
const ui = new UI();
const NO_MOVE = Object.freeze({ x: 0, y: 0, magnitude: 0, run: false });
const AUTOSAVE_SECONDS = 20;
const OVERLAYS = new Set(['reading', 'journal', 'map']);
const SETTINGS_KEY = 'valdren.settings.v1';
const SLOW_FPS = 24;

/*
 * Graphics presets. Low turns shadows and lantern lights off and renders at one
 * pixel per CSS pixel; High adds bloom and a vignette (src/post.js), and then
 * antialiases in those passes instead of in the canvas. Touch devices start on
 * Medium, everything else on High.
 * The settings in LOAD_TIME shape the world as it is built (and antialias the
 * WebGL context), so a change to them waits for the next load; the rest apply
 * at once through World.setQuality and the pixel ratio.
 */
const PRESETS = {
  low: {
    pixelRatio: 1, antialias: false, shadows: false, shadowMap: 1024, shadowExtent: 34,
    textureSize: 256, anisotropy: 2, treeDetail: 0, cropSparse: true,
    grass: 2500, grassTile: 38, lampLights: 0, lodRadius: 40, people: 40, bloom: false,
  },
  medium: {
    pixelRatio: 1.5, antialias: true, shadows: true, shadowMap: 1024, shadowExtent: 34,
    textureSize: 256, anisotropy: 4, treeDetail: 0, cropSparse: true,
    grass: 6000, grassTile: 46, lampLights: 2, lodRadius: 55, people: 60, bloom: false,
  },
  high: {
    pixelRatio: 2, antialias: true, shadows: true, shadowMap: 2048, shadowExtent: 46,
    textureSize: 512, anisotropy: 8, treeDetail: 1, cropSparse: false,
    grass: 18000, grassTile: 64, lampLights: 4, lodRadius: 75, people: 90, bloom: true,
  },
};
const LOAD_TIME = ['antialias', 'textureSize', 'anisotropy', 'treeDetail', 'cropSparse'];
const isLevel = (name) => typeof name === 'string' && Object.hasOwn(PRESETS, name);

function qualityFor(level, maxAnisotropy) {
  const q = { level, ...PRESETS[level] };
  q.anisotropy = Math.min(q.anisotropy, maxAnisotropy);
  return q;
}

// Settings live apart from the journey, so a new journey keeps them.
function loadSettings() {
  try {
    const data = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Without storage the choice simply lasts until the page is closed.
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

// Paths stay relative so the game works from any sub-folder (e.g. GitHub Pages).
async function loadJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  ui.setTouchMode(coarse);
  ui.setStatus('Preparing the realm…');

  const settings = loadSettings();
  const asked = params.get('quality');
  const level = isLevel(asked) ? asked : isLevel(settings.quality) ? settings.quality : coarse ? 'medium' : 'high';

  let renderer;
  const contextAntialias = PRESETS[level].antialias && !PRESETS[level].bloom;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: contextAntialias, powerPreference: 'high-performance' });
  } catch (err) {
    console.error(err);
    ui.showFatal('WebGL is not available, so Valdren cannot run here. Try enabling hardware acceleration or another browser.');
    return;
  }
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const quality = qualityFor(level, maxAnisotropy);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.25, 1600);
  const post = new Post(renderer, scene, camera, contextAntialias);
  post.setQuality(quality);

  // The data files load while the world is being built.
  const peopleData = loadJSON('data/npcs.json').catch((err) => {
    console.error(err);
    return null;
  });
  const loreData = loadJSON('data/lore.json').catch((err) => {
    console.error(err);
    return null;
  });

  const world = new World(scene, renderer, quality);
  await world.build(async (text) => {
    ui.setStatus(text);
    await nextFrame();
  });

  ui.setStatus('Gathering the townsfolk…');
  await nextFrame();
  const people = await peopleData;
  const secrets = await loreData;
  const missing = [!people && 'data/npcs.json', !secrets && 'data/lore.json'].filter(Boolean);
  const dataError = missing.length ? `Some of Valdren could not be loaded (${missing.join(', ')}).` : null;
  const npcs = new NPCManager(scene, world, people ? people.npcs || [] : []);
  npcs.range = quality.people;
  const animals = new Animals(scene, world, npcs);
  const balloons = new Balloons(scene, world);
  const boats = new Boats(scene, world);
  const dragon = new Dragon(scene, world);
  const BOARD_RANGE = 2.4;
  const flags = new Set();
  const lore = new Lore(scene, world, secrets || { entries: [] });

  ui.setStatus('Drawing the map…');
  await nextFrame();
  ui.setMapImage(world.paintMap(1024), WORLD_HALF);

  ui.setStatus('Summoning the traveller…');
  await nextFrame();
  const player = new Player(scene, world);
  const follow = new FollowCamera(camera, world);
  follow.yaw = 0.5;
  follow.pitch = 0.2;
  follow.distance = 9;

  const input = new Input(renderer.domElement);
  // Created after Input so the game sees a key press (and ignores it while talking)
  // before the dialogue box acts on it.
  const dialogue = new Dialogue(flags);
  const reader = new Reader();
  const journal = new Journal(lore, flags);
  ui.setTouchMode(input.touchMode);
  ui.setDebugVisible(params.has('debug'));

  // --------------------------------------------------------- save / load

  const progress = new Progress();
  let saveWarned = false;

  function snapshot() {
    const visited = {};
    for (const [id, set] of dialogue.visited) visited[id] = [...set];
    return {
      time: world.timeOfDay,
      player: { x: player.position.x, z: player.position.z, heading: player.heading },
      flags: [...flags],
      lore: [...lore.found],
      visited,
    };
  }

  function saveNow() {
    const ok = progress.save(snapshot());
    if (!ok && progress.available && !saveWarned) {
      saveWarned = true;
      ui.toast('Your progress could not be saved (browser storage is full or blocked).', 5000);
    }
    return ok;
  }

  // Somewhere the player can stand: inside the kingdom, out of walls and deep water.
  function standable(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > PLAY_HALF || Math.abs(z) > PLAY_HALF) return false;
    const y = world.getGroundHeight(x, z);
    return WATER_LEVEL - y < 0.9 && !world.colliders.contains(x, y + 1, z, player.radius);
  }

  function restore(data) {
    flags.clear();
    for (const f of data.flags || []) if (typeof f === 'string') flags.add(f);
    lore.restore(data.lore, flags);
    dialogue.visited.clear();
    for (const [id, nodes] of Object.entries(data.visited || {})) if (Array.isArray(nodes)) dialogue.visited.set(id, new Set(nodes));
    const p = data.player || {};
    if (standable(p.x, p.z)) player.teleport(p.x, p.z, Number.isFinite(p.heading) ? p.heading : player.heading);
    if (Number.isFinite(data.time)) world.setTime(data.time);
  }

  function newJourney() {
    progress.clear();
    restore({ flags: [], lore: [], visited: {}, player: { x: SITES.spawn.x, z: SITES.spawn.z, heading: SITES.spawn.heading }, time: 9.5 });
    ui.setNewJourney();
  }

  const saved = progress.load();
  if (saved) restore(saved);
  const hour = parseFloat(params.get('time'));
  if (Number.isFinite(hour)) world.setTime(hour);
  follow.update(0, player.position, true);
  world.update(0, player.position, camera);

  // ------------------------------------------------------------- states

  let mode = 'title';
  let needsRender = true;
  let talkingTo = null;   // the NPC in the current conversation
  let reachable = null;   // { npc } or { entry }: what E would act on right now
  let restoreView = 0;    // seconds left to ease the camera back behind the player
  let closedAt = -Infinity;
  let autosave = AUTOSAVE_SECONDS;
  let truthPending = false;
  const savedView = { pitch: 0.32, distance: 6.5 };

  function refreshHint() {
    const show = mode === 'playing' && !input.touchMode && !input.pointerLocked;
    ui.setHint(show ? 'Click to look around · Esc for the menu' : null);
  }

  function setMode(next) {
    mode = next;
    input.active = next === 'playing';
    ui.setPlaying(next === 'playing');
    if (next !== 'playing') {
      reachable = null;
      ui.setPrompt(null);
      ui.updateLabels([]);
    }
    needsRender = true;
    refreshHint();
  }

  // Leaves the game for a panel or a conversation: the mouse is needed for it.
  function enter(next) {
    setMode(next);
    input.reset();
    input.exitPointerLock();
  }

  // Back to walking around. Esc would release a new pointer lock straight away,
  // so after Esc the player clicks to look instead.
  function backToPlay(reason) {
    closedAt = performance.now();
    setMode('playing');
    if (reason !== 'escape') input.requestPointerLock();
  }

  function begin() {
    if (mode !== 'title') return;
    ui.hideStart();
    follow.yaw = player.heading + Math.PI;
    follow.pitch = 0.32;
    follow.distance = 6.5;
    setMode('playing');
    input.requestPointerLock();
    if (dataError) ui.toast(dataError, 6000);
    else ui.toast(saved ? `Welcome back to Valdren. Journal: ${lore.found.length} of ${lore.total} discoveries.` : 'Welcome to Valdren. Press J for your journal, M for the map.', 4000);
  }

  // --------------------------------------------------------- conversation

  function startTalk(npc) {
    if (mode !== 'playing' || !dialogue.start(npc)) return;
    talkingTo = npc;
    npc.talking = true;
    savedView.pitch = follow.pitch;
    savedView.distance = follow.distance;
    rumoursBefore = rumourCount();
    enter('talking');
  }

  let rumoursBefore = 0;
  function rumourCount() {
    return ((secrets && secrets.rumours) || []).filter((r) => flags.has(r.flag)).length;
  }

  dialogue.onClose = (npc, reason) => {
    npc.talking = false;
    talkingTo = null;
    if (mode !== 'talking') return;
    restoreView = 0.9;
    backToPlay(reason);
    if (rumourCount() > rumoursBefore) ui.toast('Noted in your journal under Rumours (J).', 2600);
    saveNow();
  };

  // ------------------------------------------------------------ overlays

  function read(entry) {
    const first = lore.discover(entry.id, flags);
    if (first && lore.complete) truthPending = true;
    reader.show(entry, lore.kindOf(entry), { first, count: lore.found.length, total: lore.total });
    enter('reading');
    if (first) saveNow();
  }

  function closeOverlay(reason) {
    if (mode === 'reading') reader.hide();
    else if (mode === 'journal') journal.hide();
    else if (mode === 'map') ui.hideMap();
    else return;
    backToPlay(reason);
    // The last discovery completes the story: show it straight away.
    if (truthPending) {
      truthPending = false;
      openJournal('truth');
      ui.toast('Your journal is complete.', 3000);
    }
  }

  function openJournal(tab) {
    if (mode !== 'playing') return;
    journal.show(tab);
    enter('journal');
  }

  function openMap() {
    if (mode !== 'playing') return;
    const metPeople = npcs.list.filter((n) => flags.has(`met_${n.id}`));
    ui.showMap({
      x: player.position.x,
      z: player.position.z,
      heading: player.heading,
      places: PLACES,
      people: metPeople.map((n) => ({ x: n.position.x, z: n.position.z, name: n.name })),
      finds: lore.found.map((id) => lore.byId.get(id)).map((e) => ({ x: e.pos.x, z: e.pos.z, title: e.title })),
    });
    enter('map');
  }

  reader.onClose = closeOverlay;
  journal.onClose = closeOverlay;
  ui.onMapClose = closeOverlay;
  ui.onMap = openMap;

  // ------------------------------------------------------------ balloon

  function boardBalloon() {
    if (!balloons.board()) return;
    ui.toast('The aeronaut casts off the sandbags, the burner roars, and up you go!', 4000);
  }

  // Back on the meadow: step out of the basket.
  function landBalloon() {
    const b = balloons.basketFloor;
    player.teleport(b.x - 2.2, b.z + 0.6, -Math.PI / 2);
    ui.toast('The basket bumps down on the meadow. What a view that was!', 3500);
    saveNow();
  }

  // --------------------------------------------------------------- pause

  function pause() {
    if (mode !== 'playing') return;
    setMode('paused');
    input.reset();
    input.exitPointerLock();
    const status = saveNow()
      ? `Saved: ${lore.found.length} of ${lore.total} discoveries.`
      : progress.available ? 'Your progress could not be saved just now.' : 'This browser is blocking storage, so progress is not being saved.';
    ui.showPause(status);
  }

  function resume(fromClick) {
    if (mode !== 'paused') return;
    ui.hidePause();
    setMode('playing');
    // Pointer lock needs a click; after Esc the player clicks the canvas to re-capture.
    if (fromClick) input.requestPointerLock();
  }

  // ------------------------------------------------------------ quality

  const builtWith = quality;
  let current = quality;

  // Whether a load-time setting differs from the world as it was built (the menu notes it).
  function pendingReload(q) {
    return LOAD_TIME.some((key) => q[key] !== builtWith[key]);
  }

  async function setQuality(next) {
    if (!isLevel(next) || next === current.level) return;
    current = qualityFor(next, maxAnisotropy);
    settings.quality = next;
    saveSettings(settings);
    ui.setQuality(next, pendingReload(current));
    // Let the menu show the choice before the materials recompile for the new lights.
    await nextFrame();
    world.setQuality(current);
    npcs.range = current.people;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, current.pixelRatio));
    post.setQuality(current);
    onResize();
    slow.warned = true;
  }

  ui.onBegin = begin;
  ui.onQuality = setQuality;
  ui.setQuality(level, false);
  ui.onResume = () => resume(true);
  ui.onNewJourney = () => {
    if (window.confirm('Start a new journey? Your saved progress in this browser will be forgotten.')) newJourney();
  };

  // ------------------------------------------------------------- input

  // The key that ends a conversation or closes a panel must not also pause or act.
  const justClosed = () => performance.now() - closedAt < 250;

  input.on('pause', () => {
    if (justClosed()) return;
    if (OVERLAYS.has(mode)) closeOverlay('escape');
    else if (mode === 'playing') pause();
    else if (mode === 'paused') resume(false);
    // While talking, Esc belongs to the dialogue box.
  });
  input.on('lockchange', (locked) => {
    if (!locked && mode === 'playing' && !input.touchMode) pause();
    refreshHint();
  });
  input.on('lockerror', refreshHint);
  input.on('touchmode', (on) => {
    ui.setTouchMode(on);
    refreshHint();
  });
  input.on('debug', () => ui.setDebugVisible(!ui.debugVisible));
  input.on('interact', () => {
    if (justClosed()) return;
    if (mode === 'reading') {
      closeOverlay('key');
      return;
    }
    if (mode !== 'playing') return;
    if (reachable && reachable.npc) startTalk(reachable.npc);
    else if (reachable && reachable.entry) read(reachable.entry);
    else if (reachable && reachable.animal) ui.toast(animals.pet(reachable.animal), 3500);
    else if (reachable && reachable.balloon) boardBalloon();
    else if (balloons.riding) ui.toast('Hold on to the basket. The meadow is a long way down.');
    else ui.toast('There is nothing here to interact with.');
  });
  input.on('journal', () => {
    if (justClosed()) return;
    if (mode === 'journal') closeOverlay('key');
    else openJournal();
  });
  input.on('map', () => {
    if (justClosed()) return;
    if (mode === 'map') closeOverlay('key');
    else openMap();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    pause();
    if (mode !== 'title') saveNow();
  });
  window.addEventListener('pagehide', () => {
    if (mode !== 'title') saveNow();
  });

  // ------------------------------------------------------------ viewport

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = w < h ? 72 : 60;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.setSize();
    needsRender = true;
  }
  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  onResize();

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    pause();
    ui.toast('The graphics context was lost. Waiting for the browser to restore it…', 5000);
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    needsRender = true;
  });

  // --------------------------------------------------------------- loop

  const clock = new THREE.Clock();

  // The passes render several times a frame, so the debug readout counts the whole frame.
  renderer.info.autoReset = false;
  function draw() {
    renderer.info.reset();
    if (post.active) post.render(world.night);
    else renderer.render(scene, camera);
  }
  const look = { yaw: 0, pitch: 0 };
  const stats = { frames: 0, time: 0 };
  const slow = { time: 0, warned: false };
  const head = new THREE.Vector3();
  const shotFocus = new THREE.Vector3();
  const sideDocked = window.matchMedia('(max-height: 520px) and (orientation: landscape)');
  let minimapTimer = 0;

  // Over-the-shoulder shot: from behind the player's shoulder onto the speaker's
  // face, placed where the dialogue box doesn't cover it: the upper part of the screen,
  // or the left half when the box is docked to the right.
  function frameConversation(dt, npc) {
    const p = player.position;
    npc.headPosition(head);
    let fx = head.x - p.x;
    let fz = head.z - p.z;
    const d = Math.hypot(fx, fz) || 1;
    fx /= d;
    fz /= d;
    const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * (d + 0.5);
    const side = sideDocked.matches;
    const lift = reach * (side ? 0.08 : 0.42);
    const shift = side ? reach * camera.aspect * 0.42 : 0;
    // Screen right, seen from behind the player, is (-fz, fx). Moving the look-at point
    // that way puts the face left of centre. The camera sits over the left shoulder.
    shotFocus.set(head.x - fx * 0.25 - fz * shift, head.y - 0.04 - lift, head.z - fz * 0.25 + fx * shift);
    const cx = p.x - fx * 0.55 + fz * 0.55;
    const cy = p.y + 1.75;
    const cz = p.z - fz * 0.55 - fx * 0.55;
    const ox = cx - shotFocus.x;
    const oy = cy - shotFocus.y;
    const oz = cz - shotFocus.z;
    const dist = Math.hypot(ox, oy, oz);
    const k = 1 - Math.exp(-5 * dt);
    follow.yaw = dampAngle(follow.yaw, Math.atan2(ox, oz), 5, dt);
    follow.pitch += (Math.asin(oy / dist) - follow.pitch) * k;
    follow.distance += (dist - follow.distance) * k;
    shotFocus.y -= follow.height;
    follow.update(dt, shotFocus);
  }

  // The nearest thing to act on: a person, a discovery or an animal to pet, whichever is closest.
  function findReachable() {
    const npc = npcs.nearest(player);
    const spot = lore.nearest(player);
    const pet = animals.nearest(player);
    const p = player.position;
    const options = [];
    if (npc) options.push({ d: Math.hypot(npc.position.x - p.x, npc.position.z - p.z), r: { npc } });
    if (spot) options.push({ d: spot.distance, r: { entry: spot.entry } });
    if (pet) options.push({ d: pet.distance + 0.5, r: { animal: pet.animal } });
    if (balloons.boardable) {
      const b = balloons.basketFloor;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      if (d < BOARD_RANGE) options.push({ d, r: { balloon: true } });
    }
    if (!options.length) return null;
    options.sort((a, b) => a.d - b.d);
    return options[0].r;
  }

  function updateHud(dt) {
    // Bearing the camera looks towards: yaw 0 looks north (-z), east is +x.
    ui.updateCompass(THREE.MathUtils.radToDeg(-follow.yaw), world.timeOfDay);
    minimapTimer -= dt;
    if (minimapTimer > 0) return;
    minimapTimer = 1 / 30;
    ui.drawMinimap({
      x: player.position.x,
      z: player.position.z,
      heading: player.heading,
      yaw: follow.yaw,
      people: npcs.list.filter((n) => n.figure.root.visible).map((n) => ({ x: n.position.x, z: n.position.z, met: flags.has(`met_${n.id}`) })),
      finds: lore.found.map((id) => lore.byId.get(id).pos),
    });
  }

  // Once a session, a struggling device is pointed to the lighter presets.
  function noticeSlow(fps, seconds) {
    if (slow.warned || current.level === 'low' || mode !== 'playing' || document.hidden) return;
    slow.time = fps < SLOW_FPS ? slow.time + seconds : 0;
    if (slow.time < 10) return;
    slow.warned = true;
    ui.toast(`Running slowly? Lower the graphics quality in the menu (${input.touchMode ? 'the pause button' : 'Esc'}).`, 6000);
  }

  function updateDebug(elapsed) {
    stats.frames++;
    stats.time += elapsed;
    if (stats.time < 0.5) return;
    const fps = stats.frames / stats.time;
    const ms = (stats.time / stats.frames) * 1000;
    noticeSlow(fps, stats.time);
    stats.frames = 0;
    stats.time = 0;
    if (!ui.debugVisible) return;
    const p = player.position;
    const info = renderer.info.render;
    const depth = WATER_LEVEL - p.y;
    ui.setDebugText([
      `${fps.toFixed(0)} fps  ${ms.toFixed(1)} ms`,
      `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(1)}k`,
      `pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`,
      `speed ${player.speed.toFixed(1)} m/s${depth > 0 ? `  wading ${depth.toFixed(2)} m` : ''}`,
      `time ${world.timeOfDay.toFixed(2)} h  night ${world.night.toFixed(2)}  dpr ${renderer.getPixelRatio()}  ${current.level}`,
      `people ${npcs.list.length}  lore ${lore.found.length}/${lore.total}  flags ${flags.size}`,
      `${mode}${input.touchMode ? ' · touch' : ''}${input.pointerLocked ? ' · locked' : ''}${progress.available ? '' : ' · no storage'}`,
    ].join('\n'));
  }

  function frame() {
    const elapsed = clock.getDelta();
    const dt = Math.min(elapsed, 0.1);

    if (mode === 'playing') {
      input.consumeLook(look);
      follow.addLook(look.yaw, look.pitch);
      follow.addZoom(input.consumeZoom());
      if (restoreView > 0) {
        // Ease back behind the player after a conversation, unless they take the camera.
        restoreView = look.yaw || look.pitch ? 0 : restoreView - dt;
        const k = 1 - Math.exp(-4 * dt);
        follow.yaw = dampAngle(follow.yaw, player.heading + Math.PI, 4, dt);
        follow.pitch += (savedView.pitch - follow.pitch) * k;
        follow.distance += (savedView.distance - follow.distance) * k;
      }
      world.advanceTime(dt);
      if (balloons.update(dt) === 'landed') landBalloon();
      boats.update(dt);
      dragon.update(dt);
      if (balloons.riding) {
        player.ride(balloons.basketFloor, dt);
      } else {
        player.update(dt, input.getMove(), follow.yaw);
      }
      npcs.update(dt, player);
      if (!balloons.riding) npcs.separate(player);
      animals.update(dt, player, npcs);
      if (!balloons.riding) animals.separate(player);
      lore.update(dt);
      follow.update(dt, player.position);
      // Hide the player when an obstacle squeezes the camera right up to them.
      player.figure.root.visible = follow.actualDistance > 1.0;
      reachable = balloons.riding ? null : findReachable();
      if (reachable && reachable.balloon) ui.setPrompt('the balloon', input.touchMode, 'Ride');
      else if (reachable && reachable.entry) ui.setPrompt(reachable.entry.title, input.touchMode, lore.kindOf(reachable.entry).verb);
      else if (reachable && reachable.animal) ui.setPrompt(animals.label(reachable.animal), input.touchMode, 'Pet');
      else ui.setPrompt(reachable ? reachable.npc.name : null, input.touchMode);
      world.update(dt, player.position, camera);
      ui.updateLabels(npcs.labels(camera, window.innerWidth, window.innerHeight, reachable && reachable.npc));
      updateHud(dt);
      draw();
      autosave -= dt;
      if (autosave <= 0) {
        autosave = AUTOSAVE_SECONDS;
        saveNow();
      }
    } else if (mode === 'talking') {
      dialogue.update(dt);
      world.advanceTime(dt);
      if (talkingTo) {
        player.faceTowards(talkingTo.position.x, talkingTo.position.z, dt);
        frameConversation(dt, talkingTo);
      }
      player.figure.root.visible = true;
      npcs.update(dt, player, dialogue.typing);
      animals.update(dt, player, npcs);
      balloons.update(dt);
      boats.update(dt);
      dragon.update(dt);
      lore.update(dt);
      world.update(dt, player.position, camera);
      draw();
    } else if (mode === 'title') {
      follow.yaw += dt * 0.06;
      player.update(dt, NO_MOVE, follow.yaw);
      npcs.update(dt, player);
      animals.update(dt, player, npcs);
      balloons.update(dt);
      boats.update(dt);
      dragon.update(dt);
      lore.update(dt);
      follow.update(dt, player.position);
      world.update(dt, player.position, camera);
      draw();
    } else if (needsRender) {
      draw();
    }
    needsRender = false;
    updateDebug(elapsed);
  }

  ui.setStatus('Lighting the sky…');
  await nextFrame();
  renderer.compile(scene, camera);
  draw();
  renderer.setAnimationLoop(frame);
  ui.setReady(saved ? `Saved journey found: ${lore.found.length} of ${lore.total} discoveries.` : null, progress.available);

  // Handy from the browser console while developing.
  window.valdren = { THREE, renderer, post, scene, camera, world, player, follow, input, ui, npcs, animals, balloons, boats, dragon, dialogue, flags, lore, journal, reader, progress, saveNow, setQuality, get quality() { return current; } };
}

boot().catch((err) => {
  console.error(err);
  ui.showFatal(`Valdren failed to start: ${err && err.message ? err.message : err}`);
});
