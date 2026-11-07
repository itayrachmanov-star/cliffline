// Menus and result screens, drawn from career state. Rides are started through the handlers app.js passes in.
(function () {
  const CL = window.CL, C = CL.Career, $ = (id) => document.getElementById(id);
  const MEDAL_NAMES = ['', 'Bronze', 'Silver', 'Gold'];
  const fmtTime = (t) => { if (!t && t !== 0) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const cash = (n) => '€' + Math.round(n).toLocaleString('en-US');
  const stars = (n) => '<span class="stars" role="img" aria-label="' + (MEDAL_NAMES[n] || 'No') + ' medal">' + [1, 2, 3].map((i) => '<i class="' + (i <= n ? 'on' : '') + '"></i>').join('') + '</span>';

  let career, actions, tab = 'stages', selected = 'harbor', idealCache = {};

  function ideal(stage) {
    if (!idealCache[stage.id]) idealCache[stage.id] = CL.Track.buildTrack(stage).idealTime;
    return idealCache[stage.id];
  }
  function today() { return C.dailyStage(C.dayKey()); }
  function stageById(id) { return id === 'daily' ? today() : C.STAGES.find((s) => s.id === id); }

  function top() {
    const lv = C.levelOf(career.xp);
    $('level').textContent = 'Level ' + lv.level;
    $('levelBar').style.transform = 'scaleX(' + lv.into / lv.span + ')';
    $('credits').textContent = cash(career.credits);
    $('starCount').textContent = C.stars(career) + ' / 24';
    document.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('sel', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    ['stages', 'garage', 'log'].forEach((t) => ($('tab-' + t).hidden = t !== tab));
    $('saveNote').textContent = C.Store.where === 'account' ? 'Progress saved to your account' : 'Progress saved on this device';
  }

  function stagesTab() {
    const dailyDone = career.daily.date === C.dayKey() && career.daily.best;
    const row = (s, i) => {
      const open = C.isUnlocked(career, s), rec = career.stages[s.id] || {};
      return '<button type="button" data-stage="' + s.id + '" class="row' + (selected === s.id ? ' sel' : '') + '"' + (open ? '' : ' disabled') + '><b>' + (i + 1) + '</b><span class="nm">' + s.name + '</span>' +
        (open ? stars(rec.stars || 0) + '<span class="t">' + (rec.best ? fmtTime(rec.best) : (s.length / 1000).toFixed(1) + ' km') + '</span>' : '<span class="t lock">' + s.need + ' medal stars</span>') + '</button>';
    };
    $('list').innerHTML = '<button type="button" data-stage="daily" class="row daily' + (selected === 'daily' ? ' sel' : '') + '"><b>D</b><span class="nm">Daily Road</span><span class="t">' + (dailyDone ? fmtTime(career.daily.best) : 'New today') + '</span></button>' + C.STAGES.map(row).join('');
    const s = stageById(selected), id = ideal(s), rec = career.stages[s.id] || {}, set = career.settings;
    const targets = C.medalTimes(id).map((m) => '<div class="medal ' + m.id + '"><dt>' + m.id + '</dt><dd>' + fmtTime(m.time) + '</dd></div>').join('');
    $('detail').innerHTML = '<h2>' + s.name + '</h2><p class="meta">' + (s.length / 1000).toFixed(1) + ' km · ' + s.sectors + ' sectors' + (rec.best ? ' · Best ' + fmtTime(rec.best) : '') + '</p><dl class="medals">' + targets + '</dl>' +
      opt('Rider aids', 'assist', [['full', 'Full'], ['light', 'Light'], ['off', 'Off']], set.assist) +
      opt('Traffic', 'traffic', [['off', 'None'], ['low', 'Low'], ['medium', 'Medium']], set.traffic) +
      opt('Gears', 'autoShift', [['true', 'Auto'], ['false', 'Manual']], String(set.autoShift)) +
      '<p class="aidNote">' + { full: 'The bike follows the road, and ABS stops you sliding. You control speed and line.', light: 'You steer more. ABS still protects you. Earn 25% more.', off: 'No help at all. Brake hard while leaned and you will crash. Earn 60% more.' }[set.assist] + '</p>';
  }
  function opt(label, key, items, cur) {
    return '<div class="opt"><span>' + label + '</span><div class="seg" role="group" aria-label="' + label + '">' + items.map(([v, t]) => '<button type="button" data-set="' + key + '" data-val="' + v + '" class="' + (v === cur ? 'sel' : '') + '" aria-pressed="' + (v === cur) + '">' + t + '</button>').join('') + '</div></div>';
  }

  function garageTab() {
    $('upgrades').innerHTML = Object.keys(C.UPGRADES).map((k) => {
      const u = C.UPGRADES[k], lv = career.upgrades[k] || 0, max = lv >= u.costs.length, cost = u.costs[lv];
      const pips = u.costs.map((_, i) => '<i class="' + (i < lv ? 'on' : '') + '"></i>').join('');
      return '<div class="upg"><div><b>' + u.name + '</b><span>' + u.desc + '</span><div class="pips">' + pips + '</div></div><button type="button" data-buy="' + k + '" ' + (max || career.credits < cost ? 'disabled' : '') + '>' + (max ? 'Maxed' : cash(cost)) + '</button></div>';
    }).join('');
    const lv = C.levelOf(career.xp).level;
    $('liveries').innerHTML = C.LIVERIES.map((l) => {
      const open = lv >= l.level;
      return '<button type="button" data-livery="' + l.id + '" class="liv' + (career.settings.livery === l.id ? ' sel' : '') + '" ' + (open ? '' : 'disabled') + '><i style="background:' + l.color + '"></i><b>' + l.name + '</b><span>' + (open ? (career.settings.livery === l.id ? 'On your bike' : 'Tap to paint') : 'Level ' + l.level) + '</span></button>';
    }).join('');
    $('soundBtn').textContent = career.settings.sound ? 'Sound on' : 'Sound off';
  }

  function logTab() {
    const t = career.totals, r = career.records, h = Math.round(t.seconds / 60);
    const grid = [['Rides', t.runs], ['Stages finished', t.finishes], ['Clean rides', t.cleanRuns], ['Distance', (t.meters / 1000).toFixed(1) + ' km'], ['Time riding', h + ' min'], ['Top speed', Math.round(r.topKmh) + ' km/h'], ['Deepest lean', Math.round(r.maxLean) + '°'], ['Crashes', t.crashes], ['Near misses', t.nearMisses], ['Gear changes', t.shifts], ['Daily roads', t.dailies], ['Euros earned', cash(t.credits)]];
    $('totals').innerHTML = grid.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('');
    const done = C.ACHIEVEMENTS.filter((a) => career.unlocked[a.id]).length;
    $('achCount').textContent = done + ' of ' + C.ACHIEVEMENTS.length;
    $('achList').innerHTML = C.ACHIEVEMENTS.map((a) => '<li class="' + (career.unlocked[a.id] ? 'on' : '') + '"><b>' + a.name + '</b><span>' + a.desc + '</span></li>').join('');
    $('hist').innerHTML = career.history.length ? career.history.map((e) => '<li><span>' + e.stage + '</span><span>' + (e.time ? fmtTime(e.time) : 'Not finished') + '</span><span>' + (e.medal || (e.crashes ? e.crashes + ' crash' + (e.crashes > 1 ? 'es' : '') : '')) + '</span></li>').join('') : '<li><span>Your last 12 rides will show here.</span></li>';
  }

  function render() { top(); if (tab === 'stages') stagesTab(); else if (tab === 'garage') garageTab(); else logTab(); }

  function result(run, res, medals, sectorBest) {
    $('rTitle').textContent = run.finished ? run.stageName : 'Ride ended';
    $('rTime').textContent = run.finished ? fmtTime(run.time) : (run.meters / 1000).toFixed(2) + ' km';
    const m = res.medal;
    $('rMedal').className = 'rMedal ' + (m ? m.id : 'none');
    $('rMedal').textContent = m ? m.id + ' medal' : run.finished ? 'No medal yet' : 'Unfinished';
    const next = run.finished && !run.daily ? medals.slice().reverse().find((x) => x.time < run.time) : null;
    const notes = [];
    if (next) notes.push(fmtTime(run.time - next.time).replace(/^0:/, '') + ' s faster earns ' + next.id);
    if (res.newRecord && run.finished) notes.push(res.delta !== null ? 'New record by ' + Math.abs(res.delta).toFixed(2) + ' s' : 'First time on the board');
    else if (res.delta !== null) notes.push('+' + res.delta.toFixed(2) + ' s from your record');
    $('rNote').textContent = notes.join(' · ');
    const stats = [['Earned', cash(res.earned)], ['Experience', '+' + res.xp], ['Top speed', Math.round(run.topKmh) + ' km/h'], ['Deepest lean', Math.round(run.maxLean) + '°'], ['Crashes', run.crashes], ['Near misses', run.nearMisses]];
    $('rStats').innerHTML = stats.map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('');
    $('rSectors').innerHTML = (run.sectors || []).map((t, i) => {
      const b = sectorBest && sectorBest[i], d = b ? t - b : null;
      return '<li><span>S' + (i + 1) + '</span><b>' + fmtTime(t) + '</b>' + (d !== null ? '<em class="' + (d <= 0 ? 'up' : 'down') + '">' + (d <= 0 ? '' : '+') + d.toFixed(2) + '</em>' : '') + '</li>';
    }).join('');
    const news = [];
    if (res.levelUp) news.push('Reached level ' + res.levelUp);
    res.newStages.forEach((n) => news.push('New stage: ' + n));
    res.newLiveries.forEach((n) => news.push('New paint: ' + n));
    res.achievements.forEach((a) => news.push('Achievement: ' + a.name));
    $('rNews').innerHTML = news.map((n) => '<li>' + n + '</li>').join('');
    $('rNews').hidden = !news.length;
  }

  function wire() {
    document.addEventListener('click', (e) => {
      const q = (sel) => e.target.closest(sel);
      let el;
      if ((el = q('[data-tab]'))) { tab = el.dataset.tab; render(); }
      else if ((el = q('[data-stage]')) && !el.disabled) { selected = el.dataset.stage; render(); }
      else if ((el = q('[data-set]'))) {
        const v = el.dataset.val;
        career.settings[el.dataset.set] = v === 'true' ? true : v === 'false' ? false : v;
        C.Store.save(career); render();
      } else if ((el = q('[data-buy]')) && !el.disabled) { if (C.buyUpgrade(career, el.dataset.buy)) { C.Store.save(career); CL.Audio.sfx.sector(); render(); } }
      else if ((el = q('[data-livery]')) && !el.disabled) { career.settings.livery = el.dataset.livery; C.Store.save(career); actions.livery(); render(); }
    });
    $('rideBtn').onclick = () => actions.ride(stageById(selected));
    $('soundBtn').onclick = () => { career.settings.sound = !career.settings.sound; CL.Audio.init(); CL.Audio.setEnabled(career.settings.sound); C.Store.save(career); render(); };
    $('rAgain').onclick = () => actions.ride(actions.currentStage());
    $('rMenu').onclick = () => actions.menu();
    $('rNext').onclick = () => {
      const cur = actions.currentStage(), i = C.STAGES.findIndex((s) => s.id === cur.id), next = C.STAGES[i + 1];
      if (next && C.isUnlocked(career, next)) { selected = next.id; actions.ride(next); } else actions.menu();
    };
  }

  CL.UI = {
    fmtTime, render, result, wire,
    setCareer(c) { career = c; },
    init(c, a) { career = c; actions = a; wire(); render(); },
    nextAvailable(stage) { const i = C.STAGES.findIndex((s) => s.id === stage.id), n = C.STAGES[i + 1]; return !!(n && C.isUnlocked(career, n)); },
  };
})();
