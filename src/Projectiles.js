// Pooled laser bolts. One manager handles both player and enemy fire; each bolt is a
// stretched glowing capsule that travels in a straight line for a fixed lifetime.
// Collision is done by the Game against alien / player positions.

import * as THREE from 'three';

const PLAYER_COLOR = 0x66ffcc;
const ENEMY_COLOR = 0xff4466;
const FWD_Z = new THREE.Vector3(0, 0, 1);
const TMP1 = new THREE.Vector3();
const TMP2 = new THREE.Vector3();

class Bolt {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 9, 6);
    geo.rotateX(Math.PI / 2); // align length along local +Z
    this.mat = new THREE.MeshBasicMaterial({ color: PLAYER_COLOR, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    // A glow sprite gives the bolt a soft halo without extra lights.
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: PLAYER_COLOR, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.set(10, 10, 1);
    this.mesh.add(this.glow);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.alive = false;
    this.vel = new THREE.Vector3();
    this.life = 0;
    this.enemy = false;
    this.damage = 1;
    this.radius = 3.2;
  }

  spawn(pos, vel, opts) {
    this.mesh.position.copy(pos);
    this.vel.copy(vel);
    this.speed = vel.length();
    this.life = opts.life ?? 2.2;
    this.enemy = !!opts.enemy;
    this.damage = opts.damage ?? 1;
    this.radius = opts.radius ?? 3.2;
    this.missile = !!opts.missile;
    this.homingTarget = opts.homingTarget || null;
    this.turnRate = opts.turnRate ?? 3.0;
    const color = opts.missile ? 0xffaa33 : (opts.enemy ? ENEMY_COLOR : PLAYER_COLOR);
    this.mat.color.setHex(color);
    this.glow.material.color.setHex(color);
    // Orient the bolt along its velocity.
    const dir = vel.clone().normalize();
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const len = opts.missile ? 1.8 : (opts.enemy ? 1.0 : 1.4);
    const girth = opts.missile ? 1.6 : 1;
    this.mesh.scale.set(girth, girth, len);
    const gs = opts.missile ? 13 : (opts.enemy ? 8 : 11);
    this.glow.scale.set(gs, gs, 1);
    this.mesh.visible = true;
    this.alive = true;
  }

  update(dt) {
    if (!this.alive) return;
    // Homing: bend velocity toward a live target, capped by turn rate.
    if (this.missile && this.homingTarget && this.homingTarget.alive) {
      const desired = TMP1.subVectors(this.homingTarget.position, this.mesh.position).normalize().multiplyScalar(this.speed);
      // Lerp toward desired, then renormalize to keep constant speed.
      this.vel.lerp(desired, Math.min(1, this.turnRate * dt));
      const spd = this.vel.length();
      if (spd > 0) this.vel.multiplyScalar(this.speed / spd);
      const dir = TMP2.copy(this.vel).normalize();
      this.mesh.quaternion.setFromUnitVectors(FWD_Z, dir);
    }
    this.mesh.position.addScaledVector(this.vel, dt);
    this.life -= dt;
    if (this.life <= 0) this.kill();
  }

  kill() { this.alive = false; this.mesh.visible = false; }
}

export class Projectiles {
  constructor(scene, size = 120) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < size; i++) this.pool.push(new Bolt(scene));
  }

  fire(pos, vel, opts = {}) {
    let b = this.pool.find((x) => !x.alive);
    if (!b) { b = this.pool[0]; } // recycle oldest under pressure
    b.spawn(pos, vel, opts);
    return b;
  }

  update(dt) {
    for (const b of this.pool) b.update(dt);
  }

  // Iterate live player or enemy bolts.
  forEachLive(enemy, cb) {
    for (const b of this.pool) {
      if (b.alive && b.enemy === enemy) cb(b);
    }
  }
}
