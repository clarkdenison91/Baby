'use strict';

/* ---------- storage ---------- */

const KEY = 'babylog.v1';
const MIN = 60e3;
const DAY = 864e5;

const defaults = () => ({
  version: 1,
  profile: { name: '', birth: '' },
  settings: { unit: 'oz', theme: 'auto' },
  entries: [],
  active: {},
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.entries)) return normalize(s);
    }
  } catch (e) { /* fall through to a fresh log */ }
  return defaults();
}

function normalize(s) {
  const d = defaults();
  return {
    ...d,
    ...s,
    profile: { ...d.profile, ...s.profile },
    settings: { ...d.settings, ...s.settings },
    active: s.active || {},
  };
}

let state = load();
const ui = { tab: 'today', dayOffset: 0, renderedDay: startOfDay(Date.now()) };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Uh oh, could not save!'); }
}

function commit(msg) {
  save();
  render();
  if (msg) toast(msg);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- time + format helpers ---------- */

const pad = (n) => String(n).padStart(2, '0');

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDur(ms) {
  const m = Math.floor(Math.max(0, ms) / MIN);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function fmtTimer(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
function fmtAgo(ts) {
  const d = Date.now() - ts;
  return d < MIN ? 'just now' : `${fmtDur(d)} ago`;
}
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayStart(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}
function nextDay(ts) {
  const d = new Date(ts);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
function dayLabel(offset) {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  return new Date(dayStart(offset)).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
function toInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromInput(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ageText() {
  const b = state.profile.birth;
  if (!b) return '';
  const [y, m, d] = b.split('-').map(Number);
  const days = Math.round((startOfDay(Date.now()) - new Date(y, m - 1, d).getTime()) / DAY);
  if (days < 0) return 'arriving soon';
  if (days === 0) return 'born today!';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const w = Math.floor(days / 7);
  const r = days % 7;
  if (!w) return `${plural(days, 'day')} old`;
  return `${plural(w, 'week')}${r ? `, ${plural(r, 'day')}` : ''} old`;
}

/* ---------- data helpers ---------- */

const OZ_ML = 29.5735;
function convert(amount, from, to) {
  if (!amount) return 0;
  if (from === to) return amount;
  return from === 'oz' ? amount * OZ_ML : amount / OZ_ML;
}
function fmtAmt(v, unit) {
  return unit === 'oz' ? `${Math.round(v * 10) / 10} oz` : `${Math.round(v)} ml`;
}
const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const breastMs = (e) => (e.L || 0) + (e.R || 0);

function lastOf(pred) {
  let best = null;
  for (const e of state.entries) if (pred(e) && (!best || e.start > best.start)) best = e;
  return best;
}

function entriesForDay(ds, de) {
  return state.entries
    .filter((e) => (e.type === 'sleep' ? e.start < de && e.end > ds : e.start >= ds && e.start < de))
    .sort((a, b) => b.start - a.start);
}

function dayStats(ds, de) {
  const unit = state.settings.unit;
  const st = { sleep: 0, naps: 0, feeds: 0, breast: 0, bottle: 0, wet: 0, dirty: 0, diapers: 0 };
  for (const e of state.entries) {
    if (e.type === 'sleep') {
      const o = overlap(e.start, e.end, ds, de);
      if (o > 0) { st.sleep += o; st.naps++; }
    } else if (e.start >= ds && e.start < de) {
      if (e.type === 'feed') {
        st.feeds++;
        if (e.kind === 'breast') st.breast += breastMs(e);
        else st.bottle += convert(e.amount, e.unit, unit);
      } else if (e.type === 'diaper') {
        st.diapers++;
        if (e.kind !== 'dirty') st.wet++;
        if (e.kind !== 'wet') st.dirty++;
      }
    }
  }
  const s = state.active.sleep;
  if (s) {
    const o = overlap(s.start, Date.now(), ds, de);
    if (o > 0) { st.sleep += o; st.naps++; }
  }
  const b = state.active.breast;
  if (b && b.start >= ds && b.start < de) st.feeds++;
  return st;
}

function breastElapsed(side) {
  const b = state.active.breast;
  if (!b) return 0;
  return (b.acc[side] || 0) + (b.side === side ? Date.now() - b.sideStart : 0);
}

function describe(e) {
  if (e.type === 'sleep') return { icon: '😴', title: 'Sleep', sub: fmtDur(e.end - e.start) };
  if (e.type === 'diaper') {
    const t = { wet: ['💧', 'Wet diaper'], dirty: ['💩', 'Dirty diaper'], both: ['💧💩', 'Wet + dirty'] }[e.kind] || ['🧷', 'Diaper'];
    return { icon: t[0], title: t[1], sub: '' };
  }
  if (e.kind === 'breast') {
    const parts = [];
    if (e.L) parts.push(`L ${fmtDur(e.L)}`);
    if (e.R) parts.push(`R ${fmtDur(e.R)}`);
    return { icon: '🤱', title: 'Breastfeed', sub: parts.join(' · ') || '0m' };
  }
  const milk = e.milk === 'breastmilk' ? 'breast milk' : 'formula';
  return { icon: '🍼', title: 'Bottle', sub: `${fmtAmt(e.amount || 0, e.unit)} ${milk}` };
}

/* ---------- rendering ---------- */

const app = document.getElementById('app');

function render() {
  applyTheme();
  ui.renderedDay = startOfDay(Date.now());
  renderBabyline();

  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));

  if (ui.tab === 'today') app.innerHTML = renderToday();
  else if (ui.tab === 'week') app.innerHTML = renderWeek();
  else app.innerHTML = renderSettings();
  tick();
}

function renderBabyline() {
  const name = state.profile.name.trim();
  const age = ageText();
  document.getElementById('babyline').innerHTML = name || age
    ? `<b>${esc(name || 'Baby')}</b>${age ? ` <span>· ${esc(age)}</span>` : ''}`
    : `<button class="linkish" data-action="tab" data-tab="settings">Add your baby's name →</button>`;
}

function renderToday() {
  const sleeping = state.active.sleep;
  const ds = dayStart(ui.dayOffset);
  const de = nextDay(ds);
  const st = dayStats(ds, de);
  const list = entriesForDay(ds, de);
  const unit = state.settings.unit;

  return `
    <section class="actions">
      <button class="big b-sleep ${sleeping ? 'live' : ''}" data-action="sleep-toggle">
        <span class="em" aria-hidden="true">${sleeping ? '🌙' : '😴'}</span>
        <span class="lbl">${sleeping ? 'Wake up' : 'Sleep'}</span>
        <small>${sleeping ? '<span data-timer="sleep"></span>' : 'start timer'}</small>
      </button>
      <button class="big b-feed ${state.active.breast ? 'live' : ''}" data-action="feed-sheet">
        <span class="em" aria-hidden="true">🍼</span>
        <span class="lbl">Feed</span>
        <small>${state.active.breast ? '<span data-timer="breast-total"></span>' : 'breast / bottle'}</small>
      </button>
      <button class="big b-diaper" data-action="diaper-sheet">
        <span class="em" aria-hidden="true">🧷</span>
        <span class="lbl">Diaper</span>
        <small>wet / dirty</small>
      </button>
    </section>

    ${renderBreastLive()}
    ${renderStatus()}

    <section class="card daynav">
      <button class="round" data-action="day" data-delta="-1" aria-label="Previous day">◀</button>
      <h2>${esc(dayLabel(ui.dayOffset))}</h2>
      <button class="round" data-action="day" data-delta="1" aria-label="Next day" ${ui.dayOffset >= 0 ? 'disabled' : ''}>▶</button>
    </section>

    <section class="stickers">
      <div class="sticker s-sleep"><span class="tag">Zzz</span><b>${fmtDur(st.sleep)}</b><small>${st.naps} sleep${st.naps === 1 ? '' : 's'}</small></div>
      <div class="sticker s-feed"><span class="tag">Feeds</span><b>${st.feeds}</b><small>${[st.breast ? `${fmtDur(st.breast)} breast` : '', st.bottle ? `${fmtAmt(st.bottle, unit)} bottle` : ''].filter(Boolean).join(' · ') || 'none yet'}</small></div>
      <div class="sticker s-wet"><span class="tag">Wet</span><b>${st.wet}</b><small>diapers</small></div>
      <div class="sticker s-dirty"><span class="tag">Dirty</span><b>${st.dirty}</b><small>diapers</small></div>
    </section>

    <section class="card timeline">
      <div class="timeline-head">
        <h3>The Log</h3>
        <button class="btn small" data-action="add-sheet">+ Add past entry</button>
      </div>
      ${list.length ? `<ul>${list.map(renderItem).join('')}</ul>`
        : `<p class="empty">Nothing logged ${ui.dayOffset === 0 ? 'yet today' : 'this day'}.<br>Tap a big button up top to start.</p>`}
    </section>`;
}

function renderItem(e) {
  const d = describe(e);
  const when = e.type === 'sleep' || (e.type === 'feed' && e.kind === 'breast' && e.end)
    ? `${fmtClock(e.start)} – ${fmtClock(e.end)}`
    : fmtClock(e.start);
  const kind = e.type === 'feed' ? 'feed' : e.type;
  return `<li><button class="item t-${kind}" data-action="edit" data-id="${esc(e.id)}">
    <span class="ico" aria-hidden="true">${d.icon}</span>
    <span class="what"><b>${d.title}</b><small>${esc([d.sub, e.note].filter(Boolean).join(' · '))}</small></span>
    <span class="when">${when}</span>
  </button></li>`;
}

function renderBreastLive() {
  const b = state.active.breast;
  if (!b) return '';
  const side = (s, label) => `
    <button class="side ${b.side === s ? 'on' : ''}" data-action="breast-side" data-side="${s}">
      <b>${label}</b><span class="clock" data-timer="${s}"></span>
      <small>${b.side === s ? 'tap to pause' : 'tap to start'}</small>
    </button>`;
  return `
    <section class="card live-card">
      <div class="live-head"><h3>🤱 Feeding</h3><span class="clock big-clock" data-timer="breast-total"></span></div>
      <div class="sides">${side('L', 'Left')}${side('R', 'Right')}</div>
      <div class="row">
        <button class="btn" data-action="breast-cancel">Discard</button>
        <button class="btn primary" data-action="breast-done">Done!</button>
      </div>
    </section>`;
}

function renderStatus() {
  const chips = [];
  if (state.active.sleep) chips.push(`<span class="chip c-sleep">😴 Asleep <b data-since="${state.active.sleep.start}"></b></span>`);
  else {
    const s = lastOf((e) => e.type === 'sleep');
    if (s) chips.push(`<span class="chip c-sleep">👀 Awake <b data-since="${s.end}"></b></span>`);
  }
  if (state.active.breast) chips.push(`<span class="chip c-feed">🤱 Feeding now</span>`);
  else {
    const f = lastOf((e) => e.type === 'feed');
    if (f) chips.push(`<span class="chip c-feed">🍼 Last fed <b data-ago="${f.start}"></b></span>`);
  }
  const d = lastOf((e) => e.type === 'diaper');
  if (d) chips.push(`<span class="chip c-diaper">🧷 Diaper <b data-ago="${d.start}"></b></span>`);
  return chips.length ? `<section class="chips">${chips.join('')}</section>` : '';
}

function renderWeek() {
  const unit = state.settings.unit;
  const days = [];
  for (let i = 0; i > -7; i--) {
    const ds = dayStart(i);
    const de = nextDay(ds);
    days.push({ i, ds, de, st: dayStats(ds, de) });
  }
  const now = Date.now();
  const pct = (t, d) => (((t - d.ds) / (d.de - d.ds)) * 100).toFixed(2);

  const ribbons = days.map((d) => {
    const segs = [];
    const sleeps = state.entries.filter((e) => e.type === 'sleep').map((e) => [e.start, e.end]);
    if (state.active.sleep) sleeps.push([state.active.sleep.start, now]);
    for (const [a, b] of sleeps) {
      const s = Math.max(a, d.ds);
      const e = Math.min(b, d.de);
      if (e > s) segs.push(`<i class="seg" style="left:${pct(s, d)}%;width:${(((e - s) / (d.de - d.ds)) * 100).toFixed(2)}%"></i>`);
    }
    for (const e of state.entries) {
      if (e.start < d.ds || e.start >= d.de) continue;
      if (e.type === 'feed') segs.push(`<i class="tick" style="left:${pct(e.start, d)}%"></i>`);
      if (e.type === 'diaper') segs.push(`<i class="dot" style="left:${pct(e.start, d)}%"></i>`);
    }
    if (d.i === 0) segs.push(`<i class="now" style="left:${pct(now, d)}%"></i>`);
    const label = d.i === 0 ? 'Today' : new Date(d.ds).toLocaleDateString([], { weekday: 'short' });
    return `<div class="rrow"><span class="rlabel">${label}</span><div class="ribbon">${segs.join('')}</div></div>`;
  }).join('');

  const logged = days.filter((d) => d.st.sleep || d.st.feeds || d.st.diapers);
  const avg = (k) => (logged.length ? logged.reduce((n, d) => n + d.st[k], 0) / logged.length : 0);

  const rows = days.map((d) => `
    <tr>
      <th>${d.i === 0 ? 'Today' : new Date(d.ds).toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })}</th>
      <td>${fmtDur(d.st.sleep)}</td>
      <td>${d.st.feeds}${d.st.bottle ? `<small>${fmtAmt(d.st.bottle, unit)}</small>` : ''}</td>
      <td>${d.st.wet}<span class="slash">/</span>${d.st.dirty}</td>
    </tr>`).join('');

  return `
    <section class="card">
      <h2 class="title">7-day rundown</h2>
      <div class="legend">
        <span><i class="seg"></i>Sleep</span><span><i class="tick"></i>Feed</span><span><i class="dot"></i>Diaper</span>
      </div>
      <div class="axis"><span></span><div><b>12a</b><b>6a</b><b>12p</b><b>6p</b><b>12a</b></div></div>
      ${ribbons}
    </section>

    <section class="card">
      <h2 class="title">By the numbers</h2>
      <table class="nums">
        <thead><tr><th></th><th>Sleep</th><th>Feeds</th><th>Wet/Dirty</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <th>Daily avg</th>
          <td>${fmtDur(avg('sleep'))}</td>
          <td>${avg('feeds').toFixed(1)}</td>
          <td>${avg('wet').toFixed(1)}<span class="slash">/</span>${avg('dirty').toFixed(1)}</td>
        </tr></tfoot>
      </table>
      <p class="hint">Averages count only days with something logged.</p>
    </section>`;
}

function renderSettings() {
  const p = state.profile;
  const s = state.settings;
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  return `
    <section class="card">
      <h2 class="title">The little dude</h2>
      <form data-form="settings" class="form">
        <label>Name<input name="name" value="${esc(p.name)}" placeholder="e.g. Max" autocomplete="off"></label>
        <label>Birthday<input name="birth" type="date" value="${esc(p.birth)}"></label>
        <label>Bottle units<select name="unit">${opt('oz', s.unit, 'Ounces (oz)')}${opt('ml', s.unit, 'Milliliters (ml)')}</select></label>
        <label>Look<select name="theme">${opt('auto', s.theme, 'Match my phone')}${opt('light', s.theme, 'Saturday morning (light)')}${opt('dark', s.theme, 'Late-night (dark)')}</select></label>
      </form>
    </section>

    <section class="card">
      <h2 class="title">Your data</h2>
      <p class="hint">Everything stays on this device, in this browser. Export a backup now and then, or to move to a new phone.</p>
      <div class="stack">
        <button class="btn" data-action="export">⬇️ Export backup</button>
        <button class="btn" data-action="import">⬆️ Import backup</button>
        <button class="btn danger" data-action="wipe">🗑️ Erase everything</button>
      </div>
      <p class="hint">${state.entries.length} entries logged.</p>
    </section>`;
}

/* ---------- live tick ---------- */

function tick() {
  const now = Date.now();
  if (startOfDay(now) !== ui.renderedDay) { render(); return; }
  document.querySelectorAll('[data-timer]').forEach((el) => {
    const k = el.dataset.timer;
    let ms = 0;
    if (k === 'sleep' && state.active.sleep) ms = now - state.active.sleep.start;
    else if (k === 'L' || k === 'R') ms = breastElapsed(k);
    else if (k === 'breast-total') ms = breastElapsed('L') + breastElapsed('R');
    el.textContent = fmtTimer(ms);
  });
  document.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = fmtAgo(Number(el.dataset.ago)); });
  document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = fmtDur(now - Number(el.dataset.since)); });
}
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { state = load(); render(); } });

/* ---------- theme ---------- */

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#1d1040' : '#19c3b5';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ---------- toast ---------- */

const CHEERS = ['Radical!', 'Cowabunga!', 'Booyah!', 'Totally tubular!', 'Way cool!', 'Da bomb!', 'Righteous!', 'Awesome possum!'];
const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- sheets (dialogs) ---------- */

const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');

function openSheet(html) {
  sheetBody.innerHTML = `<button class="close" data-action="close" aria-label="Close">✕</button>${html}`;
  if (!sheet.open) sheet.showModal();
  tick();
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

function feedSheet() {
  const last = lastOf((e) => e.type === 'feed' && e.kind === 'breast');
  const lastSide = last && last.last;
  const hint = lastSide
    ? `Last side was <b>${lastSide === 'L' ? 'Left' : 'Right'}</b>, so try <b>${lastSide === 'L' ? 'Right' : 'Left'}</b>.`
    : 'Tap a side to start the timer.';
  const unit = state.settings.unit;
  const lastBottle = lastOf((e) => e.type === 'feed' && e.kind === 'bottle');
  const amt = lastBottle ? Math.round(convert(lastBottle.amount, lastBottle.unit, unit) * 10) / 10 : (unit === 'oz' ? 2 : 60);
  openSheet(`
    <h2 class="title">Chow time!</h2>
    <h3>🤱 Breast</h3>
    ${state.active.breast ? '<p class="hint">A feed timer is already running on the main screen.</p>' : `
      <p class="hint">${hint}</p>
      <div class="sides">
        <button class="side ${lastSide === 'R' ? 'suggest' : ''}" data-action="breast-start" data-side="L"><b>Left</b><small>start</small></button>
        <button class="side ${lastSide === 'L' ? 'suggest' : ''}" data-action="breast-start" data-side="R"><b>Right</b><small>start</small></button>
      </div>`}
    <h3>🍼 Bottle</h3>
    <form data-form="bottle" class="form">
      <div class="two">
        <label>Amount (${unit})<input name="amount" type="number" inputmode="decimal" min="0" step="${unit === 'oz' ? '0.5' : '5'}" value="${amt}" required></label>
        <label>What<select name="milk"><option value="formula" ${lastBottle?.milk !== 'breastmilk' ? 'selected' : ''}>Formula</option><option value="breastmilk" ${lastBottle?.milk === 'breastmilk' ? 'selected' : ''}>Breast milk</option></select></label>
      </div>
      <label>Time<input name="start" type="datetime-local" value="${toInput(Date.now())}" required></label>
      <button class="btn primary wide" type="submit">Log bottle</button>
    </form>`);
}

function diaperSheet() {
  openSheet(`
    <h2 class="title">Diaper duty</h2>
    <form data-form="diaper" class="form">
      <label>Time<input name="start" type="datetime-local" value="${toInput(Date.now())}" required></label>
      <label>Note<input name="note" placeholder="optional, e.g. color" autocomplete="off"></label>
      <div class="diapers">
        <button class="pick p-wet" type="submit" value="wet"><span>💧</span>Wet</button>
        <button class="pick p-dirty" type="submit" value="dirty"><span>💩</span>Dirty</button>
        <button class="pick p-both" type="submit" value="both"><span>💧💩</span>Both</button>
      </div>
    </form>`);
}

function addSheet() {
  openSheet(`
    <h2 class="title">Add a past entry</h2>
    <div class="stack">
      <button class="btn" data-action="new" data-kind="sleep">😴 Sleep</button>
      <button class="btn" data-action="new" data-kind="breast">🤱 Breastfeed</button>
      <button class="btn" data-action="new" data-kind="bottle">🍼 Bottle</button>
      <button class="btn" data-action="new" data-kind="diaper">🧷 Diaper</button>
    </div>`);
}

function blankEntry(kind) {
  const now = Date.now();
  if (kind === 'sleep') return { type: 'sleep', start: now - 60 * MIN, end: now };
  if (kind === 'breast') return { type: 'feed', kind: 'breast', start: now - 20 * MIN, L: 10 * MIN, R: 10 * MIN };
  if (kind === 'bottle') return { type: 'feed', kind: 'bottle', start: now, amount: state.settings.unit === 'oz' ? 2 : 60, unit: state.settings.unit, milk: 'formula' };
  return { type: 'diaper', kind: 'wet', start: now };
}

function editSheet(e) {
  const isNew = !e.id;
  const d = describe(e);
  const note = `<label>Note<input name="note" value="${esc(e.note)}" placeholder="optional" autocomplete="off"></label>`;
  let fields = '';
  if (e.type === 'sleep') {
    fields = `
      <label>Fell asleep<input name="start" type="datetime-local" value="${toInput(e.start)}" required></label>
      <label>Woke up<input name="end" type="datetime-local" value="${toInput(e.end)}" required></label>`;
  } else if (e.type === 'feed' && e.kind === 'breast') {
    fields = `
      <label>Started<input name="start" type="datetime-local" value="${toInput(e.start)}" required></label>
      <div class="two">
        <label>Left (min)<input name="L" type="number" inputmode="numeric" min="0" step="1" value="${Math.round((e.L || 0) / MIN)}"></label>
        <label>Right (min)<input name="R" type="number" inputmode="numeric" min="0" step="1" value="${Math.round((e.R || 0) / MIN)}"></label>
      </div>
      <label>Finished on<select name="last"><option value="L" ${e.last === 'L' ? 'selected' : ''}>Left</option><option value="R" ${e.last !== 'L' ? 'selected' : ''}>Right</option></select></label>`;
  } else if (e.type === 'feed') {
    const unit = e.unit || state.settings.unit;
    fields = `
      <label>Time<input name="start" type="datetime-local" value="${toInput(e.start)}" required></label>
      <div class="two">
        <label>Amount (${unit})<input name="amount" type="number" inputmode="decimal" min="0" step="any" value="${e.amount ?? ''}" required></label>
        <label>What<select name="milk"><option value="formula" ${e.milk !== 'breastmilk' ? 'selected' : ''}>Formula</option><option value="breastmilk" ${e.milk === 'breastmilk' ? 'selected' : ''}>Breast milk</option></select></label>
      </div>`;
  } else {
    const r = (v, label) => `<label class="radio"><input type="radio" name="kind" value="${v}" ${e.kind === v ? 'checked' : ''}><span>${label}</span></label>`;
    fields = `
      <label>Time<input name="start" type="datetime-local" value="${toInput(e.start)}" required></label>
      <div class="radios">${r('wet', '💧 Wet')}${r('dirty', '💩 Dirty')}${r('both', 'Both')}</div>`;
  }
  ui.editing = e;
  openSheet(`
    <h2 class="title">${isNew ? 'New' : 'Edit'} ${d.title.toLowerCase()}</h2>
    <form data-form="entry" class="form">
      ${fields}
      ${note}
      <div class="row">
        ${isNew ? '<button class="btn" type="button" data-action="close">Cancel</button>' : '<button class="btn danger" type="button" data-action="delete">Delete</button>'}
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>`);
}

/* ---------- actions ---------- */

function stopBreast() {
  const b = state.active.breast;
  if (b.side) { b.acc[b.side] += Date.now() - b.sideStart; b.side = null; }
}

const actions = {
  tab(el) { ui.tab = el.dataset.tab; ui.dayOffset = 0; render(); window.scrollTo(0, 0); },
  day(el) { ui.dayOffset = Math.min(0, ui.dayOffset + Number(el.dataset.delta)); render(); },
  close: closeSheet,

  'sleep-toggle'() {
    const now = Date.now();
    if (state.active.sleep) {
      const { start } = state.active.sleep;
      delete state.active.sleep;
      state.entries.push({ id: uid(), type: 'sleep', start, end: now });
      commit(`Slept ${fmtDur(now - start)}. ${cheer()}`);
    } else {
      state.active.sleep = { start: now };
      commit('Sweet dreams, little dude.');
    }
  },

  'feed-sheet': feedSheet,
  'diaper-sheet': diaperSheet,
  'add-sheet': addSheet,

  'breast-start'(el) {
    const side = el.dataset.side;
    const now = Date.now();
    state.active.breast = { start: now, side, sideStart: now, last: side, acc: { L: 0, R: 0 } };
    closeSheet();
    commit(`${side === 'L' ? 'Left' : 'Right'} side, go!`);
  },
  'breast-side'(el) {
    const b = state.active.breast;
    if (!b) return;
    const side = el.dataset.side;
    const wasOn = b.side === side;
    stopBreast();
    if (!wasOn) { b.side = side; b.sideStart = Date.now(); b.last = side; }
    commit();
  },
  'breast-done'() {
    const b = state.active.breast;
    if (!b) return;
    stopBreast();
    delete state.active.breast;
    state.entries.push({ id: uid(), type: 'feed', kind: 'breast', start: b.start, end: Date.now(), L: b.acc.L, R: b.acc.R, last: b.last });
    commit(`Fed ${fmtDur(b.acc.L + b.acc.R)}. ${cheer()}`);
  },
  'breast-cancel'() {
    if (!confirm('Discard this feed without saving it?')) return;
    delete state.active.breast;
    commit('Feed discarded.');
  },

  new(el) { editSheet(blankEntry(el.dataset.kind)); },
  edit(el) {
    const e = state.entries.find((x) => x.id === el.dataset.id);
    if (e) editSheet({ ...e });
  },
  delete() {
    const e = ui.editing;
    if (!e || !e.id || !confirm('Delete this entry?')) return;
    state.entries = state.entries.filter((x) => x.id !== e.id);
    closeSheet();
    commit('Deleted.');
  },

  export() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `baby-log-${toInput(Date.now()).slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded.');
  },
  import() { document.getElementById('import-file').click(); },
  wipe() {
    if (!confirm('Erase every entry and setting on this device? This cannot be undone.')) return;
    if (!confirm('Really erase everything? Export a backup first if you might want it.')) return;
    state = defaults();
    commit('All cleared.');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) { ev.preventDefault(); fn(el, ev); }
});

document.getElementById('import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.entries)) throw new Error('bad file');
    if (!confirm(`Replace what's on this device with ${data.entries.length} entries from the backup?`)) return;
    state = normalize(data);
    commit('Backup restored!');
  } catch (e) {
    toast("That file doesn't look like a Baby Log backup.");
  }
});

/* ---------- forms ---------- */

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-form]');
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(form);
  const kind = form.dataset.form;
  const note = (f.get('note') || '').toString().trim();

  if (kind === 'bottle') {
    const start = fromInput(f.get('start'));
    const amount = parseFloat(f.get('amount'));
    if (start == null || !(amount > 0)) return toast('Need a time and an amount.');
    state.entries.push({ id: uid(), type: 'feed', kind: 'bottle', start, amount, unit: state.settings.unit, milk: f.get('milk') });
    closeSheet();
    return commit(`${fmtAmt(amount, state.settings.unit)} down the hatch! ${cheer()}`);
  }

  if (kind === 'diaper') {
    const start = fromInput(f.get('start'));
    const which = ev.submitter?.value || 'wet';
    if (start == null) return toast('Need a time.');
    state.entries.push({ id: uid(), type: 'diaper', kind: which, start, ...(note && { note }) });
    closeSheet();
    return commit(`Diaper logged. ${cheer()}`);
  }

  if (kind === 'entry') {
    const e = { ...ui.editing };
    e.start = fromInput(f.get('start'));
    if (e.start == null) return toast('Need a start time.');
    if (e.type === 'sleep') {
      e.end = fromInput(f.get('end'));
      if (e.end == null || e.end <= e.start) return toast('Wake-up time has to be after fell-asleep time.');
    } else if (e.type === 'feed' && e.kind === 'breast') {
      e.L = Math.max(0, parseFloat(f.get('L')) || 0) * MIN;
      e.R = Math.max(0, parseFloat(f.get('R')) || 0) * MIN;
      e.last = f.get('last');
      e.end = e.start + e.L + e.R;
    } else if (e.type === 'feed') {
      e.amount = parseFloat(f.get('amount'));
      if (!(e.amount > 0)) return toast('Need an amount.');
      e.unit = e.unit || state.settings.unit;
      e.milk = f.get('milk');
    } else {
      e.kind = f.get('kind') || 'wet';
    }
    if (note) e.note = note; else delete e.note;
    if (e.id) state.entries = state.entries.map((x) => (x.id === e.id ? e : x));
    else { e.id = uid(); state.entries.push(e); }
    closeSheet();
    return commit(`Saved. ${cheer()}`);
  }
});

document.addEventListener('input', (ev) => {
  const form = ev.target.closest('form[data-form="settings"]');
  if (!form) return;
  const f = new FormData(form);
  state.profile.name = (f.get('name') || '').toString();
  state.profile.birth = (f.get('birth') || '').toString();
  state.settings.unit = f.get('unit');
  state.settings.theme = f.get('theme');
  save();
  applyTheme();
  renderBabyline();
});
document.addEventListener('change', (ev) => {
  if (ev.target.closest('form[data-form="settings"]')) ev.target.dispatchEvent(new Event('input', { bubbles: true }));
});

/* ---------- boot ---------- */

render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
