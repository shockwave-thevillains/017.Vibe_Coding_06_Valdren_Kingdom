/*
 * music.js: the kingdom's music, played live with the Web Audio API; there are no
 * recordings. A drone, a plucked lute or harp, a recorder and a frame drum play
 * through a small hall reverb. The tunes are made up as they play, from a mode, a
 * chord progression and a motif that comes back, so they never quite repeat:
 *   day    a gentle dance in D dorian, recorder over a lute
 *   night  a slow harp air in A aeolian over a soft drone
 *   inn    a jig in G mixolydian with a frame drum, inside the Broken Oar and the Millstone
 * After two or three phrases a piece ends and the music rests for a while.
 *
 * Browsers only allow sound after the player has clicked or tapped, so start()
 * is called from the Begin button.
 */

const LOOKAHEAD = 0.35; // seconds of music scheduled ahead of the clock

// root: MIDI note of degree 0; mode: semitones of the seven degrees; bar: eighths per
// bar; tempo: eighths per minute; chords: one triad of scale degrees per bar of an
// eight-bar phrase; arp: which chord tone the accompaniment plucks on each eighth (-1: none).
const THEMES = {
  day: {
    root: 62, mode: [0, 2, 3, 5, 7, 9, 10], bar: 6, tempo: 176,
    chords: [[0, 2, 4], [6, 1, 3], [0, 2, 4], [3, 5, 0], [0, 2, 4], [4, 6, 1], [6, 1, 3], [0, 2, 4]],
    arp: [0, 2, 1, 2, 1, 2],
    rhythms: [[2, 1, 1, 2], [3, 1, 2], [2, 2, 2], [1, 1, 2, 2], [4, 2], [2, 1, 1, 1, 1]],
    cadence: [2, 4],
    range: [0, 9], start: 4, rests: 0.08,
    melody: 'flute', melOct: 1, accOct: 0, accLen: 1.2, accVel: 0.055, accTone: 2600,
    drone: 0.03, drum: [[0, 0.45, true], [4, 0.2, false]],
  },
  night: {
    root: 57, mode: [0, 2, 3, 5, 7, 8, 10], bar: 8, tempo: 116,
    chords: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3], [0, 2, 4], [3, 5, 0], [5, 0, 2], [0, 2, 4]],
    arp: [0, -1, 1, -1, 2, -1, 1, -1],
    rhythms: [[4, 4], [3, 1, 4], [2, 2, 4], [6, 2], [8], [2, 2, 2, 2]],
    cadence: [4, 4],
    range: [2, 11], start: 7, rests: 0.18,
    melody: 'harp', melOct: 1, accOct: 0, accLen: 2.6, accVel: 0.05, accTone: 1600,
    drone: 0.026, drum: [],
  },
  inn: {
    root: 67, mode: [0, 2, 4, 5, 7, 9, 10], bar: 6, tempo: 300,
    chords: [[0, 2, 4], [6, 1, 3], [0, 2, 4], [4, 6, 1], [0, 2, 4], [3, 5, 0], [6, 1, 3], [0, 2, 4]],
    arp: [0, -1, 1, 0, -1, 2],
    rhythms: [[1, 1, 1, 1, 1, 1], [2, 1, 2, 1], [3, 1, 1, 1], [1, 1, 1, 3], [2, 1, 1, 1, 1]],
    cadence: [3, 3],
    range: [0, 9], start: 4, rests: 0.04,
    melody: 'flute', melOct: 0, accOct: -1, accLen: 0.7, accVel: 0.06, accTone: 3200,
    drone: 0.03, drum: [[0, 0.6, true], [3, 0.4, false], [2, 0.18, 'jingle'], [5, 0.18, 'jingle']],
  },
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Music {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.want = 'day';
    this._hushed = false;
    this._ducked = false;
    this._piece = null;
    this._restUntil = 0;
    this._next = 0;
    this._timer = 0;
  }

  // Creates the sound graph; must be called from a click, tap or key press.
  start() {
    if (this.ctx) {
      this.wake();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let c;
    try {
      c = new AC();
    } catch {
      return;
    }
    this._build(c);
    this.master.gain.setTargetAtTime(this._level(), c.currentTime, 0.5);
    this._next = c.currentTime + 0.3;
    // A moment of quiet before the first tune.
    this._restUntil = c.currentTime + 2;
    this._timer = setInterval(() => this._tick(), 60);
  }

  // The mix: instruments into a dry bus and a reverb send, then a gentle compressor.
  // (Also used with an OfflineAudioContext to render music without playing it.)
  _build(c) {
    this.ctx = c;
    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(c.destination);
    this.dry = c.createGain();
    this.dry.connect(this.master);
    const reverb = c.createConvolver();
    reverb.buffer = this._impulse(2.6);
    this.send = c.createGain();
    this.send.gain.value = 0.32;
    this.send.connect(reverb).connect(this.master);
    this.noise = this._noiseBuffer();
  }

  // Resumes after the browser suspended the sound (a hidden tab, a phone call).
  wake() {
    if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {});
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  // 0..1; 0 stops making music altogether.
  setVolume(v) {
    this.volume = v;
    this._applyLevel(0.25);
  }

  // Which music fits where the traveller is: 'day', 'night' or 'inn'.
  setScene(scene) {
    this.want = scene;
  }

  // Quieter while the game is paused.
  duck(on) {
    this._ducked = on;
    this._applyLevel(0.3);
  }

  // Silence while the traveller sleeps; a new tune begins on waking.
  hush(on) {
    this._hushed = on;
    this._applyLevel(on ? 0.4 : 0.2);
    if (!this.ctx) return;
    if (on) this._endPiece(this.ctx.currentTime + 1.5, 0);
    else this._restUntil = this.ctx.currentTime + 1;
  }

  _level() {
    return this.volume * (this._hushed ? 0 : 1) * (this._ducked ? 0.4 : 1) * 1.6;
  }

  _applyLevel(tc) {
    if (this.ctx) this.master.gain.setTargetAtTime(this._level(), this.ctx.currentTime, tc);
  }

  // ------------------------------------------------------------ composing

  _tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    // After a stall (a busy tab) start again from now rather than catching up.
    if (this._next < now) this._next = now + 0.05;
    while (this._next < now + LOOKAHEAD) {
      if (!this._piece) {
        if (now < this._restUntil || this.volume <= 0 || this._hushed) return;
        this._startPiece(this._next);
      }
      this._next += this._playBar(this._next);
    }
  }

  _startPiece(t) {
    const th = THEMES[this.want];
    this._piece = { theme: this.want, th, bar: 0, phrases: 2 + Math.floor(Math.random() * 2), prev: th.start, motif: [], drone: this._drone(th, t) };
  }

  // Lets the drone die away and rests `rest` seconds before the next piece.
  _endPiece(t, rest) {
    const p = this._piece;
    if (!p) return;
    this._piece = null;
    this._restUntil = t + rest;
    if (p.drone) {
      p.drone.gain.gain.cancelScheduledValues(t);
      p.drone.gain.gain.setTargetAtTime(0, t, 0.8);
      for (const o of p.drone.oscs) o.stop(t + 4);
    }
  }

  // Schedules one bar starting at t and returns its length in seconds.
  _playBar(t) {
    const p = this._piece;
    const th = p.th;
    const inPhrase = p.bar % 8;
    // Moving into or out of an inn changes the music at once; day and night at a phrase's end.
    if (this.want !== p.theme && (this.want === 'inn' || p.theme === 'inn' || inPhrase === 0)) {
      this._endPiece(t, this.want === 'inn' || p.theme === 'inn' ? 0.6 : 3);
      return 0;
    }
    if (p.bar >= p.phrases * 8) {
      this._endPiece(t, 12 + Math.random() * 16);
      return 0;
    }
    const e = 60 / th.tempo;
    const chord = th.chords[inPhrase];
    const jitter = () => (Math.random() - 0.5) * 0.012;

    // Accompaniment: a bass note on the downbeat and the chord broken across the bar.
    this._pluck(t, this._freq(th, chord[0], th.accOct - 1), th.accLen * 1.5, th.accVel * 1.2, th.accTone * 0.5);
    th.arp.forEach((ci, k) => {
      if (ci < 0) return;
      const vel = th.accVel * (k === 0 ? 1 : 0.75) * (0.85 + Math.random() * 0.3);
      this._pluck(t + k * e + jitter(), this._freq(th, chord[ci], th.accOct), th.accLen, vel, th.accTone);
    });

    // Drums.
    for (const [at, vel, low] of th.drum) {
      if (p.bar < 2 && th !== THEMES.inn) continue;
      if (low === 'jingle') this._jingle(t + at * e + jitter(), vel * 0.5);
      else this._drum(t + at * e + jitter(), vel * (0.8 + Math.random() * 0.3), low);
    }

    // Melody, after a two-bar introduction.
    if (p.bar >= 2) {
      for (const n of this._melodyBar(p, chord, inPhrase)) {
        const f = this._freq(th, n.deg, th.melOct);
        const at = t + n.at * e + jitter();
        const len = n.len * e;
        if (th.melody === 'harp') this._pluck(at, f, Math.max(1.6, len * 2), 0.085 * (0.85 + Math.random() * 0.3), 2200, 0.45);
        else this._flute(at, f, len * 0.94, 0.1 * (0.85 + Math.random() * 0.25));
      }
    }
    p.bar++;
    return th.bar * e;
  }

  // Bars 0-1 and 4-5 of every phrase carry the piece's motif; the others are new.
  _melodyBar(p, chord, inPhrase) {
    const slot = inPhrase < 2 ? inPhrase : inPhrase === 4 || inPhrase === 5 ? inPhrase - 4 : -1;
    if (slot >= 0 && p.motif[slot]) return p.motif[slot];
    const notes = this._newBar(p, chord, inPhrase === 7);
    if (slot >= 0) p.motif[slot] = notes;
    return notes;
  }

  // A bar of melody: chord tones on the downbeat, steps between, and the tonic to end a phrase.
  _newBar(p, chord, cadence) {
    const th = p.th;
    const [lo, hi] = th.range;
    const rhythm = cadence ? th.cadence : pick(th.rhythms);
    const notes = [];
    let at = 0;
    rhythm.forEach((len, k) => {
      let deg;
      if (k === 0) {
        deg = this._nearest(p.prev, chord, lo, hi);
      } else if (cadence && k === rhythm.length - 1) {
        deg = this._nearest(p.prev, [0], lo, hi);
      } else {
        const mid = (lo + hi) / 2;
        const lean = p.prev > mid + 2 ? -1 : p.prev < mid - 2 ? 1 : 0;
        deg = p.prev + pick([-2, -1, -1, 1, 1, 2, lean || 1, lean || -1]);
        deg = Math.max(lo, Math.min(hi, deg));
      }
      if (cadence || k === 0 || Math.random() > th.rests) {
        notes.push({ at, len, deg });
        p.prev = deg;
      }
      at += len;
    });
    return notes;
  }

  // The degree among these chord tones (in any octave, within range) closest to prev.
  _nearest(prev, tones, lo, hi) {
    let best = prev;
    let bestD = Infinity;
    for (const t of tones) {
      for (const o of [-7, 0, 7, 14]) {
        const d = t + o;
        if (d < lo || d > hi) continue;
        const dist = Math.abs(d - prev) + Math.random() * 0.5;
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
    }
    return best;
  }

  _freq(th, deg, oct) {
    const o = Math.floor(deg / 7);
    const i = ((deg % 7) + 7) % 7;
    return 440 * Math.pow(2, (th.root + 12 * (oct + o) + th.mode[i] - 69) / 12);
  }

  // ---------------------------------------------------------- instruments

  // An envelope gain feeding the dry mix and the reverb; it is released when src ends.
  _voice(src, send) {
    const c = this.ctx;
    const env = c.createGain();
    env.connect(this.dry);
    if (send > 0) {
      const s = c.createGain();
      s.gain.value = send;
      env.connect(s).connect(this.send);
      src.onended = () => {
        env.disconnect();
        s.disconnect();
      };
    } else {
      src.onended = () => env.disconnect();
    }
    return env;
  }

  // A plucked string: bright at first, mellowing and dying away (a lute, or a harp when long).
  _pluck(t, f, dur, vel, tone, send = 0.3) {
    const c = this.ctx;
    const a = c.createOscillator();
    a.type = 'sawtooth';
    a.frequency.value = f;
    const b = c.createOscillator();
    b.type = 'triangle';
    b.frequency.value = f * 1.003;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(Math.min(tone + f * 2, 9000), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f * 1.2, 220), t + Math.min(0.6, dur * 0.5));
    const env = this._voice(a, send);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const mixB = c.createGain();
    mixB.gain.value = 1.4;
    a.connect(filter);
    b.connect(mixB).connect(filter);
    filter.connect(env);
    a.start(t);
    b.start(t);
    a.stop(t + dur + 0.05);
    b.stop(t + dur + 0.05);
  }

  // A recorder: a soft, breathy tone with a little vibrato once the note settles.
  _flute(t, f, dur, vel) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const o2g = c.createGain();
    o2g.gain.value = 0.12;
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = c.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.4, dur));
    lfo.connect(depth);
    depth.connect(o.frequency);
    depth.connect(o2.frequency);
    const env = this._voice(o, 0.38);
    const end = t + dur;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.05);
    env.gain.setValueAtTime(vel * 0.9, Math.max(t + 0.05, end - 0.08));
    env.gain.linearRampToValueAtTime(0.0001, end + 0.06);
    o.connect(env);
    o2.connect(o2g).connect(env);
    // Breath: a whisper of noise around the note.
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2;
    bp.Q.value = 1.2;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(vel * 0.25, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(vel * 0.04, t + 0.2);
    ng.gain.linearRampToValueAtTime(0.0001, end + 0.06);
    n.connect(bp).connect(ng).connect(env);
    for (const s of [o, o2, lfo, n]) {
      s.start(t);
      s.stop(end + 0.1);
    }
  }

  // A frame drum: a low thump (or a higher tap) with a little skin noise.
  _drum(t, vel, low) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    const f0 = low ? 105 : 170;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.5, t + 0.14);
    const env = this._voice(o, 0.15);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vel * 0.22, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 0.35 : 0.2));
    o.connect(env);
    o.start(t);
    o.stop(t + 0.4);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = low ? 900 : 1800;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vel * 0.06, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(bp).connect(ng).connect(env);
    n.start(t);
    n.stop(t + 0.08);
  }

  // A tambourine's jingle.
  _jingle(t, vel) {
    const c = this.ctx;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6500;
    const env = this._voice(n, 0.2);
    env.gain.setValueAtTime(vel * 0.12, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(hp).connect(env);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.14);
  }

  // The drone under a piece: the tonic and its fifth, low and soft, gently pulsing.
  _drone(th, t) {
    if (!th.drone) return null;
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(th.drone, t + 3);
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.6;
    filter.connect(gain);
    gain.connect(this.dry);
    const s = c.createGain();
    s.gain.value = 0.4;
    gain.connect(s).connect(this.send);
    const oscs = [];
    for (const [semi, type, level] of [[-12, 'sawtooth', 0.6], [-5, 'sawtooth', 0.4], [-24, 'triangle', 0.8]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = 440 * Math.pow(2, (th.root + semi - 69) / 12);
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g).connect(filter);
      o.start(t);
      oscs.push(o);
    }
    // A slow swell, like a bow on the strings.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start(t);
    oscs.push(lfo);
    oscs[0].onended = () => {
      gain.disconnect();
      s.disconnect();
    };
    return { gain, oscs };
  }

  // -------------------------------------------------------------- buffers

  // A hall's echo: decaying stereo noise.
  _impulse(seconds) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  _noiseBuffer() {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
