// Manages the DOM HUD overlay: score, wave, combo, hull/shield bars, speed, heat,
// crosshair lock indicator, toast messages, damage flash and the radar canvas.

import * as THREE from 'three';
import { fmt, clamp } from './utils.js';

export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      score: document.getElementById('hud-score'),
      hiscore: document.getElementById('hud-hiscore'),
      wave: document.getElementById('hud-wave'),
      combo: document.getElementById('hud-combo'),
      health: document.getElementById('hud-health'),
      shield: document.getElementById('hud-shield'),
      speed: document.getElementById('hud-speed'),
      heat: document.getElementById('hud-heat'),
      weapon: document.getElementById('hud-weapon'),
      wlevel: document.getElementById('hud-wlevel'),
      missiles: document.getElementById('hud-missiles'),
      toast: document.getElementById('toast'),
      damage: document.getElementById('damage-flash'),
      lock: document.getElementById('lock-marker'),
      popups: document.getElementById('popups'),
      mute: document.getElementById('btn-mute'),
      bossBar: document.getElementById('boss-bar'),
      bossFill: document.getElementById('boss-fill'),
      overdrive: document.getElementById('hud-overdrive'),
      odBar: document.getElementById('hud-od-bar'),
      odLabel: document.getElementById('hud-od-label'),
      odBtn: document.getElementById('btn-overdrive'),
    };
    this.radar = document.getElementById('radar');
    this.rctx = this.radar.getContext('2d');
    this._toastTimer = 0;
    this._shownScore = 0;
    this._popupCount = 0;

    // Pool of off-screen enemy direction arrows.
    this._indicators = document.getElementById('indicators');
    this._dmgArrow = document.getElementById('dmg-arrow');
    this._arrows = [];
    for (let i = 0; i < 14; i++) {
      const el = document.createElement('div');
      el.className = 'tgt-arrow';
      el.style.display = 'none';
      this._indicators.appendChild(el);
      this._arrows.push(el);
    }
    this._tmpFwd = new THREE.Vector3();
    this._tmpTo = new THREE.Vector3();
    this._tmpProj = new THREE.Vector3();
  }

  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  setScore(v) {
    // Animate the counter toward the target for a snappy feel.
    this._targetScore = v;
  }
  setHiScore(v) { this.el.hiscore.textContent = fmt(v); }
  setWave(v) { this.el.wave.textContent = v; }
  setCombo(v) { this.el.combo.textContent = v.toFixed(v >= 10 ? 0 : 1).replace(/\.0$/, ''); }

  setBars(healthPct, shieldPct) {
    this.el.health.style.width = clamp(healthPct, 0, 100) + '%';
    this.el.shield.style.width = clamp(shieldPct, 0, 100) + '%';
  }

  setSpeed(v) { this.el.speed.textContent = Math.round(v); }
  setHeat(pct, overheated) {
    this.el.heat.textContent = Math.round(pct) + '%';
    if (overheated) {
      this.el.weapon.firstChild.textContent = 'OVERHEATED! ';
      this.el.weapon.style.color = '#ff5b7a';
    } else {
      this.el.weapon.firstChild.textContent = 'PULSE LASER ';
      this.el.weapon.style.color = '';
    }
  }

  // Place edge arrows pointing at nearby enemies that are off-screen or behind.
  updateTargetArrows(camera, aliens, playerPos) {
    const W = window.innerWidth, H = window.innerHeight;
    const camPos = camera.position;
    const fwd = camera.getWorldDirection(this._tmpFwd);
    const margin = 0.94;

    // Nearest-first so the closest threats always get an arrow.
    const cands = [];
    for (const a of aliens) {
      if (!a.alive) continue;
      const d = a.position.distanceTo(playerPos);
      if (d > 1100) continue;
      cands.push({ a, d });
    }
    cands.sort((x, y) => x.d - y.d);

    let idx = 0;
    for (const { a, d } of cands) {
      if (idx >= this._arrows.length) break;
      const ndc = this._tmpProj.copy(a.position).project(camera);
      const front = this._tmpTo.subVectors(a.position, camPos).dot(fwd) > 0;
      let x = ndc.x, y = ndc.y;
      if (!front) { x = -x; y = -y; } // mirror behind-camera targets to the near edge
      if (front && Math.abs(x) <= margin && Math.abs(y) <= margin) continue; // on-screen already
      const mag = Math.max(Math.abs(x), Math.abs(y)) || 1;
      x = (x / mag) * margin; y = (y / mag) * margin;
      const sx = (x * 0.5 + 0.5) * W, sy = (-y * 0.5 + 0.5) * H;
      const ang = Math.atan2(-y, x) * 180 / Math.PI;
      const boss = a.type === 'boss';
      const el = this._arrows[idx++];
      el.style.display = 'block';
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
      el.style.transform = `translate(-50%,-50%) rotate(${ang}deg) scale(${boss ? 1.7 : 1})`;
      el.style.color = boss ? '#ff5ec4' : (a.type === 'cruiser' ? '#ffaa33' : (a.type === 'fighter' ? '#ff66cc' : '#66ff88'));
      el.style.opacity = boss ? '1' : String(Math.max(0.4, 1 - d / 1100));
    }
    for (; idx < this._arrows.length; idx++) this._arrows[idx].style.display = 'none';
  }

  hideTargetArrows() { for (const el of this._arrows) el.style.display = 'none'; }

  // Flash a red arrow at the screen edge pointing to where damage came from.
  showDamageFrom(camera, sourcePos) {
    const W = window.innerWidth, H = window.innerHeight;
    const ndc = this._tmpProj.copy(sourcePos).project(camera);
    const front = this._tmpTo.subVectors(sourcePos, camera.position).dot(camera.getWorldDirection(this._tmpFwd)) > 0;
    let x = ndc.x, y = ndc.y;
    if (!front) { x = -x; y = -y; }
    const mag = Math.max(Math.abs(x), Math.abs(y)) || 1;
    x = (x / mag) * 0.96; y = (y / mag) * 0.96;
    const el = this._dmgArrow;
    el.style.left = ((x * 0.5 + 0.5) * W) + 'px';
    el.style.top = ((-y * 0.5 + 0.5) * H) + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(-y, x) * 180 / Math.PI}deg)`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showBoss() { this.el.bossBar.classList.remove('hidden'); this.setBossHealth(100); }
  hideBoss() { this.el.bossBar.classList.add('hidden'); }
  setBossHealth(pct) { this.el.bossFill.style.width = clamp(pct, 0, 100) + '%'; }

  setWeaponLevel(level) { this.el.wlevel.textContent = 'L' + level; }
  setMissiles(n) { this.el.missiles.textContent = n; }

  setOverdrive(pct, ready, active) {
    this.el.overdrive.style.width = clamp(pct, 0, 100) + '%';
    const bar = this.el.odBar;
    bar.classList.toggle('ready', ready && !active);
    bar.classList.toggle('active', active);
    this.el.odLabel.textContent = active ? 'OVERDRIVE ●' : (ready ? 'OVERDRIVE — READY (X)' : 'OVERDRIVE');
    if (this.el.odBtn) this.el.odBtn.classList.toggle('ready', ready && !active);
  }
  setMuted(muted) { this.el.mute.textContent = muted ? '🔇' : '🔊'; }

  // Spawn a floating popup at a screen position (score gains, streak names, etc.).
  popup(screenX, screenY, text, opts = {}) {
    if (this._popupCount > 24) return; // safety cap
    const el = document.createElement('div');
    el.className = 'popup' + (opts.big ? ' big' : '');
    el.textContent = text;
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.color = opts.color || '#eafcff';
    this.el.popups.appendChild(el);
    this._popupCount++;
    setTimeout(() => { el.remove(); this._popupCount--; }, 1100);
  }

  toast(msg, dur = 1.8) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.remove('show');
    // Force reflow to restart the animation.
    void this.el.toast.offsetWidth;
    this.el.toast.classList.add('show');
    this._toastTimer = dur;
  }

  flashDamage() {
    this.el.damage.classList.add('hit');
    setTimeout(() => this.el.damage.classList.remove('hit'), 90);
  }

  // Lock marker in screen space over the current target (or null to hide).
  setLock(screenPos) {
    if (!screenPos) { this.el.lock.classList.add('hidden'); return; }
    this.el.lock.classList.remove('hidden');
    this.el.lock.style.left = screenPos.x + 'px';
    this.el.lock.style.top = screenPos.y + 'px';
  }

  update(dt) {
    // Smoothly animate the score counter.
    if (this._targetScore !== undefined) {
      const diff = this._targetScore - this._shownScore;
      if (Math.abs(diff) < 1) this._shownScore = this._targetScore;
      else this._shownScore += diff * Math.min(1, dt * 12);
      this.el.score.textContent = fmt(this._shownScore);
    }
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }

  // Draw a top-down radar of aliens relative to the player heading.
  drawRadar(player, aliens) {
    const ctx = this.rctx;
    const w = this.radar.width, h = this.radar.height;
    const cx = w / 2, cy = h / 2;
    const R = w / 2 - 4;
    ctx.clearRect(0, 0, w, h);

    // Backdrop grid.
    ctx.strokeStyle = 'rgba(56,246,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();

    // Sweep line.
    const sweep = (performance.now() / 1000) % (Math.PI * 2);
    ctx.strokeStyle = 'rgba(56,246,255,0.5)';
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();

    // Build a basis from the player's heading (forward = -Z).
    const fwd = player.forwardVector(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const range = 700;

    const ppos = player.position;
    const tmp = new THREE.Vector3();
    for (const a of aliens) {
      if (!a.alive) continue;
      tmp.subVectors(a.position, ppos);
      const forwardComp = tmp.dot(fwd);   // ahead(+)/behind(-)
      const rightComp = tmp.dot(right);   // right(+)/left(-)
      let px = rightComp / range, py = -forwardComp / range;
      const mag = Math.hypot(px, py);
      if (mag > 1) { px /= mag; py /= mag; } // clamp to rim
      const x = cx + px * R, y = cy + py * R;
      const onRim = mag > 1;
      ctx.fillStyle = a.type === 'cruiser' ? '#ffaa33' : (a.type === 'fighter' ? '#ff66cc' : '#66ff88');
      ctx.beginPath();
      ctx.arc(x, y, onRim ? 2 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player triangle at centre.
    ctx.fillStyle = '#eafcff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx - 4, cy + 5); ctx.lineTo(cx + 4, cy + 5);
    ctx.closePath(); ctx.fill();
  }
}
