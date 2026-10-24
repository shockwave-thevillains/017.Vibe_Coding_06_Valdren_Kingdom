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
    this.swordBtn = $('btn-sword');
    this.flyBtn = $('btn-fly');
    this.jumpBtn = $('btn-jump');
    this.healthEl = $('health');
    this.healthBar = this.healthEl.querySelector('i');
    this.purseEl = $('purse-count');
    this.hurtEl = $('hurt');
    this.burstEl = $('burst');
    this.orbEls = [$('btn-orb'), $('skill')];
    this._orb = -1;
    this.boltEls = [$('btn-bolt'), $('skill2')];
    this._bolt = -1;
    this._health = -1;
    this._purse = -1;
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
    this.mapTip = $('map-tip');
    this.mapPlaces = $('map-places');
    this.bossEl = $('boss');
    this.bossName = this.bossEl.querySelector('.boss-name');
    this.bossBar = this.bossEl.querySelector('i');
    this._boss = '';
    this.waypointEl = $('waypoint');
    this.waypointDist = this.waypointEl.querySelector('.wp-dist');
    this.waypointArrow = this.waypointEl.querySelector('.wp-arrow');
    this._waypoint = '';
    this.compassMark = null;
    this.inspectEl = $('inspect');
    this.lookBtn = $('btn-look');
    this._look = null;
    this._inspectTimer = 0;
    // Clicking the full map sets the traveller's mark there, or clears it when clicked again.
    this.onMark = null;
    this.mapCanvas.addEventListener('click', (e) => this._clickMap(e));
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
    this.onMusic = null;
    this.musicEls = [...document.querySelectorAll('.music-volume')];
    for (const el of this.musicEls) {
      el.addEventListener('input', () => {
        const v = Number(el.value) / 100;
        this.setMusic(v);
        if (this.onMusic) this.onMusic(v);
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

  // The touch Sword button shows whether the sword is drawn.
  setSword(drawn) {
    this.swordBtn.classList.toggle('on', drawn);
    this.swordBtn.setAttribute('aria-pressed', drawn ? 'true' : 'false');
  }

  // In flight the touch Jump button climbs, a Down button appears and Fly becomes Land.
  setFlying(on) {
    this.body.classList.toggle('flying', on);
    this.jumpBtn.textContent = on ? 'Up' : 'Jump';
    this.flyBtn.textContent = on ? 'Land' : 'Fly';
    this.flyBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  // fraction: 0..1 of full health.
  setHealth(fraction) {
    const pct = Math.round(fraction * 100);
    if (pct === this._health) return;
    this._health = pct;
    this.healthBar.style.width = `${pct}%`;
    this.healthEl.classList.toggle('low', pct <= 30);
    this.healthEl.setAttribute('aria-valuenow', String(pct));
  }

  setPurse(coins) {
    if (coins === this._purse) return;
    const more = this._purse >= 0 && coins > this._purse;
    this._purse = coins;
    this.purseEl.textContent = String(coins);
    if (more) {
      this.purseEl.parentElement.classList.remove('gain');
      void this.purseEl.offsetWidth;
      this.purseEl.parentElement.classList.add('gain');
    }
  }

  // How ready the Rasengan is (0..1), on its touch button and the desktop HUD.
  setOrb(ready) {
    const v = Math.round(ready * 40) / 40;
    if (v === this._orb) return;
    this._orb = v;
    for (const el of this.orbEls) {
      el.style.setProperty('--ready', String(v));
      el.classList.toggle('cooling', v < 1);
    }
  }

  // The touch Look button shows while someone is close enough to look over.
  setLook(on) {
    if (on === this._look) return;
    this._look = on;
    this.lookBtn.classList.toggle('near', on);
  }

  /*
   * What the traveller sees looking someone over: their looks, then how they fit each
   * description known (a wanted notice, or what a witness saw), detail by detail.
   * result: from Quests.inspect.
   */
  showInspect(npc, result) {
    const el = this.inspectEl;
    const t = result.traits;
    const make = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text });
    const parts = [make('h4', '', `You look ${npc.name} over`), make('p', 'ins-role', npc.role)];
    const looks = [t.sex === t.age ? t.sex : `${t.sex}, ${t.age}`, t.build === 'big' ? 'big-built' : null, t.hair, t.beard !== 'no beard' ? t.beard : null, t.head, t.cloak !== 'no cloak' ? t.cloak : null, t.scar !== 'no scar' ? t.scar : null].filter(Boolean);
    parts.push(make('p', 'ins-looks', looks.join(' · ')));
    if (!result.known) {
      parts.push(make('p', 'ins-none', 'You have no description to compare them with yet. Read the wanted notices in your journal (Bounties), or take a case at the Wardens’ Guild.'));
    } else if (!result.fits.length) {
      parts.push(make('p', 'ins-none', 'They fit none of your descriptions.'));
    }
    for (const f of result.fits) {
      const box = document.createElement('div');
      box.className = `ins-fit${f.full ? ' full' : ''}`;
      box.append(make('b', '', `${f.c.title}: ${f.hits} of ${f.total}`));
      const ul = document.createElement('ul');
      for (const r of f.rows) {
        const li = make('li', r.ok ? 'ok' : 'no', r.ok ? r.want : `${r.want}? No: ${r.have}`);
        li.prepend(make('span', 'tick', r.ok ? '✓ ' : '✗ '));
        ul.append(li);
      }
      box.append(ul);
      if (f.full) box.append(make('p', 'ins-verdict', result.found === f.c ? 'It’s them! Talk to them and name them to their face.' : 'Every detail fits.'));
      else if (f.hits >= f.total - 1) box.append(make('p', 'ins-verdict near', 'Close, but not quite. A lookalike?'));
      parts.push(box);
    }
    el.replaceChildren(...parts);
    el.classList.toggle('found', !!result.found);
    el.classList.remove('hidden');
    clearTimeout(this._inspectTimer);
    this._inspectTimer = setTimeout(() => this.hideInspect(), 12000);
  }

  hideInspect() {
    clearTimeout(this._inspectTimer);
    this.inspectEl.classList.add('hidden');
  }

  // How ready the Chidori is (0..1), the same way.
  setChidori(ready) {
    const v = Math.round(ready * 40) / 40;
    if (v === this._bolt) return;
    this._bolt = v;
    for (const el of this.boltEls) {
      el.style.setProperty('--ready', String(v));
      el.classList.toggle('cooling', v < 1);
    }
  }

  // The health of the monster in charge (the cave troll) at the top of the screen; null hides it.
  setBoss(boss) {
    const key = boss ? `${boss.name}:${Math.round(boss.fraction * 100)}` : '';
    if (key === this._boss) return;
    this._boss = key;
    this.bossEl.classList.toggle('hidden', !boss);
    this.body.classList.toggle('boss', !!boss);
    if (!boss) return;
    this.bossName.textContent = boss.name;
    this.bossBar.style.width = `${Math.round(boss.fraction * 100)}%`;
  }

  // A blue-white flash as a Rasengan bursts (or a Chidori strikes: kind 'lightning').
  flashBurst(kind = null) {
    const el = this.burstEl;
    el.classList.remove('on', 'lightning');
    void el.offsetWidth;
    el.classList.add('on');
    if (kind) el.classList.add(kind);
  }

  // A red pulse round the screen edge when the traveller is struck.
  flashHurt() {
    const el = this.hurtEl;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
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
  setPrompt(name, touch, verb = 'Talk to', look = false) {
    const key = name ? `${touch ? 't' : 'k'}:${verb}:${name}:${look}` : null;
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
      if (look) this.promptEl.append(Object.assign(document.createElement('span'), { className: 'look-hint' }), Object.assign(document.createElement('kbd'), { textContent: 'T' }), ' Look closely');
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
        el._say = document.createElement('div');
        el._say.className = 'say';
        el._say.hidden = true;
        el._hp = document.createElement('div');
        el._hp.className = 'hp';
        el._hp.hidden = true;
        el._bar = document.createElement('i');
        el._hp.append(el._bar);
        const name = document.createElement('span');
        name.textContent = l.text;
        el._tag = document.createElement('b');
        el._tag.className = 'tag';
        el._tag.hidden = true;
        el.append(el._say, el._tag, name, el._hp);
        this.labelsEl.append(el);
        this._labels.set(l.id, el);
      }
      seen.add(l.id);
      // What they are saying, in a bubble over the name; a health bar once hurt.
      if (el._sayText !== l.say) {
        el._sayText = l.say;
        el._say.textContent = l.say || '';
        el._say.hidden = !l.say;
      }
      if (el._tagText !== l.tag) {
        el._tagText = l.tag;
        el._tag.textContent = l.tag || '';
        el._tag.hidden = !l.tag;
        el.classList.toggle('wanted', !!l.tag);
      }
      el._hp.hidden = l.health === null || l.health === undefined;
      if (!el._hp.hidden) {
        el._bar.style.width = `${Math.round(l.health * 100)}%`;
        el._bar.style.background = l.health > 0.5 ? '#c9a14a' : l.health > 0.25 ? '#d0702a' : '#c0392b';
      }
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
    // The mark's bearing, a pin riding along the strip.
    this.compassMark = document.createElement('span');
    this.compassMark.className = 'compass-mark';
    this.compassMark.hidden = true;
    strip.append(this.compassMark);
  }

  // Shows where the mark lies on the compass: bearing in degrees (null hides it).
  setCompassMark(bearing, cameraBearing) {
    const el = this.compassMark;
    if (bearing === null) {
      el.hidden = true;
      return;
    }
    const off = ((((bearing - cameraBearing) % 360) + 540) % 360) - 180;
    const half = this.compassStrip.clientWidth / 2;
    const x = Math.max(-half + 8, Math.min(half - 8, off * COMPASS_PX_PER_DEG));
    el.hidden = false;
    el.classList.toggle('edge', Math.abs(off * COMPASS_PX_PER_DEG) > half - 8);
    el.style.transform = `translateX(${(half + x).toFixed(1)}px) translateX(-50%)`;
  }

  /*
   * The on-screen pointer to the mark: at (x, y) in pixels when it is in view, or
   * pinned to the screen's edge and pointing (angle, radians clockwise from up) when
   * it is not. null hides it.
   */
  updateWaypoint(w) {
    const el = this.waypointEl;
    if (!w) {
      if (this._waypoint !== '') {
        this._waypoint = '';
        el.classList.add('hidden');
      }
      return;
    }
    if (this._waypoint === '') el.classList.remove('hidden');
    const dist = w.distance >= 1000 ? `${(w.distance / 1000).toFixed(1)} km` : `${Math.round(w.distance)} m`;
    const text = w.label ? `${w.label} · ${dist}` : dist;
    if (text !== this._waypoint) {
      el.classList.toggle('guide', !!w.label);
      this._waypoint = text;
      this.waypointDist.textContent = text;
    }
    el.classList.toggle('off', !w.onScreen);
    el.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px) translate(-50%, ${w.onScreen ? -100 : -50}%)`;
    if (!w.onScreen) this.waypointArrow.style.transform = `rotate(${w.angle.toFixed(3)}rad)`;
  }

  // A click on the full map: the world point under it, handed to onMark.
  _clickMap(e) {
    if (!this._mapData || !this.onMark) return;
    const rect = this.mapCanvas.getBoundingClientRect();
    const V = MAP_VIEWS[this.mapView];
    const x = V.x - V.half + ((e.clientX - rect.left) / rect.width) * V.half * 2;
    const z = V.z - V.half + ((e.clientY - rect.top) / rect.height) * V.half * 2;
    const mark = this._mapData.mark;
    // Clicking on (or right by) the mark clears it.
    const near = mark && Math.hypot(mark.x - x, mark.z - z) < V.half * 0.035;
    this.onMark(near ? null : { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
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
   * view: { x, z, heading, yaw, people: [{ x, z, met, foe }], finds: [{ x, z }], home: { x, z }, mark: { x, z },
   *         shops: [{ x, z, icon }], map: { image, half, cx, cz } to show another plan (the mine's) }
   */
  drawMinimap(view) {
    const el = this.miniEl;
    if (!this.mapImage || !el.clientWidth) return;
    const plan = view.map || { image: this.mapImage, half: this.mapHalf, cx: 0, cz: 0 };
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
    g.drawImage(plan.image, plan.cx - plan.half, plan.cz - plan.half, plan.half * 2, plan.half * 2);
    const px = 1 / scale;
    if (view.home) {
      // The traveller's cottage: a little house, kept upright.
      const k = 5 * px * dpr;
      g.save();
      g.translate(view.home.x, view.home.z);
      g.rotate(-view.yaw);
      g.beginPath();
      g.moveTo(0, -k * 1.1);
      g.lineTo(k, -k * 0.1);
      g.lineTo(k * 0.7, -k * 0.1);
      g.lineTo(k * 0.7, k);
      g.lineTo(-k * 0.7, k);
      g.lineTo(-k * 0.7, -k * 0.1);
      g.lineTo(-k, -k * 0.1);
      g.closePath();
      g.fillStyle = '#2f6a3a';
      g.fill();
      g.lineWidth = 1.2 * px * dpr;
      g.strokeStyle = '#f2e6c4';
      g.stroke();
      g.restore();
    }
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
      g.fillStyle = p.foe ? '#d0392b' : p.met ? '#e8c066' : '#9a9080';
      g.fill();
      g.lineWidth = 1.2 * px * dpr;
      g.strokeStyle = '#2e2014';
      g.stroke();
    }
    if (view.mark) {
      // The mark: a red pin, held at the rim when it lies farther away.
      const dx = view.mark.x - view.x;
      const dz = view.mark.z - view.z;
      const d = Math.hypot(dx, dz);
      const k = d > MINIMAP_RADIUS - 6 ? (MINIMAP_RADIUS - 6) / d : 1;
      g.save();
      g.translate(view.x + dx * k, view.z + dz * k);
      g.rotate(-view.yaw);
      const u = px * dpr;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, -9 * u, 5 * u, Math.PI * 0.82, Math.PI * 0.18);
      g.closePath();
      g.fillStyle = '#c0392b';
      g.fill();
      g.lineWidth = 1.3 * u;
      g.strokeStyle = '#fff4d6';
      g.stroke();
      g.beginPath();
      g.arc(0, -9 * u, 1.8 * u, 0, Math.PI * 2);
      g.fillStyle = '#fff4d6';
      g.fill();
      g.restore();
    }
    // Places to eat and shop, drawn upright in screen space.
    if (view.shops && view.shops.length) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      const cy = Math.cos(view.yaw);
      const sy = Math.sin(view.yaw);
      for (const shop of view.shops) {
        const dx = (shop.x - view.x) * scale;
        const dz = (shop.z - view.z) * scale;
        const sx = r + dx * cy - dz * sy;
        const szz = r + dx * sy + dz * cy;
        if (Math.hypot(sx - r, szz - r) > r - 9 * dpr) continue;
        // Dungeons stand out: bigger, on a red disc.
        const size = (shop.dungeon ? 20 : 16) * dpr;
        if (shop.dungeon) {
          g.fillStyle = 'rgba(176, 32, 28, 0.85)';
          g.beginPath();
          g.arc(sx, szz, size * 0.62, 0, Math.PI * 2);
          g.fill();
        }
        g.drawImage(this._iconSprite(shop.icon), sx - size / 2, szz - size / 2, size, size);
      }
      g.restore();
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

  // A shop's icon on a pale disc, drawn once and then copied (text is slow to draw).
  _iconSprite(icon) {
    this._icons = this._icons || new Map();
    let c = this._icons.get(icon);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255, 248, 225, 0.88)';
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    g.font = '20px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, 16, 17);
    this._icons.set(icon, c);
    return c;
  }

  get mapOpen() {
    return !this.mapEl.classList.contains('hidden');
  }

  // The whole kingdom, north up. view: { x, z, heading, places, people: [{ x, z, name }],
  // finds: [{ x, z, title }], home: { x, z, name }, mark: { x, z } or null, touch }
  showMap(view) {
    this._mapData = view;
    this.mapEl.classList.remove('hidden');
    this.mapZoomBtn.textContent = this.mapView === 0 ? 'Show the whole kingdom' : 'Show the town';
    const tap = view.touch ? 'Tap' : 'Click';
    this.mapTip.textContent = view.mark ? `${tap} the map to move your mark, or on it to clear it.` : `${tap} the map to set a mark and follow its pointer.`;
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
    if (view.home && inView(view.home.x, view.home.z)) mark('home', view.home.x, view.home.z, null, view.home.name).title = view.home.name;
    for (const f of view.finds) if (inView(f.x, f.z)) mark('dot find', f.x, f.z).title = f.title;
    for (const p of view.people) if (inView(p.x, p.z)) mark('dot person', p.x, p.z, null, roomy ? p.name : null).title = p.name;
    for (const shop of view.shops || []) {
      if (!inView(shop.x, shop.z)) continue;
      // Dungeons are always named, however small the map.
      mark(shop.dungeon ? 'shop dungeon' : shop.wanted ? 'shop wanted' : 'shop', shop.x, shop.z, shop.icon, roomy || shop.dungeon || shop.wanted ? shop.name : null).title = `${shop.name}: ${shop.sells}`;
    }
    if (view.mark && inView(view.mark.x, view.mark.z)) mark('pin', view.mark.x, view.mark.z, null, view.mark.label || 'Your mark');
    const you = mark('you', clamp(view.x, V.x - V.half, V.x + V.half), clamp(view.z, V.z - V.half, V.z + V.half));
    // Bearing of the facing direction (north = -z, east = +x).
    you.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(Math.sin(view.heading), -Math.cos(view.heading))}rad)`;
    this.mapMarks.replaceChildren(...marks);
    this._placesList(view);
  }

  // Beside the map: every place to eat or shop; picking one marks it.
  _placesList(view) {
    const items = [];
    const sorted = [...(view.shops || [])].sort((a, b) => (!!b.wanted - !!a.wanted) || (!!b.place - !!a.place) || (!!b.food - !!a.food) || a.where.localeCompare(b.where));
    for (const shop of sorted) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const marked = view.mark && Math.hypot(view.mark.x - shop.x, view.mark.z - shop.z) < 1;
      btn.className = `${marked ? 'marked' : ''}${shop.dungeon ? ' dungeon' : ''}${shop.wanted ? ' wanted' : ''}`;
      const icon = Object.assign(document.createElement('span'), { className: 'pl-icon', textContent: shop.icon });
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'pl-text';
      text.append(Object.assign(document.createElement('b'), { textContent: shop.name }), Object.assign(document.createElement('span'), { textContent: `${shop.where} · ${shop.sells}` }));
      btn.append(icon, text);
      btn.addEventListener('click', () => {
        if (this.onMark) this.onMark({ x: shop.x, z: shop.z }, shop.name);
      });
      li.append(btn);
      items.push(li);
    }
    this.mapPlaces.replaceChildren(...items);
  }

  hideMap() {
    this.mapEl.classList.add('hidden');
  }

  // Shows the music volume (0..1) on every slider.
  setMusic(v) {
    const pct = Math.round(v * 100);
    for (const el of this.musicEls) {
      el.value = String(pct);
      el.parentElement.querySelector('.music-value').textContent = pct ? `${pct}%` : 'Off';
    }
  }

  // Fades the screen to black (on) or back; resolves when the fade has finished.
  fade(on, text = '') {
    const el = document.getElementById('fade');
    if (on) el.querySelector('.fade-text').textContent = text;
    el.classList.toggle('on', on);
    return new Promise((resolve) => setTimeout(resolve, 1500));
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
