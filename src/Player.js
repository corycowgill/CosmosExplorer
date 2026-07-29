// The player's rocket ship: a hand-built low-poly model with glowing engines and a
// particle exhaust trail, plus flight physics driven by the unified input state.
//
// Flight model: the ship always drifts forward along its nose. Input rotates the
// heading (yaw/pitch/roll) and modulates throttle/boost. A chase camera trails it.

import * as THREE from 'three';
import { clamp, lerp, damp } from './utils.js';
import { makeGlowSprite } from './SolarSystem.js';

const FORWARD = new THREE.Vector3(0, 0, -1);
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

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
    this.yawRate = 2.2;
    this.pitchRate = 2.0;
    this.rollRate = 3.0;
    this.turnScale = 1; // settings: steering sensitivity multiplier

    // Combat / survival
    this.maxHealth = 100;
    this.health = 100;
    this.maxShield = 100;
    this.shield = 100;
    this.shieldRegenDelay = 0;
    this.alive = true;

    // Weapon
    this.fireCooldown = 0;
    this.fireRate = 0.14;   // seconds between shots (tightens as weapon levels up)
    this.heat = 0;          // 0..1, overheats weapon if maxed
    this.overheated = false;
    this.muzzleFlash = 0;
    this.weaponLevel = 1;   // 1..3 — more barrels + tighter fire
    this.maxWeaponLevel = 3;

    // Homing missiles (secondary)
    this.missiles = 3;
    this.maxMissiles = 6;
    this.missileCooldown = 0;
    this.missileRegen = 0;

    // Overdrive — a kill-charged burst of rapid fire, double damage & invincibility.
    this.overdrive = 0;          // 0..100 charge
    this.overdriveMax = 100;
    this.overdriveActive = false;
    this.overdriveTimer = 0;
    this.overdriveDuration = 6;

    this.radius = 6;
    this.bank = 0;
    this.enginePulse = 0;

    // Barrel-roll evade: a quick sideways dash with brief i-frames.
    this.rolling = false;
    this.rollTimer = 0;
    this.rollDir = 1;
    this.rollCd = 0;
    this.rollDuration = 0.5;
  }

  _buildShip() {
    // Polished metal that catches the environment reflections, warm accent metal,
    // dark greeble panels, glowing trim and glass.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdbe6f2, metalness: 0.95, roughness: 0.22, envMapIntensity: 1.6, emissive: 0x0a0f16, emissiveIntensity: 0.3 });
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xb8c6d8, metalness: 0.96, roughness: 0.28, envMapIntensity: 1.5, emissive: 0x080c12, emissiveIntensity: 0.25 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.7, roughness: 0.3, envMapIntensity: 1.3, emissive: 0x551100, emissiveIntensity: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xe8b24a, metalness: 1.0, roughness: 0.28, envMapIntensity: 1.5, emissive: 0x2a1c04, emissiveIntensity: 0.3 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x3a4452, metalness: 0.85, roughness: 0.5, envMapIntensity: 0.9 });
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x38f6ff });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2299ff, metalness: 0.5, roughness: 0.06, envMapIntensity: 1.8, emissive: 0x113355, emissiveIntensity: 0.8, transparent: true, opacity: 0.88 });
    const engineMat = new THREE.MeshBasicMaterial({ color: 0x66ffff });

    // --- Fuselage: a smooth lathe-turned hull (nose −Z, tail +Z) for a sleek,
    // reflective body of revolution instead of a plain cylinder. ---
    const profile = [
      [0.02, 6.3], [0.35, 5.6], [0.7, 4.7], [1.05, 3.4], [1.35, 1.8],
      [1.55, 0.2], [1.68, -1.4], [1.9, -2.8], [2.0, -3.6], [1.7, -4.3], [1.2, -4.6],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const hull = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), hullMat);
    hull.rotation.x = -Math.PI / 2;   // profile +Y (nose) → −Z (forward)
    this.model.add(hull);

    // Panel-line rings around the hull for surface detail.
    for (const [z, r] of [[-3.4, 1.98], [-1.4, 1.72], [0.6, 1.5], [2.6, 1.2]]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 28), panelMat);
      band.position.z = z;
      this.model.add(band);
    }
    // Dorsal spine + glowing flank strips.
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 6.5), panelMat);
    spine.position.set(0, 1.3, 0.6);
    this.model.add(spine);
    for (const x of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 6.2), stripMat);
      strip.position.set(x * 1.42, 0.15, 0.3);
      this.model.add(strip);
    }
    // Ventral sensor pod.
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.6, 6, 10), panelMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(0, -1.5, -1.2);
    this.model.add(pod);

    // Nose accent chevron + a warm beacon tip.
    const noseRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.14, 8, 20), accentMat);
    noseRing.position.z = -4.6;
    this.model.add(noseRing);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    noseTip.position.set(0, 0, -6.4);
    this.model.add(noseTip);

    // --- Cockpit: a raised fairing with a framed, tinted canopy. ---
    const cockpitBase = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 12), hullMat);
    cockpitBase.scale.set(1, 0.55, 1.9);
    cockpitBase.position.set(0, 0.7, -1.9);
    this.model.add(cockpitBase);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.7), glassMat);
    canopy.rotation.x = Math.PI / 2.1;
    canopy.position.set(0, 1.02, -2.2);
    canopy.scale.set(1, 0.62, 1.7);
    this.model.add(canopy);
    const canopyFrame = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 20), trimMat);
    canopyFrame.rotation.x = Math.PI / 2;
    canopyFrame.scale.set(1, 1.7, 1);
    canopyFrame.position.set(0, 0.86, -2.2);
    this.model.add(canopyFrame);

    // --- Swept delta wings via an extruded planform (proper leading-edge sweep). ---
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 1.4);       // root leading edge
    wingShape.lineTo(4.6, -0.6);    // swept tip leading edge
    wingShape.lineTo(4.6, -1.7);    // tip trailing edge
    wingShape.lineTo(0, -2.6);      // root trailing edge
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 1 });
    wingGeo.translate(0, 0, -0.11);   // centre thickness on Y after rotation
    wingGeo.rotateX(-Math.PI / 2);    // lay flat: span→X, chord→Z, thickness→Y
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(wingGeo, bodyMat);
      w.scale.x = s;                  // mirror for the left wing
      w.position.set(s * 1.35, -0.15, 1.4);
      this.model.add(w);
      // Glowing leading edge + gold strake running out the wing.
      const edge = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 0.18), stripMat);
      edge.position.set(s * 3.2, -0.05, 0.35);
      edge.rotation.y = s * 0.42;
      this.model.add(edge);
      const strake = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 3.2), trimMat);
      strake.position.set(s * 2.0, -0.12, 1.6);
      strake.rotation.y = s * 0.18;
      this.model.add(strake);
      // Wingtip missile pod + running light (port red / starboard green).
      const podTip = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.6, 6, 10), panelMat);
      podTip.rotation.x = Math.PI / 2;
      podTip.position.set(s * 4.7, -0.1, 1.1);
      this.model.add(podTip);
      const navLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: s < 0 ? 0xff3355 : 0x33ff66 }));
      navLight.position.set(s * 4.7, -0.1, 0.1);
      this.model.add(navLight);
    }

    // --- Tail fins (twin canted + a dorsal blade). ---
    const finGeo = new THREE.BoxGeometry(0.28, 2.4, 2.8);
    for (const [x, rot, y] of [[1.9, 0.55, 0.7], [-1.9, -0.55, 0.7], [0, 0, 1.6]]) {
      const fin = new THREE.Mesh(finGeo, accentMat);
      fin.position.set(x, y, 3.1);
      fin.rotation.z = rot;
      this.model.add(fin);
      const finEdge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.14), stripMat);
      finEdge.position.set(x + Math.sin(rot) * 0.9, y + Math.cos(rot) * 0.9, 2.2);
      finEdge.rotation.z = rot;
      this.model.add(finEdge);
    }

    // --- Engine block: a gold thrust ring + a triangular cluster of recessed bells. ---
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.34, 12, 28), trimMat);
    ring.position.z = 4.0;
    this.model.add(ring);
    this.engineGlows = [];
    for (const off of [[0, 0.85], [-0.95, -0.55], [0.95, -0.55]]) {
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 1.2, 16), hullMat);
      housing.rotation.x = Math.PI / 2;
      housing.position.set(off[0], off[1], 3.9);
      this.model.add(housing);
      // Recessed dark bell so thrust reads as coming from a real nozzle.
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.44, 1.3, 16, 1, true), panelMat);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(off[0], off[1], 4.5);
      this.model.add(nozzle);
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.58, 16), engineMat);
      e.position.set(off[0], off[1], 4.7);
      e.rotation.y = Math.PI;
      this.model.add(e);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0x66ffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.set(2, 2, 1);
      glow.position.set(off[0], off[1], 5.3);
      this.model.add(glow);
      this.engineGlows.push(glow);
    }

    // Muzzle points (where lasers spawn), in ship-local space — at the wing roots.
    this.muzzles = [new THREE.Vector3(-3.4, -0.15, -1.0), new THREE.Vector3(3.4, -0.15, -1.0)];
    this.muzzleToggle = 0;

    // Muzzle-flash sprites that pop when firing.
    this.muzzleFlashes = [];
    for (const m of this.muzzles) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0xbffcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      f.position.copy(m).add(new THREE.Vector3(0, 0, -1.2));
      f.scale.setScalar(0.01);
      this.model.add(f);
      this.muzzleFlashes.push(f);
    }

    // Engine light
    this.engineLight = new THREE.PointLight(0x55ffff, 1.5, 60, 2);
    this.engineLight.position.set(0, 0, 6);
    this.model.add(this.engineLight);

    // Overdrive aura — a golden glow shell shown only while overdrive is active.
    this.overdriveAura = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: 0xffd24a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.overdriveAura.scale.setScalar(20);
    this.overdriveAura.visible = false;
    this.group.add(this.overdriveAura);
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
    this.weaponLevel = 1;
    this.missiles = 3;
    this.missileCooldown = 0;
    this.missileRegen = 0;
    this.overdrive = 0;
    this.overdriveActive = false;
    this.overdriveTimer = 0;
    if (this.overdriveAura) this.overdriveAura.visible = false;
    this.rolling = false;
    this.rollTimer = 0;
    this.rollCd = 0;
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
    const yaw = -input.yaw * this.yawRate * this.turnScale * dt;
    const pitch = input.pitch * this.pitchRate * this.turnScale * dt;
    const roll = -input.roll * this.rollRate * dt;

    this.group.rotateY(yaw);
    this.group.rotateX(pitch);
    this.group.rotateZ(roll);

    // Roll auto-level: successive local yaw+pitch rotations slowly accumulate roll
    // (gimbal walk), which would tumble the horizon. Unless the player is actively
    // rolling, gently rotate back to wings-level (ship's right vector horizontal),
    // easing off when flying near-vertical where "level" is ambiguous.
    if (roll === 0) {
      _right.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      _fwd.set(0, 0, -1).applyQuaternion(this.group.quaternion);
      const horizFactor = clamp(1 - Math.abs(_fwd.y) * 1.1, 0, 1);
      this.group.rotateZ(-_right.y * 3.0 * dt * horizFactor);
    }

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

    // ---- Barrel-roll evade ----
    if (this.rollCd > 0) this.rollCd -= dt;
    if (this.rolling) {
      this.rollTimer -= dt;
      const t = clamp(1 - this.rollTimer / this.rollDuration, 0, 1); // 0..1 progress
      // Sideways dash — strong at the start, easing out.
      const dash = 95 * (1 - t) * (1 - t);
      _right.set(1, 0, 0).applyQuaternion(this.group.quaternion);
      this.group.position.addScaledVector(_right, this.rollDir * dash * dt);
      // 360° visual spin, overriding the bank for the duration.
      this.model.rotation.z = this.bank + this.rollDir * Math.PI * 2 * t;
      if (this.rollTimer <= 0) this.rolling = false;
    }

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
    if (this.missileCooldown > 0) this.missileCooldown -= dt;
    if (this.muzzleFlash > 0) this.muzzleFlash -= dt;
    // Muzzle flash visual: bright pop that shrinks over the flash window.
    const mf = clamp(this.muzzleFlash / 0.05, 0, 1);
    for (const f of this.muzzleFlashes) {
      f.material.opacity = mf * 0.9;
      f.scale.setScalar(0.6 + mf * 3.2);
      f.visible = mf > 0.01;
    }
    // Cool down heat over time.
    this.heat = clamp(this.heat - dt * 0.32, 0, 1);
    if (this.overheated && this.heat < 0.35) this.overheated = false;

    // ---- Missile slow regen (a fresh missile every ~9s, up to max) ----
    if (this.missiles < this.maxMissiles) {
      this.missileRegen += dt;
      if (this.missileRegen >= 9) { this.missileRegen = 0; this.missiles++; }
    } else {
      this.missileRegen = 0;
    }

    // ---- Overdrive ----
    if (this.overdriveActive) {
      this.overdriveTimer -= dt;
      if (this.overdriveTimer <= 0) { this.overdriveActive = false; this.overdriveAura.visible = false; }
      else {
        this.overdriveAura.visible = true;
        const puls = 0.7 + Math.sin(this.enginePulse * 0.6) * 0.3;
        this.overdriveAura.material.opacity = 0.5 * puls;
        this.overdriveAura.scale.setScalar(18 + puls * 6);
        // Full shields stay topped up while invincible.
        this.shield = this.maxShield;
      }
    }

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

  // Fire the primary weapon. Returns an array of {pos, dir} bolts, or null if unable.
  // Higher weapon levels add angled barrels (spread) and a tighter fire rate.
  tryFire() {
    // Overdrive ignores overheating and fires much faster.
    if (this.fireCooldown > 0 || (this.overheated && !this.overdriveActive) || !this.alive) return null;
    if (this.overdriveActive) {
      this.fireCooldown = this.fireRate * 0.45;
    } else {
      // Level 3 fires noticeably faster.
      this.fireCooldown = this.fireRate * (this.weaponLevel >= 3 ? 0.7 : 1);
      this.heat = clamp(this.heat + 0.09, 0, 1);
      if (this.heat >= 1) this.overheated = true;
    }
    this.muzzleFlash = 0.05;

    const fwd = this.forwardVector();
    const up = _up.set(0, 1, 0).applyQuaternion(this.group.quaternion);
    const right = _right.set(1, 0, 0).applyQuaternion(this.group.quaternion);
    const shots = [];
    // Two main barrels straight ahead.
    for (const m of this.muzzles) {
      shots.push({ pos: m.clone().applyMatrix4(this.model.matrixWorld), dir: fwd.clone() });
    }
    // Level 2+: outward spread pair.
    if (this.weaponLevel >= 2) {
      for (const sign of [-1, 1]) {
        const d = fwd.clone().addScaledVector(right, sign * 0.14).normalize();
        const pos = this.muzzles[sign < 0 ? 0 : 1].clone().applyMatrix4(this.model.matrixWorld);
        shots.push({ pos, dir: d });
      }
    }
    // Level 3: an extra pair angled up/down for a wider fan.
    if (this.weaponLevel >= 3) {
      for (const sign of [-1, 1]) {
        const d = fwd.clone().addScaledVector(up, sign * 0.1).addScaledVector(right, sign * 0.06).normalize();
        const pos = this.muzzles[sign < 0 ? 0 : 1].clone().applyMatrix4(this.model.matrixWorld);
        shots.push({ pos, dir: d });
      }
    }
    return shots;
  }

  // Fire a homing missile if one is loaded. Returns {pos, dir} or null.
  tryFireMissile() {
    if (this.missiles <= 0 || this.missileCooldown > 0 || !this.alive) return null;
    this.missiles--;
    this.missileCooldown = 0.55;
    const dir = this.forwardVector();
    const pos = new THREE.Vector3(0, -0.8, -3).applyMatrix4(this.model.matrixWorld);
    return { pos, dir: dir.clone() };
  }

  upgradeWeapon() {
    this.weaponLevel = Math.min(this.maxWeaponLevel, this.weaponLevel + 1);
    return this.weaponLevel;
  }

  addMissiles(n) { this.missiles = clamp(this.missiles + n, 0, this.maxMissiles); }

  // Start a barrel-roll evade in `dir` (-1 left, +1 right). Returns true if it began.
  barrelRoll(dir) {
    if (this.rolling || this.rollCd > 0 || !this.alive) return false;
    this.rolling = true;
    this.rollTimer = this.rollDuration;
    this.rollDir = dir < 0 ? -1 : 1;
    this.rollCd = 1.1;
    return true;
  }
  get invulnerable() { return this.overdriveActive || this.rolling; }

  // Overdrive charge accrues from kills (blocked while overdrive is running).
  addOverdrive(n) { if (!this.overdriveActive) this.overdrive = clamp(this.overdrive + n, 0, this.overdriveMax); }
  canOverdrive() { return this.alive && !this.overdriveActive && this.overdrive >= this.overdriveMax; }
  activateOverdrive() {
    if (!this.canOverdrive()) return false;
    this.overdriveActive = true;
    this.overdriveTimer = this.overdriveDuration;
    this.overdrive = 0;
    return true;
  }

  damageBy(amount) {
    // Invincible during overdrive and while barrel-rolling (dodge frames).
    if (!this.alive || this.overdriveActive || this.rolling) return;
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
