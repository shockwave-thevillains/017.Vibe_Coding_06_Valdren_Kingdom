import * as THREE from 'three';
import { World, WATER_LEVEL } from './world.js';
import { Player, FollowCamera } from './player.js';
import { Input } from './input.js';
import { UI } from './ui.js';

/*
 * main.js: boots the renderer and the world, then runs the game loop and the
 * title -> playing <-> paused state machine.
 *
 * URL options: ?debug shows the performance readout (also F3 or `),
 *              ?time=HH starts at that hour (0-24) instead of mid-morning.
 */

const params = new URLSearchParams(window.location.search);
const ui = new UI();
const NO_MOVE = Object.freeze({ x: 0, y: 0, magnitude: 0, run: false });

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.25, 1600);

  ui.setStatus('Raising the land…');
  await nextFrame();
  const world = new World(scene, { mobile: coarse });
  const hour = parseFloat(params.get('time'));
  if (Number.isFinite(hour)) world.setTime(hour);

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
  ui.setTouchMode(input.touchMode);
  ui.setDebugVisible(params.has('debug'));

  // ------------------------------------------------------------- states

  let mode = 'title';
  let needsRender = true;

  function refreshHint() {
    const show = mode === 'playing' && !input.touchMode && !input.pointerLocked;
    ui.setHint(show ? 'Click to look around · Esc for the menu' : null);
  }

  function setMode(next) {
    mode = next;
    input.active = next === 'playing';
    ui.setPlaying(next === 'playing');
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
    ui.toast('Welcome to Valdren.');
  }

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

  input.on('pause', () => {
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
    if (mode === 'playing') ui.toast('There is nothing here to interact with.');
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
      player.update(dt, input.getMove(), follow.yaw);
      follow.update(dt, player.position);
      world.update(dt, player.position, camera);
      renderer.render(scene, camera);
    } else if (mode === 'title') {
      follow.yaw += dt * 0.06;
      player.update(dt, NO_MOVE, follow.yaw);
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
  window.valdren = { THREE, renderer, scene, camera, world, player, follow, input, ui };
}

boot().catch((err) => {
  console.error(err);
  ui.showFatal(`Valdren failed to start: ${err && err.message ? err.message : err}`);
});
