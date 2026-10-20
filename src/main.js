import * as THREE from 'three';
import { World, WATER_LEVEL } from './world.js';
import { Player, FollowCamera, dampAngle } from './player.js';
import { NPCManager } from './npc.js';
import { Dialogue } from './dialogue.js';
import { Input } from './input.js';
import { UI } from './ui.js';

/*
 * main.js: boots the renderer, the world and its people, then runs the game
 * loop and the state machine: title -> playing <-> paused, and playing <->
 * talking while a conversation is open.
 *
 * URL options: ?debug shows the performance readout (also F3 or `),
 *              ?time=HH starts at that hour (0-24) instead of mid-morning.
 */

const params = new URLSearchParams(window.location.search);
const ui = new UI();
const NO_MOVE = Object.freeze({ x: 0, y: 0, magnitude: 0, run: false });

// Rendering budget. Touch devices get a lighter default; phase 5 exposes these as presets.
function qualityFor(coarse, maxAnisotropy) {
  const q = coarse
    ? { mobile: true, pixelRatio: 1.5, shadows: true, shadowMap: 1024, shadowExtent: 34, textureSize: 256, anisotropy: 2, treeDetail: 0, grass: 6000, grassTile: 46 }
    : { mobile: false, pixelRatio: 2, shadows: true, shadowMap: 2048, shadowExtent: 46, textureSize: 512, anisotropy: 8, treeDetail: 1, grass: 18000, grassTile: 64 };
  q.anisotropy = Math.min(q.anisotropy, maxAnisotropy);
  return q;
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

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    console.error(err);
    ui.showFatal('WebGL is not available, so Valdren cannot run here. Try enabling hardware acceleration or another browser.');
    return;
  }
  const quality = qualityFor(coarse, renderer.capabilities.getMaxAnisotropy());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.25, 1600);

  const world = new World(scene, renderer, quality);
  await world.build(async (text) => {
    ui.setStatus(text);
    await nextFrame();
  });
  const hour = parseFloat(params.get('time'));
  if (Number.isFinite(hour)) world.setTime(hour);

  ui.setStatus('Gathering the townsfolk…');
  await nextFrame();
  let people = [];
  let peopleError = null;
  try {
    people = (await loadJSON('data/npcs.json')).npcs || [];
  } catch (err) {
    console.error(err);
    peopleError = 'The townsfolk could not be found (data/npcs.json failed to load).';
  }
  const npcs = new NPCManager(scene, world, people);
  const flags = new Set();

  ui.setStatus('Summoning the traveller…');
  await nextFrame();
  const player = new Player(scene, world);
  const follow = new FollowCamera(camera, world);
  follow.yaw = 0.5;
  follow.pitch = 0.2;
  follow.distance = 9;
  follow.update(0, player.position, true);
  world.update(0, player.position, camera);

  const input = new Input(renderer.domElement);
  // Created after Input so the game sees a key press (and ignores it while talking)
  // before the dialogue box acts on it.
  const dialogue = new Dialogue(flags);
  let closedAt = -Infinity;
  ui.setTouchMode(input.touchMode);
  ui.setDebugVisible(params.has('debug'));

  // ------------------------------------------------------------- states

  let mode = 'title';
  let needsRender = true;
  let talkingTo = null;   // the NPC in the current conversation
  let reachable = null;   // the NPC the player could talk to right now
  let restoreView = 0;    // seconds left to ease the camera back behind the player
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

  function begin() {
    if (mode !== 'title') return;
    ui.hideStart();
    follow.yaw = player.heading + Math.PI;
    follow.pitch = 0.32;
    follow.distance = 6.5;
    setMode('playing');
    input.requestPointerLock();
    ui.toast(peopleError || 'Welcome to Valdren.', peopleError ? 6000 : 2400);
  }

  function startTalk(npc) {
    if (mode !== 'playing' || !dialogue.start(npc)) return;
    talkingTo = npc;
    npc.talking = true;
    savedView.pitch = follow.pitch;
    savedView.distance = follow.distance;
    setMode('talking');
    input.reset();
    input.exitPointerLock();
  }

  // The dialogue closed (a reply or Esc): back to walking around.
  dialogue.onClose = (npc, reason) => {
    npc.talking = false;
    talkingTo = null;
    closedAt = performance.now();
    if (mode !== 'talking') return;
    restoreView = 0.9;
    setMode('playing');
    // Esc would release the lock again straight away; the player clicks to look instead.
    if (reason !== 'escape') input.requestPointerLock();
  };

  function pause() {
    if (mode !== 'playing') return;
    setMode('paused');
    input.reset();
    input.exitPointerLock();
    ui.showPause();
  }

  function resume(fromClick) {
    if (mode !== 'paused') return;
    ui.hidePause();
    setMode('playing');
    // Pointer lock needs a click; after Esc the player clicks the canvas to re-capture.
    if (fromClick) input.requestPointerLock();
  }

  ui.onBegin = begin;
  ui.onResume = () => resume(true);

  // The key that ends a conversation must not also pause the game or start a new one.
  const justClosed = () => performance.now() - closedAt < 250;

  input.on('pause', () => {
    // During a conversation Esc belongs to the dialogue box.
    if (justClosed()) return;
    if (mode === 'playing') pause();
    else if (mode === 'paused') resume(false);
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
    if (mode !== 'playing' || justClosed()) return;
    if (reachable) startTalk(reachable);
    else ui.toast('There is nothing here to interact with.');
  });
  input.on('journal', () => {
    if (mode === 'playing') ui.toast('Your journal is still empty.');
  });
  input.on('map', () => {
    if (mode === 'playing') ui.toast('You have not charted any of Valdren yet.');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  // ------------------------------------------------------------ viewport

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.fov = w < h ? 72 : 60;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
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
  const look = { yaw: 0, pitch: 0 };
  const stats = { frames: 0, time: 0 };
  const head = new THREE.Vector3();
  const shotFocus = new THREE.Vector3();
  const sideDocked = window.matchMedia('(max-height: 520px) and (orientation: landscape)');

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

  function updateDebug(elapsed) {
    stats.frames++;
    stats.time += elapsed;
    if (stats.time < 0.5) return;
    const fps = stats.frames / stats.time;
    const ms = (stats.time / stats.frames) * 1000;
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
      `time ${world.timeOfDay.toFixed(1)} h  dpr ${renderer.getPixelRatio()}`,
      `houses ${world.stats.houses}  trees ${world.stats.trees}  grass ${quality.grass}  people ${npcs.list.length}`,
      `${mode}${input.touchMode ? ' · touch' : ''}${input.pointerLocked ? ' · locked' : ''}`,
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
      player.update(dt, input.getMove(), follow.yaw);
      npcs.update(dt, player);
      npcs.separate(player);
      follow.update(dt, player.position);
      // Hide the player when an obstacle squeezes the camera right up to them.
      player.figure.root.visible = follow.actualDistance > 1.0;
      reachable = npcs.nearest(player);
      ui.setPrompt(reachable ? reachable.name : null, input.touchMode);
      world.update(dt, player.position, camera);
      ui.updateLabels(npcs.labels(camera, window.innerWidth, window.innerHeight, reachable));
      renderer.render(scene, camera);
    } else if (mode === 'talking') {
      dialogue.update(dt);
      if (talkingTo) {
        player.faceTowards(talkingTo.position.x, talkingTo.position.z, dt);
        frameConversation(dt, talkingTo);
      }
      player.figure.root.visible = true;
      npcs.update(dt, player, dialogue.typing);
      world.update(dt, player.position, camera);
      renderer.render(scene, camera);
    } else if (mode === 'title') {
      follow.yaw += dt * 0.06;
      player.update(dt, NO_MOVE, follow.yaw);
      npcs.update(dt, player);
      follow.update(dt, player.position);
      world.update(dt, player.position, camera);
      renderer.render(scene, camera);
    } else if (needsRender) {
      renderer.render(scene, camera);
    }
    needsRender = false;
    updateDebug(elapsed);
  }

  ui.setStatus('Lighting the sky…');
  await nextFrame();
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  renderer.setAnimationLoop(frame);
  ui.setReady();

  // Handy from the browser console while developing.
  window.valdren = { THREE, renderer, scene, camera, world, player, follow, input, ui, npcs, dialogue, flags };
}

boot().catch((err) => {
  console.error(err);
  ui.showFatal(`Valdren failed to start: ${err && err.message ? err.message : err}`);
});
