// Career progress: stages, medals, credits, upgrades, rider level, achievements and saving.
(function (root) {
  const CL = root.CL || (root.CL = {});
  const KEY = 'cliffline.v1';

  const STAGES = [
    { id: 'harbor', name: 'Harbor Road', seed: 11, length: 2200, rMin: 130, rMax: 420, straights: 0.42, sectors: 3, need: 0 },
    { id: 'lemon', name: 'Lemon Terraces', seed: 29, length: 2800, rMin: 95, rMax: 360, straights: 0.34, sectors: 3, need: 1 },
    { id: 'lighthouse', name: 'Lighthouse Run', seed: 47, length: 3400, rMin: 85, rMax: 330, straights: 0.4, sectors: 3, need: 3 },
    { id: 'saltwind', name: 'Saltwind Pass', seed: 83, length: 3900, rMin: 70, rMax: 280, straights: 0.28, sectors: 4, need: 6 },
    { id: 'chapel', name: 'Chapel Hairpins', seed: 101, length: 4300, rMin: 48, rMax: 210, straights: 0.24, sectors: 4, need: 9 },
    { id: 'seacliff', name: 'Seacliff Mile', seed: 137, length: 5200, rMin: 90, rMax: 480, straights: 0.5, sectors: 4, need: 12 },
    { id: 'widow', name: 'Widow’s Corniche', seed: 173, length: 5600, rMin: 42, rMax: 190, straights: 0.2, sectors: 5, need: 16 },
    { id: 'sundown', name: 'Sundown Grand Tour', seed: 211, length: 7000, rMin: 45, rMax: 400, straights: 0.3, sectors: 5, need: 20 },
  ];
  const MEDALS = [['gold', 1.14, 3], ['silver', 1.3, 2], ['bronze', 1.5, 1]];
  const UPGRADES = {
    engine: { name: 'Engine tune', desc: 'More power at every rev', costs: [400, 900, 1800, 3400], per: 0.05, key: 'power' },
    brakes: { name: 'Race brakes', desc: 'Harder, shorter stops', costs: [300, 700, 1400], per: 0.05, key: 'brake' },
    tires: { name: 'Softer tires', desc: 'More grip while leaned over', costs: [500, 1100, 2200], per: 0.035, key: 'grip' },
    chassis: { name: 'Sharper chassis', desc: 'Leans over faster', costs: [350, 800, 1600], per: 0.06, key: 'lean' },
  };
  const LIVERIES = [
    { id: 'ember', name: 'Ember', color: '#d9381e', level: 1 },
    { id: 'midnight', name: 'Midnight', color: '#1c2c55', level: 3 },
    { id: 'sage', name: 'Sage', color: '#5c7a4a', level: 5 },
    { id: 'gold', name: 'Gold Leaf', color: '#c9992b', level: 8 },
    { id: 'pearl', name: 'Pearl', color: '#e8e4d8', level: 12 },
  ];
  const ACHIEVEMENTS = [
    ['first', 'First Finish', 'Finish any stage', (c) => c.totals.finishes >= 1],
    ['gold1', 'Gold Standard', 'Win a gold medal', (c) => Object.values(c.stages).some((s) => s.stars >= 3)],
    ['clean', 'Rubber Side Down', 'Finish a stage with no crashes', (c) => c.totals.cleanRuns >= 1],
    ['noassist', 'Bare Hands', 'Finish with all rider aids off', (c) => c.totals.noAssistFinishes >= 1],
    ['speed250', 'Quarter Thousand', 'Reach 250 km/h', (c) => c.records.topKmh >= 250],
    ['lean48', 'Knee Down', 'Lean past 48 degrees', (c) => c.records.maxLean >= 48],
    ['km100', 'Long Way Round', 'Ride 100 km in total', (c) => c.totals.meters >= 100000],
    ['miss25', 'Threading Traffic', '25 near misses', (c) => c.totals.nearMisses >= 25],
    ['maxed', 'Factory Spec', 'Max out one upgrade', (c) => Object.keys(UPGRADES).some((k) => c.upgrades[k] >= UPGRADES[k].costs.length)],
    ['tour', 'Grand Tourist', 'Unlock the final stage', (c) => stars(c) >= STAGES[7].need],
    ['allgold', 'The Whole Coast', 'Gold on all 8 stages', (c) => STAGES.every((s) => (c.stages[s.id] || {}).stars >= 3)],
    ['daily7', 'Regular', 'Ride 7 daily roads', (c) => c.totals.dailies >= 7],
  ].map(([id, name, desc, test]) => ({ id, name, desc, test }));

  function fresh() {
    return {
      v: 1, xp: 0, credits: 0, upgrades: { engine: 0, brakes: 0, tires: 0, chassis: 0 }, stages: {}, unlocked: {}, history: [],
      totals: { runs: 0, finishes: 0, cleanRuns: 0, noAssistFinishes: 0, meters: 0, crashes: 0, seconds: 0, nearMisses: 0, shifts: 0, dailies: 0, credits: 0 },
      records: { topKmh: 0, maxLean: 0 },
      daily: { date: '', best: 0 },
      settings: { assist: 'full', autoShift: true, traffic: 'off', sound: true, livery: 'ember', quality: 'auto' },
      updated: 0,
    };
  }
  function normalize(raw) {
    const c = fresh();
    if (!raw || typeof raw !== 'object') return c;
    for (const k of Object.keys(c)) {
      if (raw[k] === undefined) continue;
      c[k] = c[k] && typeof c[k] === 'object' && !Array.isArray(c[k]) ? Object.assign(c[k], raw[k]) : raw[k];
    }
    return c;
  }

  const stars = (c) => STAGES.reduce((n, s) => n + ((c.stages[s.id] || {}).stars || 0), 0);
  const isUnlocked = (c, stage) => stars(c) >= stage.need;
  const nextLevelXP = (lv) => 400 * lv * lv;
  function levelOf(xp) {
    let lv = 1;
    while (xp >= nextLevelXP(lv)) lv++;
    const floor = lv === 1 ? 0 : nextLevelXP(lv - 1);
    return { level: lv, into: xp - floor, span: nextLevelXP(lv) - floor };
  }
  function tuneOf(c) {
    const t = { power: 1, brake: 1, grip: 1, lean: 1 };
    for (const k of Object.keys(UPGRADES)) t[UPGRADES[k].key] = 1 + UPGRADES[k].per * (c.upgrades[k] || 0);
    return t;
  }
  function medalTimes(idealTime) {
    return MEDALS.map(([id, f, st]) => ({ id, time: idealTime * f, stars: st }));
  }
  function medalFor(time, idealTime) {
    return medalTimes(idealTime).find((m) => time <= m.time) || null;
  }
  function buyUpgrade(c, key) {
    const u = UPGRADES[key], lv = c.upgrades[key] || 0;
    if (!u || lv >= u.costs.length || c.credits < u.costs[lv]) return false;
    c.credits -= u.costs[lv];
    c.upgrades[key] = lv + 1;
    return true;
  }
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dailyStage(key) {
    let h = 2166136261;
    for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    const seed = h >>> 0;
    return { id: 'daily', name: 'Daily Road', seed, length: 2600 + (seed % 1400), rMin: 60 + (seed % 40), rMax: 260 + (seed % 160), straights: 0.3, sectors: 3, need: 0 };
  }

  // Applies one ride. run: { stage, finished, time, sectors, idealTime, meters, crashes, topKmh, maxLean, nearMisses, shifts, seconds, assist, traffic, daily }
  function recordRun(c, run) {
    const levelBefore = levelOf(c.xp).level, starsBefore = stars(c);
    const t = c.totals, assist = { full: 1, light: 1.25, off: 1.6 }[run.assist] || 1, trafficMul = { off: 1, low: 1.1, medium: 1.25 }[run.traffic] || 1;
    t.runs++; t.meters += run.meters; t.crashes += run.crashes; t.seconds += run.seconds; t.nearMisses += run.nearMisses; t.shifts += run.shifts;
    c.records.topKmh = Math.max(c.records.topKmh, run.topKmh);
    c.records.maxLean = Math.max(c.records.maxLean, run.maxLean);
    let medal = null, firstMedal = false, newRecord = false, delta = null, medalBonus = 0;
    if (run.finished) {
      t.finishes++;
      if (!run.crashes) t.cleanRuns++;
      if (run.assist === 'off') t.noAssistFinishes++;
      if (run.daily) {
        t.dailies++;
        if (c.daily.date !== run.dayKey) c.daily = { date: run.dayKey, best: 0 };
        if (!c.daily.best || run.time < c.daily.best) { c.daily.best = run.time; newRecord = true; }
      }
      medal = medalFor(run.time, run.idealTime);
      if (!run.daily) {
        const rec = c.stages[run.stage] || (c.stages[run.stage] = { best: 0, stars: 0, sectors: null, rides: 0 });
        rec.rides++;
        if (rec.best) delta = run.time - rec.best;
        if (!rec.best || run.time < rec.best) { rec.best = run.time; rec.sectors = run.sectors; newRecord = true; }
        if (medal && medal.stars > rec.stars) {
          medalBonus = (medal.stars - rec.stars) * 250;
          rec.stars = medal.stars;
          firstMedal = true;
        }
      }
    }
    const base = Math.round((run.meters / 1000) * 45 + (run.finished ? 80 : 0) + run.nearMisses * 15 + (run.finished && !run.crashes ? 60 : 0));
    const earned = Math.round((base + medalBonus) * assist * trafficMul);
    const xp = Math.round((run.meters / 1000) * 30 + (run.finished ? 60 : 0) + (medal ? medal.stars * 40 : 0)) * assist;
    c.credits += earned; t.credits += earned; c.xp += Math.round(xp);
    c.history.unshift({ stage: run.stageName, time: run.finished ? +run.time.toFixed(2) : null, medal: medal ? medal.id : null, crashes: run.crashes, at: run.dayKey });
    c.history.length = Math.min(c.history.length, 12);
    const unlockedA = ACHIEVEMENTS.filter((a) => !c.unlocked[a.id] && a.test(c));
    unlockedA.forEach((a) => (c.unlocked[a.id] = run.dayKey));
    const starsNow = stars(c);
    c.updated = Date.now();
    return {
      medal, firstMedal, newRecord, delta, earned, xp: Math.round(xp), achievements: unlockedA,
      levelUp: levelOf(c.xp).level > levelBefore ? levelOf(c.xp).level : null,
      newStages: STAGES.filter((s) => s.need > starsBefore && s.need <= starsNow).map((s) => s.name),
      newLiveries: LIVERIES.filter((l) => l.level > levelBefore && l.level <= levelOf(c.xp).level).map((l) => l.name),
    };
  }

  const Store = {
    ref: null, where: 'device',
    loadLocal() { try { return normalize(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return fresh(); } },
    save(c) {
      try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* private window: keep riding */ }
      if (this.ref) this.ref.set({ json: JSON.stringify(c) }).catch(() => {});
    },
    async connect(c) {
      if (!root.claude || !root.claude.use) return c;
      try {
        const [db, user] = await Promise.all([root.claude.use('db'), root.claude.use('user')]);
        if (!db || !user) return c;
        const id = await user.id();
        if (!id) return c;
        this.ref = db.collection('data/users/' + id).doc('career');
        const snap = await this.ref.get();
        this.where = 'account';
        if (snap.exists) {
          const remote = normalize(JSON.parse(snap.data().json));
          if (remote.updated > c.updated) {
            try { localStorage.setItem(KEY, JSON.stringify(remote)); } catch (e) { /* ignore */ }
            return remote;
          }
        }
        if (c.totals.runs > 0) this.save(c);
        return c;
      } catch (e) { return c; }
    },
  };

  CL.Career = { STAGES, UPGRADES, LIVERIES, ACHIEVEMENTS, fresh, normalize, stars, isUnlocked, levelOf, tuneOf, medalTimes, medalFor, buyUpgrade, recordRun, dayKey, dailyStage, Store };
  if (typeof module !== 'undefined') module.exports = CL.Career;
})(typeof window !== 'undefined' ? window : globalThis);
