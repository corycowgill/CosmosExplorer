// Alien ships: three visually distinct types with different behaviour, spawned in
// escalating waves around the player. Each alien flies with simple steering (seek /
// strafe / evade) and fires at the player. Models are built from primitives.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';
import { randRange, clamp, damp } from './utils.js';

const TYPES = {
  // Fast, weak, swarms the player.
  scout: {
    color: 0x66ff88, glow: 0xaaffcc, radius: 4.5, health: 2, speed: 46, turn: 1.6,
    score: 100, fireCooldown: 2.4, damage: 8, projSpeed: 130, behaviour: 'seek',
  },
  // Medium fighter, strafes and shoots more.
  fighter: {
    color: 0xff66cc, glow: 0xffaaee, radius: 5.5, health: 4, speed: 38, turn: 1.1,
    score: 200, fireCooldown: 1.8, damage: 12, projSpeed: 150, behaviour: 'strafe',
  },
  // Slow tanky saucer, heavy hits.
  cruiser: {
    color: 0xffaa33, glow: 0xffdd88, radius: 9, health: 10, speed: 22, turn: 0.6,
    score: 500, fireCooldown: 2.2, damage: 22, projSpeed: 120, behaviour: 'advance',
  },
  // Mothership boss (every 5th wave): huge, tanky, fires fans and summons scouts.
  boss: {
    color: 0xaa44ff, glow: 0xdd88ff, radius: 26, health: 120, speed: 16, turn: 0.5,
    score: 5000, fireCooldown: 1.6, damage: 16, projSpeed: 130, behaviour: 'boss',
  },
};

function buildScout(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.7, roughness: 0.35, emissive: def.color, emissiveIntensity: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x223322, metalness: 0.6, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), mat);
  body.scale.set(1, 0.7, 1.5);
  g.add(body);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.8, 5, 4), dark);
    wing.rotation.z = Math.PI / 2 * s;
    wing.position.set(3.2 * s, 0, 1);
    g.add(wing);
  }
  return g;
}

function buildFighter(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.75, roughness: 0.3, emissive: def.color, emissiveIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x330022, metalness: 0.6, roughness: 0.5 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), mat);
  g.add(core);
  const prongGeo = new THREE.BoxGeometry(0.8, 0.8, 7);
  for (const s of [-1, 1]) {
    const prong = new THREE.Mesh(prongGeo, dark);
    prong.position.set(3 * s, 0, -1.5);
    prong.rotation.y = -0.2 * s;
    g.add(prong);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), new THREE.MeshBasicMaterial({ color: def.glow }));
    tip.position.set(3.4 * s, 0, -4.5);
    g.add(tip);
  }
  return g;
}

function buildCruiser(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.7, roughness: 0.4, emissive: def.color, emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x332200, metalness: 0.6, roughness: 0.5 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1.6, 24), mat);
  g.add(disc);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 14, 0, Math.PI*2, 0, Math.PI/2), new THREE.MeshStandardMaterial({ color: 0xffee99, emissive: 0xaa6600, emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.2 }));
  dome.position.y = 0.8;
  g.add(dome);
  const under = new THREE.Mesh(new THREE.ConeGeometry(4, 3, 24), dark);
  under.rotation.x = Math.PI;
  under.position.y = -1.6;
  g.add(under);
  // Glowing lights around the rim.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshBasicMaterial({ color: def.glow }));
    light.position.set(Math.cos(a) * 6.6, 0, Math.sin(a) * 6.6);
    g.add(light);
  }
  return g;
}

function buildBoss(def) {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x2a2036, metalness: 0.85, roughness: 0.4, emissive: 0x180a2a, emissiveIntensity: 0.4 });
  const glowMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 });
  const darkGlow = new THREE.MeshStandardMaterial({ color: def.glow, emissive: def.glow, emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 });

  // Central hull — a wide, menacing disc-hull.
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 1), hull);
  body.scale.set(1.3, 0.55, 1.3);
  g.add(body);

  // Glowing reactor core + aura.
  const core = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 24), glowMat);
  core.position.y = 1;
  g.add(core);
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: def.glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  aura.scale.setScalar(46);
  g.add(aura);

  // Twin rotating rings.
  for (const [r, tilt] of [[24, 0.2], [30, -0.35]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 1.2, 10, 40), darkGlow);
    ring.rotation.x = Math.PI / 2 + tilt;
    g.add(ring);
  }

  // Turret pods + spikes around the rim.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 12), glowMat);
    pod.position.set(Math.cos(a) * 17, 0, Math.sin(a) * 17);
    g.add(pod);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(1.6, 8, 6), hull);
    spike.position.set(Math.cos(a) * 20, 0, Math.sin(a) * 20);
    spike.rotation.z = -Math.PI / 2;
    spike.rotation.y = -a;
    g.add(spike);
  }
  return g;
}

const BUILDERS = { scout: buildScout, fighter: buildFighter, cruiser: buildCruiser, boss: buildBoss };

class Alien {
  constructor(scene, type) {
    this.scene = scene;
    this.type = type;
    this.def = TYPES[type];
    this.group = new THREE.Group();
    this.mesh = BUILDERS[type](this.def);
    this.group.add(this.mesh);

    // Tight aura glow so the ship's silhouette still reads (was washing out).
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: this.def.glow, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.aura.scale.setScalar(this.def.radius * 2.1);
    this.group.add(this.aura);

    // Thruster glow behind the ship. Attached to the group (which faces travel via
    // lookAt, +Z = forward) so it sits behind the alien and never spins with the hull.
    this.trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: this.def.glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.scale.setScalar(this.def.radius * 1.7);
    this.trail.position.set(0, 0, -this.def.radius * 1.1);
    this.group.add(this.trail);

    // Give the hull a stronger self-lit glow so the geometry pops at distance.
    this.mesh.traverse((o) => {
      if (o.material && o.material.emissive) o.material.emissiveIntensity = Math.max(o.material.emissiveIntensity || 0, 0.55);
    });

    scene.add(this.group);
    this.group.visible = false;

    this.alive = false;
    this.velocity = new THREE.Vector3();
    this.health = 0;
    this.fireTimer = 0;
    this.wobble = Math.random() * Math.PI * 2;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.hitFlash = 0;
  }

  spawn(pos) {
    this.group.position.copy(pos);
    this.group.visible = true;
    this.alive = true;
    this.health = this.def.health;
    this.maxHealth = this.def.health;
    this.velocity.set(0, 0, 0);
    this.fireTimer = randRange(0.5, this.def.fireCooldown);
    this.hitFlash = 0;
    // Boss attack scheduling.
    this.bossTimer = 2.0;
    this.bossPattern = 0;
  }

  kill() { this.alive = false; this.group.visible = false; }

  hit(dmg) {
    this.health -= dmg;
    this.hitFlash = 0.12;
    return this.health <= 0;
  }

  get position() { return this.group.position; }
  get radius() { return this.def.radius; }

  update(dt, playerPos, difficulty) {
    if (!this.alive) return;
    this.wobble += dt * 2;
    const def = this.def;

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const dist = toPlayer.length();
    toPlayer.normalize();

    // Desired heading depends on behaviour.
    let desired = toPlayer.clone();
    if (def.behaviour === 'strafe' && dist < 260) {
      // Circle-strafe: mix of toward-player and perpendicular.
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(toPlayer, up).normalize().multiplyScalar(this.strafeDir);
      desired.addScaledVector(side, 1.3);
      if (dist < 130) desired.addScaledVector(toPlayer, -1.4); // back off when too close
      desired.normalize();
    } else if (def.behaviour === 'advance') {
      // Slow relentless approach with slight wobble.
      desired.y += Math.sin(this.wobble) * 0.2;
      desired.normalize();
    } else if (def.behaviour === 'boss') {
      // Hold at a menacing mid-range, orbiting slowly.
      const ideal = 230;
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(toPlayer, up).normalize().multiplyScalar(this.strafeDir);
      desired.copy(side).multiplyScalar(0.8);
      if (dist > ideal + 40) desired.addScaledVector(toPlayer, 1.0);      // close in
      else if (dist < ideal - 40) desired.addScaledVector(toPlayer, -1.0); // back off
      desired.y += Math.sin(this.wobble * 0.6) * 0.15;
      desired.normalize();
    } else {
      // seek with wobble
      desired.x += Math.sin(this.wobble * 1.3) * 0.25;
      desired.y += Math.cos(this.wobble) * 0.25;
      desired.normalize();
    }

    // Steer velocity toward desired.
    const speed = def.speed * (0.9 + difficulty * 0.06);
    const targetVel = desired.multiplyScalar(speed);
    this.velocity.lerp(targetVel, damp(def.turn * 1.4, dt));
    this.group.position.addScaledVector(this.velocity, dt);

    // Face travel direction.
    if (this.velocity.lengthSq() > 0.01) {
      const look = new THREE.Vector3().copy(this.group.position).add(this.velocity);
      this.group.lookAt(look);
    }
    // Spin for character.
    if (this.type === 'cruiser') this.mesh.rotation.y += dt * 1.2;
    else if (this.type === 'boss') this.mesh.rotation.y += dt * 0.5;
    else this.mesh.rotation.z += dt * 0.6;

    // Hit flash decay (restores to the brighter self-lit base, not below it).
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const f = Math.max(0, this.hitFlash / 0.12);
      this.mesh.traverse((o) => { if (o.material && o.material.emissive) o.material.emissiveIntensity = 0.55 + f * 2.5; });
    }

    // Aura + thruster pulse.
    this.aura.material.opacity = 0.28 + Math.sin(this.wobble * 2) * 0.08;
    const throb = 0.85 + Math.sin(this.wobble * 4) * 0.15;
    this.trail.scale.setScalar(this.def.radius * 1.7 * throb);

    // Fire logic handled by manager (needs projectile pool); expose readiness.
    this.fireTimer -= dt;
  }

  wantsToFire(playerPos, difficulty) {
    if (!this.alive) return false;
    const dist = this.position.distanceTo(playerPos);
    if (dist > 340) return false;
    if (this.fireTimer <= 0) {
      this.fireTimer = this.def.fireCooldown * (0.7 + Math.random() * 0.6) / (1 + difficulty * 0.05);
      return true;
    }
    return false;
  }
}

export class AlienManager {
  constructor(scene, projectiles, audio) {
    this.scene = scene;
    this.projectiles = projectiles;
    this.audio = audio;
    this.aliens = [];
    this.pools = { scout: [], fighter: [], cruiser: [], boss: [] };
    this.wave = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.difficulty = 1;
    this.bossWave = false;
    this.boss = null;
    this.onKill = null; // callback(alien, position)
  }

  _acquire(type) {
    let a = this.pools[type].find((x) => !x.alive);
    if (!a) {
      a = new Alien(this.scene, type);
      this.pools[type].push(a);
      this.aliens.push(a);
    }
    return a;
  }

  reset() {
    for (const a of this.aliens) a.kill();
    this.wave = 0;
    this.difficulty = 1;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.bossWave = false;
    this.boss = null;
    this._pendingWave = null;
  }

  liveCount() {
    let n = 0;
    for (const a of this.aliens) if (a.alive) n++;
    return n;
  }

  startWave(wave) {
    this.wave = wave;
    this.difficulty = wave;
    this.boss = null;

    // Every 5th wave is a boss wave: one Mothership plus a small escort.
    this.bossWave = wave % 5 === 0;
    if (this.bossWave) {
      this._queue = ['boss'];
      const escorts = 2 + Math.floor(wave / 5);
      for (let i = 0; i < escorts; i++) this._queue.push('fighter');
      this.toSpawn = this._queue.length;
      this.spawnTimer = 0;
      this.maxConcurrent = 16;
      return;
    }

    // Composition scales with wave.
    const scouts = 3 + wave * 2;
    const fighters = Math.max(0, wave - 1) + Math.floor(wave / 2);
    const cruisers = Math.floor(wave / 3);
    this._queue = [];
    for (let i = 0; i < scouts; i++) this._queue.push('scout');
    for (let i = 0; i < fighters; i++) this._queue.push('fighter');
    for (let i = 0; i < cruisers; i++) this._queue.push('cruiser');
    // Shuffle.
    for (let i = this._queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._queue[i], this._queue[j]] = [this._queue[j], this._queue[i]];
    }
    this.toSpawn = this._queue.length;
    this.spawnTimer = 0;
    this.maxConcurrent = Math.min(6 + wave, 16);
  }

  bossAlive() { return this.boss && this.boss.alive; }
  bossHealthPct() { return this.boss ? clamp((this.boss.health / this.boss.maxHealth) * 100, 0, 100) : 0; }

  _spawnOne(playerPos, playerForward) {
    const type = this._queue.shift();
    if (!type) return;
    const a = this._acquire(type);
    // Spawn ahead-ish of the player, on a shell, so they fly into view.
    const dir = new THREE.Vector3(randRange(-1,1), randRange(-0.5,0.5), randRange(-1,1)).normalize();
    // Bias toward the player's forward hemisphere.
    if (playerForward) dir.addScaledVector(playerForward, 0.8).normalize();
    const dist = type === 'boss' ? 300 : randRange(280, 420);
    const pos = playerPos.clone().addScaledVector(dir, dist);
    a.spawn(pos);
    if (type === 'boss') {
      // Scale boss HP with how deep the run is.
      a.maxHealth = a.def.health + Math.floor(this.wave / 5) * 90;
      a.health = a.maxHealth;
      this.boss = a;
    }
  }

  // Boss attack patterns: alternating fan-fire and scout summons.
  _bossAttack(boss, player) {
    const playerPos = player.position;
    const up = new THREE.Vector3(0, 1, 0);
    if (boss.bossPattern % 2 === 0) {
      // Fan of bolts aimed at the player.
      const base = new THREE.Vector3().subVectors(playerPos, boss.position).normalize();
      const q = new THREE.Quaternion();
      for (let i = -3; i <= 3; i++) {
        const dir = base.clone().applyQuaternion(q.setFromAxisAngle(up, i * 0.11));
        const vel = dir.clone().multiplyScalar(boss.def.projSpeed);
        const muzzle = boss.position.clone().addScaledVector(dir, boss.radius + 2);
        this.projectiles.fire(muzzle, vel, { enemy: true, damage: boss.def.damage, life: 4, radius: 3 });
      }
      if (this.audio) this.audio.enemyLaser();
    } else {
      // Summon a pair of scouts flanking the boss.
      for (const s of [-1, 1]) {
        const scout = this._acquire('scout');
        const side = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(playerPos, boss.position).normalize(), up).multiplyScalar(s * 30);
        scout.spawn(boss.position.clone().add(side));
      }
      if (this.audio) this.audio.pickup();
    }
    boss.bossPattern++;
  }

  update(dt, player) {
    const playerPos = player.position;
    const playerForward = player.forwardVector();

    // Trickle-spawn the wave, respecting a concurrency cap.
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.liveCount() < this.maxConcurrent) {
        this._spawnOne(playerPos, playerForward);
        this.toSpawn--;
        this.spawnTimer = randRange(0.4, 1.1);
      }
    }

    const tmpVel = new THREE.Vector3();
    for (const a of this.aliens) {
      if (!a.alive) continue;
      a.update(dt, playerPos, this.difficulty);

      // Boss uses timed attack patterns instead of the single-bolt fire.
      if (a.type === 'boss') {
        a.bossTimer -= dt;
        if (a.bossTimer <= 0 && a.position.distanceTo(playerPos) < 600) {
          this._bossAttack(a, player);
          a.bossTimer = randRange(1.6, 2.4);
        }
        continue;
      }

      // Firing.
      if (a.wantsToFire(playerPos, this.difficulty)) {
        // Aim with a little lead toward the player's velocity.
        const aim = new THREE.Vector3().subVectors(playerPos, a.position);
        const dist = aim.length();
        aim.normalize();
        const lead = tmpVel.copy(player.velocity).multiplyScalar(clamp(dist / a.def.projSpeed, 0, 1.2));
        const target = playerPos.clone().add(lead);
        const dir = target.sub(a.position).normalize();
        const vel = dir.multiplyScalar(a.def.projSpeed);
        const muzzle = a.position.clone().addScaledVector(dir, a.radius + 1);
        this.projectiles.fire(muzzle, vel, { enemy: true, damage: a.def.damage, life: 3.5, radius: 2.5 });
        if (this.audio) this.audio.enemyLaser();
      }

      // Despawn stragglers that wandered absurdly far.
      if (a.position.distanceTo(playerPos) > 1400) a.kill();
    }
  }

  // Wave is complete when nothing left to spawn and nothing alive.
  waveComplete() {
    return this.toSpawn <= 0 && this.liveCount() === 0;
  }
}
