// Solar flare hazard: periodically the sun erupts, hurling an expanding shockwave
// shell outward across the system. A telegraph warns first (the star flares bright),
// then a wall of plasma radiates out — brace with a barrel-roll or Overdrive as it
// washes over you, or eat the hit. Purely a Game-driven hazard; this class owns the
// visuals + expansion state and reports when the shell crosses a given distance.

import * as THREE from 'three';
import { makeGlowSprite } from './SolarSystem.js';

export class SolarFlare {
  constructor(scene, maxRadius = 3200) {
    this.maxRadius = maxRadius;
    this.speed = 460;            // shell expansion, units/sec
    this.active = false;
    this.warning = 0;            // seconds of telegraph remaining
    this.radius = 0;
    this.opacity = 0;

    // Expanding shell — a back-side additive sphere so it reads as an incoming wall
    // that briefly floods the view as it passes the camera.
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff7a2a, transparent: true, opacity: 0, side: THREE.BackSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.shell.frustumCulled = false;
    this.shell.visible = false;
    scene.add(this.shell);

    // A bright flare burst pinned at the sun during the telegraph + eruption.
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowSprite(), color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.flash.scale.setScalar(700);
    this.flash.visible = false;
    scene.add(this.flash);
  }

  // Begin the telegraph. Returns nothing; call erupt() when the warning elapses.
  warn(seconds = 2.0) {
    this.warning = seconds;
    this.flash.visible = true;
  }

  erupt(sunPos) {
    this.active = true;
    this.warning = 0;
    this.radius = 260;           // start at the sun's surface
    this.opacity = 0.9;
    this._hitReported = false;
    this.shell.position.copy(sunPos);
    this.shell.visible = true;
  }

  // Advance visuals/expansion. `sunPos` keeps everything pinned to the star.
  update(dt, sunPos) {
    this.flash.position.copy(sunPos);

    if (this.warning > 0) {
      this.warning -= dt;
      // Pulsing bright telegraph.
      const p = 0.5 + Math.sin(this.warning * 18) * 0.5;
      this.flash.material.opacity = 0.4 + p * 0.5;
      this.flash.scale.setScalar(650 + p * 250);
      return;
    }

    if (!this.active) { this.flash.visible = false; return; }

    this.radius += this.speed * dt;
    const frac = (this.radius - 260) / (this.maxRadius - 260);
    this.opacity = Math.max(0, 0.9 * (1 - frac));
    this.shell.position.copy(sunPos);
    this.shell.scale.setScalar(this.radius);
    this.shell.material.opacity = this.opacity * 0.5;
    // Fade the sun burst out as the shell leaves.
    this.flash.material.opacity = Math.max(0, 0.6 * (1 - frac * 1.6));
    if (this.radius >= this.maxRadius) this._end();
  }

  // Has the shell just swept across `dist` (a distance from the sun)? True once per
  // eruption, on the frame the expanding radius crosses that distance.
  crosses(dist) {
    if (!this.active || this._hitReported) return false;
    if (Math.abs(dist - this.radius) < Math.max(40, this.speed * 0.03)) {
      this._hitReported = true;
      return true;
    }
    // If the shell blew straight past a close target in one frame, still count it.
    if (this.radius > dist + 40) { this._hitReported = true; return true; }
    return false;
  }

  _end() {
    this.active = false;
    this.shell.visible = false;
    this.flash.visible = false;
    this.shell.material.opacity = 0;
    this.flash.material.opacity = 0;
  }

  reset() {
    this._end();
    this.warning = 0;
    this.radius = 0;
  }
}
