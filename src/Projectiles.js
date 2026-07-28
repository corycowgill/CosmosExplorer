// Pooled laser bolts. One manager handles both player and enemy fire; each bolt is a
// stretched glowing capsule that travels in a straight line for a fixed lifetime.
// Collision is done by the Game against alien / player positions.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';

const PLAYER_COLOR = 0x66ffcc;
const ENEMY_COLOR = 0xff4466;
const FWD_Z = new THREE.Vector3(0, 0, 1);
const TMP1 = new THREE.Vector3();
const TMP2 = new THREE.Vector3();

// Shared geometries — smooth, rounded, and reused across every pooled bolt so the
// projectiles never read as faceted/blocky and we don't pay per-bolt geometry cost.
const LASER_GEO = new THREE.CapsuleGeometry(0.45, 5.5, 4, 16); LASER_GEO.rotateX(Math.PI / 2);
const CORE_GEO = new THREE.CapsuleGeometry(0.18, 6.2, 3, 10); CORE_GEO.rotateX(Math.PI / 2);
const M_BODY_GEO = new THREE.CylinderGeometry(0.5, 0.5, 3.4, 20); M_BODY_GEO.rotateX(Math.PI / 2);
const M_NOSE_GEO = new THREE.ConeGeometry(0.5, 1.6, 20); M_NOSE_GEO.rotateX(Math.PI / 2);
const M_FIN_GEO = new THREE.BoxGeometry(0.9, 0.12, 1.0);
// Shared missile materials (missiles are always the same warm rocket look).
const M_BODY_MAT = new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.4, emissive: 0x110a04, emissiveIntensity: 0.3 });
const M_NOSE_MAT = new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.7, roughness: 0.3, envMapIntensity: 1.2, emissive: 0x551100, emissiveIntensity: 0.5 });
const M_FIN_MAT = new THREE.MeshStandardMaterial({ color: 0x555f6b, metalness: 0.8, roughness: 0.4 });

class Bolt {
  constructor(scene) {
    this.mesh = new THREE.Group();

    // Laser: a smooth glowing capsule with a bright white inner core.
    this.bodyMat = new THREE.MeshBasicMaterial({ color: PLAYER_COLOR, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.body = new THREE.Mesh(LASER_GEO, this.bodyMat);
    this.core = new THREE.Mesh(CORE_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.add(this.body, this.core);

    // Missile: a proper little rocket (smooth body, nose cone, fins), reusing shared
    // geometry/material. Hidden unless this bolt is fired as a missile.
    this.missileMesh = new THREE.Group();
    this.missileMesh.add(new THREE.Mesh(M_BODY_GEO, M_BODY_MAT));
    const nose = new THREE.Mesh(M_NOSE_GEO, M_NOSE_MAT); nose.position.z = 1.7; // apex points +Z (forward)
    this.missileMesh.add(nose);
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(M_FIN_GEO, M_FIN_MAT);
      const a = (i / 3) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, -1.1); // radial fins at the rear
      fin.rotation.z = a;
      this.missileMesh.add(fin);
    }
    // A glowing thruster at the tail.
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0xffcc66, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.setScalar(2.4);
    flame.position.z = -2.2;
    this.missileMesh.add(flame);
    this.missileMesh.visible = false;
    this.mesh.add(this.missileMesh);

    // Soft halo.
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: PLAYER_COLOR, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
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
    this.drone = !!opts.drone;
    this.homingTarget = opts.homingTarget || null;
    this.homing = !!(opts.homing || opts.missile) && !!this.homingTarget;
    this.turnRate = opts.turnRate ?? 3.0;

    // Orient along velocity (all geometry is aligned to +Z / travel).
    const dir = vel.clone().normalize();
    this.mesh.quaternion.setFromUnitVectors(FWD_Z, dir);

    if (this.missile) {
      this.body.visible = false;
      this.core.visible = false;
      this.missileMesh.visible = true;
      this.mesh.scale.setScalar(1);
      this.glow.material.color.setHex(0xffaa44);
      this.glow.scale.set(9, 9, 1);
    } else {
      this.body.visible = true;
      this.core.visible = true;
      this.missileMesh.visible = false;
      const color = opts.color ?? (opts.enemy ? ENEMY_COLOR : PLAYER_COLOR);
      this.bodyMat.color.setHex(color);
      this.glow.material.color.setHex(color);
      // Homing enemy orbs are chunkier and glow more so they read as a threat.
      const len = this.homing ? 1.0 : (opts.enemy ? 0.85 : 1.15);
      const girth = this.homing ? 1.5 : (opts.enemy ? 0.9 : 1);
      this.mesh.scale.set(girth, girth, len);
      this.glow.scale.setScalar(this.homing ? 12 : (opts.enemy ? 8 : 11));
    }
    this.mesh.visible = true;
    this.alive = true;
  }

  update(dt) {
    if (!this.alive) return;
    // Homing: bend velocity toward a live target, capped by turn rate.
    if (this.homing && this.homingTarget && this.homingTarget.alive) {
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
