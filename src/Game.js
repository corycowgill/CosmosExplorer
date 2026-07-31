// Core game: sets up the renderer + bloom pipeline and chase camera, owns every
// subsystem, runs the fixed game loop, resolves collisions, drives wave flow and
// scoring, and manages the menu / playing / game-over states.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { SolarSystem } from './SolarSystem.js';
import { WarpStreaks } from './WarpStreaks.js';
import { SolarFlare } from './SolarFlare.js';
import { Player } from './Player.js';
import { AlienManager } from './AlienManager.js';
import { Projectiles } from './Projectiles.js';
import { ExplosionManager } from './ExplosionManager.js';
import { Pickups } from './Pickups.js';
import { Asteroids } from './Asteroids.js';
import { Drones } from './Drones.js';
import { HUD } from './HUD.js';
import { Input } from './Input.js';
import { AudioFX } from './Audio.js';
import { LensFlare } from './LensFlare.js';
import { Achievements, ACHIEVEMENTS } from './Achievements.js';
import { clamp, lerp, damp, isTouchDevice } from './utils.js';

const STATE = { MENU: 'menu', PLAYING: 'playing', GAMEOVER: 'gameover', PAUSED: 'paused' };

// Extra radius beyond the hull's hit range that counts as a near-miss "graze".
const GRAZE_MARGIN = 20;

// Difficulty presets scale enemy lethality, pace and score reward.
const DIFFICULTIES = {
  cadet: { label: 'CADET', enemyDmg: 0.6,  enemySpeed: 0.85, fireRate: 1.35, spawnMul: 0.75, scoreMul: 0.8 },
  pilot: { label: 'PILOT', enemyDmg: 1.0,  enemySpeed: 1.0,  fireRate: 1.0,  spawnMul: 1.0,  scoreMul: 1.0 },
  ace:   { label: 'ACE',   enemyDmg: 1.45, enemySpeed: 1.2,  fireRate: 0.72, spawnMul: 1.3,  scoreMul: 1.5 },
};
const bestKey = (diff) => `cosmos_hiscore_${diff}`;

// First-run coach hints (shown once, one at a time, at the bottom of the screen).
const TUTORIAL = [
  'STEER with your <b>mouse</b> or <b>WASD</b> — fly toward the invaders',
  'Hold <b>Click</b> or <b>Space</b> to <b>FIRE</b> your lasers',
  '<b>Right-click</b> or <b>C</b> launches a homing <b>MISSILE</b>',
  'Fly into glowing <b>POWER-UPS</b> to collect them',
  'Fill the <b>OVERDRIVE</b> bar with kills, then press <b>X</b> to go nova',
  'Every 5th wave brings a <b>BOSS</b>. Good luck out there, pilot!',
];
const TUT_STEP_TIME = 5.0;

export class Game {
  constructor() {
    this.state = STATE.MENU;
    this.score = 0;
    // Difficulty + per-difficulty best score.
    this.difficultyKey = localStorage.getItem('cosmos_diff') || 'pilot';
    if (!DIFFICULTIES[this.difficultyKey]) this.difficultyKey = 'pilot';
    this.diffConfig = DIFFICULTIES[this.difficultyKey];
    this.hiScore = Number(localStorage.getItem(bestKey(this.difficultyKey)) || 0);
    this.kills = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.betweenWaves = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.bossesKilled = 0;
    this.grazeCount = 0;
    this._grazeCd = 0;
    this._hitStop = 0;
    this._flash = 0;
    this._flareTimer = 18 + Math.random() * 10;   // first flare, seconds

    // First-run tutorial (shown once ever).
    this.tutorialDone = localStorage.getItem('cosmos_tut_done') === '1';

    // Player-comfort settings (persisted).
    this.settings = { invertY: false, sensitivity: 1, volume: 0.55 };
    try {
      const s = JSON.parse(localStorage.getItem('cosmos_settings') || '{}');
      if (typeof s.invertY === 'boolean') this.settings.invertY = s.invertY;
      if (typeof s.sensitivity === 'number') this.settings.sensitivity = s.sensitivity;
      if (typeof s.volume === 'number') this.settings.volume = s.volume;
    } catch (e) { /* ignore */ }

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

    // Reflection environment: metal hulls now mirror the sun and coloured space,
    // which is what makes the ships read as polished metal rather than flat plastic.
    this._buildEnvironment();

    this.solar = new SolarSystem(this.scene, this.quality);
    this.warp = new WarpStreaks(this.scene, this.quality === 'high' ? 220 : 120);
    this.solarFlare = new SolarFlare(this.scene);

    // Post-processing: subtle bloom that makes lasers, engines, the sun and
    // explosions glow. Lighter on low-end devices.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const strength = this.quality === 'high' ? 0.72 : 0.55;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, 0.65, 0.85);
    this.composer.addPass(this.bloom);
    this._bloomBase = strength;
    this._flash = 0;   // transient bloom-flash amount on heavy impacts

    // Cinematic sun lens flare (camera-attached screen-space sprites).
    this.lensFlare = new LensFlare(this.scene, this.camera);
    this._sunPos = new THREE.Vector3();

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
    this._baseAber = this.gradePass.uniforms.uAberration.value;
  }

  // Build a PMREM reflection map from a procedural equirectangular "space" image:
  // a warm sun highlight, coloured nebula gradients and scattered stars. Assigned
  // to scene.environment so every metallic material reflects it automatically.
  _buildEnvironment() {
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // Base vertical gradient (deep space).
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0a0f24');
    g.addColorStop(0.5, '#0a0818');
    g.addColorStop(1, '#05030f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Coloured nebula patches.
    const blobs = [['#3b2a80', 0.5], ['#2a5a80', 0.4], ['#802a55', 0.35]];
    for (const [col, a] of blobs) {
      for (let i = 0; i < 5; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 40 + Math.random() * 90;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a; ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Bright sun highlight — the key reflection on the metal.
    const sx = w * 0.62, sy = h * 0.42;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, 70);
    sun.addColorStop(0, '#fff6e0'); sun.addColorStop(0.25, '#ffd27a');
    sun.addColorStop(0.6, 'rgba(255,140,60,0.5)'); sun.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
    // Stars.
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 400; i++) {
      ctx.globalAlpha = Math.random() * 0.8 + 0.2;
      ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() < 0.9 ? 1 : 2, 1);
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const rt = pmrem.fromEquirectangular(tex);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.75;
    pmrem.dispose();
    tex.dispose();
  }

  _initSubsystems() {
    this.audio = new AudioFX();
    this.input = new Input();
    this.projectiles = new Projectiles(this.scene, 160);
    this.explosions = new ExplosionManager(this.scene, this.quality === 'high' ? 18 : 12);
    this.pickups = new Pickups(this.scene);
    this.asteroids = new Asteroids(this.scene, this.quality);
    this.drones = new Drones(this.scene);
    this.player = new Player(this.scene);
    this.aliens = new AlienManager(this.scene, this.projectiles, this.audio);
    this.hud = new HUD();
    this.ach = new Achievements();

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

    // Difficulty selector.
    this._diffBtns = Array.from(document.querySelectorAll('.diff-btn'));
    for (const btn of this._diffBtns) {
      const key = btn.dataset.diff;
      btn.classList.toggle('active', key === this.difficultyKey);
      btn.addEventListener('click', () => this._selectDifficulty(key));
    }

    // Achievements gallery.
    this._achQueue = [];
    this._achToast = document.getElementById('ach-toast');
    this._updateAchCount();
    document.getElementById('btn-achievements').addEventListener('click', () => {
      this._renderAchievements();
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('achievements').classList.remove('hidden');
    });
    document.getElementById('btn-ach-close').addEventListener('click', () => {
      document.getElementById('achievements').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
    });

    // Settings panel.
    this._setEls = {
      invert: document.getElementById('set-invert'),
      sens: document.getElementById('set-sens'),
      sensVal: document.getElementById('set-sens-val'),
      vol: document.getElementById('set-vol'),
      volVal: document.getElementById('set-vol-val'),
    };
    this._syncSettingsUI();
    this._applySettings();
    document.getElementById('btn-settings').addEventListener('click', () => {
      this._syncSettingsUI();
      document.getElementById('menu').classList.add('hidden');
      document.getElementById('settings').classList.remove('hidden');
    });
    document.getElementById('btn-set-close').addEventListener('click', () => {
      document.getElementById('settings').classList.add('hidden');
      document.getElementById('menu').classList.remove('hidden');
    });
    this._setEls.invert.addEventListener('click', () => {
      this.settings.invertY = !this.settings.invertY;
      this._saveSettings(); this._syncSettingsUI();
    });
    this._setEls.sens.addEventListener('input', () => {
      this.settings.sensitivity = parseFloat(this._setEls.sens.value);
      this._saveSettings(); this._syncSettingsUI();
    });
    this._setEls.vol.addEventListener('input', () => {
      this.settings.volume = parseFloat(this._setEls.vol.value);
      this._saveSettings(); this._syncSettingsUI();
    });

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
    this.audio.startMusic();
    this._musicIntensity = 1;

    document.getElementById('menu').classList.add('hidden');
    document.getElementById('gameover').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    this.hud.show();
    this.hud.hideBoss();
    document.body.classList.remove('overdrive');
    this._odWas = false;

    this.score = 0;
    this.kills = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this._streakCount = 0;
    this._streakTimer = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.bossesKilled = 0;
    this.grazeCount = 0;
    this._grazeCd = 0;
    this._hitStop = 0;
    this._flash = 0;
    this._flareTimer = 18 + Math.random() * 10;   // first flare, seconds
    // Apply the chosen difficulty and show its best score.
    this.hiScore = Number(localStorage.getItem(bestKey(this.difficultyKey)) || 0);
    this.aliens.setDifficulty(this.diffConfig);
    this.hud.setHiScore(this.hiScore);
    this.hud.setScore(0);
    this.hud.setCombo(1);
    this.hud.setWeaponLevel(1);
    this.hud.setMissiles(this.player.missiles ?? 3);

    this.player.reset();
    this.aliens.reset();
    this.pickups.reset();
    this.asteroids.reset(this.player.position);
    this.drones.reset();
    this.warp.reset();
    this.solarFlare.reset();
    this.gradePass.uniforms.uAberration.value = this._baseAber;
    // Snap camera behind the ship.
    this._placeCameraBehind(true);

    this.wave = 0;
    this.betweenWaves = 1.2;
    this._tookDamageThisWave = false;
    this.state = STATE.PLAYING;
    this.input.enable();
    this.hud.toast('WAVE 1', 1.5);

    // Kick off the one-time tutorial on the player's first run.
    this._tutActive = !this.tutorialDone;
    this._tutStep = -1;
    this._tutTimer = 1.6; // let the WAVE 1 toast breathe first
    if (this.tutorialDone) this.hud.hideHint();
  }

  _nextWave() {
    this.wave++;
    this._tookDamageThisWave = false;
    this.aliens.startWave(this.wave);
    this.hud.setWave(this.wave);
    if (this.aliens.bossWave) {
      const name = this.aliens.bossType === 'warden' ? 'WARDEN' : 'MOTHERSHIP';
      this.hud.toast(`⚠  ${name} INBOUND  ⚠`, 2.4);
      this.hud.showBoss(name);
      this.audio.explosion(true); // ominous boom
    } else if (this.wave > 1) {
      this.hud.toast(`WAVE ${this.wave}`, 1.5);
      this.audio.waveClear();
    }
    // Score the fight: dark & driving during boss waves, energetic otherwise.
    this._musicIntensity = this.aliens.bossWave ? 2 : 1;
    this.audio.setMusicIntensity(this._musicIntensity);
  }

  gameOver() {
    this.state = STATE.GAMEOVER;
    if (this._tutActive) this._tutFinish();
    this.hud.hideBoss();
    this.hud.hideTargetArrows();
    document.body.classList.remove('overdrive');
    this.input.disable();
    this.audio.stopEngine();
    this.audio.stopMusic();
    this.audio.gameOver();

    const isRecord = this.score > this.hiScore;
    if (isRecord) {
      this.hiScore = Math.floor(this.score);
      localStorage.setItem(bestKey(this.difficultyKey), this.hiScore);
    }
    const accuracy = this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;

    // Record run-end achievement stats.
    this.ach.setMax('bestWave', this.wave);
    this.ach.setMax('bestScore', Math.floor(this.score));
    if (this.shotsFired >= 15) this.ach.setMax('bestAccuracy', accuracy);
    if (this.difficultyKey === 'ace') this.ach.setMax('aceWave', this.wave);
    this._checkAch();

    document.getElementById('go-score').textContent = Math.floor(this.score).toLocaleString();
    document.getElementById('go-hiscore').textContent = this.hiScore.toLocaleString();
    document.getElementById('go-wave').textContent = this.wave;
    document.getElementById('go-kills').textContent = this.kills;
    document.getElementById('go-accuracy').textContent = accuracy + '%';
    document.getElementById('go-grazes').textContent = this.grazeCount;
    document.getElementById('go-diff').textContent = this.diffConfig.label;
    document.getElementById('go-record').classList.toggle('hidden', !isRecord);

    // Medals.
    const medalsEl = document.getElementById('go-medals');
    medalsEl.innerHTML = '';
    const medals = this._computeMedals(accuracy);
    medals.forEach((m, i) => {
      const el = document.createElement('div');
      el.className = 'medal';
      el.style.animationDelay = (i * 0.08) + 's';
      el.textContent = m;
      medalsEl.appendChild(el);
    });

    if (isRecord) this.audio.waveClear();
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
      this.audio.setMusicIntensity(0); // duck the score while paused
      document.getElementById('pause').classList.remove('hidden');
    } else if (!paused && this.state === STATE.PAUSED) {
      this.state = STATE.PLAYING;
      this.input.enable();
      this.audio.setMusicIntensity(this._musicIntensity || 1);
      document.getElementById('pause').classList.add('hidden');
      this._clock.getDelta(); // discard the paused interval so nothing jumps
    }
  }

  _toggleMute() {
    this.muted = !this.muted;
    this.audio.enabled = !this.muted;
    if (this.audio.master) this.audio.master.gain.value = this.muted ? 0 : this.audio.volume;
    this.hud.setMuted(this.muted);
  }

  _selectDifficulty(key) {
    if (!DIFFICULTIES[key]) return;
    this.difficultyKey = key;
    this.diffConfig = DIFFICULTIES[key];
    localStorage.setItem('cosmos_diff', key);
    for (const btn of this._diffBtns) btn.classList.toggle('active', btn.dataset.diff === key);
    // Show the best for the selected difficulty.
    this.hiScore = Number(localStorage.getItem(bestKey(key)) || 0);
    this.hud.setHiScore(this.hiScore);
  }

  _tutAdvance() {
    this._tutStep++;
    if (this._tutStep >= TUTORIAL.length) { this._tutFinish(); return; }
    const n = this._tutStep + 1;
    this.hud.showHint(`${TUTORIAL[this._tutStep]}<span class="tut-step">TIP ${n} / ${TUTORIAL.length}</span>`);
    this._tutTimer = TUT_STEP_TIME;
  }

  _tutFinish() {
    this._tutActive = false;
    this.hud.hideHint();
    this.tutorialDone = true;
    try { localStorage.setItem('cosmos_tut_done', '1'); } catch (e) { /* ignore */ }
  }

  _applySettings() {
    this.input.invertY = this.settings.invertY;
    this.player.turnScale = this.settings.sensitivity;
    this.audio.setVolume(this.settings.volume);
  }

  _saveSettings() {
    this._applySettings();
    try { localStorage.setItem('cosmos_settings', JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  _syncSettingsUI() {
    const e = this._setEls;
    e.invert.textContent = this.settings.invertY ? 'ON' : 'OFF';
    e.invert.classList.toggle('on', this.settings.invertY);
    e.sens.value = this.settings.sensitivity;
    e.sensVal.textContent = this.settings.sensitivity.toFixed(2) + '×';
    e.vol.value = this.settings.volume;
    e.volVal.textContent = Math.round(this.settings.volume * 100) + '%';
  }

  _activateOverdrive() {
    if (!this.player.activateOverdrive()) return;
    this.ach.add('overdrives');
    this._checkAch();
    this.hud.toast('⚡ OVERDRIVE ⚡', 1.6);
    this.audio.overdrive();
    this._addShake(1.3, 0.6);
    document.body.classList.add('overdrive');
    // Screen-clearing pulse that damages everything nearby.
    const pos = this.player.position;
    this.explosions.burst(pos.clone(), { scale: 2.6, big: true, color: 0xffd24a });
    for (const a of this.aliens.aliens) {
      if (!a.alive) continue;
      if (a.position.distanceTo(pos) < 240 && a.type !== 'boss') {
        if (a.hit(6)) this._onAlienDestroyed(a);
      } else if (a.type === 'boss' && a.position.distanceTo(pos) < 240) {
        a.hit(15); // bosses take a chunk but survive
      }
    }
  }

  // Compute earned medals from the run's stats.
  _computeMedals(accuracy) {
    const medals = [];
    const s = this.score, w = this.wave;
    // Score rank (highest that applies).
    if (s >= 100000) medals.push('💎 DIAMOND ACE');
    else if (s >= 50000) medals.push('🥇 GOLD');
    else if (s >= 20000) medals.push('🥈 SILVER');
    else if (s >= 5000) medals.push('🥉 BRONZE');
    // Boss medals.
    if (this.bossesKilled >= 3) medals.push('👑 WARLORD');
    else if (this.bossesKilled >= 1) medals.push('👑 BOSS SLAYER');
    // Wave depth.
    if (w >= 15) medals.push('🌌 DEEP SPACE');
    else if (w >= 10) medals.push('🚀 VETERAN');
    // Accuracy (needs a meaningful sample).
    if (this.shotsFired >= 25) {
      if (accuracy >= 80) medals.push('🎯 DEADEYE');
      else if (accuracy >= 55) medals.push('🎯 SHARPSHOOTER');
    }
    // Daredevil grazing.
    if (this.grazeCount >= 60) medals.push('😎 DAREDEVIL');
    else if (this.grazeCount >= 25) medals.push('🪶 CLOSE SHAVE');
    // Difficulty badge.
    if (this.difficultyKey === 'ace') medals.push('🔥 ACE PILOT');
    return medals;
  }

  // ---------------- achievements ----------------
  _updateAchCount() {
    const el = document.getElementById('ach-count');
    if (el) el.textContent = `${this.ach.count()}/${this.ach.total()}`;
  }

  // Evaluate unlocks after recording stats; announce any that are newly earned.
  _checkAch() {
    const fresh = this.ach.check();
    this._updateAchCount();
    if (fresh.length) {
      this._achQueue.push(...fresh);
      if (!this._achShowing) this._showNextAch();
    }
  }

  _showNextAch() {
    const a = this._achQueue.shift();
    if (!a) { this._achShowing = false; return; }
    this._achShowing = true;
    this._achToast.innerHTML =
      `<div class="at-icon">${a.icon}</div><div><div class="at-title">ACHIEVEMENT UNLOCKED</div><div class="at-name">${a.name}</div></div>`;
    this._achToast.classList.add('show');
    this.audio.pickup();
    setTimeout(() => {
      this._achToast.classList.remove('show');
      setTimeout(() => this._showNextAch(), 350);
    }, 2600);
  }

  _renderAchievements() {
    const grid = document.getElementById('ach-grid');
    grid.innerHTML = '';
    for (const a of ACHIEVEMENTS) {
      const unlocked = this.ach.isUnlocked(a.id);
      const card = document.createElement('div');
      card.className = 'ach-card ' + (unlocked ? 'unlocked' : 'locked');
      card.innerHTML =
        `<div class="ach-icon">${a.icon}</div>` +
        `<div><div class="ach-name">${unlocked ? a.name : '???'}</div>` +
        `<div class="ach-desc">${a.desc}</div></div>`;
      grid.appendChild(card);
    }
    document.getElementById('ach-progress').textContent = `${this.ach.count()} / ${this.ach.total()}`;
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

    // One-shot buttons: pause, mute & overdrive, handled in any state.
    const edges = this.input.consumeEdges();
    if (edges.mute) this._toggleMute();
    if (edges.pause && (this.state === STATE.PLAYING || this.state === STATE.PAUSED)) {
      this._setPaused(this.state === STATE.PLAYING);
    }
    if (edges.overdrive && this.state === STATE.PLAYING) this._activateOverdrive();
    if (edges.evade && this.state === STATE.PLAYING) {
      if (this.player.barrelRoll(edges.evade)) this.audio.evade();
    }

    if (this.state === STATE.PLAYING) {
      // Hit-stop: on heavy impacts, briefly near-freeze the simulation (real-time
      // countdown) so the blow lands with weight before time snaps back.
      let simDt = dt;
      if (this._hitStop > 0) { this._hitStop -= dt; simDt = dt * 0.12; }
      this._updatePlaying(simDt);
    } else if (this.state === STATE.PAUSED) {
      // Frozen: render the frame but advance nothing.
    } else {
      // Idle camera drift for menu / game-over ambience.
      this.solar.update(dt, this.camera.position);
      this._idleCamera(dt);
      this.explosions.update(dt);
      this.projectiles.update(dt);
    }

    // Update the sun lens flare from the sun's current world position.
    this.solar.sun.getWorldPosition(this._sunPos);
    this.lensFlare.update(this._sunPos);

    this.gradePass.uniforms.uTime.value = this._elapsed;
    // Bloom flash on heavy impacts: spike then decay back to the baseline.
    if (this._flash > 0) this._flash = Math.max(0, this._flash - dt * 3.5);
    this.bloom.strength = this._bloomBase + this._flash + (this.warp ? this.warp.amount * 0.25 : 0);
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
      // Achievements: wave depth + flawless-wave clear.
      this.ach.setMax('bestWave', this.wave);
      if (!this._tookDamageThisWave) this.ach.setFlag('noDamageWave');
      this._checkAch();
    }

    // Update entities.
    this.player.update(dt, input);
    this._avoidBodies(dt);
    this.aliens.update(dt, this.player);
    this.projectiles.update(dt);
    this.explosions.update(dt);
    this.solar.update(dt, this.camera.position);
    this.asteroids.update(dt, this.player.position);
    // Wingman drones orbit and auto-fire at the nearest enemy.
    this.drones.update(dt, this.player, this.aliens.aliens, (pos, targetPos) => {
      const dir = this._tmpV.subVectors(targetPos, pos).normalize();
      const vel = dir.clone().multiplyScalar(480);
      this.projectiles.fire(pos.clone(), vel, { enemy: false, drone: true, damage: 1, life: 1.6, radius: 3 });
      this.audio.laser();
    });

    // Firing — primary pulse laser.
    if (input.fire) {
      const shots = this.player.tryFire();
      if (shots) {
        const dmg = this.player.overdriveActive ? 2 : 1;
        for (const s of shots) {
          const vel = s.dir.clone().multiplyScalar(520).add(this.player.velocity);
          this.projectiles.fire(s.pos, vel, { enemy: false, damage: dmg, life: 1.8, radius: 3.5 });
        }
        this.shotsFired += shots.length;
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
    this._collideAsteroids(dt);

    // Pickups.
    const collected = this.pickups.update(dt, this.player.position);
    for (const kind of collected) this._applyPickup(kind);

    // Solar flare hazard.
    this._updateSolarFlare(dt);

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
    // First-run tutorial: advance the coach hints on a timer.
    if (this._tutActive) {
      this._tutTimer -= dt;
      if (this._tutTimer <= 0) this._tutAdvance();
    }
    // Overdrive end: clear the screen tint the frame it wears off.
    if (this._odWas && !this.player.overdriveActive) {
      document.body.classList.remove('overdrive');
      this.hud.toast('OVERDRIVE DEPLETED', 1.0);
    }
    this._odWas = this.player.overdriveActive;

    // Engine audio tracks speed.
    const spd = this.player.speed;
    this.audio.setEngine(clamp((spd - 40) / 110, 0, 1));

    // Warp streaks + boost-driven color grade: stars smear into hyperspace lines and
    // the chromatic aberration swells while the throttle is pinned.
    const fwd = this.player.forwardVector(this._tmpV);
    this.warp.update(dt, this.player.position, fwd, this.player.speed, !!input.boost);
    this.gradePass.uniforms.uAberration.value = this._baseAber + this.warp.amount * 2.2;

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
        if (!b.drone) this.shotsHit++; // drone auto-fire doesn't affect accuracy
        b.kill();
        const res = hitAlien.hitFrom(b.damage, hitPos, wasMissile);
        if (res.dead) this._onAlienDestroyed(hitAlien);
        else if (res.blocked) {
          // Shield deflection — cyan spark, no damage to the hull.
          this.explosions.burst(hitPos, { scale: 0.3, color: 0x99eeff });
          this.audio.hit();
        } else {
          this.explosions.burst(hitPos, { scale: 0.35, color: 0xffee88 });
          this.audio.hit();
        }
        // Missiles detonate with an area blast that damages nearby aliens.
        if (wasMissile) {
          this.explosions.burst(hitPos, { scale: 1.3, big: true, color: 0xffaa33 });
          this.audio.explosion(true);
          this._heavyImpact(0.05, 0.5, 0.7, 0.35);
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
    if (this._grazeCd > 0) this._grazeCd -= dt;
    this.projectiles.forEachLive(true, (b) => {
      if (!this.player.alive) return;
      const rr = this.player.radius + b.radius;
      const d2 = b.mesh.position.distanceToSquared(pp);
      if (d2 < rr * rr) {
        const src = b.mesh.position.clone();
        b.kill();
        this._damagePlayer(b.damage, src);
        this.explosions.burst(src, { scale: 0.4, color: 0xff5566 });
      } else if (!b._grazed) {
        // Near-miss: a bolt whisks past just outside the hull. Reward the dodge.
        const gr = rr + GRAZE_MARGIN;
        if (d2 < gr * gr) { b._grazed = true; this._onGraze(); }
      }
    });
  }

  // Grazing: skimming enemy fire without being hit builds Overdrive and score,
  // rewarding aggressive close-quarters flying. Popup/sound are rate-limited so a
  // dense volley reads as one satisfying rush instead of a wall of text.
  _onGraze() {
    this.grazeCount++;
    this.score += 15;
    this.player.addOverdrive(5);
    if (this._grazeCd <= 0) {
      this._grazeCd = 0.22;
      const screen = this._toScreen(this.player.position);
      if (screen) this.hud.popup(screen.x, screen.y - 34, 'GRAZE', { color: '#8ff0ff' });
      if (this.audio) this.audio.graze();
    }
  }

  _collideShips(dt) {
    if (!this.player.alive) return;
    const pp = this.player.position;
    for (const a of this.aliens.aliens) {
      if (!a.alive) continue;
      const rr = this.player.radius + a.radius;
      if (pp.distanceToSquared(a.position) < rr * rr) {
        // Ram: destroy alien, damage player. Kamikaze stingers hit harder.
        const src = a.position.clone();
        const ram = a.def.ramDamage ?? 18;
        this._onAlienDestroyed(a);
        this._damagePlayer(ram * this.diffConfig.enemyDmg, src);
      }
    }
  }

  // Asteroids: shoot them apart for points/loot, and take a bump if you fly in.
  _collideAsteroids(dt) {
    const pp = this.player.position;
    // Player bolts shatter asteroids (accuracy tracks enemies only, so no shotsHit).
    this.projectiles.forEachLive(false, (b) => {
      for (const a of this.asteroids.pool) {
        if (!a.alive) continue;
        const rr = a.radius + b.radius;
        if (b.mesh.position.distanceToSquared(a.position) < rr * rr) {
          const missile = b.missile;
          b.kill();
          this.explosions.burst(b.mesh.position.clone(), { scale: 0.3, color: 0xc9a98a });
          if (a.hit(missile ? 99 : b.damage)) this._shatterAsteroid(a);
          break;
        }
      }
    });
    // Ramming an asteroid hurts and destroys it (overdrive makes you immune).
    if (this.player.alive) {
      for (const a of this.asteroids.pool) {
        if (!a.alive) continue;
        const rr = this.player.radius + a.radius;
        if (pp.distanceToSquared(a.position) < rr * rr) {
          this._shatterAsteroid(a);
          this._damagePlayer(12, a.position.clone());
        }
      }
    }
  }

  _shatterAsteroid(a) {
    const pos = a.position.clone();
    const scale = a.radius / 10;
    this.explosions.burst(pos, { scale: 0.9 * scale, color: 0xc98a5a });
    this.audio.explosion(false);
    this._addShake(0.3 * scale, 0.2);
    this.score += 50;
    this.hud.setScore(this.score);
    const screen = this._toScreen(pos);
    if (screen) this.hud.popup(screen.x, screen.y, '+50', { color: '#c9a98a' });
    if (Math.random() < 0.16) this.pickups.maybeDrop(pos);
    this.ach.add('asteroids');
    this._checkAch();
    // Respawn it elsewhere so the field stays full.
    this.asteroids.respawn(a, this.player.position);
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
    const isBoss = a.type === 'boss' || a.type === 'warden';
    const big = a.type === 'cruiser' || isBoss;
    this.explosions.burst(pos, { scale: isBoss ? 3.2 : (big ? 1.8 : (a.type === 'fighter' ? 1.1 : 0.8)), big, color: a.def.glow });
    this.audio.explosion(big);
    a.kill();
    this.kills++;

    // Overdrive charge scales with the target's toughness.
    this.player.addOverdrive(isBoss ? 60 : (a.type === 'cruiser' ? 22 : (a.type === 'fighter' ? 11 : 7)));
    this.ach.add('kills');

    // Combo + score.
    this.combo = clamp(this.combo + 0.5, 1, 8);
    this.comboTimer = 3.2;
    const gained = Math.round(a.def.score * this.combo * this.diffConfig.scoreMul);
    this.score += gained;
    this.hud.setScore(this.score);
    this.hud.setCombo(this.combo);

    // Impact feedback scaled to the blast: bosses & heavies land with a hit-stop and
    // a bloom flash; ordinary kills just get a light shake (no stutter on every scout).
    if (isBoss) this._heavyImpact(0.14, 1.0, 1.6, 0.9);
    else if (big) this._heavyImpact(0.05, 0.45, 0.9, 0.5);
    else this._addShake(0.4, 0.28);

    // Floating score popup at the kill location.
    const screen = this._toScreen(pos);
    if (screen) {
      const color = this.combo >= 3 ? '#ffd54a' : '#eafcff';
      this.hud.popup(screen.x, screen.y, '+' + gained, { color, big: big || this.combo >= 4 });
    }

    if (isBoss) { this._onBossDefeated(pos); return; }

    // Killstreak callouts (kills bunched close in time).
    this._streakCount++;
    this._streakTimer = 1.4;
    const names = { 3: 'TRIPLE!', 5: 'RAMPAGE!', 8: 'UNSTOPPABLE!', 12: 'GODLIKE!' };
    if (names[this._streakCount]) this.hud.toast(names[this._streakCount], 1.2);

    // Achievements: lifetime kills + best combo.
    this.ach.setMax('maxCombo', this.combo);
    this._checkAch();

    // Drops (cruisers are more generous).
    this.pickups.maybeDrop(pos, big);
  }

  // Boss defeated: a cascade of explosions, guaranteed loot, and a clean sweep.
  _onBossDefeated(pos) {
    this.bossesKilled++;
    this.ach.add('bosses');
    this._checkAch();
    this.hud.hideBoss();
    this.hud.toast('MOTHERSHIP DESTROYED!', 2.6);
    // Explosion cascade around the wreck.
    for (let i = 0; i < 10; i++) {
      const off = new THREE.Vector3((Math.random()-0.5)*50, (Math.random()-0.5)*50, (Math.random()-0.5)*50);
      const delay = i * 60;
      setTimeout(() => {
        if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) {
          this.explosions.burst(pos.clone().add(off), { scale: 1.6, big: true, color: 0xdd88ff });
        }
      }, delay);
    }
    this.audio.explosion(true);
    this._addShake(2.0, 1.0);
    // Guaranteed loot around the wreck.
    this.pickups.drop(pos.clone().add(new THREE.Vector3(12, 0, 0)), 'weapon');
    this.pickups.drop(pos.clone().add(new THREE.Vector3(-12, 0, 0)), 'missile');
    this.pickups.drop(pos.clone().add(new THREE.Vector3(0, 12, 0)), 'repair');
    this.pickups.drop(pos.clone().add(new THREE.Vector3(0, -12, 0)), 'shield');
    // Clear the escorts in a satisfying sweep.
    for (const e of this.aliens.aliens) {
      if (e.alive && e.type !== 'boss') {
        this.explosions.burst(e.position.clone(), { scale: 0.8, color: e.def.glow });
        e.kill();
      }
    }
  }

  _damagePlayer(amount, sourcePos) {
    if (!this.player.alive) return;
    const before = this.player.health + this.player.shield;
    this.player.damageBy(amount);
    const took = (this.player.health + this.player.shield) < before;
    if (took) this._tookDamageThisWave = true; // breaks the flawless-wave achievement
    this.hud.flashDamage();
    this._addShake(0.5, 0.3);
    if (sourcePos && took) this.hud.showDamageFrom(this.camera, sourcePos);
    if (took) this.audio.hit();
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
    else if (kind === 'drone') {
      this.drones.add();
      this.hud.toast('WINGMAN DRONE ONLINE', 1.2);
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

  // Solar flare: schedule → telegraph → erupt → sweep. The expanding shell hits the
  // player once as it washes over them, unless they're briefly invulnerable (a barrel
  // roll or Overdrive) — so the fair play is to time a roll through the wall of plasma.
  _updateSolarFlare(dt) {
    const flare = this.solarFlare;
    const sun = this.solar.sun.getWorldPosition(this._tmpV2);

    // Erupting: expand the shell and hit the player once as it washes over them.
    if (flare.active) {
      flare.update(dt, sun);
      const dist = this.player.position.distanceTo(sun);
      if (flare.crosses(dist) && !this.player.invulnerable) {
        this._damagePlayer(20 * this.diffConfig.enemyDmg, sun.clone());
        this._heavyImpact(0, 0.6, 1.1, 0.5);
        this.explosions.burst(this.player.position.clone(), { scale: 0.7, color: 0xff8833 });
      }
      return;
    }

    // Telegraph: when the warning elapses, the flare erupts.
    if (flare.warning > 0) {
      flare.update(dt, sun);
      if (flare.warning <= 0) {
        flare.erupt(sun);
        if (this.audio && this.audio.flareErupt) this.audio.flareErupt();
        this._addShake(0.5, 0.4);
        // Next flare comes sooner as waves escalate (floors at ~14s).
        this._flareTimer = Math.max(14, 30 - this.wave) + Math.random() * 8;
      }
      return;
    }

    // Idle: count down to the next flare, then start its telegraph.
    if (this.wave < 2) return;
    this._flareTimer -= dt;
    if (this._flareTimer <= 0) {
      flare.warn(2.0);
      this.hud.toast('☀ SOLAR FLARE — BRACE', 2.2);
      if (this.audio && this.audio.flareWarn) this.audio.flareWarn();
    }
  }

  // Heavy-impact feedback: a brief hit-stop (sim near-freeze), a bloom flash and a
  // camera shake — bundled so big moments (boss deaths, missile blasts) land hard.
  _heavyImpact(hitStop, flash, shake, shakeTime) {
    this._hitStop = Math.max(this._hitStop, hitStop);
    this._flash = Math.max(this._flash, flash);
    if (shake) this._addShake(shake, shakeTime ?? 0.35);
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
    this.hud.setOverdrive(
      (this.player.overdrive / this.player.overdriveMax) * 100,
      this.player.canOverdrive(),
      this.player.overdriveActive
    );
    if (this.aliens.bossAlive()) this.hud.setBossHealth(this.aliens.bossHealthPct());
    this.hud.drawRadar(this.player, this.aliens.aliens);
    this.hud.updateTargetArrows(this.camera, this.aliens.aliens, this.player.position);
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
