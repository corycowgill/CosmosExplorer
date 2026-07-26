// A lightweight screen-space lens flare for bright sources (the sun). Flare sprites
// are parented to the camera and positioned each frame along the line from the
// source's screen position through the centre, with an anamorphic streak and a
// central glare. No addon dependency — built from canvas textures.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';
import { clamp } from './utils.js';

function makeStreakTexture() {
  const w = 256, h = 16;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0.0, 'rgba(120,180,255,0)');
  g.addColorStop(0.5, 'rgba(200,225,255,1)');
  g.addColorStop(1.0, 'rgba(120,180,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.35, w, h * 0.3);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

function makeRingTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, s*0.30, s/2, s/2, s*0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(180,200,255,0.5)');
  g.addColorStop(0.85, 'rgba(255,220,180,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s/2, s/2, s/2, 0, Math.PI*2); ctx.fill();
  return new THREE.CanvasTexture(c);
}

// Each ghost: t = position along the sun→centre axis (0 at sun, 1 at opposite
// side), size = fraction of screen height, color, base opacity, texture kind.
const GHOSTS = [
  { t: 0.00, size: 0.60, color: 0xffddaa, op: 0.35, kind: 'glow' },  // soft halo
  { t: 0.00, size: 0.16, color: 0xffffff, op: 0.9,  kind: 'glow' },  // core glare
  { t: 0.30, size: 0.05, color: 0x88bbff, op: 0.5,  kind: 'glow' },
  { t: 0.50, size: 0.10, color: 0xff88bb, op: 0.4,  kind: 'ring' },
  { t: 0.72, size: 0.06, color: 0x88ffcc, op: 0.45, kind: 'glow' },
  { t: 1.00, size: 0.14, color: 0xffcc66, op: 0.3,  kind: 'ring' },
  { t: 1.28, size: 0.05, color: 0x99aaff, op: 0.45, kind: 'glow' },
  { t: 1.55, size: 0.09, color: 0xff9955, op: 0.3,  kind: 'glow' },
];

export class LensFlare {
  constructor(scene, camera) {
    this.camera = camera;
    // Camera must be in the scene graph for its children to render.
    scene.add(camera);
    this.group = new THREE.Group();
    camera.add(this.group);

    const glow = makeGlowSprite();
    const ring = makeRingTexture();
    const mk = (tex, color, op) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: op,
        depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      s.renderOrder = 999;
      this.group.add(s);
      return s;
    };

    this.ghosts = GHOSTS.map((d) => ({ def: d, sprite: mk(d.kind === 'ring' ? ring : glow, d.color, d.op) }));
    this.streak = mk(makeStreakTexture(), 0xbfe0ff, 0.6);
    this._tmp = new THREE.Vector3();
    this.dist = 10;
  }

  update(sunWorldPos) {
    const cam = this.camera;
    const ndc = this._tmp.copy(sunWorldPos).project(cam);
    const behind = ndc.z > 1;
    const radial = Math.hypot(ndc.x, ndc.y);
    // Brightest when the sun is centred in view; gone when behind or far off-screen.
    const intensity = behind ? 0 : clamp(1 - radial / 1.25, 0, 1);

    if (intensity <= 0.01) {
      for (const g of this.ghosts) g.sprite.visible = false;
      this.streak.visible = false;
      return;
    }

    const vFov = (cam.fov * Math.PI) / 180;
    const halfH = Math.tan(vFov / 2) * this.dist;
    const halfW = halfH * cam.aspect;

    for (const g of this.ghosts) {
      const t = g.def.t;
      const gx = ndc.x * (1 - 2 * t);
      const gy = ndc.y * (1 - 2 * t);
      g.sprite.position.set(gx * halfW, gy * halfH, -this.dist);
      g.sprite.scale.setScalar(g.def.size * 2 * halfH);
      g.sprite.material.opacity = g.def.op * intensity;
      g.sprite.visible = true;
    }

    // Anamorphic horizontal streak centred on the sun.
    this.streak.position.set(ndc.x * halfW, ndc.y * halfH, -this.dist);
    this.streak.scale.set(halfW * 3.2, halfH * 0.09, 1);
    this.streak.material.opacity = 0.55 * intensity;
    this.streak.visible = true;
  }
}
