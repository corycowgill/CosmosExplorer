// Lightweight procedural sound using the Web Audio API — no asset files needed.
// All effects are synthesized so the game stays self-contained and instant to load.

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Chord progressions (root MIDI note + chord tone offsets). Normal is a hopeful
// A-minor loop; boss is darker and more dissonant.
const NORMAL_PROG = [
  { root: 45, notes: [0, 3, 7] },  // Am
  { root: 41, notes: [0, 4, 7] },  // F
  { root: 48, notes: [0, 4, 7] },  // C
  { root: 43, notes: [0, 4, 7] },  // G
];
const BOSS_PROG = [
  { root: 45, notes: [0, 3, 7] },   // Am
  { root: 44, notes: [0, 3, 6] },   // tension
  { root: 46, notes: [0, 3, 7] },   // Bbm
  { root: 43, notes: [0, 4, 8] },   // Gaug
];

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._droneNodes = null;
    this.music = null;
  }

  // Must be called from a user gesture (button click) to satisfy autoplay policies.
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _now() { return this.ctx.currentTime; }

  // Generic tone with envelope.
  _tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.2, gain = 0.3, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.3, gain = 0.4, lpStart = 3000, lpEnd = 200, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this._now() + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lpStart, t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(60, lpEnd), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  laser() {
    this._tone({ type: 'sawtooth', freq: 1400, freqEnd: 320, dur: 0.16, gain: 0.16 });
    this._tone({ type: 'square', freq: 720, freqEnd: 180, dur: 0.12, gain: 0.06 });
  }

  enemyLaser() {
    this._tone({ type: 'square', freq: 500, freqEnd: 140, dur: 0.18, gain: 0.09 });
  }

  explosion(big = false) {
    this._noise({ dur: big ? 0.7 : 0.4, gain: big ? 0.5 : 0.32, lpStart: big ? 2400 : 1800, lpEnd: 90 });
    this._tone({ type: 'sine', freq: big ? 120 : 200, freqEnd: 40, dur: big ? 0.5 : 0.3, gain: big ? 0.4 : 0.22 });
  }

  hit() {
    this._noise({ dur: 0.25, gain: 0.35, lpStart: 1200, lpEnd: 120 });
    this._tone({ type: 'sine', freq: 160, freqEnd: 50, dur: 0.22, gain: 0.3 });
  }

  pickup() {
    this._tone({ type: 'sine', freq: 660, freqEnd: 990, dur: 0.14, gain: 0.2 });
    this._tone({ type: 'sine', freq: 990, freqEnd: 1320, dur: 0.14, gain: 0.16, delay: 0.07 });
  }

  waveClear() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this._tone({ type: 'triangle', freq: f, dur: 0.3, gain: 0.18, delay: i * 0.1 }));
  }

  gameOver() {
    const notes = [523, 392, 330, 262];
    notes.forEach((f, i) => this._tone({ type: 'sawtooth', freq: f, freqEnd: f * 0.98, dur: 0.5, gain: 0.16, delay: i * 0.18 }));
  }

  // Continuous engine drone whose pitch tracks speed.
  startEngine() {
    if (!this.ctx || !this.enabled || this._droneNodes) return;
    const osc = this.ctx.createOscillator();
    const sub = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    osc.type = 'sawtooth'; osc.frequency.value = 70;
    sub.type = 'sine'; sub.frequency.value = 42;
    lp.type = 'lowpass'; lp.frequency.value = 380;
    g.gain.value = 0.0;
    osc.connect(lp); sub.connect(lp); lp.connect(g); g.connect(this.master);
    osc.start(); sub.start();
    this._droneNodes = { osc, sub, g, lp };
  }

  setEngine(intensity) {
    if (!this._droneNodes) return;
    const { osc, sub, g, lp } = this._droneNodes;
    const t = this._now();
    g.gain.setTargetAtTime(0.03 + intensity * 0.06, t, 0.1);
    osc.frequency.setTargetAtTime(60 + intensity * 90, t, 0.1);
    sub.frequency.setTargetAtTime(38 + intensity * 40, t, 0.1);
    lp.frequency.setTargetAtTime(320 + intensity * 500, t, 0.1);
  }

  stopEngine() {
    if (!this._droneNodes) return;
    const { osc, sub, g } = this._droneNodes;
    const t = this._now();
    g.gain.setTargetAtTime(0.0001, t, 0.2);
    osc.stop(t + 0.4); sub.stop(t + 0.4);
    this._droneNodes = null;
  }

  // ---------------- adaptive music ----------------
  // A lookahead scheduler sequences a pad, bassline, arpeggio and (boss) kick.
  startMusic() {
    if (!this.ctx || this.music) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.master);
    this.music = {
      gain: g, step: 0, bar: 0, tempo: 104, intensity: 1,
      next: this.ctx.currentTime + 0.2, timer: null,
    };
    g.gain.setTargetAtTime(0.16, this.ctx.currentTime, 1.4);
    this.music.timer = setInterval(() => this._musicTick(), 25);
  }

  stopMusic() {
    if (!this.music) return;
    const m = this.music;
    this.music = null;
    if (m.timer) clearInterval(m.timer);
    m.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.5);
    setTimeout(() => { try { m.gain.disconnect(); } catch (e) {} }, 1600);
  }

  setMusicIntensity(level) {
    const m = this.music;
    if (!m || !this.ctx) return;
    m.intensity = level;
    m.tempo = level >= 2 ? 128 : 104;
    const vol = level <= 0 ? 0.05 : (level >= 2 ? 0.2 : 0.15);
    m.gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.6);
  }

  _musicTick() {
    const m = this.music;
    if (!m || !this.ctx) return;
    const sec16 = 60 / m.tempo / 4; // one sixteenth note
    while (m.next < this.ctx.currentTime + 0.12) {
      this._musicStep(m.step, m.next);
      m.next += sec16;
      m.step++;
      if (m.step >= 16) { m.step = 0; m.bar++; }
    }
  }

  _musicStep(step, time) {
    const m = this.music;
    const prog = m.intensity >= 2 ? BOSS_PROG : NORMAL_PROG;
    const chord = prog[m.bar % prog.length];
    const beatLen = 60 / m.tempo;

    if (step === 0) this._pad(chord, time, beatLen * 4);                 // pad per bar
    if (step % (m.intensity >= 2 ? 2 : 4) === 0) this._bass(chord.root, time); // bassline
    if (m.intensity >= 1 && step % 2 === 0) this._arp(chord, step, time);      // arpeggio
    if (m.intensity >= 2 && step % 4 === 0) this._kick(time);                  // boss kick
  }

  _pad(chord, time, dur) {
    if (!this.music) return;
    for (const semi of chord.notes) {
      const f = midiToFreq(chord.root + 12 + semi);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const lp = this.ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() - 0.5) * 10;
      lp.type = 'lowpass';
      lp.frequency.value = 850;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.05, time + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(lp); lp.connect(g); g.connect(this.music.gain);
      osc.start(time); osc.stop(time + dur + 0.1);
    }
  }

  _bass(rootMidi, time) {
    if (!this.music) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(rootMidi - 12);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.14, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(g); g.connect(this.music.gain);
    osc.start(time); osc.stop(time + 0.26);
  }

  _arp(chord, step, time) {
    if (!this.music) return;
    const idx = (step / 2) % chord.notes.length;
    const oct = 24 + (Math.floor(step / 8) % 2) * 12;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = midiToFreq(chord.root + oct + chord.notes[idx]);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.035, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
    osc.connect(g); g.connect(this.music.gain);
    osc.start(time); osc.stop(time + 0.16);
  }

  _kick(time) {
    if (!this.music) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    g.gain.setValueAtTime(0.18, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    osc.connect(g); g.connect(this.music.gain);
    osc.start(time); osc.stop(time + 0.24);
  }
}
