/*
 * input.js: keyboard, mouse (pointer lock with a drag fallback), touch
 * joystick and look area, and the on-screen buttons. Everything is reduced to
 * a movement vector, accumulated look/zoom deltas, and named action events.
 *
 * Events emitted: interact, journal, map, lantern, jump, fly, attack, sword, rasengan, pause,
 * debug, lockchange, lockerror, touchmode.
 */

const MOVE_KEYS = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const ACTION_KEYS = {
  KeyE: 'interact',
  KeyJ: 'journal',
  KeyM: 'map',
  KeyF: 'lantern',
  Space: 'jump',
  KeyG: 'fly',
  KeyQ: 'attack',
  KeyR: 'sword',
  KeyV: 'rasengan',
  Escape: 'pause',
  Backquote: 'debug',
  F3: 'debug',
};

const JOY_RADIUS = 56;       // px the knob can travel
const JOY_BASE_HALF = 60;    // half the base element size in px
const JOY_DEADZONE = 0.12;
const JOY_RUN = 0.92;        // push past this to run
const MOVE_ZONE = 0.45;      // left share of the screen that spawns the joystick
const MAX_LOOK_STEP = 300;   // px; ignores the occasional pointer-lock spike

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.active = false;            // true only while the game is being played
    this.touchMode = window.matchMedia('(pointer: coarse)').matches;
    this.pointerLocked = false;
    this.mouseSensitivity = 0.0022; // rad per px
    this.touchSensitivity = 0.0055;

    this._listeners = new Map();
    this._keys = new Set();
    this._held = new Set(); // on-screen buttons being held down
    this._look = { yaw: 0, pitch: 0 };
    this._zoom = 0;
    this._move = { x: 0, y: 0, magnitude: 0, run: false };
    this._joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this._lookTouch = { id: null, x: 0, y: 0 };
    this._drag = { active: false, id: null, x: 0, y: 0 };
    this._lockLostAt = -Infinity;
    this._lockedAt = -Infinity;
    this._skipLockedMoves = 0;

    this._joyBase = document.getElementById('joy-base');
    this._joyKnob = document.getElementById('joy-knob');

    this._bindKeyboard();
    this._bindPointer();
    this._bindButtons();
    this._bindLifecycle();
  }

  // ------------------------------------------------------------- events

  on(name, fn) {
    if (!this._listeners.has(name)) this._listeners.set(name, new Set());
    this._listeners.get(name).add(fn);
    return () => this._listeners.get(name).delete(fn);
  }

  emit(name, detail) {
    const set = this._listeners.get(name);
    if (set) for (const fn of set) fn(detail);
  }

  // ------------------------------------------------------------- polling

  // Movement intent: x = strafe right, y = forward, both scaled by magnitude (0..1).
  getMove() {
    const m = this._move;
    let x = 0;
    let y = 0;
    let run = false;
    if (this.active) {
      for (const code of this._keys) {
        const v = MOVE_KEYS[code];
        if (v) {
          x += v[0];
          y += v[1];
        }
      }
      run = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight');
    }
    // Climbing and descending in flight: Space and C, or the held Jump and Down buttons.
    m.up = this.active && (this._keys.has('Space') || this._held.has('jump'));
    m.down = this.active && (this._keys.has('KeyC') || this._held.has('down'));
    let magnitude = Math.hypot(x, y);
    if (magnitude > 0) {
      x /= magnitude;
      y /= magnitude;
      magnitude = 1;
    }

    const j = this._joy;
    if (this.active && j.id !== null) {
      const jm = Math.hypot(j.x, j.y);
      if (jm > JOY_DEADZONE) {
        const scaled = Math.min(1, (jm - JOY_DEADZONE) / (1 - JOY_DEADZONE));
        x = (j.x / jm) * scaled;
        y = (j.y / jm) * scaled;
        magnitude = scaled;
        run = jm >= JOY_RUN;
      }
    }

    m.x = x;
    m.y = y;
    m.magnitude = magnitude;
    m.run = run && magnitude > 0;
    return m;
  }

  // Copies the look delta (radians) accumulated since the last call into out and clears it.
  consumeLook(out) {
    out.yaw = this._look.yaw;
    out.pitch = this._look.pitch;
    this._look.yaw = 0;
    this._look.pitch = 0;
    return out;
  }

  consumeZoom() {
    const z = this._zoom;
    this._zoom = 0;
    return z;
  }

  // ------------------------------------------------------- pointer lock

  requestPointerLock() {
    if (this.touchMode || this.pointerLocked || !this.canvas.requestPointerLock) return;
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Not allowed here (e.g. sandboxed iframe); mouse drag still works.
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.canvas && document.exitPointerLock) document.exitPointerLock();
  }

  setTouchMode(on) {
    if (this.touchMode === on) return;
    this.touchMode = on;
    if (on) this.exitPointerLock();
    this.emit('touchmode', on);
  }

  // Drops every held key and touch, e.g. when the window loses focus.
  reset() {
    this._keys.clear();
    this._held.clear();
    this._releaseJoy();
    this._lookTouch.id = null;
    this._drag.active = false;
    this._look.yaw = 0;
    this._look.pitch = 0;
    this._zoom = 0;
  }

  // ------------------------------------------------------------ binding

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (MOVE_KEYS[code] || RUN_KEYS.has(code) || code === 'Space' || code === 'KeyC') {
        this._keys.add(code);
        if (code.startsWith('Arrow') || (code === 'Space' && this.active)) e.preventDefault();
      }
      const action = ACTION_KEYS[code];
      if (!action || e.repeat) return;
      if (code === 'F3') e.preventDefault();
      // The Esc press that released pointer lock has already paused the game.
      if (action === 'pause' && performance.now() - this._lockLostAt < 500) return;
      this.emit(action, { source: 'keyboard' });
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
    });
  }

  _bindPointer() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    c.addEventListener('pointermove', (e) => this._onPointerMove(e));
    c.addEventListener('pointerup', (e) => this._onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this._onPointerUp(e));
    c.addEventListener('lostpointercapture', (e) => this._onPointerUp(e));
    c.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        this._zoom += clamp(px, -200, 200) * 0.0012;
      },
      { passive: false },
    );

    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.pointerLocked) return;
      // Browsers may report the cursor re-centring as one huge movement just after locking,
      // sometimes several frames late on a busy main thread.
      if (this._skipLockedMoves > 0) {
        this._skipLockedMoves--;
        return;
      }
      if (performance.now() - this._lockedAt < 400 && Math.abs(e.movementX) + Math.abs(e.movementY) > 200) return;
      this._addLook(e.movementX, e.movementY, this.mouseSensitivity);
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === c;
      if (this.pointerLocked && !locked) this._lockLostAt = performance.now();
      if (!this.pointerLocked && locked) {
        this._lockedAt = performance.now();
        this._skipLockedMoves = 1;
      }
      this.pointerLocked = locked;
      this.emit('lockchange', locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.emit('lockerror');
    });
    // Stop iOS Safari from pinch-zooming the page.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  _bindButtons() {
    document.querySelectorAll('[data-action]').forEach((btn) => {
      const release = () => btn.classList.remove('pressed');
      const action = btn.dataset.action;
      const up = () => {
        release();
        this._held.delete(action);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('pressed');
        this._held.add(action);
        this.emit(action, { source: 'button' });
      });
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('click', (e) => e.preventDefault());
    });
  }

  _bindLifecycle() {
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.reset();
    });
  }

  // ----------------------------------------------------------- pointers

  _onPointerDown(e) {
    if (e.pointerType === 'mouse') {
      if (this.touchMode) this.setTouchMode(false);
      if (!this.active) return;
      // With the mouse captured, a left click is a blow and a right click the Rasengan.
      if (this.pointerLocked && (e.button === 0 || e.button === 2)) {
        this.emit(e.button === 0 ? 'attack' : 'rasengan', { source: 'mouse' });
        return;
      }
      if (!this.pointerLocked) {
        this.requestPointerLock();
        this._drag.active = true;
        this._drag.id = e.pointerId;
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
      }
      return;
    }

    // Touch or pen.
    if (!this.touchMode) this.setTouchMode(true);
    if (!this.active) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; moves are still tracked by pointer id.
    }
    if (e.clientX < window.innerWidth * MOVE_ZONE && this._joy.id === null) {
      this._startJoy(e.pointerId, e.clientX, e.clientY);
    } else if (this._lookTouch.id === null) {
      this._lookTouch.id = e.pointerId;
      this._lookTouch.x = e.clientX;
      this._lookTouch.y = e.clientY;
    }
  }

  _onPointerMove(e) {
    if (e.pointerType === 'mouse') {
      const d = this._drag;
      if (d.active && this.active && !this.pointerLocked) {
        this._addLook(e.clientX - d.x, e.clientY - d.y, this.mouseSensitivity * 1.4);
      }
      d.x = e.clientX;
      d.y = e.clientY;
      return;
    }
    if (e.pointerId === this._joy.id) {
      this._updateJoy(e.clientX, e.clientY);
    } else if (e.pointerId === this._lookTouch.id) {
      const t = this._lookTouch;
      if (this.active) this._addLook(e.clientX - t.x, e.clientY - t.y, this.touchSensitivity);
      t.x = e.clientX;
      t.y = e.clientY;
    }
  }

  _onPointerUp(e) {
    if (e.pointerType === 'mouse') {
      if (e.pointerId === this._drag.id) this._drag.active = false;
      return;
    }
    if (e.pointerId === this._joy.id) this._releaseJoy();
    if (e.pointerId === this._lookTouch.id) this._lookTouch.id = null;
  }

  _addLook(dx, dy, sensitivity) {
    this._look.yaw -= clamp(dx, -MAX_LOOK_STEP, MAX_LOOK_STEP) * sensitivity;
    this._look.pitch += clamp(dy, -MAX_LOOK_STEP, MAX_LOOK_STEP) * sensitivity;
  }

  // ------------------------------------------------------------ joystick

  _startJoy(id, x, y) {
    const j = this._joy;
    j.id = id;
    j.ox = x;
    j.oy = y;
    j.x = 0;
    j.y = 0;
    if (this._joyBase) {
      this._joyBase.classList.add('active');
      this._joyBase.style.left = `${x - JOY_BASE_HALF}px`;
      this._joyBase.style.top = `${y - JOY_BASE_HALF}px`;
      this._joyBase.style.bottom = 'auto';
    }
    this._setKnob(0, 0);
  }

  _updateJoy(x, y) {
    const j = this._joy;
    let dx = x - j.ox;
    let dy = y - j.oy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) {
      dx *= JOY_RADIUS / d;
      dy *= JOY_RADIUS / d;
    }
    j.x = dx / JOY_RADIUS;
    j.y = -dy / JOY_RADIUS;
    this._setKnob(dx, dy);
  }

  _releaseJoy() {
    const j = this._joy;
    j.id = null;
    j.x = 0;
    j.y = 0;
    if (this._joyBase) {
      this._joyBase.classList.remove('active');
      this._joyBase.style.left = '';
      this._joyBase.style.top = '';
      this._joyBase.style.bottom = '';
    }
    this._setKnob(0, 0);
  }

  _setKnob(dx, dy) {
    if (this._joyKnob) this._joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
