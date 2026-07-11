// Collectible power-ups dropped by destroyed aliens: repair (hull), shield cell and
// score bonus. They gently bob and pull toward the player when nearby, then are
// collected on contact.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';
import { randRange } from './utils.js';

const KINDS = {
  repair:  { color: 0x46ffa0, label: 'HULL +25' },
  shield:  { color: 0x38f6ff, label: 'SHIELD +40' },
  bonus:   { color: 0xffd54a, label: 'BONUS' },
  weapon:  { color: 0xff5ec4, label: 'WEAPON UP' },
  missile: { color: 0xffaa33, label: 'MISSILES +2' },
};

class Pickup {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.4, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.2 })
    );
    this.group.add(this.core);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(11);
    this.group.add(this.glow);
    scene.add(this.group);
    this.group.visible = false;
    this.alive = false;
    this.kind = 'bonus';
    this.life = 0;
    this.spin = randRange(0.5, 1.5);
    this.radius = 5;
  }

  spawn(pos, kind) {
    this.kind = kind;
    const def = KINDS[kind];
    this.core.material.color.setHex(def.color);
    this.core.material.emissive.setHex(def.color);
    this.glow.material.color.setHex(def.color);
    this.group.position.copy(pos);
    this.group.visible = true;
    this.alive = true;
    this.life = 16; // seconds before it fades
  }

  kill() { this.alive = false; this.group.visible = false; }

  update(dt, playerPos) {
    if (!this.alive) return null;
    this.life -= dt;
    if (this.life <= 0) { this.kill(); return null; }
    this.core.rotation.y += dt * this.spin * 2;
    this.core.rotation.x += dt * this.spin;
    const bob = Math.sin(performance.now() / 500 + this.spin) * 0.6;
    this.glow.material.opacity = 0.6 + Math.sin(performance.now() / 300) * 0.2;

    const to = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const dist = to.length();
    // Magnet toward the player when close.
    if (dist < 90) {
      to.normalize().multiplyScalar((90 - dist) / 90 * 120 * dt);
      this.group.position.add(to);
    }
    this.group.position.y += bob * dt;
    if (dist < this.radius + 6) { this.kill(); return this.kind; }
    // Fade out in the last 3 seconds.
    if (this.life < 3) this.glow.material.opacity *= this.life / 3;
    return null;
  }
}

export class Pickups {
  constructor(scene, pool = 14) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < pool; i++) this.pool.push(new Pickup(scene));
  }

  reset() { for (const p of this.pool) p.kill(); }

  // Chance-based drop at a position.
  maybeDrop(pos, biasHeal = false) {
    const r = Math.random();
    let kind = null;
    if (r < 0.05) kind = 'weapon';       // rare: upgrade the pulse laser
    else if (r < 0.13) kind = 'missile'; // uncommon: +2 homing missiles
    else if (r < 0.22) kind = 'repair';
    else if (r < 0.34) kind = 'shield';
    else if (r < 0.42) kind = 'bonus';
    if (biasHeal && !kind && r < 0.6) kind = 'shield';
    if (!kind) return;
    const p = this.pool.find((x) => !x.alive);
    if (p) p.spawn(pos, kind);
  }

  // Force a specific drop (used for guaranteed rewards, e.g. bosses/milestones).
  drop(pos, kind) {
    const p = this.pool.find((x) => !x.alive);
    if (p) p.spawn(pos, kind);
  }

  // Returns array of collected kinds this frame.
  update(dt, playerPos) {
    const collected = [];
    for (const p of this.pool) {
      const got = p.update(dt, playerPos);
      if (got) collected.push(got);
    }
    return collected;
  }
}

export { KINDS };
