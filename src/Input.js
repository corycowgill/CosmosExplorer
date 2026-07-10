// Unified input layer.
// Merges keyboard, mouse, touch (virtual joystick + buttons) and gamepad into a
// single per-frame control state so the rest of the game never cares which device
// the player is using.
//
// Exposed state (all normalized):
//   yaw    : -1 (left)  .. 1 (right)
//   pitch  : -1 (down)  .. 1 (up)
//   roll   : -1 .. 1
//   throttle: -1 (brake) .. 1 (accelerate)
//   fire   : boolean
//   boost  : boolean

import { clamp, isTouchDevice } from './utils.js';

export class Input {
  constructor() {
    this.state = { yaw: 0, pitch: 0, roll: 0, throttle: 0, fire: false, boost: false };

    this.keys = new Set();
    this.mouse = { x: 0, y: 0, active: false, down: false };
    this.touch = { steerX: 0, steerY: 0, fire: false, boost: false };
    this.enabled = false;

    this._bindKeyboard();
    this._bindMouse();
    if (isTouchDevice) this._bindTouch();
  }

  enable() { this.enabled = true; }
  disable() {
    this.enabled = false;
    this.keys.clear();
    this.mouse.down = false;
    this.mouse.active = false;
    this.touch = { steerX: 0, steerY: 0, fire: false, boost: false };
  }

  // ------------------------------------------------------------------
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindMouse() {
    const root = document.getElementById('game-root');
    window.addEventListener('mousemove', (e) => {
      // Steering is proportional to distance from screen centre.
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      this.mouse.x = nx;
      this.mouse.y = ny;
      this.mouse.active = true;
      this.mouse.lastMove = performance.now(); // for idle-decay so a parked cursor stops steering
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.down = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    if (root) root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _bindTouch() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const thumb = document.getElementById('joystick-thumb');
    const fireBtn = document.getElementById('btn-fire');
    const boostBtn = document.getElementById('btn-boost');
    const maxR = 62;
    let joyId = null;
    let origin = { x: 0, y: 0 };

    const startJoy = (id, x, y) => {
      joyId = id;
      origin = { x, y };
      base.style.left = x + 'px';
      base.style.top = y + 'px';
      base.classList.add('active');
    };
    const moveJoy = (x, y) => {
      let dx = x - origin.x, dy = y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.steerX = clamp(dx / maxR, -1, 1);
      this.touch.steerY = clamp(dy / maxR, -1, 1);
    };
    const endJoy = () => {
      joyId = null;
      base.classList.remove('active');
      thumb.style.transform = 'translate(0,0)';
      this.touch.steerX = 0;
      this.touch.steerY = 0;
    };

    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      startJoy(t.identifier, t.clientX, t.clientY);
      moveJoy(t.clientX, t.clientY);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === joyId) moveJoy(t.clientX, t.clientY);
      }
    }, { passive: false });
    const onEnd = (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) endJoy();
    };
    zone.addEventListener('touchend', onEnd);
    zone.addEventListener('touchcancel', onEnd);

    // Fire & boost buttons
    const hold = (btn, prop) => {
      const on = (e) => { e.preventDefault(); this.touch[prop] = true; };
      const off = (e) => { e.preventDefault(); this.touch[prop] = false; };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off);
      btn.addEventListener('touchcancel', off);
    };
    hold(fireBtn, 'fire');
    hold(boostBtn, 'boost');
  }

  // ------------------------------------------------------------------
  _pollGamepad(s) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) { if (p && p.connected) { pad = p; break; } }
    if (!pad) return;

    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
    const ax = pad.axes;
    // Left stick steers.
    s.yaw += dz(ax[0] ?? 0);
    s.pitch += -dz(ax[1] ?? 0); // stick up (negative) => pitch up
    // Right stick can also nudge steering / roll.
    s.roll += dz(ax[2] ?? 0) * 0.8;

    const btn = (i) => pad.buttons[i] && pad.buttons[i].pressed;
    const val = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    // Fire: RT (7) or A (0)
    if (val(7) > 0.35 || btn(0)) s.fire = true;
    // Boost: LT (6) or B (1)
    if (val(6) > 0.35 || btn(1)) s.boost = true;
    // Roll with bumpers LB(4)/RB(5)
    if (btn(4)) s.roll -= 1;
    if (btn(5)) s.roll += 1;
    // D-pad up/down as throttle
    if (btn(12)) s.throttle += 1;
    if (btn(13)) s.throttle -= 1;
  }

  // Called once per frame. Produces the merged control state.
  update() {
    const s = this.state;
    s.yaw = 0; s.pitch = 0; s.roll = 0; s.throttle = 0; s.fire = false; s.boost = false;
    if (!this.enabled) return s;

    // ---- Keyboard ----
    // WASD / arrow keys steer in every direction: A/D yaw, W/S pitch. Combined with
    // roll (Q/E) the ship can point and fly anywhere — full spherical flight.
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) s.yaw -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s.yaw += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) s.pitch += 1;   // nose up / climb
    if (k.has('KeyS') || k.has('ArrowDown')) s.pitch -= 1; // nose down / dive
    if (k.has('KeyQ')) s.roll -= 1;
    if (k.has('KeyE')) s.roll += 1;
    // Speed: accelerate / brake on a dedicated pair so it never blocks steering.
    if (k.has('KeyR') || k.has('Equal')) s.throttle += 1;
    if (k.has('KeyF') || k.has('Minus')) s.throttle -= 1;
    if (k.has('Space')) s.fire = true;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) s.boost = true;

    // ---- Mouse (steer + aim) ----
    if (this.mouse.active) {
      // Idle-decay: fade the mouse's steering authority to zero shortly after the
      // pointer stops moving, so a parked off-centre cursor no longer turns the
      // ship forever. Active movement instantly restores full authority.
      const idle = performance.now() - (this.mouse.lastMove || 0);
      const gain = idle < 180 ? 1 : Math.max(0, 1 - (idle - 180) / 450);

      if (gain > 0) {
        const mx = this.mouse.x, my = this.mouse.y;
        const deadzone = 0.06;
        const shape = (v) => {
          const a = Math.abs(v);
          if (a < deadzone) return 0;
          // Reach full deflection at ~65% toward the edge, mostly linear.
          const t = Math.min(1, (a - deadzone) / (0.65 - deadzone));
          return Math.sign(v) * t * (0.55 + 0.45 * t) * gain;
        };
        // Keyboard steering takes precedence when a key is held.
        if (s.yaw === 0) s.yaw += shape(mx);
        if (s.pitch === 0) s.pitch += -shape(my);
      }
      if (this.mouse.down) s.fire = true;
    }

    // ---- Touch ----
    if (this.touch.steerX || this.touch.steerY) {
      if (s.yaw === 0) s.yaw += this.touch.steerX;
      if (s.pitch === 0) s.pitch += -this.touch.steerY;
    }
    if (this.touch.fire) s.fire = true;
    if (this.touch.boost) s.boost = true;

    // ---- Gamepad ----
    this._pollGamepad(s);

    s.yaw = clamp(s.yaw, -1, 1);
    s.pitch = clamp(s.pitch, -1, 1);
    s.roll = clamp(s.roll, -1, 1);
    s.throttle = clamp(s.throttle, -1, 1);
    return s;
  }
}
