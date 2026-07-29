// Hyperspace warp streaks. A cylindrical volume of light streaks wrapped around the
// ship's travel axis that only light up while boosting — the classic "jump to
// lightspeed" star-streak effect. Purely decorative and pooled: a fixed LineSegments
// buffer whose vertices are rewritten each frame, no per-frame allocation.

import * as THREE from 'three';
import { clamp, randRange } from './utils.js';

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _head = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _altUp = new THREE.Vector3(1, 0, 0);

export class WarpStreaks {
  constructor(scene, count = 200) {
    this.count = count;
    // Per-streak state: position along the travel axis (z), and a perpendicular
    // offset expressed as radius + angle so streaks ring the flight path.
    this.z = new Float32Array(count);
    this.rad = new Float32Array(count);
    this.ang = new Float32Array(count);
    this.range = 220;         // half-length of the streak volume along travel
    for (let i = 0; i < count; i++) this._seed(i, randRange(-this.range, this.range));

    const positions = new Float32Array(count * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.positions = positions;
    this.geo = geo;
    this.mat = new THREE.LineBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;   // it follows the camera; never cull it
    this.lines.renderOrder = 2;
    scene.add(this.lines);

    this.amount = 0;          // smoothed 0..1 boost/warp intensity
  }

  _seed(i, z) {
    this.z[i] = z;
    this.rad[i] = randRange(7, 70);
    this.ang[i] = randRange(0, Math.PI * 2);
  }

  update(dt, shipPos, forward, speed, boosting) {
    // Smoothly ramp the warp intensity in and out.
    const target = boosting ? 1 : 0;
    this.amount += (target - this.amount) * clamp(dt * 6, 0, 1);
    this.mat.opacity = this.amount * 0.85;
    if (this.amount < 0.01) { this.lines.visible = false; return; }
    this.lines.visible = true;

    // Orthonormal basis around the travel axis.
    const upRef = Math.abs(forward.dot(_worldUp)) > 0.95 ? _altUp : _worldUp;
    _right.crossVectors(forward, upRef).normalize();
    _up.crossVectors(_right, forward).normalize();

    // Streaks flow backward past the ship; length grows with speed and warp amount.
    const flow = speed * dt;
    const len = (5 + speed * 0.16) * this.amount;
    const pos = this.positions;
    for (let i = 0; i < this.count; i++) {
      let z = this.z[i] - flow;
      if (z < -this.range) { this._seed(i, this.range); z = this.z[i]; }
      else this.z[i] = z;

      const r = this.rad[i];
      const ca = Math.cos(this.ang[i]) * r;
      const sa = Math.sin(this.ang[i]) * r;
      // Head world position = ship + along-axis offset + perpendicular ring offset.
      _head.copy(shipPos)
        .addScaledVector(forward, z)
        .addScaledVector(_right, ca)
        .addScaledVector(_up, sa);

      const o = i * 6;
      pos[o] = _head.x;        pos[o + 1] = _head.y;        pos[o + 2] = _head.z;
      // Tail trails behind along the travel axis, stretching into a streak.
      pos[o + 3] = _head.x - forward.x * len;
      pos[o + 4] = _head.y - forward.y * len;
      pos[o + 5] = _head.z - forward.z * len;
    }
    this.geo.attributes.position.needsUpdate = true;
  }

  reset() {
    this.amount = 0;
    this.mat.opacity = 0;
    this.lines.visible = false;
    for (let i = 0; i < this.count; i++) this._seed(i, randRange(-this.range, this.range));
  }
}
