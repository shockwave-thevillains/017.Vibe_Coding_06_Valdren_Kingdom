import * as THREE from 'three';

/*
 * chidori.js: the traveller's Chidori, lightning gathered in the hand.
 *
 * Press X (or the middle mouse button, or the touch button) and lightning
 * crackles round the right hand with a sound like a thousand birds. Half a second
 * later the traveller dashes forward, fast and straight, at whoever stands closest
 * in the direction the camera looks: everyone the dash passes through is struck,
 * the one it is aimed at hardest, and on impact the lightning leaps on to a few
 * more who stand near. It has a cooldown of its own, so it can be used while the
 * Rasengan is still gathering strength (and the other way round), though not both
 * at once.
 *
 * Everything is drawn and voiced in code: bolts re-forked every frame round a
 * white-hot glow, a jagged trail along the dash, arcs to the ones the lightning
 * leaps to, a flash; Web Audio oscillators and noise for the chirping and the crack.
 */

export const DAMAGE = 75;          // to the one it is aimed at
const PIERCE = 40;                 // to anyone else the dash passes through
const CHAIN = 24;                  // to those the lightning leaps to after
const CHAINS = 3;
const CHAIN_RADIUS = 6;
const PATH_RADIUS = 1.35;          // how close to the dash someone must be to be struck
const CHARGE = 0.5;                // seconds to gather the lightning
const DASH_SPEED = 26;             // metres per second
const DASH_MAX = 0.32;             // seconds (about 8 m)
const AIM_RANGE = 10;
const AIM_CONE = 0.8;
const FLING = 3.2;
export const COOLDOWN = 5;

const BOLTS = 14;                  // bolts round the hand
const BOLT_STEPS = 5;
const TRAIL = 3;                   // bolts along a dash
const TRAIL_STEPS = 14;
const ARC_STEPS = 9;

const additive = (opts) => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...opts });

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(210,235,255,0.85)');
  grd.addColorStop(0.5, 'rgba(120,170,255,0.3)');
  grd.addColorStop(1, 'rgba(80,120,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Line segments for `n` polylines of `steps` segments each, filled in later.
function boltLines(n, steps, color, opacity = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * steps * 2 * 3), 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial(additive({ color, opacity })));
  lines.frustumCulled = false;
  lines.renderOrder = 7;
  return lines;
}

// Writes a jagged bolt from a to b (THREE.Vector3s) into lines at polyline `k`.
function zigzag(lines, k, steps, a, b, jitter) {
  const pos = lines.geometry.attributes.position;
  let px = a.x;
  let py = a.y;
  let pz = a.z;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const off = i === steps ? 0 : jitter * Math.sin(Math.PI * t);
    const x = a.x + (b.x - a.x) * t + (Math.random() - 0.5) * off;
    const y = a.y + (b.y - a.y) * t + (Math.random() - 0.5) * off;
    const z = a.z + (b.z - a.z) * t + (Math.random() - 0.5) * off;
    const j = (k * steps + i - 1) * 2;
    pos.setXYZ(j, px, py, pz);
    pos.setXYZ(j + 1, x, y, z);
    px = x;
    py = y;
    pz = z;
  }
  pos.needsUpdate = true;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hand = new THREE.Vector3();

export class Chidori {
  constructor(scene) {
    this.state = 'idle'; // idle, gather, dash
    this.t = 0;
    this.cooldown = 0;
    this.target = null;
    this._struck = new Set();
    this._sound = null;
    // Hooks: onImpact(npc, result, wasCalm) for each person struck, onBurst(strength)
    // for the flash and shake; audio() returns the AudioContext and a noise buffer (or null).
    this.onImpact = null;
    this.onBurst = null;
    // Monsters it can strike as well: { alive, struck(player, reach, sweep) }.
    this.foes = null;
    this.audio = () => null;

    const glow = glowTexture();
    // The lightning in the hand: a white-hot glow, a bluer halo and forking bolts.
    this.spark = new THREE.Group();
    this.spark.name = 'chidori';
    this.core = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glow, color: 0xf2f8ff })));
    this.core.scale.setScalar(0.5);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glow, color: 0x6a8cff, opacity: 0.7 })));
    this.halo.scale.setScalar(1.6);
    this.spark.add(this.halo, this.core);
    this.spark.visible = false;
    this.spark.renderOrder = 7;
    this.bolts = boltLines(BOLTS, BOLT_STEPS, 0xd8ecff);
    this.bolts.visible = false;
    // The trail of a dash and the arcs that leap from where it ends.
    this.trail = boltLines(TRAIL, TRAIL_STEPS, 0xc8e0ff);
    this.arcs = boltLines(CHAINS, ARC_STEPS, 0xe0f0ff);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glow, color: 0xb8d4ff })));
    for (const m of [this.trail, this.arcs, this.flash]) m.visible = false;
    this.flash.renderOrder = 7;
    scene.add(this.spark, this.bolts, this.trail, this.arcs, this.flash);
    this.trailT = -1;
    this.arcT = -1;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._arcEnds = [];
  }

  // The things to carry between scenes (the world and a dungeon).
  get meshes() {
    return [this.spark, this.bolts, this.trail, this.arcs, this.flash];
  }

  get busy() {
    return this.state !== 'idle';
  }

  // 0 just used .. 1 ready.
  get ready() {
    return 1 - this.cooldown / COOLDOWN;
  }

  // Starts gathering the lightning. Returns false while it is still recovering (or already in hand).
  begin() {
    if (this.state !== 'idle' || this.cooldown > 0) return false;
    this.state = 'gather';
    this.t = 0;
    this.spark.visible = true;
    this.bolts.visible = true;
    this._chirp();
    return true;
  }

  // Lets the lightning go unused (a conversation, a page opened, sleep).
  cancel() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.spark.visible = false;
    this.bolts.visible = false;
    this._stopChirp(0.1);
  }

  // People (and monsters) it may strike: in sight, not gone.
  _candidates(npcs) {
    const people = npcs.list.filter((n) => n.mood !== 'gone' && n.figure.root.visible && !n.talking);
    return this.foes ? people.concat(this.foes.alive) : people;
  }

  _pick(player, npcs, aimYaw) {
    const pos = player.position;
    let best = null;
    let bestD = AIM_RANGE;
    for (const npc of this._candidates(npcs)) {
      const dx = npc.position.x - pos.x;
      const dz = npc.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD || Math.abs(npc.position.y - pos.y) > 2) continue;
      const a = Math.atan2(dx, dz) - aimYaw;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > AIM_CONE) continue;
      best = npc;
      bestD = d;
    }
    return best;
  }

  /*
   * Each frame while playing. player: the traveller (whose right hand holds the
   * lightning and who dashes); npcs: who can be struck; aimYaw: the camera's heading.
   */
  update(dt, player, npcs, aimYaw) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this._fade(dt);
    if (this.state === 'idle') return;
    this.t += dt;
    this._place(player);

    if (this.state === 'gather') {
      if (this.t >= CHARGE) {
        // Dash at whoever is closest in the direction of the view, or straight ahead.
        this.target = this._pick(player, npcs, aimYaw);
        const p = player.position;
        let dir = aimYaw;
        let time = 0.2;
        if (this.target) {
          const dx = this.target.position.x - p.x;
          const dz = this.target.position.z - p.z;
          dir = Math.atan2(dx, dz);
          // Through them and a little beyond.
          time = Math.min(DASH_MAX, Math.max(0.08, (Math.hypot(dx, dz) + 1.2) / DASH_SPEED));
        }
        player.lunge(Math.sin(dir) * DASH_SPEED, Math.cos(dir) * DASH_SPEED, time);
        player.animator.strike('thrust');
        this._from.copy(_hand);
        this.state = 'dash';
        this.t = 0;
        this.dashTime = time;
        this._struck.clear();
      }
      return;
    }

    // Dashing: whoever the traveller passes through is struck.
    const pos = player.position;
    for (const npc of this._candidates(npcs)) {
      if (this._struck.has(npc)) continue;
      const d = Math.hypot(npc.position.x - pos.x, npc.position.z - pos.z);
      if (d > PATH_RADIUS + (npc.radius || 0.3) || Math.abs(npc.position.y - pos.y) > 2) continue;
      this._hit(npc, npc === this.target ? DAMAGE : PIERCE, pos);
    }
    if (this.t >= this.dashTime + 0.04) this._impact(player, npcs);
  }

  _hit(npc, damage, from) {
    this._struck.add(npc);
    const wasCalm = npc.calm;
    const result = npc.hit(damage, from);
    if (!result) return;
    if (result !== 'dodge') npc.fling(from, damage === DAMAGE ? FLING : 1.4);
    if (this.onImpact && !npc.isMonster) this.onImpact(npc, result, wasCalm, damage === DAMAGE);
  }

  // The lightning sits round the right hand, forking anew every frame.
  _place(player) {
    const hand = player.figure.bones.handR;
    hand.updateWorldMatrix(true, false);
    _hand.set(0, -0.04, 0.03).applyMatrix4(hand.matrixWorld);
    const grow = this.state === 'gather' ? Math.min(1, this.t / CHARGE) : 1;
    this.spark.position.copy(_hand);
    const flicker = 0.85 + Math.random() * 0.3;
    this.core.scale.setScalar(0.35 * grow * flicker + 0.1);
    this.halo.scale.setScalar(1.4 * grow * flicker + 0.2);
    const reach = 0.25 + 0.45 * grow;
    for (let k = 0; k < BOLTS; k++) {
      _b.set(Math.random() - 0.5, Math.random() - 0.35, Math.random() - 0.5).normalize().multiplyScalar(reach * (0.5 + Math.random() * 0.7)).add(_hand);
      zigzag(this.bolts, k, BOLT_STEPS, _hand, _b, 0.18 * grow);
    }
    const visible = player.figure.root.visible || this.state === 'dash';
    this.spark.visible = visible;
    this.bolts.visible = visible;
  }

  _impact(player, npcs) {
    this.state = 'idle';
    this.spark.visible = false;
    this.bolts.visible = false;
    this.cooldown = COOLDOWN;
    this._stopChirp(0.05);
    const pos = player.position;
    const at = _a.copy(_hand);
    // The one aimed at, if the dash fell short of them but they are within reach now.
    const main = this.target;
    if (main && !this._struck.has(main) && main.alive !== false && main.mood !== 'gone' && Math.hypot(main.position.x - pos.x, main.position.z - pos.z) < 2.6) this._hit(main, DAMAGE, pos);
    // Then it leaps on to the nearest few others.
    const near = this._candidates(npcs)
      .filter((n) => !this._struck.has(n) && n.alive !== false && Math.abs(n.position.y - pos.y) < 2.5)
      .map((n) => ({ n, d: Math.hypot(n.position.x - at.x, n.position.z - at.z) }))
      .filter((o) => o.d < CHAIN_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, CHAINS);
    this._arcEnds = near.map(({ n }) => new THREE.Vector3(n.position.x, n.position.y + 1.1, n.position.z));
    for (const { n } of near) this._hit(n, CHAIN, at);
    this.target = null;
    // The trail from where the dash began to where it ended, the arcs and a flash.
    this._to.copy(at);
    this.trailT = 0;
    this.arcT = this._arcEnds.length ? 0 : -1;
    this.flash.position.copy(at);
    this.flash.visible = true;
    this.trail.visible = true;
    this.arcs.visible = this.arcT >= 0;
    const strength = this._struck.size ? 1 : 0.55;
    if (this.onBurst) this.onBurst(strength);
    this._crack(strength);
  }

  // Trails, arcs and the flash fade out, flickering as they go.
  _fade(dt) {
    if (this.trailT >= 0) {
      this.trailT += dt;
      const u = this.trailT / 0.45;
      if (u >= 1) {
        this.trailT = -1;
        this.trail.visible = false;
        this.flash.visible = false;
      } else {
        for (let k = 0; k < TRAIL; k++) {
          _a.copy(this._from).add(_b.set(0, (k - 1) * 0.12, 0));
          zigzag(this.trail, k, TRAIL_STEPS, _a, this._to, 0.9);
        }
        this.trail.material.opacity = (1 - u) * (0.6 + Math.random() * 0.4);
        this.flash.scale.setScalar(1.2 + u * 3.5);
        this.flash.material.opacity = (1 - u) ** 2;
      }
    }
    if (this.arcT >= 0) {
      this.arcT += dt;
      const u = this.arcT / 0.4;
      if (u >= 1) {
        this.arcT = -1;
        this.arcs.visible = false;
      } else {
        const pos = this.arcs.geometry.attributes.position;
        for (let k = 0; k < CHAINS; k++) {
          const end = this._arcEnds[k];
          if (end) zigzag(this.arcs, k, ARC_STEPS, this._to, end, 1.1);
          else for (let i = 0; i < ARC_STEPS * 2; i++) pos.setXYZ(k * ARC_STEPS * 2 + i, this._to.x, this._to.y, this._to.z);
        }
        pos.needsUpdate = true;
        this.arcs.material.opacity = (1 - u) * (0.5 + Math.random() * 0.5);
      }
    }
  }

  // ------------------------------------------------------------- sound

  // The chirping of a thousand birds: a square wave darting about high up, with crackle.
  _chirp() {
    const a = this.audio();
    if (!a) return;
    const { ctx: c, noise } = a;
    const now = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.16, now + 0.12);
    out.connect(c.destination);
    const tone = c.createOscillator();
    tone.type = 'square';
    tone.frequency.value = 2400;
    const sweep = c.createOscillator();
    sweep.type = 'sawtooth';
    sweep.frequency.value = 37;
    const depth = c.createGain();
    depth.gain.value = 900;
    sweep.connect(depth).connect(tone.frequency);
    const chop = c.createOscillator();
    chop.type = 'square';
    chop.frequency.value = 23;
    const cg = c.createGain();
    cg.gain.value = 0.5;
    const tg = c.createGain();
    tg.gain.value = 0.5;
    chop.connect(cg).connect(tg.gain);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 3200;
    band.Q.value = 1.4;
    tone.connect(tg).connect(band).connect(out);
    const crackle = c.createBufferSource();
    crackle.buffer = noise;
    crackle.loop = true;
    const high = c.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 3500;
    const ng = c.createGain();
    ng.gain.value = 0.7;
    crackle.connect(high).connect(ng).connect(out);
    for (const n of [tone, sweep, chop]) n.start(now);
    crackle.start(now, Math.random() * 0.5);
    this._sound = { out, nodes: [tone, sweep, chop, crackle], c };
  }

  _stopChirp(fade) {
    const s = this._sound;
    if (!s) return;
    this._sound = null;
    const now = s.c.currentTime;
    s.out.gain.cancelScheduledValues(now);
    s.out.gain.setValueAtTime(s.out.gain.value, now);
    s.out.gain.linearRampToValueAtTime(0, now + fade);
    for (const n of s.nodes) n.stop(now + fade + 0.05);
  }

  // The strike: a sharp crack and a falling zap.
  _crack(strength) {
    const a = this.audio();
    if (!a) return;
    const { ctx: c, noise } = a;
    const now = c.currentTime;
    const out = c.createGain();
    out.gain.value = 0.5 * (0.6 + 0.4 * strength);
    out.connect(c.destination);
    const crack = c.createBufferSource();
    crack.buffer = noise;
    const high = c.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1800;
    const cg = c.createGain();
    cg.gain.setValueAtTime(1, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    crack.connect(high).connect(cg).connect(out);
    const zap = c.createOscillator();
    zap.type = 'sawtooth';
    zap.frequency.setValueAtTime(1800, now);
    zap.frequency.exponentialRampToValueAtTime(90, now + 0.3);
    const zg = c.createGain();
    zg.gain.setValueAtTime(0.35, now);
    zg.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    zap.connect(zg).connect(out);
    crack.start(now, Math.random() * 0.5);
    crack.stop(now + 0.3);
    zap.start(now);
    zap.stop(now + 0.35);
  }
}
