// Core game: sets up the renderer + bloom pipeline and chase camera, owns every
// subsystem, runs the fixed game loop, resolves collisions, drives wave flow and
// scoring, and manages the menu / playing / game-over states.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { SolarSystem } from './SolarSystem.js';
import { Player } from './Player.js';
import { AlienManager } from './AlienManager.js';
import { Projectiles } from './Projectiles.js';
import { ExplosionManager } from './ExplosionManager.js';
import { Pickups } from './Pickups.js';
import { HUD } from './HUD.js';
import { Input } from './Input.js';
import { AudioFX } from './Audio.js';
import { clamp, lerp, damp, isTouchDevice } from './utils.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover', PAUSED: 'paused' };

export class Game {
  constructor() {
    this.state = STATE.MENU;
    this.score = 0;
    this.hiScore = Number(localStorage.getItem('cosmos_hiscore') || 0);
    this.kills = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.betweenWaves = 0;

    this._initRenderer();
    this._initScene();
    this._initSubsystems();
    this._initUI();

    this._clock = new THREE.Clock();
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    // Kick off the render loop immediately so the menu shows the live scene.
    this._loop = this._loop.bind(this);
    this.renderer.setAnimationLoop(this._loop);
  }

  _initRenderer() {
    // Cap pixel ratio on mobile for performance.
    this.quality = (isTouchDevice || navigator.hardwareConcurrency <= 4) ? 'low' : 'high';
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality === 'high', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('game-root').appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05010f, 0.00016);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.5, 12000);
    this.camera.position.set(0, 130, 1960);

    this.solar = new SolarSystem(this.scene, this.quality);

    // Post-processing: subtle bloom that makes lasers, engines, the sun and
    // explosions glow. Lighter on low-end devices.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const strength = this.quality === 'high' ? 0.72 : 0.55;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, 0.65, 0.85);
    this.composer.addPass(this.bloom);

    // Cinematic grade: chromatic aberration toward the edges, a soft vignette,
    // gentle film grain and a saturation lift for that "spaceship viewport" look.
    this.gradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uAberration: { value: this.quality === 'high' ? 1.6 : 0.9 },
        uVignette: { value: 0.62 },
        uGrain: { value: this.quality === 'high' ? 0.05 : 0.03 },
        uSaturation: { value: 1.14 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uTime, uAberration, uVignette, uGrain, uSaturation;
        void main(){
          vec2 uv = vUv;
          vec2 center = uv - 0.5;
          float dist = length(center);
          // Chromatic aberration grows toward the frame edges.
          vec2 dir = center * (uAberration * 0.006) * dist * 2.0;
          float r = texture2D(tDiffuse, uv - dir).r;
          float g = texture2D(tDiffuse, uv).g;
          float b = texture2D(tDiffuse, uv + dir).b;
          vec3 col = vec3(r, g, b);
          // Saturation.
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, uSaturation);
          // Vignette.
          float vig = smoothstep(0.95, 0.32, dist);
          col *= mix(1.0, vig, uVignette);
          // Animated film grain.
          float grain = fract(sin(dot(uv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          col += (grain - 0.5) * uGrain;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.composer.addPass(this.gradePass);
  }

  _initSubsystems() {
    this.audio = new AudioFX();
    this.input = new Input();
    this.projectiles = new Projectiles(this.scene, 160);
    this.explosions = new ExplosionManager(this.scene, this.quality === 'high' ? 18 : 12);
    this.pickups = new Pickups(this.scene);
    this.player = new Player(this.scene);
    this.aliens = new AlienManager(this.scene, this.projectiles, this.audio);
    this.hud = new HUD();

    this._camShakeT = 0;
    this._camShakeMag = 0;
    this._fovBase = 70;
  }

  _initUI() {
    this.hud.setHiScore(this.hiScore);

    const start = document.getElementById('btn-start');
    const restart = document.getElementById('btn-restart');
    start.addEventListener('click', () => this.start());
    restart.addEventListener('click', () => this.start());
    const resume = document.getElementById('btn-resume');
    if (resume) resume.addEventListener('click', () => this._setPaused(false));

    this.muted = false;
    this._streakCount = 0;
    this._streakTimer = 0;

    // Hide the loader once modules are up.
    const loader = document.getElementById('loader');
    loader.classList.add('fade-out');
    setTimeout(() => loader.classList.add('hidden'), 600);

    if (isTouchDevice) document.getElementById('touch-controls').classList.remove('hidden');
  }

  start() {
    this.audio.init();
    this.audio.startEngine();

    document.getElementById('menu').classList.add('hidden');
    document.getElementById('gameover').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    this.hud.show();

    this.score = 0;
    this.kills = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this._streakCount = 0;
    this._streakTimer = 0;
    this.hud.setScore(0);
    this.hud.setCombo(1);
    this.hud.setWeaponLevel(1);
    this.hud.setMissiles(this.player.missiles ?? 3);

    this.player.reset();
    this.aliens.reset();
    this.pickups.reset();
    // Snap camera behind the ship.
    this._placeCameraBehind(true);

    this.wave = 0;
    this.betweenWaves = 1.2;
    this.state = STATE.PLAYING;
    this.input.enable();
    this.hud.toast('WAVE 1', 1.5);
  }

  _nextWave() {
    this.wave++;
    this.aliens.startWave(this.wave);
    this.hud.setWave(this.wave);
    if (this.wave > 1) {
      this.hud.toast(`WAVE ${this.wave}`, 1.5);
      this.audio.waveClear();
    }
  }

  gameOver() {
    this.state = STATE.GAMEOVER;
    this.input.disable();
    this.audio.stopEngine();
    this.audio.gameOver();
    if (this.score > this.hiScore) {
      this.hiScore = Math.floor(this.score);
      localStorage.setItem('cosmos_hiscore', this.hiScore);
    }
    document.getElementById('go-score').textContent = Math.floor(this.score).toLocaleString();
    document.getElementById('go-hiscore').textContent = this.hiScore.toLocaleString();
    document.getElementById('go-wave').textContent = this.wave;
    document.getElementById('go-kills').textContent = this.kills;
    setTimeout(() => {
      this.hud.hide();
      document.getElementById('gameover').classList.remove('hidden');
    }, 1400);
  }

  _setPaused(paused) {
    if (paused && this.state === STATE.PLAYING) {
      this.state = STATE.PAUSED;
      this.input.disable();
      this.audio.setEngine(0);
      document.getElementById('pause').classList.remove('hidden');
    } else if (!paused && this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.input.enable();
      document.getElementById('pause').classList.add('hidden');
      this._clock.getDelta(); // discard the paused interval so nothing jumps
    }
  }

  _toggleMute() {
    this.muted = !this.muted;
    this.audio.enabled = !this.muted;
    if (this.audio.master) this.audio.master.gain.value = this.muted ? 0 : 0.55;
    this.hud.setMuted(this.muted);
  }

  // Project a world position to screen pixels (returns null if behind camera).
  _toScreen(worldPos) {
    const p = worldPos.clone().project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ---------------- main loop ----------------
  _loop() {
    const dt = Math.min(0.05, this._clock.getDelta());
    this._elapsed = (this._elapsed || 0) + dt;

    // One-shot buttons: pause & mute, handled in any state.
    const edges = this.input.consumeEdges();
    if (edges.mute) this._toggleMute();
    if (edges.pause && (this.state === STATE.PLAYING || this.state === STATE.PAUSED)) {
      this._setPaused(this.state === STATE.PLAYING);
    }

    if (this.state === STATE.PLAYING) {
      this._updatePlaying(dt);
    } else if (this.state === STATE.PAUSED) {
      // Frozen: render the frame but advance nothing.
    } else {
      // Idle camera drift for menu / game-over ambience.
      this.solar.update(dt, this.camera.position);
      this._idleCamera(dt);
      this.explosions.update(dt);
      this.projectiles.update(dt);
    }

    this.gradePass.uniforms.uTime.value = this._elapsed;
    this.hud.update(dt);
    this.composer.render();
  }

  _updatePlaying(dt) {
    const input = this.input.update();

    // Wave gating.
    if (this.betweenWaves > 0) {
      this.betweenWaves -= dt;
      if (this.betweenWaves <= 0) this._nextWave();
    } else if (this.aliens.waveComplete()) {
      this.betweenWaves = 3.0;
      this.hud.toast(`WAVE ${this.wave} CLEAR`, 2.0);
      this.audio.waveClear();
      // Reward: small heal between waves.
      this.player.heal(10, 40);
    }

    // Update entities.
    this.player.update(dt, input);
    this._avoidBodies(dt);
    this.aliens.update(dt, this.player);
    this.projectiles.update(dt);
    this.explosions.update(dt);
    this.solar.update(dt, this.camera.position);

    // Firing — primary pulse laser.
    if (input.fire) {
      const shots = this.player.tryFire();
      if (shots) {
        for (const s of shots) {
          const vel = s.dir.clone().multiplyScalar(520).add(this.player.velocity);
          this.projectiles.fire(s.pos, vel, { enemy: false, damage: 1, life: 1.8, radius: 3.5 });
        }
        this.audio.laser();
      }
    }

    // Firing — homing missile (locks the current target if there is one).
    if (input.missile) {
      const m = this.player.tryFireMissile();
      if (m) {
        const vel = m.dir.clone().multiplyScalar(300).add(this.player.velocity);
        this.projectiles.fire(m.pos, vel, {
          enemy: false, missile: true, damage: 5, life: 4.0, radius: 5,
          homingTarget: this._lockTarget || null, turnRate: 2.6,
        });
        this.audio.laser();
        this.hud.setMissiles(this.player.missiles);
      }
    }

    // Collisions.
    this._collidePlayerBolts();
    this._collideEnemyBolts(dt);
    this._collideShips(dt);

    // Pickups.
    const collected = this.pickups.update(dt, this.player.position);
    for (const kind of collected) this._applyPickup(kind);

    // Combo decay.
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 1; this.hud.setCombo(1); }
    }
    // Killstreak window.
    if (this._streakTimer > 0) {
      this._streakTimer -= dt;
      if (this._streakTimer <= 0) this._streakCount = 0;
    }

    // Engine audio tracks speed.
    const spd = this.player.speed;
    this.audio.setEngine(clamp((spd - 40) / 110, 0, 1));

    // Camera + HUD.
    this._chaseCamera(dt, input);
    this._updateLock();
    this._updateHUD();

    if (!this.player.alive && this.state === STATE.PLAYING) this.gameOver();
  }

  // ---------------- collisions ----------------
  _collidePlayerBolts() {
    this.projectiles.forEachLive(false, (b) => {
      let hitAlien = null;
      let best = Infinity;
      for (const a of this.aliens.aliens) {
        if (!a.alive) continue;
        const d = b.mesh.position.distanceToSquared(a.position);
        const rr = (a.radius + b.radius); const rr2 = rr * rr;
        if (d < rr2 && d < best) { best = d; hitAlien = a; }
      }
      if (hitAlien) {
        const hitPos = b.mesh.position.clone();
        const wasMissile = b.missile;
        b.kill();
        const dead = hitAlien.hit(b.damage);
        if (dead) this._onAlienDestroyed(hitAlien);
        else {
          this.explosions.burst(hitPos, { scale: 0.35, color: 0xffee88 });
          this.audio.hit();
        }
        // Missiles detonate with an area blast that damages nearby aliens.
        if (wasMissile) {
          this.explosions.burst(hitPos, { scale: 1.3, big: true, color: 0xffaa33 });
          this.audio.explosion(true);
          this._addShake(0.7, 0.35);
          const splashR = 40;
          for (const a of this.aliens.aliens) {
            if (!a.alive || a === hitAlien) continue;
            if (a.position.distanceToSquared(hitPos) < splashR * splashR) {
              if (a.hit(3)) this._onAlienDestroyed(a);
            }
          }
        }
      }
    });
  }

  _collideEnemyBolts(dt) {
    const pp = this.player.position;
    this.projectiles.forEachLive(true, (b) => {
      if (!this.player.alive) return;
      const rr = this.player.radius + b.radius;
      if (b.mesh.position.distanceToSquared(pp) < rr * rr) {
        b.kill();
        this._damagePlayer(b.damage);
        this.explosions.burst(b.mesh.position.clone(), { scale: 0.4, color: 0xff5566 });
      }
    });
  }

  _collideShips(dt) {
    if (!this.player.alive) return;
    const pp = this.player.position;
    for (const a of this.aliens.aliens) {
      if (!a.alive) continue;
      const rr = this.player.radius + a.radius;
      if (pp.distanceToSquared(a.position) < rr * rr) {
        // Ram: destroy alien, damage player.
        this._onAlienDestroyed(a);
        this._damagePlayer(18);
      }
    }
  }

  // Soft-avoid planets & sun: push the player out and damage if grazing the sun.
  _avoidBodies(dt) {
    if (!this.player.alive) return;
    const pp = this.player.position;
    for (const col of this.solar.colliders) {
      const d = pp.distanceTo(col.position);
      const safe = col.radius + 12;
      if (d < safe) {
        const push = this._tmpV.subVectors(pp, col.position).normalize().multiplyScalar((safe - d));
        pp.add(push);
        if (col.sun) {
          this._damagePlayer(30 * dt * 3); // scorching
          if (Math.random() < 0.3) this.explosions.burst(pp.clone(), { scale: 0.5, color: 0xff7722 });
        }
      }
    }
  }

  _onAlienDestroyed(a) {
    const pos = a.position.clone();
    const big = a.type === 'cruiser';
    this.explosions.burst(pos, { scale: big ? 1.8 : (a.type === 'fighter' ? 1.1 : 0.8), big, color: a.def.glow });
    this.audio.explosion(big);
    a.kill();
    this.kills++;

    // Combo + score.
    this.combo = clamp(this.combo + 0.5, 1, 8);
    this.comboTimer = 3.2;
    const gained = Math.round(a.def.score * this.combo);
    this.score += gained;
    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo);

    // Camera shake scaled to blast.
    this._addShake(big ? 0.9 : 0.4, big ? 0.5 : 0.28);

    // Floating score popup at the kill location.
    const screen = this._toScreen(pos);
    if (screen) {
      const color = this.combo >= 3 ? '#ffd54a' : '#eafcff';
      this.hud.popup(screen.x, screen.y, '+' + gained, { color, big: big || this.combo >= 4 });
    }

    // Killstreak callouts (kills bunched close in time).
    this._streakCount++;
    this._streakTimer = 1.4;
    const names = { 3: 'TRIPLE!', 5: 'RAMPAGE!', 8: 'UNSTOPPABLE!', 12: 'GODLIKE!' };
    if (names[this._streakCount]) this.hud.toast(names[this._streakCount], 1.2);

    // Drops (cruisers are more generous).
    this.pickups.maybeDrop(pos, big);
  }

  _damagePlayer(amount) {
    if (!this.player.alive) return;
    const beforeHealth = this.player.health;
    this.player.damageBy(amount);
    this.hud.flashDamage();
    this._addShake(0.5, 0.3);
    if (this.player.health < beforeHealth) this.audio.hit();
  }

  _applyPickup(kind) {
    if (kind === 'repair') { this.player.heal(25, 0); this.hud.toast('HULL RESTORED', 1.0); }
    else if (kind === 'shield') { this.player.heal(0, 40); this.hud.toast('SHIELDS +40', 1.0); }
    else if (kind === 'bonus') { this.score += 250; this.hud.setScore(this.score); this.hud.toast('+250', 0.9); }
    else if (kind === 'weapon') {
      const lvl = this.player.upgradeWeapon();
      this.hud.toast(lvl >= this.player.maxWeaponLevel ? 'WEAPON MAXED!' : 'WEAPON UP  L' + lvl, 1.2);
      this.hud.setWeaponLevel(lvl);
    }
    else if (kind === 'missile') {
      this.player.addMissiles(2);
      this.hud.toast('MISSILES +2', 1.0);
      this.hud.setMissiles(this.player.missiles);
    }
    this.audio.pickup();
  }

  // ---------------- camera ----------------
  _placeCameraBehind(snap) {
    const offset = this._tmpV.set(0, 6.2, 21).applyQuaternion(this.player.group.quaternion);
    const target = this._tmpV2.copy(this.player.position).add(offset);
    if (snap) {
      this.camera.position.copy(target);
      this.camera.lookAt(this.player.position);
    }
  }

  _chaseCamera(dt, input) {
    // Desired camera sits behind and above the ship.
    const boosting = input.boost;
    const back = 21 + (boosting ? 5 : 0);
    const offset = this._tmpV.set(0, 6.2, back).applyQuaternion(this.player.group.quaternion);
    const desired = this._tmpV2.copy(this.player.position).add(offset);
    this.camera.position.lerp(desired, damp(6, dt));

    // Look slightly ahead of the ship.
    const ahead = this.player.forwardVector(new THREE.Vector3()).multiplyScalar(30).add(this.player.position);
    // Smooth the look target.
    if (!this._lookAt) this._lookAt = ahead.clone();
    this._lookAt.lerp(ahead, damp(7, dt));

    // Apply camera shake.
    if (this._camShakeT > 0) {
      this._camShakeT -= dt;
      const s = this._camShakeMag * (this._camShakeT > 0 ? this._camShakeT : 0);
      this.camera.position.x += (Math.random() - 0.5) * s * 6;
      this.camera.position.y += (Math.random() - 0.5) * s * 6;
    }
    this.camera.up.set(0, 1, 0).applyQuaternion(this.player.group.quaternion);
    this.camera.lookAt(this._lookAt);

    // FOV kick on boost.
    const targetFov = this._fovBase + (boosting ? 12 : 0) + (this.player.speed - 70) * 0.05;
    this.camera.fov = lerp(this.camera.fov, targetFov, damp(4, dt));
    this.camera.updateProjectionMatrix();
  }

  _idleCamera(dt) {
    // Slow orbit around the ship for menu ambience.
    this._idleAngle = (this._idleAngle || 0) + dt * 0.15;
    const r = 26;
    const p = this.player.position;
    this.camera.position.set(
      p.x + Math.cos(this._idleAngle) * r,
      p.y + 6,
      p.z + Math.sin(this._idleAngle) * r
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p);
    // Gentle ship spin.
    this.player.model.rotation.y += dt * 0.3;
  }

  _addShake(mag, time) {
    if (mag > this._camShakeMag * this._camShakeT || this._camShakeT <= 0) {
      this._camShakeMag = mag;
      this._camShakeT = time;
    }
  }

  // ---------------- lock-on + HUD ----------------
  _updateLock() {
    // Find the nearest alien within a forward cone for the lock marker.
    const fwd = this.player.forwardVector(this._tmpV);
    const pp = this.player.position;
    let target = null, best = -1;
    for (const a of this.aliens.aliens) {
      if (!a.alive) continue;
      const to = this._tmpV2.subVectors(a.position, pp);
      const dist = to.length();
      if (dist > 500) continue;
      to.normalize();
      const dot = to.dot(fwd);
      if (dot > 0.9 && dot > best) { best = dot; target = a; }
    }
    this._lockTarget = target;
    if (target) {
      // Project to screen.
      const p = target.position.clone().project(this.camera);
      if (p.z < 1) {
        const x = (p.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-p.y * 0.5 + 0.5) * window.innerHeight;
        this.hud.setLock({ x, y });
      } else this.hud.setLock(null);
    } else {
      this.hud.setLock(null);
    }
  }

  _updateHUD() {
    this.hud.setBars(
      (this.player.health / this.player.maxHealth) * 100,
      (this.player.shield / this.player.maxShield) * 100
    );
    this.hud.setSpeed(this.player.speed);
    this.hud.setHeat(this.player.heat * 100, this.player.overheated);
    this.hud.setMissiles(this.player.missiles);
    this.hud.drawRadar(this.player, this.aliens.aliens);
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }
}
