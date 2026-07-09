// Builds the environment the player flies through: a glowing sun, orbiting planets
// with procedurally-tinted surfaces, a ringed gas giant, a deep starfield and a
// couple of nebula clouds for depth. All geometry is generated in code so there
// are no texture downloads.

import * as THREE from 'three';
import { randRange, pick } from './utils.js';

// Rough, believable-ish planet palette (not to scale — this is arcade space).
const PLANETS = [
  { name: 'Mercury', radius: 26,  dist: 620,  color: 0x9a8478, speed: 0.05, emissive: 0x2a2320 },
  { name: 'Venus',   radius: 40,  dist: 980,  color: 0xd9a066, speed: 0.035, emissive: 0x3a2a12 },
  { name: 'Terra',   radius: 44,  dist: 1400, color: 0x3a7bd5, speed: 0.03, emissive: 0x0a2038, ocean: true },
  { name: 'Mars',    radius: 34,  dist: 1850, color: 0xc1440e, speed: 0.024, emissive: 0x2a0d05 },
  { name: 'Jove',    radius: 110, dist: 2600, color: 0xcaa472, speed: 0.015, emissive: 0x2a2013, bands: true },
  { name: 'Cronus',  radius: 92,  dist: 3400, color: 0xe8d9a0, speed: 0.011, emissive: 0x2a2515, ring: true },
];

// Simple value-noise texture drawn onto a canvas, tinted for planet surfaces.
function makePlanetTexture(baseColor, opts = {}) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const base = new THREE.Color(baseColor);

  ctx.fillStyle = `rgb(${base.r * 255 | 0},${base.g * 255 | 0},${base.b * 255 | 0})`;
  ctx.fillRect(0, 0, size, size);

  // Mottled blobs for surface variation.
  const blobs = opts.bands ? 0 : 260;
  for (let i = 0; i < blobs; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = randRange(4, 26);
    const shade = randRange(-0.35, 0.35);
    const col = base.clone().offsetHSL(randRange(-0.03, 0.03), randRange(-0.1, 0.1), shade * 0.5);
    ctx.globalAlpha = randRange(0.05, 0.22);
    ctx.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Horizontal bands for gas giants.
  if (opts.bands) {
    for (let y = 0; y < size; y += 4) {
      const shade = Math.sin(y * 0.09) * 0.28 + randRange(-0.06, 0.06);
      const col = base.clone().offsetHSL(0, randRange(-0.05, 0.05), shade * 0.4);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
      ctx.fillRect(0, y, size, 4 + Math.random() * 3);
    }
    // Great storm spot.
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#b5482a';
    ctx.beginPath(); ctx.ellipse(size * 0.66, size * 0.6, 22, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Ocean/continent contrast for Terra.
  if (opts.ocean) {
    for (let i = 0; i < 60; i++) {
      ctx.globalAlpha = randRange(0.3, 0.7);
      ctx.fillStyle = pick(['#2e7d32', '#3d8b40', '#6b8e23', '#8a7b4a']);
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, randRange(8, 30), randRange(6, 20), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class SolarSystem {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.planets = [];
    this.colliders = []; // {position, radius} for planets+sun (soft collision / avoidance)
    this.root = new THREE.Group();
    scene.add(this.root);

    this._buildStars();
    this._buildNebula();
    this._buildSun();
    this._buildPlanets();
  }

  _buildStars() {
    const count = this.quality === 'low' ? 2200 : 5200;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const palette = [
      new THREE.Color(0xffffff), new THREE.Color(0xbcd4ff),
      new THREE.Color(0xfff0c0), new THREE.Color(0xffd0a0), new THREE.Color(0x9fd0ff),
    ];
    for (let i = 0; i < count; i++) {
      // Distribute on a large sphere shell.
      const r = randRange(4200, 8000);
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
      pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i*3+2] = r * Math.cos(phi);
      const c = pick(palette).clone().multiplyScalar(randRange(0.5, 1));
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
      sizes[i] = randRange(1, 4);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aScale', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 6, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      map: makeStarSprite(),
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  _buildNebula() {
    // A few large additive sprite clouds far away for colour and depth.
    const tex = makeGlowSprite();
    const colors = [0x5522aa, 0x22447a, 0xaa2255, 0x2a6a8a];
    this.nebulae = new THREE.Group();
    const n = this.quality === 'low' ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, color: pick(colors), transparent: true,
        opacity: randRange(0.06, 0.16), depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const s = new THREE.Sprite(mat);
      const r = randRange(3000, 6000);
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
      s.position.set(r*Math.sin(phi)*Math.cos(theta), r*Math.sin(phi)*Math.sin(theta)*0.4, r*Math.cos(phi));
      const sc = randRange(2400, 4200);
      s.scale.set(sc, sc, 1);
      this.nebulae.add(s);
    }
    this.scene.add(this.nebulae);
  }

  _buildSun() {
    const geo = new THREE.SphereGeometry(200, 48, 48);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd66 });
    this.sun = new THREE.Mesh(geo, mat);
    this.root.add(this.sun);

    // Layered additive glow sprites make the sun bloom nicely.
    const glowTex = makeGlowSprite();
    for (const [scale, opacity, color] of [[900, 0.9, 0xffcc55], [1500, 0.5, 0xff8844], [2600, 0.25, 0xff5522]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, opacity,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      s.scale.set(scale, scale, 1);
      this.sun.add(s);
    }

    // Point light emanating from the sun.
    this.sunLight = new THREE.PointLight(0xfff0d0, 3.2, 0, 0.0);
    this.sun.add(this.sunLight);

    this.colliders.push({ position: this.sun.position, radius: 260, sun: true });

    // Soft ambient + a subtle rim fill so ships never go fully black.
    this.scene.add(new THREE.AmbientLight(0x334466, 0.6));
    const fill = new THREE.DirectionalLight(0x6688ff, 0.35);
    fill.position.set(-1, 0.5, -1);
    this.scene.add(fill);
  }

  _buildPlanets() {
    for (const def of PLANETS) {
      const pivot = new THREE.Group();
      pivot.rotation.y = randRange(0, Math.PI * 2);
      this.root.add(pivot);

      const tex = makePlanetTexture(def.color, def);
      const mat = new THREE.MeshStandardMaterial({
        map: tex, color: 0xffffff, roughness: 0.95, metalness: 0.0,
        emissive: def.emissive || 0x000000, emissiveIntensity: 0.35,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 40, 40), mat);
      mesh.position.set(def.dist, randRange(-60, 60), 0);
      mesh.rotation.z = randRange(-0.4, 0.4);
      pivot.add(mesh);

      // Atmospheric rim glow.
      const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(def.radius * 1.08, 32, 32),
        new THREE.MeshBasicMaterial({
          color: def.ocean ? 0x6fb7ff : new THREE.Color(def.color).offsetHSL(0, -0.2, 0.2),
          transparent: true, opacity: 0.14, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      mesh.add(atmo);

      if (def.ring) this._addRing(mesh, def.radius);

      this.planets.push({ pivot, mesh, def, angle: pivot.rotation.y, spin: randRange(0.05, 0.2) });
      this.colliders.push({ position: mesh.getWorldPosition(new THREE.Vector3()), radius: def.radius * 1.15, mesh });
    }
  }

  _addRing(planet, radius) {
    const inner = radius * 1.4, outer = radius * 2.4;
    const geo = new THREE.RingGeometry(inner, outer, 96);
    // Fix UVs so a radial gradient texture maps across the ring band.
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i);
      const r = v3.length();
      uv.setXY(i, (r - inner) / (outer - inner), 0.5);
    }
    const c = document.createElement('canvas');
    c.width = 128; c.height = 8;
    const ctx = c.getContext('2d');
    for (let x = 0; x < 128; x++) {
      const a = (Math.sin(x * 0.5) * 0.3 + 0.6) * (Math.random() * 0.3 + 0.7);
      ctx.fillStyle = `rgba(230,214,170,${a})`;
      ctx.fillRect(x, 0, 1, 8);
    }
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2 + 0.35;
    planet.add(ring);
  }

  update(dt, cameraPos) {
    // Orbit + spin planets.
    for (const p of this.planets) {
      p.pivot.rotation.y += p.def.speed * dt * 0.4;
      p.mesh.rotation.y += p.spin * dt;
      // Keep collider world positions current.
      p.mesh.getWorldPosition(this._tmp || (this._tmp = new THREE.Vector3()));
    }
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      if (col.mesh) col.mesh.getWorldPosition(col.position);
    }
    this.sun.rotation.y += dt * 0.03;
    // Parallax: keep starfield/nebula centred on the camera so they feel infinitely far.
    if (cameraPos) {
      this.stars.position.copy(cameraPos);
      this.nebulae.position.copy(cameraPos);
    }
  }
}

// --- shared sprite textures (cached) ---
let _glowSprite = null;
function makeGlowSprite() {
  if (_glowSprite) return _glowSprite;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _glowSprite = new THREE.CanvasTexture(c);
  return _glowSprite;
}

let _starSprite = null;
function makeStarSprite() {
  if (_starSprite) return _starSprite;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _starSprite = new THREE.CanvasTexture(c);
  return _starSprite;
}

export { makeGlowSprite };
