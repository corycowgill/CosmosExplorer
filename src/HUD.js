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
      toast: document.getElementById('toast'),
      damage: document.getElementById('damage-flash'),
      lock: document.getElementById('lock-marker'),
    };
    this.radar = document.getElementById('radar');
    this.rctx = this.radar.getContext('2d');
    this._toastTimer = 0;
    this._shownScore = 0;
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
    this.el.weapon.textContent = overheated ? 'OVERHEATED!' : 'PULSE LASER';
    this.el.weapon.style.color = overheated ? '#ff5b7a' : '';
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
