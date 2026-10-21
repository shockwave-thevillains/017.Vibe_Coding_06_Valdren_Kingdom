/*
 * ui.js: DOM overlays and HUD. The start screen, pause menu and graphics
 * choice, toasts, the pointer-lock hint, the interaction prompt, name labels,
 * the compass and clock, the minimap, the full map and the debug readout all
 * live here (the dialogue box, journal and reader have their own modules).
 * Game logic calls in; the UI calls back out only through the on* hooks.
 */

const COMPASS_PX_PER_DEG = 2.4;
const MINIMAP_RADIUS = 70;   // metres from the centre to the rim
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The full map's two views: the town and its surroundings, and the whole kingdom.
const MAP_VIEWS = [
  { name: 'town', x: 20, z: 40, half: 190 },
  { name: 'kingdom', x: 0, z: -10, half: 610 },
];
const QUALITY_ABOUT = {
  low: 'No shadows or lantern light, sparse grass. For older phones and laptops.',
  medium: 'Soft shadows, lantern light at night, lighter grass and textures.',
  high: 'Sharp shadows, dense grass, full-detail textures and trees, glowing lights.',
};

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.body = document.body;
    this.startEl = $('start');
    this.statusEl = $('load-status');
    this.beginBtn = $('btn-begin');
    this.pauseEl = $('pause');
    this.resumeBtn = $('btn-resume');
    this.toastEl = $('toast');
    this.hintEl = $('hint');
    this.debugEl = $('debug');
    this.promptEl = $('prompt');
    this.labelsEl = $('labels');
    this.interactBtn = $('btn-interact');
    this.lanternBtn = $('btn-lantern');
    this.newBtn = $('btn-new');
    this.saveStatusEl = $('save-status');
    this.compassTrack = null;
    this.clockEl = $('clock');
    this.miniEl = $('minimap');
    this.mapEl = $('map');
    this.mapCanvas = $('map-canvas');
    this.mapMarks = $('map-marks');
    this.mapImage = null;
    this.mapZoomBtn = $('map-zoom');
    this.mapView = 0;
    this._mapData = null;
    this.mapZoomBtn.addEventListener('click', () => {
      this.mapView = 1 - this.mapView;
      if (this._mapData) this.showMap(this._mapData);
    });
    this._labels = new Map();
    this._prompt = null;
    this._clock = '';

    this.onBegin = null;
    this.onResume = null;
    this.onNewJourney = null;
    this.onMap = null;
    this.onMapClose = null;
    this.onQuality = null;
    this._buildCompass($('compass-strip'));
    this.newBtn.addEventListener('click', () => this.onNewJourney && this.onNewJourney());
    this.miniEl.addEventListener('click', () => this.onMap && this.onMap());
    $('map-close').addEventListener('click', () => this.onMapClose && this.onMapClose('click'));
    this._toastTimer = 0;
    this._hint = null;

    const template = $('tpl-controls');
    document.querySelectorAll('.controls-slot').forEach((slot) => {
      slot.replaceWith(template.content.cloneNode(true));
    });
    // The graphics choice appears on the start screen and in the pause menu.
    const qualityTemplate = $('tpl-quality');
    document.querySelectorAll('.quality-slot').forEach((slot) => {
      slot.replaceWith(qualityTemplate.content.cloneNode(true));
    });
    this.qualityEls = [...document.querySelectorAll('.quality')];
    for (const el of this.qualityEls) {
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quality]');
        if (btn && this.onQuality) this.onQuality(btn.dataset.quality);
      });
    }
    this.pauseStatusEl = $('pause-status');

    this.beginBtn.addEventListener('click', () => {
      if (!this.beginBtn.disabled && this.onBegin) this.onBegin();
    });
    this.resumeBtn.addEventListener('click', () => {
      if (this.onResume) this.onResume();
    });
  }

  // ------------------------------------------------------- start screen

  setStatus(text, isError = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', isError);
  }

  // saved: a line about saved progress, or null; storage: whether progress can be saved at all.
  setReady(saved = null, storage = true) {
    window.__valdrenReady = true;
    this.setStatus('The gates of Valdren stand open.');
    this.beginBtn.textContent = saved ? 'Continue' : 'Begin';
    this.newBtn.classList.toggle('hidden', !saved);
    this.saveStatusEl.textContent = !storage
      ? 'This browser is blocking storage, so progress cannot be saved this time. Everything else works.'
      : saved || 'Progress is saved in this browser as you play.';
    this.beginBtn.disabled = false;
    try {
      this.beginBtn.focus({ preventScroll: true });
    } catch {
      // Focus is a convenience only.
    }
  }

  hideStart() {
    this.startEl.classList.add('hidden');
  }

  showFatal(message) {
    this.startEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.beginBtn.disabled = true;
    this.setStatus(message, true);
  }

  // --------------------------------------------------------------- pause

  showPause(status = '') {
    this.pauseStatusEl.textContent = status;
    this.pauseEl.classList.remove('hidden');
    try {
      this.resumeBtn.focus({ preventScroll: true });
    } catch {
      // Focus is a convenience only.
    }
  }

  hidePause() {
    this.pauseEl.classList.add('hidden');
  }

  // Marks the chosen preset; reload: whether part of it waits for the next load.
  setQuality(level, reload) {
    for (const el of this.qualityEls) {
      for (const btn of el.querySelectorAll('[data-quality]')) {
        const on = btn.dataset.quality === level;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-checked', String(on));
      }
      el.querySelector('.quality-about').textContent = QUALITY_ABOUT[level] || '';
      el.querySelector('.quality-note').classList.toggle('hidden', !reload);
    }
  }

  // ----------------------------------------------------------------- HUD

  // The lantern button glows while the lantern is lit.
  setLantern(on) {
    this.lanternBtn.classList.toggle('on', on);
    this.lanternBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  setPlaying(playing) {
    this.body.classList.toggle('playing', playing);
  }

  setTouchMode(on) {
    this.body.classList.toggle('touch', on);
  }

  setHint(text) {
    if (text === this._hint) return;
    this._hint = text;
    this.hintEl.textContent = text || '';
    this.hintEl.classList.toggle('hidden', !text);
  }

  // "Talk to …" / "Read …" prompt for whatever is in reach (null hides it).
  setPrompt(name, touch, verb = 'Talk to') {
    const key = name ? `${touch ? 't' : 'k'}:${verb}:${name}` : null;
    if (key === this._prompt) return;
    this._prompt = key;
    this.interactBtn.classList.toggle('ready', !!name);
    this.promptEl.classList.toggle('hidden', !name);
    if (!name) return;
    const what = document.createElement('b');
    what.textContent = name;
    if (touch) {
      this.promptEl.replaceChildren('Tap ', Object.assign(document.createElement('b'), { textContent: 'Interact' }), ` to ${verb.toLowerCase()} `, what);
    } else {
      this.promptEl.replaceChildren(Object.assign(document.createElement('kbd'), { textContent: 'E' }), ` ${verb} `, what);
    }
  }

  // Floating names: list of { id, text, x, y, opacity, focus } in CSS pixels.
  updateLabels(list) {
    const seen = new Set();
    for (const l of list) {
      let el = this._labels.get(l.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'npc-label';
        el.textContent = l.text;
        this.labelsEl.append(el);
        this._labels.set(l.id, el);
      }
      seen.add(l.id);
      el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = l.opacity.toFixed(2);
      el.classList.toggle('focus', l.focus);
      el.hidden = false;
    }
    for (const [id, el] of this._labels) if (!seen.has(id)) el.hidden = true;
  }

  // Back to a fresh start screen after a reset.
  setNewJourney() {
    this.beginBtn.textContent = 'Begin';
    this.newBtn.classList.add('hidden');
    this.saveStatusEl.textContent = 'A new journey. Progress is saved in this browser as you play.';
  }

  // ----------------------------------------------------- compass, clock

  _buildCompass(strip) {
    const track = document.createElement('div');
    track.className = 'compass-track';
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let deg = -180; deg <= 540; deg += 15) {
      const el = document.createElement('span');
      const b = ((deg % 360) + 360) % 360;
      if (b % 45 === 0) {
        el.textContent = names[b / 45];
        el.className = b % 90 === 0 ? `major${b === 0 ? ' north' : ''}` : '';
      } else {
        el.className = 'tick';
      }
      el.style.left = `${(deg + 180) * COMPASS_PX_PER_DEG}px`;
      track.append(el);
    }
    strip.append(track);
    this.compassTrack = track;
    this.compassStrip = strip;
  }

  // bearing: degrees clockwise from north the camera looks towards; hours: time of day.
  updateCompass(bearing, hours) {
    const b = ((bearing % 360) + 360) % 360;
    const half = this.compassStrip.clientWidth / 2;
    this.compassTrack.style.transform = `translateX(${(half - (b + 180) * COMPASS_PX_PER_DEG).toFixed(1)}px)`;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    const icon = hours >= 6 && hours < 19.5 ? '☀' : '☾';
    const text = `${icon} ${String(h).padStart(2, '0')}:${String(m - (m % 5)).padStart(2, '0')}`;
    if (text !== this._clock) {
      this._clock = text;
      this.clockEl.textContent = text;
    }
  }

  // --------------------------------------------------------------- maps

  // canvas covers +-half metres in x and z, north up.
  setMapImage(canvas, half) {
    this.mapImage = canvas;
    this.mapHalf = half;
  }

  /*
   * The minimap turns with the camera, so "up" is the way you are looking.
   * view: { x, z, heading, yaw, people: [{ x, z, met }], finds: [{ x, z }] }
   */
  drawMinimap(view) {
    const el = this.miniEl;
    if (!this.mapImage || !el.clientWidth) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(el.clientWidth * dpr);
    if (el.width !== size) el.width = el.height = size;
    const g = el.getContext('2d');
    const r = size / 2;
    const scale = (r - 3 * dpr) / MINIMAP_RADIUS;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
    g.fillStyle = '#d9c9a0';
    g.fill();
    g.clip();
    g.translate(r, r);
    g.rotate(view.yaw);
    g.scale(scale, scale);
    g.translate(-view.x, -view.z);
    const half = this.mapHalf;
    g.drawImage(this.mapImage, -half, -half, half * 2, half * 2);
    const px = 1 / scale;
    for (const f of view.finds) {
      g.save();
      g.translate(f.x, f.z);
      g.rotate(Math.PI / 4 - view.yaw);
      g.fillStyle = '#b03a2e';
      g.fillRect(-3.2 * px * dpr, -3.2 * px * dpr, 6.4 * px * dpr, 6.4 * px * dpr);
      g.restore();
    }
    for (const p of view.people) {
      g.beginPath();
      g.arc(p.x, p.z, 3.4 * px * dpr, 0, Math.PI * 2);
      g.fillStyle = p.met ? '#e8c066' : '#9a9080';
      g.fill();
      g.lineWidth = 1.2 * px * dpr;
      g.strokeStyle = '#2e2014';
      g.stroke();
    }
    // The player, pointing where they face.
    const s = Math.sin(view.heading);
    const c = Math.cos(view.heading);
    const L = 9 * px * dpr;
    g.beginPath();
    g.moveTo(view.x + s * L, view.z + c * L);
    g.lineTo(view.x - s * L * 0.6 + c * L * 0.55, view.z - c * L * 0.6 - s * L * 0.55);
    g.lineTo(view.x - s * L * 0.25, view.z - c * L * 0.25);
    g.lineTo(view.x - s * L * 0.6 - c * L * 0.55, view.z - c * L * 0.6 + s * L * 0.55);
    g.closePath();
    g.fillStyle = '#1d4fa8';
    g.fill();
    g.lineWidth = 1.4 * px * dpr;
    g.strokeStyle = '#fff';
    g.stroke();
    g.restore();

    // Rim and a north mark that travels round it.
    g.lineWidth = 3 * dpr;
    g.strokeStyle = '#6b4a24';
    g.beginPath();
    g.arc(r, r, r - 2 * dpr, 0, Math.PI * 2);
    g.stroke();
    const nx = r + Math.sin(view.yaw) * (r - 11 * dpr);
    const ny = r - Math.cos(view.yaw) * (r - 11 * dpr);
    g.fillStyle = '#6b4a24';
    g.beginPath();
    g.arc(nx, ny, 8 * dpr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f0d590';
    g.font = `bold ${11 * dpr}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', nx, ny + 0.5 * dpr);
  }

  get mapOpen() {
    return !this.mapEl.classList.contains('hidden');
  }

  // The whole kingdom, north up. view: { x, z, heading, places, people: [{ x, z, name }], finds: [{ x, z, title }] }
  showMap(view) {
    this._mapData = view;
    this.mapEl.classList.remove('hidden');
    this.mapZoomBtn.textContent = this.mapView === 0 ? 'Show the whole kingdom' : 'Show the town';
    const cv = this.mapCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.max(64, Math.round(cv.clientWidth * dpr));
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const half = this.mapHalf;
    const px = this.mapImage.width / (half * 2);
    const V = MAP_VIEWS[this.mapView];
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.mapImage, (V.x - V.half + half) * px, (V.z - V.half + half) * px, V.half * 2 * px, V.half * 2 * px, 0, 0, size, size);
    // Aged edges.
    const vg = g.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.72);
    vg.addColorStop(0, 'rgba(90,60,30,0)');
    vg.addColorStop(1, 'rgba(90,60,30,0.45)');
    g.fillStyle = vg;
    g.fillRect(0, 0, size, size);

    const pct = (v, c) => `${(((v - c + V.half) / (V.half * 2)) * 100).toFixed(2)}%`;
    const marks = [];
    const mark = (cls, x, z, text, name) => {
      const el = document.createElement('div');
      el.className = `mk ${cls}`;
      el.style.left = pct(x, V.x);
      el.style.top = pct(z, V.z);
      if (text) el.textContent = text;
      if (name) {
        const n = document.createElement('span');
        n.className = 'name';
        n.textContent = name;
        el.append(n);
      }
      marks.push(el);
      return el;
    };
    // On a small map (or the whole kingdom) only the larger places and no people are named,
    // or the town's labels pile up. Marks outside the view are left out.
    const roomy = cv.clientWidth >= 620 && this.mapView === 0;
    const inView = (x, z) => Math.abs(x - V.x) < V.half * 0.98 && Math.abs(z - V.z) < V.half * 0.98;
    for (const p of view.places) if ((roomy || p.size > 0) && inView(p.x, p.z)) mark(`place${p.size === 2 ? ' big' : ''}`, p.x, p.z, p.name);
    for (const f of view.finds) if (inView(f.x, f.z)) mark('dot find', f.x, f.z).title = f.title;
    for (const p of view.people) if (inView(p.x, p.z)) mark('dot person', p.x, p.z, null, roomy ? p.name : null).title = p.name;
    const you = mark('you', clamp(view.x, V.x - V.half, V.x + V.half), clamp(view.z, V.z - V.half, V.z + V.half));
    // Bearing of the facing direction (north = -z, east = +x).
    you.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(Math.sin(view.heading), -Math.cos(view.heading))}rad)`;
    this.mapMarks.replaceChildren(...marks);
  }

  hideMap() {
    this.mapEl.classList.add('hidden');
  }

  toast(text, ms = 2400) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  get debugVisible() {
    return !this.debugEl.classList.contains('hidden');
  }

  setDebugVisible(visible) {
    this.debugEl.classList.toggle('hidden', !visible);
  }

  setDebugText(text) {
    this.debugEl.textContent = text;
  }
}
