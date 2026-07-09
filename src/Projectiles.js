// Pooled laser bolts. One manager handles both player and enemy fire; each bolt is a
// stretched glowing capsule that travels in a straight line for a fixed lifetime.
// Collision is done by the Game against alien / player positions.

import * as THREE from 'three';

const PLAYER_COLOR = 0x66ffcc;
const ENEMY_COLOR = 0xff4466;

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
    this.life = opts.life ?? 2.2;
    this.enemy = !!opts.enemy;
    this.damage = opts.damage ?? 1;
    this.radius = opts.radius ?? 3.2;
    const color = opts.enemy ? ENEMY_COLOR : PLAYER_COLOR;
    this.mat.color.setHex(color);
    this.glow.material.color.setHex(color);
    // Orient the bolt along its velocity.
    const dir = vel.clone().normalize();
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const len = opts.enemy ? 1.0 : 1.4;
    this.mesh.scale.set(1, 1, len);
    this.glow.scale.set(opts.enemy ? 8 : 11, opts.enemy ? 8 : 11, 1);
    this.mesh.visible = true;
    this.alive = true;
  }

  update(dt) {
    if (!this.alive) return;
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
