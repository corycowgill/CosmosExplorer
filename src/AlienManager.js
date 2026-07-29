// Alien ships: three visually distinct types with different behaviour, spawned in
// escalating waves around the player. Each alien flies with simple steering (seek /
// strafe / evade) and fires at the player. Models are built from primitives.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';
import { randRange, clamp, damp } from './utils.js';

const _v1 = new THREE.Vector3();

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
  // Shielded sentinel: a frontal energy shield blocks head-on fire — flank it,
  // break the shield with sustained hits, or bypass it with a missile.
  sentinel: {
    color: 0x33ddff, glow: 0x99eeff, radius: 6, health: 7, speed: 19, turn: 0.9,
    score: 350, fireCooldown: 2.0, damage: 14, projSpeed: 145, behaviour: 'sentinel',
    shieldHP: 6,
  },
  // Stinger: a fast, fragile kamikaze that locks on, then dashes to ram you.
  stinger: {
    color: 0xff5522, glow: 0xffaa66, radius: 4, health: 2, speed: 58, turn: 2.2,
    score: 150, fireCooldown: 0, damage: 0, projSpeed: 0, behaviour: 'kamikaze', ramDamage: 26,
  },
  // Lancer: a long-range sniper that charges a visible beam, then fires a fast bolt.
  lancer: {
    color: 0xffee44, glow: 0xffffaa, radius: 5, health: 5, speed: 15, turn: 0.8,
    score: 300, fireCooldown: 3.0, damage: 26, projSpeed: 300, behaviour: 'sniper',
  },
  // Mothership boss: huge, tanky, fires aimed fans and summons scouts.
  boss: {
    color: 0xaa44ff, glow: 0xdd88ff, radius: 26, health: 120, speed: 16, turn: 0.5,
    score: 5000, fireCooldown: 1.6, damage: 16, projSpeed: 130, behaviour: 'boss',
  },
  // Warden dreadnought: faster, aggressive — radial bursts, homing seekers, spiral fans.
  warden: {
    color: 0xff3355, glow: 0xff88aa, radius: 21, health: 100, speed: 21, turn: 0.6,
    score: 6000, fireCooldown: 1.5, damage: 15, projSpeed: 125, behaviour: 'boss',
  },
};

const BOSS_TYPES = new Set(['boss', 'warden']);

// How long a Lancer telegraphs its charge before it looses a bolt.
const LANCER_CHARGE = 1.4;

function buildScout(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.3, emissive: def.color, emissiveIntensity: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2a1c, metalness: 0.8, roughness: 0.45, envMapIntensity: 1.1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), mat);
  body.scale.set(1, 0.7, 1.5);
  g.add(body);
  // A glowing sensor "eye" up front and a rear thruster.
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 12), glowMat);
  eye.position.set(0, 0.1, -3.2);
  g.add(eye);
  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.8, 12), glowMat);
  thruster.rotation.x = Math.PI / 2;
  thruster.position.set(0, 0, 4);
  g.add(thruster);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.8, 5, 4), dark);
    wing.rotation.z = Math.PI / 2 * s;
    wing.position.set(3.2 * s, 0, 1);
    g.add(wing);
    // Glowing wing-edge strip.
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.12), glowMat);
    edge.position.set(2 * s, 0, -0.6);
    g.add(edge);
  }
  return g;
}

function buildFighter(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.85, roughness: 0.26, envMapIntensity: 1.4, emissive: def.color, emissiveIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a0020, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), mat);
  g.add(core);
  // Glowing equatorial band + a bright core node.
  const band = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.22, 8, 24), glowMat);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const node = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 12), glowMat);
  node.position.set(0, 0, -2.6);
  g.add(node);
  const prongGeo = new THREE.BoxGeometry(0.8, 0.8, 7);
  for (const s of [-1, 1]) {
    const prong = new THREE.Mesh(prongGeo, dark);
    prong.position.set(3 * s, 0, -1.5);
    prong.rotation.y = -0.2 * s;
    g.add(prong);
    // Emissive strip along each prong + a glowing tip.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 6.4), glowMat);
    strip.position.set(3 * s, 0.42, -1.5);
    strip.rotation.y = -0.2 * s;
    g.add(strip);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 10), glowMat);
    tip.position.set(3.4 * s, 0, -4.5);
    g.add(tip);
  }
  return g;
}

function buildCruiser(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.3, emissive: def.color, emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a1c00, metalness: 0.8, roughness: 0.42, envMapIntensity: 1.1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1.6, 32), mat);
  g.add(disc);
  // Beveled rim ring + a glowing equatorial band.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(7, 0.6, 10, 40), dark);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const band = new THREE.Mesh(new THREE.TorusGeometry(7.05, 0.16, 8, 40), glowMat);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.2, 24, 16, 0, Math.PI*2, 0, Math.PI/2), new THREE.MeshStandardMaterial({ color: 0xffee99, emissive: 0xaa6600, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.15, envMapIntensity: 1.5 }));
  dome.position.y = 0.8;
  g.add(dome);
  // Panel-line spokes on the top disc.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 4), dark);
    spoke.position.set(Math.cos(a) * 4.5, 0.85, Math.sin(a) * 4.5);
    spoke.rotation.y = -a;
    g.add(spoke);
  }
  const under = new THREE.Mesh(new THREE.ConeGeometry(4, 3, 32), dark);
  under.rotation.x = Math.PI;
  under.position.y = -1.6;
  g.add(under);
  const underGlow = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12), glowMat);
  underGlow.position.y = -2.8;
  g.add(underGlow);
  // Glowing lights around the rim.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), glowMat);
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

function buildSentinel(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.85, roughness: 0.3, envMapIntensity: 1.3, emissive: def.color, emissiveIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0e2630, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });

  // Angular core (an octahedron drum) with a glowing eye and side vanes.
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(3.2, 0), mat);
  core.scale.set(1, 1.1, 0.8);
  g.add(core);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), glowMat);
  eye.position.set(0, 0, -2.6);
  g.add(eye);
  for (const s of [-1, 1]) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 2), dark);
    vane.position.set(3 * s, 0, 1);
    vane.rotation.z = 0.3 * s;
    g.add(vane);
  }

  // Frontal energy shield — a translucent dome facing +Z (toward the player).
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 1.5, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshBasicMaterial({ color: def.glow, transparent: true, opacity: 0.4, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  shield.rotation.x = -Math.PI / 2;   // dome opening back, convex toward +Z
  shield.position.z = -def.radius * 0.2;
  shield.name = 'sentinelShield';
  g.add(shield);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 1.42, 0.14, 8, 28), glowMat);
  rim.name = 'sentinelShieldRim';
  rim.position.z = -def.radius * 0.2;
  g.add(rim);
  return g;
}

function buildWarden(def) {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x2a1016, metalness: 0.85, roughness: 0.4, emissive: 0x1a0408, emissiveIntensity: 0.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });
  const coreMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.3 });

  // Elongated spindle hull (a stretched diamond).
  const spindle = new THREE.Mesh(new THREE.OctahedronGeometry(13, 1), hull);
  spindle.scale.set(0.7, 0.7, 1.9);
  g.add(spindle);
  // Glowing reactor core + aura.
  const core = new THREE.Mesh(new THREE.SphereGeometry(5, 22, 22), coreMat);
  g.add(core);
  const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: def.glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  aura.scale.setScalar(42);
  g.add(aura);
  // Forward maw ring (its firing mouth).
  const maw = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.7, 10, 28), glowMat);
  maw.position.z = -15;
  g.add(maw);
  // Four orbiting weapon pods on struts (spin with the hull).
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 14), hull);
    strut.position.set(Math.cos(a) * 9, Math.sin(a) * 9, 0);
    g.add(strut);
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 0), coreMat);
    pod.position.set(Math.cos(a) * 16, Math.sin(a) * 16, 0);
    g.add(pod);
  }
  // Rear thruster prongs.
  for (const s of [-1, 1]) {
    const prong = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 8), glowMat);
    prong.position.set(4 * s, 0, 15);
    prong.rotation.x = -Math.PI / 2;
    g.add(prong);
  }
  return g;
}

function buildStinger(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.8, roughness: 0.3, envMapIntensity: 1.3, emissive: def.color, emissiveIntensity: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a0e05, metalness: 0.7, roughness: 0.5 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });
  // Dart body — a sharp cone pointing forward (+Z is travel/forward for aliens).
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.6, 6, 8), mat);
  body.rotation.x = Math.PI / 2; // apex toward +Z
  g.add(body);
  // Glowing tip "eye".
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 10), glowMat);
  eye.position.z = 3;
  g.add(eye);
  // Swept-back wings.
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3.5, 4), dark);
    wing.rotation.z = Math.PI / 2 * s;
    wing.position.set(2 * s, 0, -1.5);
    g.add(wing);
  }
  return g;
}

function buildLancer(def) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.85, roughness: 0.3, envMapIntensity: 1.3, emissive: def.color, emissiveIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2405, metalness: 0.8, roughness: 0.4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: def.glow });
  // Long thin hull.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, 7, 12), mat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  // Big front cannon lens (the charge emitter).
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1, 2, 14), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 4;
  g.add(lens);
  // Charge glow — grows/brightens while charging a shot.
  const charge = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowSprite(), color: def.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  charge.scale.setScalar(3);
  charge.position.z = 5.2;
  charge.name = 'lancerCharge';
  g.add(charge);
  // Stabilizer fins at the rear.
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 1.6), glowMat);
    fin.position.set(1.4 * s, 0, -2.6);
    g.add(fin);
  }
  return g;
}

const BUILDERS = { scout: buildScout, fighter: buildFighter, cruiser: buildCruiser, boss: buildBoss, sentinel: buildSentinel, warden: buildWarden, stinger: buildStinger, lancer: buildLancer };

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
    this._facing = new THREE.Vector3(0, 0, 1);

    // Sentinel shield references.
    this.shieldMesh = this.mesh.getObjectByName('sentinelShield');
    this.shieldRim = this.mesh.getObjectByName('sentinelShieldRim');
    // Lancer charge-glow reference.
    this.chargeGlow = this.mesh.getObjectByName('lancerCharge');
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
    // Sentinel shield.
    this.shieldActive = this.type === 'sentinel';
    this.shieldHP = this.def.shieldHP || 0;
    this.shieldRecharge = 0;
    this.shieldFlash = 0;
    if (this.shieldMesh) { this.shieldMesh.visible = this.shieldActive; this.shieldRim.visible = this.shieldActive; }
    // Stinger kamikaze + Lancer sniper state.
    this.kState = 'seek';
    this.kTimer = 0;
    this.dashDir = new THREE.Vector3();
    this.charging = false;
    this.chargeTimer = 0;
    if (this.chargeGlow) this.chargeGlow.material.opacity = 0;
  }

  kill() { this.alive = false; this.group.visible = false; }

  hit(dmg) {
    this.health -= dmg;
    this.hitFlash = 0.12;
    return this.health <= 0;
  }

  // Shield-aware hit: sentinels block non-missile fire that arrives within their
  // frontal shield arc, damaging the shield until it overloads and drops. Returns
  // { dead, blocked }.
  hitFrom(dmg, boltPos, isMissile) {
    if (this.type === 'sentinel' && this.shieldActive && !isMissile) {
      const toBolt = _v1.subVectors(boltPos, this.position).normalize();
      if (toBolt.dot(this._facing) > 0.35) {          // came from the shielded front
        this.shieldHP -= dmg;
        this.shieldFlash = 0.16;
        if (this.shieldHP <= 0) { this.shieldActive = false; this.shieldRecharge = 4; }
        return { dead: false, blocked: true };
      }
    }
    return { dead: this.hit(dmg), blocked: false };
  }

  get position() { return this.group.position; }
  get radius() { return this.def.radius; }

  update(dt, playerPos, difficulty, speedMul = 1) {
    if (!this.alive) return;
    this.wobble += dt * 2;
    const def = this.def;

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const dist = toPlayer.length();
    toPlayer.normalize();

    // Desired heading depends on behaviour.
    let desired = toPlayer.clone();
    let extraSpeed = 1; // per-behaviour speed multiplier (dash / hold / etc.)
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
    } else if (def.behaviour === 'sentinel') {
      // Keep its shielded face toward the player while drifting to hold ~200 range.
      if (dist > 240) desired.copy(toPlayer);
      else if (dist < 150) desired.copy(toPlayer).multiplyScalar(-1);
      else {
        const up = new THREE.Vector3(0, 1, 0);
        desired.copy(new THREE.Vector3().crossVectors(toPlayer, up)).multiplyScalar(this.strafeDir * 0.5);
      }
      desired.normalize();
    } else if (def.behaviour === 'kamikaze') {
      // Seek → telegraph a lock → commit to a fast straight dash to ram the player.
      this.kTimer -= dt;
      if (this.kState === 'seek') {
        desired.copy(toPlayer);
        if (dist < 320) { this.kState = 'lock'; this.kTimer = 0.55; }
      } else if (this.kState === 'lock') {
        desired.copy(toPlayer);
        extraSpeed = 0.12; // slow, aiming — the tell that a dash is coming
        if (this.kTimer <= 0) { this.kState = 'dash'; this.kTimer = 1.6; this.dashDir.copy(toPlayer); }
      } else { // dash
        desired.copy(this.dashDir);
        extraSpeed = 2.6;
        if (this.kTimer <= 0) this.kState = 'seek';
      }
      desired.normalize();
    } else if (def.behaviour === 'sniper') {
      // Hold long range, strafe, and slow to a near-stop while charging a shot.
      const ideal = 420;
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(toPlayer, up).normalize().multiplyScalar(this.strafeDir * 0.6);
      desired.copy(side);
      if (dist > ideal + 60) desired.addScaledVector(toPlayer, 1.0);
      else if (dist < ideal - 60) desired.addScaledVector(toPlayer, -1.0);
      desired.normalize();
      if (this.charging) { extraSpeed = 0.1; this.chargeTimer -= dt; }
    } else {
      // seek with wobble
      desired.x += Math.sin(this.wobble * 1.3) * 0.25;
      desired.y += Math.cos(this.wobble) * 0.25;
      desired.normalize();
    }

    // Steer velocity toward desired.
    const speed = def.speed * (0.9 + difficulty * 0.06) * speedMul * extraSpeed;
    const targetVel = desired.multiplyScalar(speed);
    this.velocity.lerp(targetVel, damp(def.turn * 1.4, dt));
    this.group.position.addScaledVector(this.velocity, dt);

    // Facing: sentinels/lancers aim their front at the player; others face travel.
    if (this.type === 'sentinel' || this.type === 'lancer') {
      this.group.lookAt(playerPos);
      this._facing.copy(toPlayer); // +Z of the group points at the player
    } else if (this.velocity.lengthSq() > 0.01) {
      const look = new THREE.Vector3().copy(this.group.position).add(this.velocity);
      this.group.lookAt(look);
    }
    // Spin for character (directional craft keep their nose forward).
    if (this.type === 'cruiser') this.mesh.rotation.y += dt * 1.2;
    else if (this.type === 'boss') this.mesh.rotation.y += dt * 0.5;
    else if (this.type === 'warden') this.mesh.rotation.z += dt * 0.9;
    else if (!['sentinel', 'stinger', 'lancer'].includes(this.type)) this.mesh.rotation.z += dt * 0.6;

    // Sentinel shield: recharge after breaking, and drive its glow/flash.
    if (this.type === 'sentinel') this._updateShield(dt);

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

    // Kamikaze telegraph + lancer charge glow (override the generic aura above).
    if (this.type === 'stinger') this._updateStinger();
    else if (this.type === 'lancer') this._updateLancer(dt);

    // Fire logic handled by manager (needs projectile pool); expose readiness.
    this.fireTimer -= dt;
  }

  _updateStinger() {
    if (this.kState === 'lock') {
      // Rapid red flash — the tell that a ram dash is imminent.
      this.aura.material.color.setHex(0xff2200);
      this.aura.material.opacity = 0.4 + Math.abs(Math.sin(this.wobble * 12)) * 0.55;
      this.aura.scale.setScalar(this.def.radius * 2.8);
    } else if (this.kState === 'dash') {
      this.aura.material.color.setHex(0xff5522);
      this.aura.material.opacity = 0.75;
      this.aura.scale.setScalar(this.def.radius * 3.2);
    } else {
      this.aura.material.color.setHex(this.def.glow);
      this.aura.scale.setScalar(this.def.radius * 2.1);
    }
  }

  _updateLancer(dt) {
    if (!this.chargeGlow) return;
    if (this.charging) {
      const prog = clamp(1 - this.chargeTimer / LANCER_CHARGE, 0, 1);
      this.chargeGlow.material.opacity = 0.4 + prog * 0.6;
      this.chargeGlow.scale.setScalar(2 + prog * 6);
      this.aura.material.opacity = 0.4 + prog * 0.5; // whole ship glows as it charges
    } else {
      this.chargeGlow.material.opacity = Math.max(0, this.chargeGlow.material.opacity - dt * 5);
      this.chargeGlow.scale.setScalar(2);
    }
  }

  _updateShield(dt) {
    if (!this.shieldMesh) return;
    if (this.shieldFlash > 0) this.shieldFlash -= dt;
    if (!this.shieldActive) {
      // Recharging: keep the dome hidden until it comes back online.
      this.shieldRecharge -= dt;
      this.shieldMesh.visible = false;
      this.shieldRim.visible = false;
      if (this.shieldRecharge <= 0) {
        this.shieldActive = true;
        this.shieldHP = this.def.shieldHP;
      }
      return;
    }
    this.shieldMesh.visible = true;
    this.shieldRim.visible = true;
    const flash = this.shieldFlash > 0 ? 0.5 : 0;
    const hpFrac = this.shieldHP / this.def.shieldHP;
    this.shieldMesh.material.opacity = 0.22 + hpFrac * 0.22 + flash;
  }

  wantsToFire(playerPos, difficulty, fireRateMul = 1) {
    if (!this.alive) return false;
    const dist = this.position.distanceTo(playerPos);
    if (dist > 340) return false;
    if (this.fireTimer <= 0) {
      this.fireTimer = this.def.fireCooldown * (0.7 + Math.random() * 0.6) / (1 + difficulty * 0.05) * fireRateMul;
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
    this.pools = { scout: [], fighter: [], cruiser: [], boss: [], sentinel: [], warden: [], stinger: [], lancer: [] };
    this.wave = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.difficulty = 1;
    this.bossWave = false;
    this.boss = null;
    this.onKill = null; // callback(alien, position)
    // Difficulty multipliers (set by Game per selected difficulty).
    this.diff = { enemyDmg: 1, enemySpeed: 1, fireRate: 1, spawnMul: 1, scoreMul: 1 };
  }

  setDifficulty(cfg) { this.diff = cfg; }

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

    // Every 5th wave is a boss wave, alternating Mothership and Warden.
    this.bossWave = wave % 5 === 0;
    if (this.bossWave) {
      this.bossType = ((wave / 5) % 2 === 1) ? 'boss' : 'warden'; // 5=boss,10=warden,15=boss…
      this._queue = [this.bossType];
      const escorts = 2 + Math.floor(wave / 5);
      for (let i = 0; i < escorts; i++) this._queue.push('fighter');
      this.toSpawn = this._queue.length;
      this.spawnTimer = 0;
      this.maxConcurrent = 16;
      return;
    }

    // Composition scales with wave and the difficulty spawn multiplier.
    const m = this.diff.spawnMul;
    const scouts = Math.max(1, Math.round((3 + wave * 2) * m));
    const fighters = Math.round((Math.max(0, wave - 1) + Math.floor(wave / 2)) * m);
    const cruisers = Math.floor(wave / 3);
    const sentinels = wave >= 3 ? Math.round((1 + Math.floor((wave - 3) / 2)) * m) : 0;
    const stingers = wave >= 2 ? Math.round((1 + Math.floor((wave - 2) / 2)) * m) : 0;
    const lancers = wave >= 4 ? Math.round((1 + Math.floor((wave - 4) / 3)) * m) : 0;
    this._queue = [];
    for (let i = 0; i < scouts; i++) this._queue.push('scout');
    for (let i = 0; i < fighters; i++) this._queue.push('fighter');
    for (let i = 0; i < cruisers; i++) this._queue.push('cruiser');
    for (let i = 0; i < sentinels; i++) this._queue.push('sentinel');
    for (let i = 0; i < stingers; i++) this._queue.push('stinger');
    for (let i = 0; i < lancers; i++) this._queue.push('lancer');
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
    const dist = BOSS_TYPES.has(type) ? 300 : randRange(280, 420);
    const pos = playerPos.clone().addScaledVector(dir, dist);
    a.spawn(pos);
    if (BOSS_TYPES.has(type)) {
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
        this.projectiles.fire(muzzle, vel, { enemy: true, damage: boss.def.damage * this.diff.enemyDmg, life: 4, radius: 3 });
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

  // Warden attack patterns: radial ring, homing seekers, sweeping spiral fan.
  _wardenAttack(boss, player) {
    const pp = player.position;
    const up = new THREE.Vector3(0, 1, 0);
    const dmg = boss.def.damage * this.diff.enemyDmg;
    const spd = boss.def.projSpeed;
    const p = boss.bossPattern % 3;
    if (p === 0) {
      // Radial ring burst — get moving.
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.35, Math.sin(a)).normalize();
        const muzzle = boss.position.clone().addScaledVector(dir, boss.radius + 2);
        this.projectiles.fire(muzzle, dir.clone().multiplyScalar(spd * 0.9), { enemy: true, damage: dmg, life: 4.5, radius: 2.5, color: 0xff5577 });
      }
    } else if (p === 1) {
      // Homing seeker orbs — slow, curving, must be dodged or outrun.
      const base = new THREE.Vector3().subVectors(pp, boss.position).normalize();
      const side = new THREE.Vector3().crossVectors(base, up).normalize();
      for (const off of [-1, 0, 1]) {
        const dir = base.clone().addScaledVector(side, off * 0.4).normalize();
        const muzzle = boss.position.clone().addScaledVector(dir, boss.radius + 2);
        this.projectiles.fire(muzzle, dir.clone().multiplyScalar(spd * 0.55), {
          enemy: true, homing: true, homingTarget: player, turnRate: 0.7,
          damage: dmg, life: 5.5, radius: 3, color: 0xcc66ff,
        });
      }
    } else {
      // Sweeping aimed spiral fan.
      const base = new THREE.Vector3().subVectors(pp, boss.position).normalize();
      const q = new THREE.Quaternion();
      for (let i = -3; i <= 3; i++) {
        const ang = i * 0.14 + Math.sin(boss.wobble) * 0.5;
        const dir = base.clone().applyQuaternion(q.setFromAxisAngle(up, ang));
        const muzzle = boss.position.clone().addScaledVector(dir, boss.radius + 2);
        this.projectiles.fire(muzzle, dir.clone().multiplyScalar(spd), { enemy: true, damage: dmg, life: 4, radius: 2.5, color: 0xff88aa });
      }
    }
    if (this.audio) this.audio.enemyLaser();
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
      a.update(dt, playerPos, this.difficulty, this.diff.enemySpeed);

      // Bosses use timed attack patterns instead of the single-bolt fire.
      if (BOSS_TYPES.has(a.type)) {
        a.bossTimer -= dt;
        if (a.bossTimer <= 0 && a.position.distanceTo(playerPos) < 620) {
          if (a.type === 'warden') this._wardenAttack(a, player);
          else this._bossAttack(a, player);
          a.bossTimer = randRange(1.4, 2.2) * this.diff.fireRate;
        }
        continue;
      }

      // Stinger never shoots — it rams (handled by ship-collision damage).
      if (a.type === 'stinger') {
        if (a.position.distanceTo(playerPos) > 1400) a.kill();
        continue;
      }

      // Lancer: telegraph a bright charge, then loose one fast, precise aimed bolt.
      if (a.type === 'lancer') {
        const dist = a.position.distanceTo(playerPos);
        if (a.charging) {
          if (a.chargeTimer <= 0) {
            // Fire straight at the player (fast bolt — hard to dodge, so aim true).
            const dir = new THREE.Vector3().subVectors(playerPos, a.position).normalize();
            const vel = dir.clone().multiplyScalar(a.def.projSpeed);
            const muzzle = a.position.clone().addScaledVector(dir, a.radius + 3);
            this.projectiles.fire(muzzle, vel, { enemy: true, damage: a.def.damage * this.diff.enemyDmg, life: 4, radius: 3, color: 0xffee66 });
            if (this.audio) this.audio.enemyLaser();
            a.charging = false;
            a.fireTimer = a.def.fireCooldown * (0.8 + Math.random() * 0.5) * this.diff.fireRate;
          }
        } else if (a.fireTimer <= 0 && dist < 560) {
          a.charging = true;
          a.chargeTimer = LANCER_CHARGE;
        }
        if (a.position.distanceTo(playerPos) > 1400) a.kill();
        continue;
      }

      // Firing.
      if (a.wantsToFire(playerPos, this.difficulty, this.diff.fireRate)) {
        // Aim with a little lead toward the player's velocity.
        const aim = new THREE.Vector3().subVectors(playerPos, a.position);
        const dist = aim.length();
        aim.normalize();
        const lead = tmpVel.copy(player.velocity).multiplyScalar(clamp(dist / a.def.projSpeed, 0, 1.2));
        const target = playerPos.clone().add(lead);
        const dir = target.sub(a.position).normalize();
        const vel = dir.multiplyScalar(a.def.projSpeed);
        const muzzle = a.position.clone().addScaledVector(dir, a.radius + 1);
        this.projectiles.fire(muzzle, vel, { enemy: true, damage: a.def.damage * this.diff.enemyDmg, life: 3.5, radius: 2.5 });
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
