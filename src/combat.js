import { strikeImpact } from './player.js';

/*
 * combat.js: the traveller's blows and wounds. A punch lands on the nearest person
 * in front; a sword stroke sweeps everyone within its reach. Swinging turns the
 * traveller towards whoever is close in the direction the camera looks, so a blow
 * finds its mark on a phone as well as with a mouse. Wounds heal slowly once
 * nobody has struck the traveller for a while.
 */

export const MAX_HEALTH = 100;
const BLOWS = {
  punch: { reach: 1.35, damage: 12, sweep: false, rest: 0.42 },
  slash: { reach: 2.1, damage: 30, sweep: true, rest: 0.6 },
};
const STEEL_DAMAGE = 42;  // a slash with the blacksmith's steel sword
const AIM_CONE = 1.25;    // radians either side of the camera's view a target is turned to
const REGEN_AFTER = 8;    // seconds without a wound before health returns
const REGEN_RATE = 2.5;   // health per second

export class Combat {
  constructor(player, npcs, sword) {
    this.player = player;
    this.npcs = npcs;
    this.sword = sword;
    this.health = MAX_HEALTH;
    this.sinceHurt = 99;
    this._cooldown = 0;
    this._pending = null; // { kind, t }: a blow on its way
    // Told when a blow lands on someone: onLanded(npc, result, wasCalm), result being
    // what NPC.hit returned ('dodge', 'hurt', 'down' or 'yield').
    this.onLanded = null;
  }

  get kind() {
    return this.sword.drawn ? 'slash' : 'punch';
  }

  /*
   * Starts a blow (aimYaw: the heading the camera looks along). Returns the kind of
   * blow, or null while the last one is still being recovered from.
   */
  attack(aimYaw) {
    if (this._cooldown > 0) return null;
    const kind = this.kind;
    const blow = BLOWS[kind];
    this._turnToTarget(aimYaw, blow.reach + 1.2);
    this.player.animator.strike(kind);
    this._cooldown = blow.rest;
    this._pending = { kind, t: strikeImpact(kind) };
    return kind;
  }

  // Faces the nearest person within range near the view direction (or the view itself).
  _turnToTarget(aimYaw, range) {
    const p = this.player;
    const pos = p.position;
    let best = null;
    let bestD = range;
    for (const npc of this.npcs.list) {
      if (npc.mood === 'gone' || !npc.figure.root.visible || npc.talking) continue;
      const dx = npc.position.x - pos.x;
      const dz = npc.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD || Math.abs(npc.position.y - pos.y) > 1.4) continue;
      const a = Math.atan2(dx, dz) - aimYaw;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > AIM_CONE) continue;
      best = npc;
      bestD = d;
    }
    if (best) p.heading = Math.atan2(best.position.x - pos.x, best.position.z - pos.z);
    else if (p.speed < 0.5) p.heading = aimYaw;
  }

  update(dt) {
    this._cooldown = Math.max(0, this._cooldown - dt);
    this.sinceHurt += dt;
    if (this.sinceHurt > REGEN_AFTER && this.health < MAX_HEALTH) this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
    const pending = this._pending;
    if (!pending) return;
    pending.t -= dt;
    if (pending.t > 0) return;
    this._pending = null;
    const blow = BLOWS[pending.kind];
    const damage = pending.kind === 'slash' && this.sword.steel ? STEEL_DAMAGE : blow.damage;
    for (const npc of this.npcs.struck(this.player, blow.reach, blow.sweep)) {
      const wasCalm = npc.calm;
      const result = npc.hit(damage, this.player.position);
      if (result && this.onLanded) this.onLanded(npc, result, wasCalm);
    }
  }

  // A blow on the traveller. Returns true when it knocks them out.
  hurt(damage) {
    this.health = Math.max(0, this.health - damage);
    this.sinceHurt = 0;
    this.player.animator.hurt = 1;
    return this.health <= 0;
  }

  heal(amount) {
    this.health = Math.min(MAX_HEALTH, this.health + amount);
  }
}
