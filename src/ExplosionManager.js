// Pooled particle explosions: debris bursts, an expanding shockwave ring, a bright
// flash sprite and a short-lived point light. Everything is recycled so continuous
// combat never allocates.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';
import { randRange } from './utils.js';

const PARTICLES_PER = 46;

class Explosion {
  constructor(scene) {
    this.scene = scene;
    this.alive = false;
    this.time = 0;
    this.duration = 1.0;

    // Debris particle cloud.
    const geo = new THREE.BufferGeometry();
    this.count = PARTICLES_PER;
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.colorArr = new Float32Array(this.count * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colorArr, 3));
    const mat = new THREE.PointsMaterial({
      size: 9, map: makeGlowSprite(), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    // Shockwave ring.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.ring.visible = false;
    scene.add(this.ring);

    // Central flash.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowSprite(), color: 0xffffff, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.flash.visible = false;
    scene.add(this.flash);

    // Dynamic light.
    this.light = new THREE.PointLight(0xffaa44, 0, 400, 2);
    scene.add(this.light);
  }

  spawn(pos, opts = {}) {
    const scale = opts.scale ?? 1;
    const color = new THREE.Color(opts.color ?? 0xff8844);
    const hot = new THREE.Color(0xffffff);
    this.alive = true;
    this.time = 0;
    this.duration = (opts.big ? 1.35 : 0.95) * (0.8 + scale * 0.2);
    this.baseSize = (opts.big ? 16 : 10) * scale;
    this.ringMax = (opts.big ? 120 : 60) * scale;

    for (let i = 0; i < this.count; i++) {
      this.positions[i*3] = pos.x; this.positions[i*3+1] = pos.y; this.positions[i*3+2] = pos.z;
      // Random spherical velocity.
      const speed = randRange(20, 130) * scale;
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      this.velocities[i*3]   = speed * Math.sin(phi) * Math.cos(theta);
      this.velocities[i*3+1] = speed * Math.sin(phi) * Math.sin(theta);
      this.velocities[i*3+2] = speed * Math.cos(phi);
      const c = Math.random() < 0.4 ? hot : color.clone().offsetHSL(randRange(-0.04, 0.04), 0, randRange(-0.1, 0.15));
      this.colorArr[i*3] = c.r; this.colorArr[i*3+1] = c.g; this.colorArr[i*3+2] = c.b;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.material.size = this.baseSize;
    this.points.material.opacity = 1;
    this.points.visible = true;

    this.ring.position.copy(pos);
    this.ring.material.color.copy(color);
    this.ring.material.opacity = 0.85;
    this.ring.scale.setScalar(1);
    this.ring.quaternion.copy(opts.ringQuat ?? new THREE.Quaternion());
    this.ring.visible = true;

    this.flash.position.copy(pos);
    this.flash.material.color.copy(hot);
    this.flash.material.opacity = 1;
    this.flash.scale.setScalar(this.baseSize * 6);
    this.flash.visible = true;

    this.light.position.copy(pos);
    this.light.color.copy(color);
    this.light.intensity = opts.big ? 6 : 3.5;
  }

  update(dt) {
    if (!this.alive) return;
    this.time += dt;
    const t = this.time / this.duration;
    if (t >= 1) { this._kill(); return; }

    // Debris integrate + drag.
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.count; i++) {
      this.velocities[i*3] *= drag; this.velocities[i*3+1] *= drag; this.velocities[i*3+2] *= drag;
      this.positions[i*3]   += this.velocities[i*3] * dt;
      this.positions[i*3+1] += this.velocities[i*3+1] * dt;
      this.positions[i*3+2] += this.velocities[i*3+2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.material.opacity = 1 - t;
    this.points.material.size = this.baseSize * (1 - t * 0.5);

    // Ring expand + fade (fast then settle).
    const rt = Math.min(1, t * 1.6);
    const rs = 1 + rt * this.ringMax;
    this.ring.scale.setScalar(rs);
    this.ring.material.opacity = 0.85 * (1 - rt);

    // Flash: quick pop then vanish.
    const ft = Math.min(1, t * 3.5);
    this.flash.material.opacity = 1 - ft;
    this.flash.scale.setScalar(this.baseSize * (6 + ft * 8));

    // Light fades quickly.
    this.light.intensity *= Math.exp(-6 * dt);
  }

  _kill() {
    this.alive = false;
    this.points.visible = false;
    this.ring.visible = false;
    this.flash.visible = false;
    this.light.intensity = 0;
  }
}

export class ExplosionManager {
  constructor(scene, pool = 16) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < pool; i++) this.pool.push(new Explosion(scene));
  }

  burst(pos, opts) {
    let ex = this.pool.find((e) => !e.alive);
    if (!ex) {
      // Recycle the oldest if the pool is exhausted.
      ex = this.pool[0];
    }
    ex.spawn(pos, opts);
  }

  update(dt) {
    for (const e of this.pool) e.update(dt);
  }
}
