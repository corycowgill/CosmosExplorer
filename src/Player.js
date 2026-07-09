// The player's rocket ship: a hand-built low-poly model with glowing engines and a
// particle exhaust trail, plus flight physics driven by the unified input state.
//
// Flight model: the ship always drifts forward along its nose. Input rotates the
// heading (yaw/pitch/roll) and modulates throttle/boost. A chase camera trails it.

import * as THREE from 'three';
import { clamp, lerp, damp } from './utils.js';
import { makeGlowSprite } from './SolarSystem.js';

const FORWARD = new THREE.Vector3(0, 0, -1);

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); // heading transform (moves + rotates)
    scene.add(this.group);

    this.model = new THREE.Group(); // visual, banks independently
    this.group.add(this.model);

    this._buildShip();
    this._buildTrail();

    // Flight state — turn rates are high relative to cruise speed so the ship
    // banks into tight, responsive arcs instead of a wide airliner turn.
    this.velocity = new THREE.Vector3();
    this.speed = 55;
    this.baseSpeed = 58;
    this.boostSpeed = 135;
    this.yawRate = 2.7;
    this.pitchRate = 2.5;
    this.rollRate = 3.4;

    // Combat / survival
    this.maxHealth = 100;
    this.health = 100;
    this.maxShield = 100;
    this.shield = 100;
    this.shieldRegenDelay = 0;
    this.alive = true;

    // Weapon
    this.fireCooldown = 0;
    this.fireRate = 0.14;   // seconds between shots
    this.heat = 0;          // 0..1, overheats weapon if maxed
    this.overheated = false;
    this.muzzleFlash = 0;

    this.radius = 6;
    this.bank = 0;
    this.enginePulse = 0;
  }

  _buildShip() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8e4f0, metalness: 0.8, roughness: 0.3, emissive: 0x101820, emissiveIntensity: 0.4 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.6, roughness: 0.35, emissive: 0x551100, emissiveIntensity: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2299ff, metalness: 0.4, roughness: 0.1, emissive: 0x113355, emissiveIntensity: 0.8, transparent: true, opacity: 0.9 });
    const engineMat = new THREE.MeshBasicMaterial({ color: 0x66ffff });

    // Fuselage
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 9, 16), bodyMat);
    fuse.rotation.x = Math.PI / 2;
    this.model.add(fuse);

    // Nose cone
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.5, 16), accentMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -6.6;
    this.model.add(nose);

    // Cockpit canopy
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.7), glassMat);
    canopy.rotation.x = Math.PI / 2.1;
    canopy.position.set(0, 0.9, -2.2);
    canopy.scale.set(1, 0.7, 1.6);
    this.model.add(canopy);

    // Rear engine ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.4, 10, 20), accentMat);
    ring.position.z = 4.4;
    this.model.add(ring);

    // Engine glow discs
    this.engineGlows = [];
    for (const off of [[0,0], [-0.9,0.6], [0.9,0.6], [0,-0.9]]) {
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.7, 16), engineMat);
      e.position.set(off[0], off[1], 4.5);
      e.rotation.y = Math.PI;
      this.model.add(e);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0x66ffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(2, 2, 1);
      glow.position.set(off[0], off[1], 5.2);
      this.model.add(glow);
      this.engineGlows.push(glow);
    }

    // Wings
    const wingShape = new THREE.BoxGeometry(7, 0.3, 3);
    const wingL = new THREE.Mesh(wingShape, bodyMat);
    wingL.position.set(0, -0.2, 2);
    wingL.geometry = wingShape;
    this.model.add(wingL);

    // Fins (vertical + angled)
    const finGeo = new THREE.BoxGeometry(0.3, 2.6, 3);
    for (const [x, rot, y] of [[3.2, 0.5, 0.6], [-3.2, -0.5, 0.6], [0, 0, 1.4]]) {
      const fin = new THREE.Mesh(finGeo, accentMat);
      fin.position.set(x, y, 3);
      fin.rotation.z = rot;
      this.model.add(fin);
    }

    // Wingtip strut lights
    for (const x of [-3.5, 3.5]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), new THREE.MeshBasicMaterial({ color: x < 0 ? 0xff3355 : 0x33ff66 }));
      tip.position.set(x, -0.2, 1);
      this.model.add(tip);
    }

    // Muzzle points (where lasers spawn), in ship-local space.
    this.muzzles = [new THREE.Vector3(-3.5, -0.2, -1.5), new THREE.Vector3(3.5, -0.2, -1.5)];
    this.muzzleToggle = 0;

    // Engine light
    this.engineLight = new THREE.PointLight(0x55ffff, 1.5, 60, 2);
    this.engineLight.position.set(0, 0, 6);
    this.model.add(this.engineLight);
  }

  _buildTrail() {
    // Additive point trail streaming from the engines.
    this.trailCount = 90;
    this.trailPos = new Float32Array(this.trailCount * 3);
    this.trailAlpha = new Float32Array(this.trailCount);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const mat = new THREE.PointsMaterial({
      size: 3, map: makeGlowSprite(), color: 0x55ffee,
      transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.trail = new THREE.Points(geo, mat);
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this._trailHead = 0;
    this._trailAccum = 0;
  }

  reset() {
    this.group.position.set(420, 130, 1750);
    this.group.quaternion.identity();
    // The ship's nose / FORWARD is local -Z, but Object3D.lookAt aims local +Z at
    // the target. So to point the nose at the sun (origin) we look at the mirror
    // point on the far side, which orients -Z toward the system's heart.
    this.group.lookAt(this.group.position.clone().multiplyScalar(2));
    this.model.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.shield = this.maxShield;
    this.heat = 0;
    this.overheated = false;
    this.alive = true;
    this.speed = this.baseSpeed;
    this.fireCooldown = 0;
    // Seed the trail at the ship so it doesn't streak from the origin.
    const p = this.group.position;
    for (let i = 0; i < this.trailCount; i++) {
      this.trailPos[i*3] = p.x; this.trailPos[i*3+1] = p.y; this.trailPos[i*3+2] = p.z;
      this.trailAlpha[i] = 0;
    }
  }

  get position() { return this.group.position; }

  forwardVector(out = new THREE.Vector3()) {
    return out.copy(FORWARD).applyQuaternion(this.group.quaternion);
  }

  // Returns muzzle world positions for firing.
  getMuzzleWorld(out) {
    const m = this.muzzles[this.muzzleToggle % this.muzzles.length];
    this.muzzleToggle++;
    return out.copy(m).applyMatrix4(this.model.matrixWorld);
  }

  update(dt, input) {
    if (!this.alive) return;

    // ---- Rotation from input ----
    // Yaw turns the heading directly (no auto-bank on the heading — that only
    // muddied the turn). Banking is purely cosmetic, applied to the model below.
    const yaw = -input.yaw * this.yawRate * dt;
    const pitch = input.pitch * this.pitchRate * dt;
    const roll = -input.roll * this.rollRate * dt;

    this.group.rotateY(yaw);
    this.group.rotateX(pitch);
    this.group.rotateZ(roll);

    // Visual bank: lean the model into the turn.
    const targetBank = clamp(-input.yaw * 0.5 + -input.roll * 0.3, -0.6, 0.6);
    this.bank = lerp(this.bank, targetBank, damp(8, dt));
    this.model.rotation.z = this.bank;
    this.model.rotation.x = lerp(this.model.rotation.x, input.pitch * 0.12, damp(8, dt));

    // ---- Throttle / speed ----
    const boosting = input.boost;
    let targetSpeed = this.baseSpeed + input.throttle * 40;
    if (boosting) targetSpeed = this.boostSpeed;
    targetSpeed = clamp(targetSpeed, 24, this.boostSpeed);
    this.speed = lerp(this.speed, targetSpeed, damp(2.5, dt));

    const fwd = this.forwardVector();
    this.velocity.copy(fwd).multiplyScalar(this.speed);
    this.group.position.addScaledVector(this.velocity, dt);

    // ---- Engine visuals ----
    this.enginePulse += dt * 20;
    const throb = 0.85 + Math.sin(this.enginePulse) * 0.12;
    const boostScale = boosting ? 1.5 : 1.0;
    for (const g of this.engineGlows) {
      g.scale.setScalar((1.5 + input.throttle * 0.5) * throb * boostScale);
      g.material.color.setHex(boosting ? 0xff9955 : 0x66ffff);
    }
    this.engineLight.color.setHex(boosting ? 0xff8844 : 0x55ffff);
    this.engineLight.intensity = (1.4 + (boosting ? 1.8 : 0)) * throb;

    // ---- Exhaust trail ----
    this._updateTrail(dt, boosting);

    // ---- Weapon heat / cooldown ----
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
    // Cool down heat over time.
    this.heat = clamp(this.heat - dt * 0.32, 0, 1);
    if (this.overheated && this.heat < 0.35) this.overheated = false;

    // ---- Shield regen ----
    if (this.shieldRegenDelay > 0) this.shieldRegenDelay -= dt;
    else if (this.shield < this.maxShield) this.shield = clamp(this.shield + dt * 12, 0, this.maxShield);
  }

  _updateTrail(dt, boosting) {
    // Emit new trail points at the engine, in bursts.
    this._trailAccum += dt;
    const emitEvery = 0.012;
    const enginePos = new THREE.Vector3(0, 0, 6).applyMatrix4(this.model.matrixWorld);
    while (this._trailAccum >= emitEvery) {
      this._trailAccum -= emitEvery;
      const h = this._trailHead;
      this.trailPos[h*3] = enginePos.x + (Math.random()-0.5)*0.8;
      this.trailPos[h*3+1] = enginePos.y + (Math.random()-0.5)*0.8;
      this.trailPos[h*3+2] = enginePos.z + (Math.random()-0.5)*0.8;
      this._trailHead = (h + 1) % this.trailCount;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.material.color.setHex(boosting ? 0xff8844 : 0x55ffee);
    this.trail.material.size = boosting ? 4.2 : 3;
  }

  // Fire two bolts from alternating muzzles. Returns array of {pos, dir} or null if unable.
  tryFire() {
    if (this.fireCooldown > 0 || this.overheated || !this.alive) return null;
    this.fireCooldown = this.fireRate;
    this.heat = clamp(this.heat + 0.09, 0, 1);
    if (this.heat >= 1) this.overheated = true;
    this.muzzleFlash = 0.05;

    const dir = this.forwardVector();
    const shots = [];
    for (const m of this.muzzles) {
      const pos = m.clone().applyMatrix4(this.model.matrixWorld);
      shots.push({ pos, dir: dir.clone() });
    }
    return shots;
  }

  damageBy(amount) {
    if (!this.alive) return;
    this.shieldRegenDelay = 3.5;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, amount);
      this.shield -= absorbed;
      amount -= absorbed;
    }
    if (amount > 0) {
      this.health = clamp(this.health - amount, 0, this.maxHealth);
      if (this.health <= 0) { this.health = 0; this.alive = false; }
    }
  }

  heal(h, s) {
    if (h) this.health = clamp(this.health + h, 0, this.maxHealth);
    if (s) this.shield = clamp(this.shield + s, 0, this.maxShield);
  }
}
