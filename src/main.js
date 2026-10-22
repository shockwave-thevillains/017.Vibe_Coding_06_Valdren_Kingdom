import * as THREE from 'three';
import { World, WATER_LEVEL, WORLD_HALF, PLAY_HALF, PLACES, SITES } from './world.js';
import { Player, FollowCamera, dampAngle } from './player.js';
import { NPCManager } from './npc.js';
import { Animals } from './animals.js';
import { Balloons } from './balloons.js';
import { Boats } from './boats.js';
import { Dragon } from './dragon.js';
import { Post } from './post.js';
import { Lantern } from './lantern.js';
import { Sword } from './gear.js';
import { Combat, MAX_HEALTH } from './combat.js';
import { Rasengan } from './rasengan.js';
import { Chidori } from './chidori.js';
import { Dungeons, DUNGEONS } from './dungeon.js';
import { Quests, CASES, SHOPS } from './quests.js';
import { Music } from './music.js';
import { Dialogue } from './dialogue.js';
import { Lore, Reader, Journal, Progress } from './lore.js';
import { Input } from './input.js';
import { UI } from './ui.js';

/*
 * main.js: boots the renderer, the world, its people and its secrets, then
 * runs the game loop and the state machine:
 *   title -> playing <-> paused
 *   playing <-> talking (a conversation), reading (a discovery),
 *               journal, map, shop, sleeping (and knocked out, and going
 *               into or out of the mine, which is a scene of its own)
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
const OVERLAYS = new Set(['reading', 'journal', 'map', 'shop']);
const SETTINGS_KEY = 'valdren.settings.v1';
const SLOW_FPS = 24;
const GUARD_SIGHT = 26; // metres within which a guard sees a brawl
const FINE = 5;         // crowns a guard fines the traveller for it
const BIND_RANGE = 2.2;
const MARK_REACHED = 6;   // metres from the mark at which it counts as reached

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
    grass: 2500, grassTile: 38, lampLights: 0, lodRadius: 40, districtView: 300, people: 40, bloom: false, lanternShadow: false,
  },
  medium: {
    pixelRatio: 1.5, antialias: true, shadows: true, shadowMap: 1024, shadowExtent: 34,
    textureSize: 256, anisotropy: 4, treeDetail: 0, cropSparse: true,
    grass: 6000, grassTile: 46, lampLights: 2, lodRadius: 55, districtView: 420, people: 60, bloom: false, lanternShadow: false,
  },
  high: {
    pixelRatio: 2, antialias: true, shadows: true, shadowMap: 2048, shadowExtent: 46,
    textureSize: 512, anisotropy: 8, treeDetail: 1, cropSparse: false,
    grass: 18000, grassTile: 64, lampLights: 4, lodRadius: 75, districtView: 640, people: 90, bloom: true, lanternShadow: true,
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

  // The townsfolk's walks are known first, so the world plants no tree across them.
  const people = await peopleData;
  const paths = [];
  for (const def of people ? people.npcs || [] : []) {
    const pts = def.patrol && def.patrol.points;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - (def.patrol.mode === 'loop' ? 0 : 1); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      paths.push([a.x, a.z, b.x, b.z]);
    }
  }
  const world = new World(scene, renderer, quality);
  await world.build(async (text) => {
    ui.setStatus(text);
    await nextFrame();
  }, { paths });

  ui.setStatus('Gathering the townsfolk…');
  await nextFrame();
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
  const lantern = new Lantern(scene, quality);
  const sword = new Sword(scene);
  const combat = new Combat(player, npcs, sword);
  const rasengan = new Rasengan(scene);
  const chidori = new Chidori(scene);
  // Its sounds play through the music's audio context (once Begin has started it).
  rasengan.audio = () => (music.ctx && music.noise ? { ctx: music.ctx, noise: music.noise } : null);
  // The Gloomhollow Mine: built the first time the traveller goes down.
  const dungeon = new Dungeons(world, quality);
  dungeon.audio = rasengan.audio;
  combat.foes = dungeon;
  rasengan.foes = dungeon;
  chidori.foes = dungeon;
  chidori.audio = rasengan.audio;
  const music = new Music();
  music.volume = typeof settings.music === 'number' ? Math.min(1, Math.max(0, settings.music)) : 0.6;
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
  const quests = new Quests(flags, npcs);
  quests.heal = (amount) => {
    if (combat.health >= MAX_HEALTH - 0.5) return false;
    combat.heal(amount);
    return true;
  };
  quests.equip = (id) => sword.setSteel(id === 'steel');
  quests.say = (text) => ui.toast(text, 3000);
  quests.purse = (coins) => ui.setPurse(coins);
  journal.pages = {
    bag: (page, refresh) => quests.renderBag(page, refresh),
    bounties: (page) => quests.renderBounties(page),
  };
  ui.setTouchMode(input.touchMode);
  ui.setDebugVisible(params.has('debug'));

  // --------------------------------------------------------- save / load

  const progress = new Progress();
  let saveWarned = false;
  let mark = null; // { x, z }: the spot the traveller has marked on the map
  let underground = false; // in a dungeon
  // The way down into the dungeon the traveller is in (or last went into).
  const doorOf = (id) => world.dungeonDoors.find((d) => d.id === id) || world.dungeonDoors[0];
  const hereDoor = () => doorOf(dungeon.current.id);

  function snapshot() {
    const visited = {};
    for (const [id, set] of dialogue.visited) visited[id] = [...set];
    return {
      time: world.timeOfDay,
      // In a dungeon, the journey is saved at its way in.
      player: underground
        ? { x: hereDoor().out[0], z: hereDoor().out[1], heading: hereDoor().out[2], health: Math.round(combat.health) }
        : { x: player.position.x, z: player.position.z, heading: player.heading, health: Math.round(combat.health) },
      flags: [...flags],
      lore: [...lore.found],
      visited,
      mark,
      quests: quests.snapshot(),
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
    combat.health = Number.isFinite(p.health) ? Math.min(MAX_HEALTH, Math.max(20, p.health)) : MAX_HEALTH;
    if (Number.isFinite(data.time)) world.setTime(data.time);
    mark = data.mark && Number.isFinite(data.mark.x) && Number.isFinite(data.mark.z) ? { x: data.mark.x, z: data.mark.z } : null;
    quests.restore(data.quests, player);
  }

  function newJourney() {
    progress.clear();
    restore({ flags: [], lore: [], visited: {}, player: { x: SITES.spawn.x, z: SITES.spawn.z, heading: SITES.spawn.heading }, time: 9.5, mark: null });
    ui.setNewJourney();
  }

  const saved = progress.load();
  if (saved) restore(saved);
  else quests.restore(null, player);
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
      ui.updateWaypoint(null);
      if (rasengan.busy || chidori.busy) {
        rasengan.cancel();
        chidori.cancel();
        endOrb();
      }
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
    // Browsers only allow sound after a click or tap, and Begin is one.
    music.start();
    if (dataError) ui.toast(dataError, 6000);
    else ui.toast(saved ? `Welcome back to Valdren. Journal: ${lore.found.length} of ${lore.total} discoveries.` : `Welcome to Valdren. Your cottage is marked on the map (${input.touchMode ? 'tap the minimap' : 'M'}); your journal is under ${input.touchMode ? 'Journal' : 'J'}.`, 5000);
  }

  // --------------------------------------------------------- conversation

  function startTalk(npc) {
    if (mode !== 'playing') return;
    quests.prepareTalk(npc);
    if (!dialogue.start(npc)) return;
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

  // What a reply asks the game to do: open a shop when the talk ends, a culprit
  // bolting, a place marked on the map, a captive handed over to the guild.
  let pendingShop = null;
  let afterTalk = null; // a line to show once the conversation is over
  dialogue.onAction = (action, npc) => {
    const [verb, arg] = action.split(':');
    if (verb === 'shop' && quests.hasShop(npc.id)) {
      pendingShop = npc.id;
    } else if (verb === 'bolt') {
      npc.bolt();
      afterTalk = `${npc.name} makes a run for it! Catch them and beat them until they yield.`;
    } else if (verb === 'mark') {
      const c = CASES.find((k) => k.id === arg);
      if (c) {
        mark = { ...c.at };
        afterTalk = `Marked on your map: ${c.place}. Follow the red pointer.`;
      }
    } else if (verb === 'handover') {
      const c = quests.handOver(arg);
      if (c) {
        ui.toast(`+${c.bounty} crowns. ${c.title}: closed.`, 4000);
        saveNow();
      }
    }
  };

  dialogue.onClose = (npc, reason) => {
    npc.talking = false;
    talkingTo = null;
    const shop = pendingShop;
    const line = afterTalk;
    pendingShop = null;
    afterTalk = null;
    if (mode !== 'talking') return;
    restoreView = 0.9;
    if (shop) {
      quests.touch = input.touchMode;
      quests.showShop(shop);
      setMode('shop');
    } else {
      backToPlay(reason);
    }
    if (line) ui.toast(line, 4500);
    else if (rumourCount() > rumoursBefore) ui.toast('Noted in your journal under Rumours (J).', 2600);
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
    else if (mode === 'shop') quests.hideShop();
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

  // Where to go: the dungeons and the guild, then every seller's own spot.
  function shopPlaces() {
    const out = [];
    for (const def of DUNGEONS) {
      const door = world.dungeonDoors.find((d) => d.id === def.id);
      if (door) out.push({ id: `dungeon:${def.id}`, x: door.door[0], z: door.door[1], icon: def.icon, name: def.name, where: def.where, sells: `Dungeon: ${def.about}`, place: true, dungeon: true });
    }
    if (world.guild) out.push({ id: 'guild', x: world.guild.board[0], z: world.guild.board[1], icon: '🛡️', name: world.guild.name, where: 'West of the market', sells: 'Bounties for catching wrongdoers', place: true });
    for (const [id, shop] of Object.entries(SHOPS)) {
      const npc = npcs.byId.get(id);
      if (npc) out.push({ id, x: npc.home.x, z: npc.home.z, icon: shop.icon, name: shop.title, where: shop.where, sells: shop.sells, food: shop.kind === 'food' });
    }
    return out;
  }
  const shops = shopPlaces();

  function mapView() {
    const metPeople = npcs.list.filter((n) => flags.has(`met_${n.id}`) && n.mood !== 'gone');
    // Below ground, the map shows where the dungeon's way in is.
    const at = underground ? { x: hereDoor().door[0], z: hereDoor().door[1] } : player.position;
    return {
      x: at.x,
      z: at.z,
      heading: player.heading,
      places: world.guild ? [...PLACES, { name: world.guild.name, x: world.guild.board[0], z: world.guild.board[1], size: 0 }] : PLACES,
      people: metPeople.map((n) => ({ x: n.position.x, z: n.position.z, name: n.name })),
      finds: lore.found.map((id) => lore.byId.get(id)).map((e) => ({ x: e.pos.x, z: e.pos.z, title: e.title })),
      home: world.home,
      mark,
      shops,
      touch: input.touchMode,
    };
  }

  function openMap() {
    if (mode !== 'playing') return;
    ui.showMap(mapView());
    enter('map');
  }

  // Marking the map: a pin to head for, with a pointer on screen and on the compass.
  ui.onMark = (spot, name) => {
    mark = spot;
    if (mode === 'map') ui.showMap(mapView());
    if (name) ui.toast(`Marked: ${name}. Close the map and follow the red pointer.`, 3000);
    saveNow();
  };

  reader.onClose = closeOverlay;
  journal.onClose = closeOverlay;
  quests.onShopClose = closeOverlay;
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
    music.duck(true);
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
    music.duck(false);
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
    lantern.setQuality(current);
    dungeon.setQuality(current);
    npcs.range = current.people;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, current.pixelRatio));
    post.setQuality(current);
    onResize();
    slow.warned = true;
  }

  ui.onBegin = begin;
  ui.onQuality = setQuality;
  ui.onMusic = (v) => {
    music.setVolume(v);
    settings.music = v;
    saveSettings(settings);
  };
  ui.setMusic(music.volume);
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
    else if (reachable && reachable.bed) sleep();
    else if (reachable && reachable.captive) bindCaptive(reachable.captive);
    else if (reachable && reachable.door) enterDungeon(reachable.door.id);
    else if (reachable && reachable.exit) leaveMine();
    else if (reachable && reachable.chest) openChest();
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
  input.on('lantern', () => {
    if (mode !== 'playing') return;
    setLantern(!lantern.on);
    ui.toast(lantern.on ? 'You light your lantern.' : 'You put out your lantern.', 1800);
  });
  input.on('jump', () => {
    if (mode !== 'playing' || balloons.riding || player.flying) return;
    player.jump();
  });
  input.on('fly', () => {
    if (mode !== 'playing' || balloons.riding) return;
    setFlying(!player.flying);
  });
  // A technique in hand (the Rasengan or the Chidori) keeps the hands busy.
  const techniqueBusy = () => rasengan.busy || chidori.busy;
  input.on('sword', () => {
    if (mode !== 'playing' || balloons.riding || techniqueBusy()) return;
    sword.drawn = !sword.drawn;
    holdGear();
    ui.toast(sword.drawn ? `You draw your ${sword.steel ? 'steel ' : ''}sword.` : 'You sheathe your sword.', 1600);
  });
  input.on('attack', () => {
    if (mode !== 'playing' || balloons.riding || techniqueBusy()) return;
    combat.attack(follow.yaw + Math.PI);
  });

  // The Rasengan: gathered in the right hand (the sword goes back in its scabbard for
  // it and comes out again after; a lit lantern moves to the left hand), then driven
  // into whoever is closest in the direction of the view.
  let orbSword = false;
  let orbUsed = false;
  let orbNagged = 0;
  input.on('rasengan', () => {
    if (mode !== 'playing' || balloons.riding || techniqueBusy()) return;
    if (!rasengan.begin()) {
      if (performance.now() - orbNagged > 1500) {
        orbNagged = performance.now();
        ui.toast('Your Rasengan is still gathering strength…', 1400);
      }
      return;
    }
    orbSword = sword.drawn;
    sword.drawn = false;
    lantern.hand = 'handL';
    player.animator.action = 'orb';
    ui.setSword(false);
    if (!orbUsed) {
      orbUsed = true;
      ui.toast(`Rasengan! A sphere of wind gathers in your palm. In a moment you lunge and drive it into whoever is in front of you. While it gathers strength again, use the Chidori (${input.touchMode ? 'the lightning button' : 'X'}).`, 5000);
    }
  });

  // The Chidori: lightning in the right hand, then a dash through whoever is in front.
  // Its cooldown is its own, so it is ready while the Rasengan is not.
  let chidoriUsed = false;
  let chidoriNagged = 0;
  input.on('chidori', () => {
    if (mode !== 'playing' || balloons.riding || techniqueBusy()) return;
    if (!chidori.begin()) {
      if (performance.now() - chidoriNagged > 1500) {
        chidoriNagged = performance.now();
        ui.toast('The lightning is still gathering…', 1400);
      }
      return;
    }
    orbSword = sword.drawn;
    sword.drawn = false;
    lantern.hand = 'handL';
    player.animator.action = 'orb';
    ui.setSword(false);
    if (!chidoriUsed) {
      chidoriUsed = true;
      ui.toast('Chidori! Lightning chirps in your hand like a thousand birds. In a moment you dash through whoever is in front of you, and it leaps on to those nearby.', 5000);
    }
  });
  // Back to sword and lantern as they were.
  function endOrb() {
    sword.drawn = orbSword;
    orbSword = false;
    holdGear();
  }
  let shake = 0;
  rasengan.onImpact = (npc, result, wasCalm) => combat.onLanded(npc, result, wasCalm);
  rasengan.onBurst = (strength) => {
    shake = 0.32 * strength;
    ui.flashBurst();
  };
  chidori.onImpact = (npc, result, wasCalm) => combat.onLanded(npc, result, wasCalm);
  chidori.onBurst = (strength) => {
    shake = Math.max(shake, 0.22 * strength);
    ui.flashBurst('lightning');
  };

  // The hand lantern: held out in front while lit, and the traveller turns to shine it
  // wherever the camera looks when standing still.
  function setLantern(on) {
    lantern.toggle(on);
    player.aiming = on;
    holdGear();
    ui.setLantern(on);
  }

  // What the hands hold: a drawn sword in the right, so the lantern moves to the left.
  function holdGear() {
    // While a technique is in hand the hands stay as they are; endOrb() calls this after.
    if (techniqueBusy()) return;
    lantern.hand = sword.drawn ? 'handL' : 'handR';
    if (lantern.on) player.animator.action = sword.drawn ? 'lanternL' : 'lantern';
    else player.animator.action = sword.drawn ? 'sword' : null;
    ui.setSword(sword.drawn);
  }

  // Taking to the air, or coming down (not into deep water).
  let flownBefore = false;
  function setFlying(on) {
    if (!player.setFlying(on)) {
      ui.toast('Only deep water below. Fly on to land before you come down.', 2600);
      return;
    }
    ui.setFlying(on);
    if (on && !flownBefore) {
      flownBefore = true;
      ui.toast(input.touchMode
        ? 'You rise into the air! Hold Up or Down to climb or sink, push the stick to the edge to speed along, and tap Land to come down.'
        : 'You rise into the air! Hold Space to climb and C to sink, Shift to speed along, and G to land.', 6000);
    }
  }

  // ------------------------------------------------------------ fights

  // A blow from a criminal landed on the traveller.
  npcs.onEvent = (type, npc, value) => {
    if (type === 'blow' && mode === 'playing') {
      ui.flashHurt();
      if (combat.hurt(value)) knockedOut(npc);
    } else if (type === 'escaped' && npc.criminal) {
      ui.toast(`${npc.name} has given you the slip. Find them again and confront them.`, 4000);
    }
  };

  // A guard who sees an unprovoked blow fines the traveller (quests.js keeps the purse).
  let lastFine = -Infinity;
  combat.onLanded = (npc, result, wasCalm) => {
    if (result === 'yield') ui.toast(`${npc.name} yields! ${input.touchMode ? 'Tap Interact' : 'Press E'} to bind their hands.`, 4000);
    if (!wasCalm) return;
    if (result === 'down') ui.toast(`${npc.name} is knocked to the ground.`, 2200);
    const now = performance.now();
    if (now - lastFine < 6000) return;
    const p = player.position;
    const guard = npcs.list.find((n) => n.guard && n !== npc && n.calm && n.figure.root.visible && Math.hypot(n.position.x - p.x, n.position.z - p.z) < GUARD_SIGHT);
    if (!guard) return;
    lastFine = now;
    guard.say(npc.child ? 'Leave the children be!' : 'Hold there! No brawling in Valdren!', 3);
    fine(guard, npc);
  };
  function fine(guard) {
    const paid = quests.fine(FINE);
    ui.toast(paid ? `${guard.name} saw that and fines you ${paid} crown${paid === 1 ? '' : 's'}. Keep the peace!` : `${guard.name} saw that. Your purse is empty, so it's a warning this time.`, 3500);
  }

  // A beaten criminal has their hands bound and follows the traveller from then on.
  function bindCaptive(npc) {
    quests.bind(npc);
    let where = 'Lead them to the Wardens\' Guild';
    if (!mark && world.guild) {
      mark = { x: world.guild.door[0], z: world.guild.door[1] };
      where += ' (marked on your map)';
    }
    ui.toast(`You bind ${npc.name}'s hands. ${where}.`, 4500);
    saveNow();
  }

  // ------------------------------------------------------------ the mine

  // What the traveller carries between the world and the mine: themselves and their gear.
  const travellers = () => [player.figure.root, lantern.prop, lantern.light, lantern.light.target, lantern.shaft,
    sword.blade, sword.scabbard, rasengan.orb, rasengan.shock, rasengan.groundRing, rasengan.sparks, ...chidori.meshes];
  function carryTo(target) {
    for (const o of travellers()) target.add(o);
    post.setScene(target);
  }

  const visits = new Map();
  async function enterDungeon(id = 'mine') {
    if (mode !== 'playing' || underground) return;
    setMode('sleeping');
    await ui.fade(true, 'You climb down into the dark…');
    const place = dungeon.select(id);
    const s = dungeon.reset();
    dungeon.active = true;
    underground = true;
    carryTo(dungeon.scene);
    player.teleport(s.x, s.z, s.heading);
    follow.yaw = player.heading + Math.PI;
    follow.pitch = 0.3;
    follow.update(0, player.position, true);
    renderer.compile(dungeon.scene, camera);
    needsRender = true;
    await wait(500);
    await ui.fade(false);
    setMode('playing');
    const n = (visits.get(id) || 0) + 1;
    visits.set(id, n);
    const dark = lantern.on ? '' : ` It is dark down here: ${input.touchMode ? 'tap the lantern button' : 'press F'} for your lantern.`;
    ui.toast(n === 1
      ? `${place.name}. ${place.def.about} Every monster you defeat drops crowns.${dark}`
      : `Back in ${place.name}. The monsters have crept back in.${dark}`, 6500);
  }
  const enterMine = () => enterDungeon('mine');

  // Back up at the dungeon's way in, at once (also when knocked out below).
  function surface() {
    dungeon.active = false;
    underground = false;
    carryTo(scene);
    ui.setBoss(null);
    const [x, z, heading] = hereDoor().out;
    player.teleport(x, z, heading);
    follow.yaw = heading + Math.PI;
    follow.update(0, player.position, true);
    needsRender = true;
  }

  async function leaveMine() {
    if (mode !== 'playing' || !underground) return;
    setMode('sleeping');
    await ui.fade(true, world.night > 0.5 ? 'Up into the night air…' : 'Up into the daylight…');
    surface();
    await wait(400);
    await ui.fade(false);
    setMode('playing');
    saveNow();
  }

  // A monster's blow; the troll's knocks the traveller back.
  dungeon.onBlow = (monster, damage) => {
    if (mode !== 'playing') return;
    ui.flashHurt();
    if (monster.spec.boss) {
      const dx = player.position.x - monster.position.x;
      const dz = player.position.z - monster.position.z;
      const d = Math.hypot(dx, dz) || 1;
      player.lunge((dx / d) * 9, (dz / d) * 9, 0.22);
      shake = Math.max(shake, 0.18);
    }
    if (combat.hurt(damage)) knockedOut();
  };
  let lootShown = false;
  dungeon.onLoot = (monster, coins) => {
    quests.addCoins(coins);
    if (monster.spec.boss) ui.toast(`The ${monster.name.toLowerCase()} falls! +${coins} crowns. The chest behind is yours to open.`, 5000);
    else if (!lootShown) {
      lootShown = true;
      ui.toast(`${monster.name} defeated: +${coins} crowns!`, 2600);
    }
  };
  dungeon.onBoss = (boss) => ui.setBoss(boss ? { name: boss.name, fraction: boss.health / boss.spec.health } : null);

  function openChest() {
    const r = dungeon.openChest();
    if (!r) return;
    if (r.coins) {
      quests.addCoins(r.coins);
      ui.toast(`${r.text} +${r.coins} crowns.`, 4000);
      saveNow();
    } else {
      ui.toast(r.text, 3000);
    }
  }

  // Beaten senseless: the traveller comes to in their cottage, and whoever did it gets away.
  async function knockedOut() {
    if (mode !== 'playing') return;
    setMode('sleeping');
    music.hush(true);
    await ui.fade(true, 'Everything goes dark…');
    const below = underground;
    if (below) surface();
    for (const n of npcs.list) if (n.mood === 'fight' || n.mood === 'flee') n.goHome();
    world.setTime((world.timeOfDay + 3) % 24);
    combat.health = MAX_HEALTH * 0.5;
    // Teleporting puts the traveller back on their feet (out of the air, too).
    if (world.home) {
      const { stand, face } = world.home.bed;
      player.teleport(stand[0], stand[1], Math.atan2(face[0] - stand[0], face[1] - stand[1]));
    } else {
      player.teleport(SITES.spawn.x, SITES.spawn.z, SITES.spawn.heading);
    }
    ui.setFlying(false);
    follow.yaw = player.heading + Math.PI;
    follow.update(0, player.position, true);
    saveNow();
    needsRender = true;
    await wait(900);
    await ui.fade(false);
    music.hush(false);
    setMode('playing');
    ui.toast(below
      ? `You wake in your cottage, sore all over. Someone must have dragged you out of ${dungeon.current.name}.`
      : 'You wake in your cottage, sore all over. Whoever beat you is long gone.', 4500);
  }

  // Inside an inn the music turns to a jig; otherwise it follows day and night.
  let musicTimer = 0;
  function chooseMusic(dt) {
    musicTimer -= dt;
    if (musicTimer > 0) return;
    musicTimer = 0.5;
    const p = player.position;
    const room = world.interiorAt(p.x, p.y + 0.5, p.z);
    const inn = room && (room.name === 'The Broken Oar' || room.name === 'The Millstone');
    music.setScene(inn ? 'inn' : underground || world.night > 0.55 ? 'night' : 'day');
  }

  // ------------------------------------------------------------- sleep

  // Sleeping in your own bed: after dark you wake at seven the next morning; by day
  // you rest until seven in the evening. The screen fades out and in around it.
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function sleep() {
    if (mode !== 'playing' || !world.home) return;
    const h = world.timeOfDay;
    const night = h >= 17.5 || h < 5;
    setMode('sleeping');
    if (lantern.on) setLantern(false);
    music.hush(true);
    await ui.fade(true, night ? 'You sleep…' : 'You rest a while…');
    world.setTime(night ? 7 : 19);
    const { stand, face } = world.home.bed;
    player.teleport(stand[0], stand[1], Math.atan2(face[0] - stand[0], face[1] - stand[1]));
    follow.yaw = player.heading + Math.PI;
    follow.update(0, player.position, true);
    saveNow();
    needsRender = true;
    await wait(900);
    await ui.fade(false);
    music.hush(false);
    setMode('playing');
    ui.toast(night ? 'You sleep soundly. Morning comes to Valdren.' : 'You doze until the evening.', 4000);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      music.wake();
      return;
    }
    pause();
    music.suspend();
    if (mode !== 'title') saveNow();
  });
  // A phone may suspend the sound (a call, the lock screen); the next touch brings it back.
  window.addEventListener('pointerdown', () => music.wake(), { passive: true });
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
    if (!underground) animals.draw(camera, player.position);
    if (post.active) post.render(underground ? 1 : world.night);
    else renderer.render(underground ? dungeon.scene : scene, camera);
  }
  const look = { yaw: 0, pitch: 0 };
  const stats = { frames: 0, time: 0 };
  const slow = { time: 0, warned: false };
  // Once a session, the first nightfall (after a few seconds of play) suggests the lantern.
  const nightHint = { played: 0, shown: false };
  let homeGreeted = false;
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
    if (player.flying || player.airborne) return null;
    if (underground) return dungeon.reachable(player);
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
    for (const door of world.dungeonDoors) {
      const d = Math.hypot(door.door[0] - p.x, door.door[1] - p.z);
      if (d < 2.6) options.push({ d, r: { door } });
    }
    // A beaten criminal on their knees, waiting to be bound.
    for (const n of npcs.list) {
      if (n.mood !== 'yield') continue;
      const d = Math.hypot(n.position.x - p.x, n.position.z - p.z);
      if (d < BIND_RANGE) options.push({ d: d - 0.5, r: { captive: n } });
    }
    if (world.home) {
      const [bx, bz] = world.home.bed.at;
      const d = Math.hypot(bx - p.x, bz - p.z);
      if (d < 1.9 && world.interiorAt(p.x, p.y + 0.5, p.z) === world.home.interior) options.push({ d: d - 0.3, r: { bed: true } });
    }
    if (!options.length) return null;
    options.sort((a, b) => a.d - b.d);
    return options[0].r;
  }

  function updateHud(dt) {
    // Bearing the camera looks towards: yaw 0 looks north (-z), east is +x.
    ui.updateCompass(THREE.MathUtils.radToDeg(-follow.yaw), world.timeOfDay);
    ui.setHealth(combat.health / MAX_HEALTH);
    ui.setOrb(rasengan.ready);
    ui.setChidori(chidori.ready);
    minimapTimer -= dt;
    if (minimapTimer > 0) return;
    minimapTimer = 1 / 30;
    if (underground) {
      // The mine's own plan, with its monsters.
      ui.drawMinimap({
        x: player.position.x,
        z: player.position.z,
        heading: player.heading,
        yaw: follow.yaw,
        people: dungeon.alive.map((m) => ({ x: m.position.x, z: m.position.z, foe: true })),
        finds: [],
        home: null,
        mark: null,
        map: dungeon.minimap,
      });
      return;
    }
    ui.drawMinimap({
      x: player.position.x,
      z: player.position.z,
      heading: player.heading,
      yaw: follow.yaw,
      people: npcs.list.filter((n) => n.figure.root.visible).map((n) => ({ x: n.position.x, z: n.position.z, met: flags.has(`met_${n.id}`), foe: n.mood === 'flee' || n.mood === 'fight' })),
      finds: lore.found.map((id) => lore.byId.get(id).pos),
      home: world.home,
      mark,
      shops,
    });
  }

  // The pointer to the mark: over the spot when it is in view, else at the edge of the
  // screen pointing the way. Reaching the spot clears the mark.
  const markPoint = new THREE.Vector3();
  function updateMark() {
    if (!mark || underground) {
      ui.updateWaypoint(null);
      ui.setCompassMark(null);
      return;
    }
    const p = player.position;
    const dx = mark.x - p.x;
    const dz = mark.z - p.z;
    const distance = Math.hypot(dx, dz);
    if (distance < MARK_REACHED && !player.flying) {
      mark = null;
      ui.updateWaypoint(null);
      ui.setCompassMark(null);
      ui.toast('You have reached your mark.', 2500);
      saveNow();
      return;
    }
    ui.setCompassMark(THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)), THREE.MathUtils.radToDeg(-follow.yaw));
    const ground = Math.max(world.getGroundHeight(mark.x, mark.z), WATER_LEVEL);
    markPoint.set(mark.x, ground + 2.2, mark.z).project(camera);
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x = (markPoint.x * 0.5 + 0.5) * W;
    let y = (-markPoint.y * 0.5 + 0.5) * H;
    const behind = markPoint.z > 1;
    const margin = 40;
    const onScreen = !behind && x > margin && x < W - margin && y > margin + 40 && y < H - margin;
    let angle = 0;
    if (!onScreen) {
      // Behind the camera the projection comes out mirrored.
      let vx = x - W / 2;
      let vy = y - H / 2;
      if (behind) {
        vx = -vx;
        vy = -vy;
      }
      if (Math.abs(vx) < 1e-3 && Math.abs(vy) < 1e-3) vy = 1;
      const k = Math.min((W / 2 - margin) / Math.max(Math.abs(vx), 1e-3), (H / 2 - margin - 30) / Math.max(Math.abs(vy), 1e-3));
      x = W / 2 + vx * k;
      y = H / 2 + vy * k;
      angle = Math.atan2(vx, -vy);
    }
    ui.updateWaypoint({ x, y, distance, onScreen, angle });
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
      `speed ${player.speed.toFixed(1)} m/s${depth > 0 ? `  wading ${depth.toFixed(2)} m` : ''}${player.flying ? '  flying' : player.airborne ? '  airborne' : ''}  health ${combat.health.toFixed(0)}`,
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
      combat.update(dt);
      const orbBusy = rasengan.busy;
      rasengan.update(dt, player, npcs, follow.yaw + Math.PI);
      // The left hand lets go of the sphere as the lunge begins; the gear returns after.
      if (rasengan.state === 'lunge' && player.animator.action === 'orb') player.animator.action = lantern.on ? 'lanternL' : null;
      if (orbBusy && !rasengan.busy) endOrb();
      const boltBusy = chidori.busy;
      chidori.update(dt, player, npcs, follow.yaw + Math.PI);
      if (chidori.state === 'dash' && player.animator.action === 'orb') player.animator.action = lantern.on ? 'lanternL' : null;
      if (boltBusy && !chidori.busy) endOrb();
      npcs.update(dt, player);
      if (!underground) quests.update(dt, player, standable);
      animals.update(dt, player, npcs);
      if (underground) {
        dungeon.update(dt, player);
        dungeon.separate(player);
      } else if (!balloons.riding) {
        npcs.separate(player);
        animals.separate(player);
      }
      lore.update(dt);
      follow.update(dt, player.position);
      if (shake > 0.002) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        camera.position.z += (Math.random() - 0.5) * shake;
        shake *= Math.exp(-7 * dt);
      }
      // Hide the player when an obstacle squeezes the camera right up to them.
      player.figure.root.visible = follow.actualDistance > 1.0;
      lantern.update(dt, player, camera, underground ? 1 : world.night);
      sword.update(player);
      chooseMusic(dt);
      if (!homeGreeted && world.home && world.interiorAt(player.position.x, player.position.y + 0.5, player.position.z) === world.home.interior) {
        homeGreeted = true;
        ui.toast('Your cottage. Sleep in the bed to pass the night, or to rest until evening.', 4500);
      }
      nightHint.played += dt;
      if (!nightHint.shown && nightHint.played > 6 && world.night > 0.6 && !lantern.on) {
        nightHint.shown = true;
        ui.toast(`Night has fallen. ${input.touchMode ? 'Tap the lantern button' : 'Press F'} to light your lantern, or sleep in your cottage until morning.`, 5500);
      }
      reachable = balloons.riding ? null : findReachable();
      if (reachable && reachable.balloon) ui.setPrompt('the balloon', input.touchMode, 'Ride');
      else if (reachable && reachable.bed) ui.setPrompt('your bed', input.touchMode, 'Sleep in');
      else if (reachable && reachable.entry) ui.setPrompt(reachable.entry.title, input.touchMode, lore.kindOf(reachable.entry).verb);
      else if (reachable && reachable.animal) ui.setPrompt(animals.label(reachable.animal), input.touchMode, 'Pet');
      else if (reachable && reachable.captive) ui.setPrompt(reachable.captive.name, input.touchMode, 'Bind');
      else if (reachable && reachable.door) ui.setPrompt(reachable.door.name, input.touchMode, 'Enter');
      else if (reachable && reachable.exit) ui.setPrompt(dungeon.current.name, input.touchMode, 'Climb out of');
      else if (reachable && reachable.chest) ui.setPrompt('the chest', input.touchMode, 'Open');
      else ui.setPrompt(reachable ? reachable.npc.name : null, input.touchMode);
      if (!underground) world.update(dt, player.position, camera);
      ui.updateLabels(underground ? dungeon.labels(camera, window.innerWidth, window.innerHeight) : npcs.labels(camera, window.innerWidth, window.innerHeight, reachable && reachable.npc));
      updateHud(dt);
      updateMark();
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
      lantern.update(dt, player, camera, world.night);
      sword.update(player);
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
      lantern.update(dt, player, camera, world.night);
      sword.update(player);
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
  window.valdren = { THREE, renderer, post, scene, camera, world, player, lantern, setLantern, sword, combat, rasengan, chidori, dungeon, enterMine, enterDungeon, leaveMine, quests, setFlying, music, sleep, follow, input, ui, npcs, animals, balloons, boats, dragon, dialogue, flags, lore, journal, reader, progress, saveNow, setQuality, get quality() { return current; } };
}

boot().catch((err) => {
  console.error(err);
  ui.showFatal(`Valdren failed to start: ${err && err.message ? err.message : err}`);
});
