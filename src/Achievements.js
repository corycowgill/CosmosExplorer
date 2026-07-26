// Persistent, cross-run achievements. Lifetime stats and unlocked IDs are stored in
// localStorage. Game records events (kills, bosses, waves, accuracy, …); check()
// evaluates the definitions and returns any newly-unlocked achievements to announce.

const KEY = 'cosmos_achievements';

export const ACHIEVEMENTS = [
  { id: 'first_blood',  icon: '💥', name: 'First Blood',   desc: 'Destroy your first alien',        test: (s) => s.kills >= 1 },
  { id: 'centurion',    icon: '⚔️', name: 'Centurion',      desc: 'Destroy 100 aliens (lifetime)',   test: (s) => s.kills >= 100 },
  { id: 'exterminator', icon: '☠️', name: 'Exterminator',   desc: 'Destroy 1,000 aliens (lifetime)', test: (s) => s.kills >= 1000 },
  { id: 'boss_slayer',  icon: '👑', name: 'Boss Slayer',    desc: 'Defeat a Mothership',             test: (s) => s.bosses >= 1 },
  { id: 'warlord',      icon: '🛡️', name: 'Warlord',        desc: 'Defeat 10 Motherships (lifetime)',test: (s) => s.bosses >= 10 },
  { id: 'overdriver',   icon: '⚡', name: 'Overdriver',     desc: 'Unleash Overdrive',               test: (s) => s.overdrives >= 1 },
  { id: 'deep_space',   icon: '🚀', name: 'Deep Space',     desc: 'Reach wave 10',                   test: (s) => s.bestWave >= 10 },
  { id: 'legend',       icon: '🌌', name: 'Living Legend',  desc: 'Reach wave 20',                   test: (s) => s.bestWave >= 20 },
  { id: 'sharpshooter', icon: '🎯', name: 'Sharpshooter',   desc: 'Finish a run at 80%+ accuracy',   test: (s) => s.bestAccuracy >= 80 },
  { id: 'deadeye',      icon: '🔭', name: 'Deadeye',        desc: 'Finish a run at 95%+ accuracy',   test: (s) => s.bestAccuracy >= 95 },
  { id: 'untouchable',  icon: '✨', name: 'Untouchable',    desc: 'Clear a wave without a scratch',  test: (s) => s.noDamageWave },
  { id: 'combo_king',   icon: '🔥', name: 'Combo King',     desc: 'Reach an x8 combo',               test: (s) => s.maxCombo >= 8 },
  { id: 'rock_breaker', icon: '🪨', name: 'Rock Breaker',   desc: 'Smash 50 asteroids (lifetime)',   test: (s) => s.asteroids >= 50 },
  { id: 'millionaire',  icon: '💎', name: 'High Roller',    desc: 'Score 100,000 in a run',          test: (s) => s.bestScore >= 100000 },
  { id: 'ace_pilot',    icon: '🏆', name: 'Ace Pilot',      desc: 'Reach wave 10 on Ace difficulty', test: (s) => s.aceWave >= 10 },
];

const DEFAULT_STATS = {
  kills: 0, bosses: 0, asteroids: 0, overdrives: 0,
  bestWave: 0, bestAccuracy: 0, bestScore: 0, maxCombo: 0,
  aceWave: 0, noDamageWave: false,
};

export class Achievements {
  constructor() {
    this.unlocked = new Set();
    this.stats = { ...DEFAULT_STATS };
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (Array.isArray(raw.unlocked)) this.unlocked = new Set(raw.unlocked);
      if (raw.stats) this.stats = { ...DEFAULT_STATS, ...raw.stats };
    } catch (e) { /* ignore corrupt data */ }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ unlocked: [...this.unlocked], stats: this.stats }));
    } catch (e) { /* storage may be unavailable */ }
  }

  add(key, n = 1) { this.stats[key] = (this.stats[key] || 0) + n; }
  setMax(key, v) { this.stats[key] = Math.max(this.stats[key] || 0, v); }
  setFlag(key) { this.stats[key] = true; }

  // Evaluate all definitions; return the list of newly-unlocked achievements.
  check() {
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (!this.unlocked.has(a.id) && a.test(this.stats)) {
        this.unlocked.add(a.id);
        fresh.push(a);
      }
    }
    if (fresh.length) this._save();
    else this._save(); // persist stat updates too
    return fresh;
  }

  isUnlocked(id) { return this.unlocked.has(id); }
  count() { return this.unlocked.size; }
  total() { return ACHIEVEMENTS.length; }
}
