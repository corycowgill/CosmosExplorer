// Wingman combat drones. Collected from a rare power-up, a drone orbits the ship
// and auto-fires at the nearest enemy in range for a limited time. Pooled; up to a
// couple active at once. Firing is delegated to a callback so this module stays
// decoupled from the projectile pool.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';

class Drone {
  constructor(scene) {
    this.group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8ff0ff, metalness: 0.85, roughness: 0.3, envMapIntensity: 1.4, emissive: 0x1a3a44, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.3, 0), mat);
    body.scale.set(1, 0.7, 1.3);
    this.group.add(body);
    // Glowing eye + aura.
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 12), new THREE.MeshBasicMaterial({ color: 0x66ffff }));
    eye.position.z = -1;
    this.group.add(eye);
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0x66ffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.scale.setScalar(5);
    this.group.add(this.aura);
    this.group.visible = false;
    scene.add(this.group);

    this.active = false;
    this.life = 0;
    this.angle = 0;
    this.fireCd = 0;
    this._tmp = new THREE.Vector3();
  }

  activate(angle) { this.active = true; this.life = 18; this.angle = angle; this.fireCd = 0.4; this.group.visible = true; }
  deactivate() { this.active = false; this.group.visible = false; }
  get position() { return this.group.position; }

  update(dt, player, aliens, fireCb) {
    if (!this.active) return;
    this.life -= dt;
    if (this.life <= 0) { this.deactivate(); return; }

    // Orbit the ship (in world XZ, with a gentle bob).
    this.angle += dt * 1.6;
    const r = 11;
    const p = player.position;
    this.group.position.set(
      p.x + Math.cos(this.angle) * r,
      p.y + 3 + Math.sin(this.angle * 2) * 1.5,
      p.z + Math.sin(this.angle) * r
    );
    // Fade the aura when the drone is about to expire.
    this.aura.material.opacity = (this.life < 3 ? this.life / 3 : 1) * (0.5 + Math.sin(this.angle * 4) * 0.15);

    // Auto-fire at the nearest enemy in range.
    this.fireCd -= dt;
    if (this.fireCd <= 0) {
      let target = null, best = 320 * 320;
      for (const a of aliens) {
        if (!a.alive) continue;
        const d = this.group.position.distanceToSquared(a.position);
        if (d < best) { best = d; target = a; }
      }
      if (target) {
        this.group.lookAt(target.position);
        fireCb(this.group.position, target.position);
        this.fireCd = 0.5;
      } else {
        this.fireCd = 0.15;
      }
    }
  }
}

export class Drones {
  constructor(scene) {
    this.pool = [new Drone(scene), new Drone(scene)];
  }

  reset() { for (const d of this.pool) d.deactivate(); }

  // Add a drone (or refresh the shortest-lived one if all slots are full).
  add() {
    let d = this.pool.find((x) => !x.active);
    if (!d) d = this.pool.reduce((a, b) => (a.life < b.life ? a : b));
    d.activate(d.active ? d.angle : Math.random() * Math.PI * 2);
  }

  activeCount() { let n = 0; for (const d of this.pool) if (d.active) n++; return n; }

  update(dt, player, aliens, fireCb) {
    for (const d of this.pool) d.update(dt, player, aliens, fireCb);
  }
}
