// A drifting, destructible asteroid field. Rocks are pooled and wrapped in a box
// that follows the ship, so the field feels continuous but bounded. They tumble,
// can be shot apart for points and the occasional power-up, and bump the hull if
// you fly into one. Collision resolution lives in Game; this owns spawn/motion.

import * as THREE from 'three';
import { randRange } from './utils.js';

function makeRockGeometry(detail = 1) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let s = seen.get(key);
    if (s === undefined) { s = 1 + randRange(-0.28, 0.28); seen.set(key, s); }
    v.multiplyScalar(s);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

class Asteroid {
  constructor(scene) {
    this.scene = scene;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6b5d52, roughness: 0.95, metalness: 0.06,
      flatShading: true, envMapIntensity: 0.35,
      emissive: 0x140f0a, emissiveIntensity: 0.4,
    });
    this.mesh = new THREE.Mesh(makeRockGeometry(1), mat);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.alive = false;
    this.spin = new THREE.Vector3();
    this.drift = new THREE.Vector3();
    this.radius = 10;
    this.hp = 4;
  }

  spawn(pos, size) {
    this.mesh.position.copy(pos);
    this.mesh.scale.setScalar(size);
    this.mesh.rotation.set(randRange(0, 6.28), randRange(0, 6.28), randRange(0, 6.28));
    this.mesh.visible = true;
    this.radius = size * 1.05;
    this.hp = Math.round(size * 0.5);
    this.spin.set(randRange(-0.6, 0.6), randRange(-0.6, 0.6), randRange(-0.6, 0.6));
    this.drift.set(randRange(-4, 4), randRange(-4, 4), randRange(-4, 4));
    this.alive = true;
  }

  hit(dmg) { this.hp -= dmg; return this.hp <= 0; }
  kill() { this.alive = false; this.mesh.visible = false; }
  get position() { return this.mesh.position; }

  update(dt) {
    if (!this.alive) return;
    this.mesh.rotation.x += this.spin.x * dt;
    this.mesh.rotation.y += this.spin.y * dt;
    this.mesh.rotation.z += this.spin.z * dt;
    this.mesh.position.addScaledVector(this.drift, dt);
  }
}

export class Asteroids {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.range = 560;
    this.count = quality === 'low' ? 18 : 30;
    this.pool = [];
    for (let i = 0; i < this.count; i++) this.pool.push(new Asteroid(scene));
  }

  // (Re)scatter the whole field around a centre, keeping a clear bubble near it.
  reset(center) {
    for (const a of this.pool) {
      const pos = this._randomPos(center);
      a.spawn(pos, randRange(6, 17));
    }
  }

  _randomPos(center) {
    const pos = new THREE.Vector3();
    for (let tries = 0; tries < 8; tries++) {
      pos.set(
        center.x + randRange(-this.range, this.range),
        center.y + randRange(-this.range, this.range),
        center.z + randRange(-this.range, this.range)
      );
      if (pos.distanceTo(center) > 110) break; // don't spawn on top of the ship
    }
    return pos;
  }

  // Respawn a destroyed rock elsewhere in the field so it stays populated.
  respawn(a, center) {
    a.spawn(this._randomPos(center), randRange(6, 17));
  }

  update(dt, center) {
    const R = this.range;
    for (const a of this.pool) {
      if (!a.alive) continue;
      a.update(dt);
      // Wrap around the ship so the field is effectively endless.
      const p = a.mesh.position;
      if (p.x - center.x > R) p.x -= 2 * R; else if (p.x - center.x < -R) p.x += 2 * R;
      if (p.y - center.y > R) p.y -= 2 * R; else if (p.y - center.y < -R) p.y += 2 * R;
      if (p.z - center.z > R) p.z -= 2 * R; else if (p.z - center.z < -R) p.z += 2 * R;
    }
  }
}
