import * as THREE from 'three';

/*
 * rasengan.js: the traveller's Rasengan, a sphere of wind spun in the palm.
 *
 * Press V (or right-click, or the touch button) and a ball of churning blue air
 * gathers in the right hand while the left hand cups over it. A moment later the
 * traveller lunges at whoever stands closest in the direction the camera looks and
 * drives it home: a very heavy blow that throws them back, with a burst of light,
 * a shock ring along the ground, sparks, a shake of the camera and a boom. Others
 * close to the burst are caught by its edge. Then it must gather strength again.
 *
 * Everything is drawn and voiced in code: a swirl shader on the sphere, a white-hot
 * core, whirling rings, a soft glow, and Web Audio noise and oscillators.
 */

export const DAMAGE = 90;          // to the one it is driven into (people have 100)
const SPLASH = 28;                 // to anyone else within SPLASH_RADIUS of the burst
const SPLASH_RADIUS = 2.6;
const FLING = 5.5;                 // metres the target is thrown back
const CHARGE = 0.85;               // seconds to gather the sphere
const LUNGE_SPEED = 15;            // metres per second
const LUNGE_MAX = 0.32;            // seconds (about 4.8 m)
const REACH = 2.4;                 // from the traveller to the target at the moment of impact
const AIM_RANGE = 9;               // how far away a target may be picked
const AIM_CONE = 0.9;              // radians either side of the view
export const COOLDOWN = 3.5;       // seconds before the next one
const ORB_RADIUS = 0.17;

const SHELL_VERT = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

// Bands of wind spiralling round the sphere's axis, brightest at the rim.
const SHELL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 p = normalize(vPos);
    float a = atan(p.z, p.x);
    float swirl = sin(a * 5.0 + p.y * 9.0 - uTime * 26.0) * 0.5 + 0.5;
    float swirl2 = sin(a * 3.0 - p.y * 13.0 + uTime * 19.0) * 0.5 + 0.5;
    float bands = pow(swirl, 3.0) * 0.8 + pow(swirl2, 4.0) * 0.6;
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
    vec3 col = mix(vec3(0.1, 0.42, 1.0), vec3(0.72, 0.9, 1.0), bands * 0.8 + rim * 0.2);
    float alpha = clamp(rim * 0.7 + bands * 0.55 + 0.04, 0.0, 1.0) * uPower;
    gl_FragColor = vec4(col * (0.75 + bands * 0.7), alpha);
  }
`;

// A thin bright shell for the burst: brightest at its rim, fading as it grows.
const SHOCK_FRAG = /* glsl */ `
  uniform float uFade;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.5);
    gl_FragColor = vec4(vec3(0.35, 0.65, 1.0) * 1.4, rim * uFade);
  }
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(170,215,255,0.75)');
  grd.addColorStop(1, 'rgba(60,140,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const additive = (opts) => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...opts });
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const SPARKS = 90;

export class Rasengan {
  constructor(scene) {
    this.state = 'idle'; // idle, gather, lunge
    this.t = 0;
    this.cooldown = 0;
    this.target = null;
    this._sound = null;
    // Hooks: onImpact(npc, result, wasCalm) for each person struck, onBurst(strength)
    // for the camera shake; audio() returns the AudioContext and a noise buffer (or null).
    this.onImpact = null;
    this.onBurst = null;
    this.audio = () => null;

    // The sphere in the hand.
    this.orb = new THREE.Group();
    this.orb.name = 'rasengan';
    this.uniforms = { uTime: { value: 0 }, uPower: { value: 0 } };
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.ShaderMaterial(additive({
      uniforms: this.uniforms, vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, side: THREE.DoubleSide,
    })));
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshBasicMaterial(additive({ color: new THREE.Color(0.85, 1.0, 1.3) })));
    this.rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.12 + i * 0.1, 0.022, 6, 40), new THREE.MeshBasicMaterial(additive({ color: 0x6fb4ff, opacity: 0.75 })));
      ring.rotation.set(i * 1.1, i * 0.7, 0);
      this.rings.push(ring);
    }
    const glow = glowTexture();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial(additive({ map: glow, color: 0x4f9cff, opacity: 0.5 })));
    this.glow.scale.setScalar(3.6);
    this.orb.add(shell, this.core, ...this.rings, this.glow);
    this.orb.visible = false;
    this.orb.renderOrder = 6;
    scene.add(this.orb);

    // The burst: a growing shell, a ring along the ground and a spray of sparks.
    this.shockUniforms = { uFade: { value: 0 } };
    this.shock = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), new THREE.ShaderMaterial(additive({
      uniforms: this.shockUniforms, vertexShader: SHELL_VERT, fragmentShader: SHOCK_FRAG,
    })));
    this.groundRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial(additive({ color: 0x8cc8ff, side: THREE.DoubleSide })));
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial(additive({ map: glow, color: 0x8cc4ff, size: 0.22, sizeAttenuation: true })));
    this.sparks.frustumCulled = false;
    this._vel = new Float32Array(SPARKS * 3);
    for (const m of [this.shock, this.groundRing, this.sparks]) {
      m.visible = false;
      m.renderOrder = 6;
      scene.add(m);
    }
    this.burstT = -1;
  }

  get busy() {
    return this.state !== 'idle';
  }

  // 0 just used .. 1 ready.
  get ready() {
    return 1 - this.cooldown / COOLDOWN;
  }

  // Starts gathering the sphere. Returns false while it is still recovering (or already in hand).
  begin() {
    if (this.state !== 'idle' || this.cooldown > 0) return false;
    this.state = 'gather';
    this.t = 0;
    this.orb.visible = true;
    this.uniforms.uPower.value = 0;
    this._hum();
    return true;
  }

  // Puts the sphere away unused (a conversation, a page opened, sleep).
  cancel() {
    if (this.state === 'idle') return;
    this.state = 'idle';
    this.orb.visible = false;
    this._stopHum(0.15);
  }

  // The nearest person in reach of a lunge, near the direction of the view.
  _pick(player, npcs, aimYaw) {
    const pos = player.position;
    let best = null;
    let bestD = AIM_RANGE;
    for (const npc of npcs.list) {
      if (npc.mood === 'gone' || !npc.figure.root.visible || npc.talking) continue;
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
   * Each frame while playing. player: the traveller (whose hand holds the sphere and
   * who does the lunging); npcs: who can be struck; aimYaw: the camera's heading.
   */
  update(dt, player, npcs, aimYaw) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.uniforms.uTime.value += dt;
    this._updateBurst(dt);
    if (this.state === 'idle') return;
    this.t += dt;

    if (this.state === 'gather') {
      const grow = Math.min(1, this.t / CHARGE);
      this.uniforms.uPower.value = grow;
      this._place(player, ORB_RADIUS * (0.25 + 0.75 * (1 - (1 - grow) ** 3)));
      if (this.t >= CHARGE) {
        // Lunge at whoever is closest in the direction of the view, or straight ahead.
        this.target = this._pick(player, npcs, aimYaw);
        const p = player.position;
        let dir = aimYaw;
        let time = 0.18;
        if (this.target) {
          const dx = this.target.position.x - p.x;
          const dz = this.target.position.z - p.z;
          dir = Math.atan2(dx, dz);
          time = Math.min(LUNGE_MAX, Math.max(0.06, (Math.hypot(dx, dz) - 1.1) / LUNGE_SPEED));
        }
        player.lunge(Math.sin(dir) * LUNGE_SPEED, Math.cos(dir) * LUNGE_SPEED, time);
        player.animator.strike('thrust');
        this.state = 'lunge';
        this.t = 0;
        this.lungeTime = time;
      }
      return;
    }

    // Lunging: the sphere leads, and bursts when the lunge ends.
    this._place(player, ORB_RADIUS * (1.05 + Math.sin(this.t * 40) * 0.05));
    if (this.t >= this.lungeTime + 0.04) this._impact(player, npcs);
  }

  // The sphere sits just above the right palm, spinning.
  _place(player, radius) {
    const hand = player.figure.bones.handR;
    hand.updateWorldMatrix(true, false);
    _v.set(0, -0.06, 0.04).applyMatrix4(hand.matrixWorld);
    const h = player.heading;
    _v.x += Math.sin(h) * 0.12;
    _v.z += Math.cos(h) * 0.12;
    _v.y += 0.1;
    this.orb.position.copy(_v);
    this.orb.scale.setScalar(Math.max(0.001, radius));
    const t = this.uniforms.uTime.value;
    this.orb.rotation.set(t * 3.1, t * 7.3, t * 1.7);
    this.rings.forEach((r, i) => r.rotation.set(i * 1.1 + t * (17 + i * 5), i * 0.7 + t * (11 - i * 3), 0));
    this.core.scale.setScalar(0.85 + Math.sin(t * 31) * 0.12);
    this.orb.visible = player.figure.root.visible || this.state === 'lunge';
  }

  _impact(player, npcs) {
    const at = _w.copy(this.orb.position);
    this.state = 'idle';
    this.orb.visible = false;
    this.cooldown = COOLDOWN;
    this._stopHum(0.05);

    // The one it is driven into: the chosen target if they are still within reach,
    // else whoever is now right in front.
    const pos = player.position;
    let main = this.target;
    if (main && (main.mood === 'gone' || Math.hypot(main.position.x - pos.x, main.position.z - pos.z) > REACH + 0.6)) main = null;
    if (!main) main = npcs.struck(player, REACH, false)[0] || null;
    const struck = [];
    if (main) struck.push([main, DAMAGE]);
    for (const npc of npcs.list) {
      if (npc === main || npc.mood === 'gone' || !npc.figure.root.visible || npc.talking) continue;
      if (Math.hypot(npc.position.x - at.x, npc.position.z - at.z) < SPLASH_RADIUS && Math.abs(npc.position.y - pos.y) < 2) struck.push([npc, SPLASH]);
    }
    for (const [npc, damage] of struck) {
      const wasCalm = npc.calm;
      const result = npc.hit(damage, pos);
      if (!result) continue;
      if (result !== 'dodge') npc.fling(pos, damage === DAMAGE ? FLING : 1.6);
      if (this.onImpact) this.onImpact(npc, result, wasCalm, damage === DAMAGE);
    }
    this.target = null;
    this._burst(at, player, main ? 1 : 0.6);
  }

  _burst(at, player, strength) {
    this.burstT = 0;
    this.burstStrength = strength;
    this.shock.position.copy(at);
    const ground = player.position.y;
    this.groundRing.position.set(at.x, ground + 0.06, at.z);
    const pos = this.sparks.geometry.attributes.position;
    for (let i = 0; i < SPARKS; i++) {
      pos.setXYZ(i, at.x, at.y, at.z);
      // Mostly outwards and forwards, a little up.
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 - 0.2;
      const s = (5 + Math.random() * 9) * strength;
      this._vel[i * 3] = Math.cos(a) * s;
      this._vel[i * 3 + 1] = up * s;
      this._vel[i * 3 + 2] = Math.sin(a) * s;
    }
    pos.needsUpdate = true;
    for (const m of [this.shock, this.groundRing, this.sparks]) m.visible = true;
    if (this.onBurst) this.onBurst(strength);
    this._boom(strength);
  }

  _updateBurst(dt) {
    if (this.burstT < 0) return;
    this.burstT += dt;
    const u = this.burstT / 0.55;
    if (u >= 1) {
      this.burstT = -1;
      for (const m of [this.shock, this.groundRing, this.sparks]) m.visible = false;
      return;
    }
    const ease = 1 - (1 - u) ** 3;
    const k = this.burstStrength;
    this.shock.scale.setScalar(0.2 + ease * 2.3 * k);
    this.shockUniforms.uFade.value = (1 - u) ** 2 * 1.3;
    this.groundRing.scale.setScalar(0.4 + ease * 5.5 * k);
    this.groundRing.material.opacity = (1 - u) * 0.9;
    const pos = this.sparks.geometry.attributes.position;
    const drag = Math.exp(-3.5 * dt);
    for (let i = 0; i < SPARKS; i++) {
      const j = i * 3;
      this._vel[j] *= drag;
      this._vel[j + 1] = this._vel[j + 1] * drag - 9 * dt;
      this._vel[j + 2] *= drag;
      pos.setXYZ(i, pos.getX(i) + this._vel[j] * dt, pos.getY(i) + this._vel[j + 1] * dt, pos.getZ(i) + this._vel[j + 2] * dt);
    }
    pos.needsUpdate = true;
    this.sparks.material.opacity = 1 - u;
  }

  // ------------------------------------------------------------- sound

  // A rising whirr of wind while the sphere gathers.
  _hum() {
    const a = this.audio();
    if (!a) return;
    const { ctx: c, noise } = a;
    const now = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.32, now + CHARGE * 0.8);
    out.connect(c.destination);
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.setValueAtTime(350, now);
    band.frequency.exponentialRampToValueAtTime(2600, now + CHARGE + 0.3);
    src.connect(band).connect(out);
    const whine = c.createOscillator();
    whine.type = 'triangle';
    whine.frequency.setValueAtTime(140, now);
    whine.frequency.exponentialRampToValueAtTime(620, now + CHARGE + 0.3);
    const wg = c.createGain();
    wg.gain.value = 0.18;
    const lfo = c.createOscillator();
    lfo.frequency.value = 22;
    const lg = c.createGain();
    lg.gain.value = 0.12;
    lfo.connect(lg).connect(wg.gain);
    whine.connect(wg).connect(out);
    src.start(now);
    whine.start(now);
    lfo.start(now);
    this._sound = { out, nodes: [src, whine, lfo], c };
  }

  _stopHum(fade) {
    const s = this._sound;
    if (!s) return;
    this._sound = null;
    const now = s.c.currentTime;
    s.out.gain.cancelScheduledValues(now);
    s.out.gain.setValueAtTime(s.out.gain.value, now);
    s.out.gain.linearRampToValueAtTime(0, now + fade);
    for (const n of s.nodes) n.stop(now + fade + 0.05);
  }

  // The burst: a deep thump, a roar of air and a sharp crack.
  _boom(strength) {
    const a = this.audio();
    if (!a) return;
    const { ctx: c, noise } = a;
    const now = c.currentTime;
    const out = c.createGain();
    out.gain.value = 0.55 * (0.6 + 0.4 * strength);
    out.connect(c.destination);
    const thump = c.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, now);
    thump.frequency.exponentialRampToValueAtTime(32, now + 0.5);
    const tg = c.createGain();
    tg.gain.setValueAtTime(1, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    thump.connect(tg).connect(out);
    const roar = c.createBufferSource();
    roar.buffer = noise;
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.setValueAtTime(4000, now);
    low.frequency.exponentialRampToValueAtTime(250, now + 0.7);
    const rg = c.createGain();
    rg.gain.setValueAtTime(0.9, now);
    rg.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    roar.connect(low).connect(rg).connect(out);
    const crack = c.createBufferSource();
    crack.buffer = noise;
    const high = c.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 2500;
    const cg = c.createGain();
    cg.gain.setValueAtTime(0.7, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    crack.connect(high).connect(cg).connect(out);
    thump.start(now);
    thump.stop(now + 0.65);
    roar.start(now, Math.random() * 0.5);
    roar.stop(now + 0.85);
    crack.start(now, Math.random() * 0.5);
    crack.stop(now + 0.15);
  }
}
