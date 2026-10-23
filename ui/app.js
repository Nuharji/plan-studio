/* Plan Studio — school planner of the Studio family: today, timetable, homework, exams / deadlines and subjects.
   Same chrome and controls as the other apps (menus from MENUS with customizable shortcuts, option bar, tool rail,
   panels, status bar, settings dialog). The plan is one JSON document saved by Rust in the app's data folder
   (plan.json, previous version kept as plan.bak); in a plain browser it lives in localStorage. */
'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const STORE = 'plan-studio.v1';
const invoke = window.__TAURI__ ? window.__TAURI__.core.invoke : null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= Texts ================= */
let I18N = {en: {}, de: {}}, lang = 'en';
function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
const fmtKey = k => lang === 'de' ? k.replace(/Ctrl/g, 'Strg').replace(/Shift/g, 'Umschalt') : k;
async function loadTexts() {
  if (invoke) { I18N = await invoke('texts'); return; }
  const get = l => fetch(`../src-tauri/i18n/${l}.json`).then(r => r.json()).catch(() => ({}));
  I18N = {en: await get('en'), de: await get('de')};
}

/* ================= Dates (local, "YYYY-MM-DD") ================= */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => isoOf(new Date());
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const dayDiff = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
const weekday = iso => (dateOf(iso).getDay() + 6) % 7;             // 0 = Monday
const validIso = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const fmtDate = (iso, o = {weekday: 'short', day: 'numeric', month: 'short'}) => dateOf(iso).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', o);
const dayName = (i, style = 'long') => new Date(2024, 0, 1 + i).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {weekday: style});
/* "today", "tomorrow", "in 3 days", "2 days ago" */
function relDay(iso) {
  const n = dayDiff(today(), iso);
  if (n === 0) return t('d.today');
  if (n === 1) return t('d.tomorrow');
  if (n === -1) return t('d.yesterday');
  return n > 0 ? t('d.inDays', {n}) : t('d.daysAgo', {n: -n});
}
const minutesOf = hm => { const [h, m] = String(hm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

/* ================= Plan model ================= */
const COLORS = ['#e5484d', '#f76b15', '#f5a524', '#30a46c', '#12a594', '#0ea5e9', '#3e63dd', '#8e4ec6', '#d6409f', '#a18072', '#64748b', '#1f2328'];
const DEFAULT_SUBJECTS = {
  de: [['Deutsch', 'D'], ['Mathematik', 'M'], ['Englisch', 'E'], ['Biologie', 'Bio'], ['Chemie', 'Ch'], ['Physik', 'Ph'], ['Geschichte', 'G'],
    ['Erdkunde', 'Ek'], ['Politik', 'Po'], ['Kunst', 'Ku'], ['Musik', 'Mu'], ['Sport', 'Sp'], ['Religion / Ethik', 'Re'], ['Informatik', 'If']],
  en: [['English', 'En'], ['Mathematics', 'Ma'], ['German', 'De'], ['Biology', 'Bio'], ['Chemistry', 'Ch'], ['Physics', 'Ph'], ['History', 'Hi'],
    ['Geography', 'Geo'], ['Civics', 'Ci'], ['Art', 'Art'], ['Music', 'Mu'], ['PE', 'PE'], ['Religion / Ethics', 'Re'], ['Computer Science', 'CS']]
};
const DEFAULT_PERIODS = [['07:45', '08:30'], ['08:35', '09:20'], ['09:40', '10:25'], ['10:30', '11:15'], ['11:35', '12:20'], ['12:25', '13:10'],
  ['13:40', '14:25'], ['14:30', '15:15'], ['15:20', '16:05'], ['16:10', '16:55']].map(([start, end]) => ({start, end}));
const EVENT_TYPES = ['exam', 'test', 'talk', 'deadline', 'class', 'other'];
function newPlan(l = lang) {
  return {version: 1, days: 5, periods: DEFAULT_PERIODS.slice(0, 8),
    subjects: DEFAULT_SUBJECTS[l === 'de' ? 'de' : 'en'].map(([name, short], i) => ({id: uid(), name, short, color: COLORS[i % COLORS.length], teacher: '', room: ''})),
    lessons: [], tasks: [], events: []};
}
const validPlan = p => !!p && Array.isArray(p.subjects) && Array.isArray(p.lessons) && Array.isArray(p.tasks) && Array.isArray(p.events) && Array.isArray(p.periods);
let plan = null;
const subj = id => plan.subjects.find(s => s.id === id);
/* When a lesson takes place. Terms (half-years, quarters, blocks…): a lesson can be limited to some of them, e.g. an
   elective that changes every quarter. Week types (A/B weeks): a lesson can be limited to one of them. Holidays and
   single cancelled days drop it. `date` = the day it is about (none = every lesson). */
const terms = () => plan.terms || [];
const termsOn = date => terms().filter(x => x.from <= date && date <= x.to);
const holidays = () => plan.holidays || [];
const holidayOn = date => holidays().find(x => x.from <= date && date <= x.to);
const mondayOf = iso => addDays(iso, -weekday(iso));
const holidayWeek = monday => Array.from({length: Math.min(plan.days, 5)}, (_, i) => addDays(monday, i)).every(holidayOn);
/* A/B weeks: the names take turns week by week from an anchor week (whose name is names[start]); weeks that are all
   holidays can be left out of the count, so the rhythm continues after the holidays. */
const cycle = () => plan.weekCycle && (plan.weekCycle.names || []).length > 1 && validIso(plan.weekCycle.anchor) ? plan.weekCycle : null;
let wtCache = {};
function weekTypeOf(date) {
  const c = cycle(); if (!c || !validIso(date)) return '';
  const a = mondayOf(c.anchor), m = mondayOf(date);
  if (wtCache[m] != null) return wtCache[m];
  if (Math.abs(dayDiff(a, m)) > 7 * 600) return '';
  let n = 0;
  if (m >= a) { for (let w = a; w < m; w = addDays(w, 7)) if (!(c.skipHolidays && holidayWeek(w))) n++; }
  else { for (let w = m; w < a; w = addDays(w, 7)) if (!(c.skipHolidays && holidayWeek(w))) n--; }
  const L = c.names.length;
  return (wtCache[m] = c.names[(((c.start || 0) + n) % L + L) % L]);
}
const termOk = (l, date) => !date || !(l.terms && l.terms.length) || l.terms.some(id => termsOn(date).some(x => x.id === id));
/* `strict`: also leave out holidays and days the lesson is cancelled (the timetable editor shows those). */
const lessonOn = (l, date, strict = true) => !date || (termOk(l, date) && (!l.weekType || !cycle() || l.weekType === weekTypeOf(date))
  && (!strict || (!holidayOn(date) && !(l.skip || []).includes(date))));
const lessonsAt = (day, period, date, strict = true) => plan.lessons.filter(l => l.day === day && l.period === period && lessonOn(l, date, strict));
const lessonAt = (day, period, date, strict = true) => lessonsAt(day, period, date, strict)[0];
/* Days can be shorter than the others (e.g. only mornings on Saturday). */
const periodsOn = day => Math.min(plan.periods.length, (plan.dayPeriods || [])[day] || plan.periods.length);
const periodName = () => (plan.periodName || '').trim() || t('ui.period');
/* A lesson can have its own times inside its period (e.g. a shorter session). */
const timeOf = (l, p) => ({start: l.start || p.start, end: l.end || p.end});
/* Elective areas: subjects in the same area form a catalog; a timetable slot of that area is chosen from it — once,
   or anew every week when the area says so (then the choice is stored per date in `picks`; "-" = not taking part). */
const groups = () => [...new Set(plan.subjects.map(s => (s.group || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const areaOf = name => (plan.areas || {})[name] || {};
// Elective slots are chosen anew every week unless their area is set to one choice for all weeks (e.g. per quarter).
const weeklyArea = name => !!name && areaOf(name).weekly !== false;
const OFF = '-';
function choiceOn(l, date) {
  const p = date && l.picks && l.picks[date];
  if (p === OFF) return {off: true, subject: null, picked: true};
  if (p && subj(p)) return {subject: subj(p), picked: true};
  // In a weekly area a choice for all weeks counts only when it was set as one ("Same every week"); a fixed choice
  // also only counts in weeks its offer is given (e.g. an offer of the B weeks only).
  const s = subj(l.subject);
  if (s && weeklyArea(l.group) && !l.everyWeek) return {subject: null, picked: false};
  return {subject: s && !(l.group && s.weekType && cycle() && date && s.weekType !== weekTypeOf(date)) ? s : null, picked: false};
}
/* The offers of an area for one slot: matching the week type and offered in that slot (or everywhere). */
const offersFor = (group, day, period, date) => plan.subjects.filter(s => (s.group || '').trim() === group
  && (!s.weekType || !cycle() || s.weekType === weekTypeOf(date)) && (!(s.offered || []).length || s.offered.includes(`${day}|${period}`)));
const categoriesOf = group => [...new Set(plan.subjects.filter(s => (s.group || '').trim() === group).map(s => (s.category || '').trim()).filter(Boolean))];
/* Elective slots of the next days that still need a choice (weekly areas, or no choice at all yet). */
function openChoices(from, days) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i), w = weekday(date);
    if (w >= plan.days) continue;
    plan.periods.slice(0, periodsOn(w)).forEach((p, period) => lessonsAt(w, period, date).filter(l => l.group).forEach(l => {
      const c = choiceOn(l, date);
      if (!c.picked && !c.subject) out.push({date, day: w, period, l, p});
    }));
  }
  return out;
}
/* Area rules ("at least 1 slot a week from <category>", maybe only in some week type) that the week still misses. */
function ruleWarnings(monday) {
  const out = [];
  if (holidayWeek(monday)) return out;
  for (const g of groups()) {
    const r = areaOf(g);
    if (!(+r.min > 0) || !(r.category || '').trim() || (r.ruleWeek && r.ruleWeek !== weekTypeOf(monday))) continue;
    let n = 0;
    for (let i = 0; i < plan.days; i++) {
      const date = addDays(monday, i);
      plan.lessons.filter(l => l.day === i && l.group === g && lessonOn(l, date)).forEach(l => {
        const c = choiceOn(l, date);
        if (c.subject && (c.subject.category || '').trim().toLowerCase() === r.category.trim().toLowerCase()) n++;
      });
    }
    if (n < +r.min) out.push(t('area.ruleMissing', {area: g, n: +r.min - n, cat: r.category.trim()}));
  }
  return out;
}
/* Class sessions at changing times (dated events of type "class") — shown in the timetable and in Today. */
const classesOn = date => plan.events.filter(e => e.type === 'class' && e.date === date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const classEnd = e => { const m = minutesOf(e.time) + (+e.minutes || 90); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; };
const overlaps = (e, p) => !!e.time && minutesOf(e.time) < minutesOf(p.end) && minutesOf(e.time) + (+e.minutes || 90) > minutesOf(p.start);
function isoWeek(iso) {
  const d = dateOf(addDays(iso, 3 - weekday(iso))), jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round((d - jan4) / 86400000 / 7 + (weekday(isoOf(jan4)) - 3) / 7);
}
let weekStart = null;   // the Monday of the week the timetable shows (null = this week)
const shownMonday = () => weekStart || mondayOf(today());
/* The next school day (after `from`) with a lesson in this subject — the natural due date for homework. */
function nextLesson(subjectId, from = today()) {
  if (!subjectId) return addDays(from, 1);
  for (let i = 1; i <= 21; i++) {
    const d = addDays(from, i), w = weekday(d);
    if (w < plan.days && plan.lessons.some(l => l.day === w && l.period < periodsOn(w) && lessonOn(l, d) && (choiceOn(l, d).subject || {}).id === subjectId)) return d;
    if (classesOn(d).some(e => e.subject === subjectId)) return d;
  }
  return addDays(from, 1);
}
/* Which period is running now (index), or -1. */
function currentPeriod() {
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  return plan.periods.findIndex(p => m >= minutesOf(p.start) && m < minutesOf(p.end));
}

/* ================= Settings, history, saving ================= */
const THEMES = ['dark', 'light', 'github', 'github-dark'];
const DEF = {keys: {}, autoHide: false, lang: 'auto', theme: 'dark', dock: true, dockTab: 'details', view: 'today', showDone: false, icsTasks: true, icsWeeks: 0};
let settings = {...DEF}, sel = null, booted = false, saveT = 0, dirty = false;
const hist = {back: [], fwd: []};
const effectiveLang = () => settings.lang === 'auto' ? ((navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en') : settings.lang;
function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify({settings, plan: invoke ? undefined : plan})); } catch (e) {} }
/* Every change goes through here: undo step, then the plan is saved shortly after. */
function change(fn) {
  hist.back.push(JSON.stringify(plan)); if (hist.back.length > 100) hist.back.shift();
  hist.fwd = [];
  fn();
  persist(); renderAll();
}
function persist() {
  dirty = true; updateStatus();
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try { if (invoke) await invoke('plan_save', {content: JSON.stringify(plan)}); else saveSettings(); dirty = false; }
    catch (e) { toast(t('toast.saveFail', {e})); }
    updateStatus();
  }, 400);
}
function undo() { if (!hist.back.length) return; wtCache = {}; hist.fwd.push(JSON.stringify(plan)); plan = JSON.parse(hist.back.pop()); fixSel(); persist(); renderAll(); }
function redo() { if (!hist.fwd.length) return; hist.back.push(JSON.stringify(plan)); plan = JSON.parse(hist.fwd.pop()); fixSel(); persist(); renderAll(); }
function fixSel() {
  if (!sel) return;
  const list = {task: plan.tasks, event: plan.events, subject: plan.subjects}[sel.kind];
  if (list && !list.some(x => x.id === sel.id)) sel = null;
}

/* ================= Linked calendars ================= */
/* Calendars from Google, Apple, Outlook… linked by their subscription address (.ics / webcal://). Rust downloads and
   reads them (ical.rs); their events are shown read-only in Today and the next-7-days panel. The last result is kept in
   the plan (calCache), so they also show offline. The address is secret: it is stored on this PC only. */
const CAL_COLORS = ['#3e63dd', '#30a46c', '#d6409f', '#f76b15', '#8e4ec6', '#12a594'];
const calendars = () => plan.calendars || [];
let calBusy = false;
async function refreshCalendars(only = null) {
  if (!invoke || calBusy || !calendars().length) return;
  calBusy = true;
  const from = addDays(today(), -7), to = addDays(today(), 180);
  plan.calCache = plan.calCache || {};
  for (const c of calendars().filter(c => !only || c.id === only)) {
    try {
      const r = await invoke('calendar_fetch', {url: c.url, from, to});
      plan.calCache[c.id] = {at: Date.now(), events: r.events, error: ''};
      if (!c.name && r.name) c.name = r.name;
    } catch (e) {
      plan.calCache[c.id] = {...(plan.calCache[c.id] || {events: []}), error: String(e)};
    }
  }
  calBusy = false;
  persist(); renderAll(); if (settingsOpen && prefsSection === 'calendars') renderSettings();
}
/* An event's local start date and time (UTC times are shown in local time). */
function localOf(e, which = 'start') {
  const v = e[which];
  if (e.all_day) return {date: v, time: ''};
  const d = e.utc ? new Date(v + 'Z') : new Date(v);
  return {date: isoOf(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}`};
}
/* The linked events on one day (all-day events on every day they span). */
function calEventsOn(day) {
  const out = [];
  for (const c of calendars()) {
    if (c.off) continue;
    const cache = plan.calCache && plan.calCache[c.id];
    for (const e of (cache && cache.events) || []) {
      const s = localOf(e), en = localOf(e, 'end');
      if (s.date <= day && (en.date >= day || s.date === day)) out.push({...e, cal: c, time: s.date === day ? s.time : ''});
    }
  }
  return out.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
const calRow = e => `<div class="row" title="${esc(e.cal.name)}${e.location ? ' · ' + esc(e.location) : ''}"><span class="chip" style="background:${e.cal.color}22;color:${e.cal.color}"><i style="background:${e.cal.color}"></i>${esc(e.time || t('cal.allDay'))}</span>
  <span class="grow">${esc(e.title)}</span>${e.location ? `<span class="meta">${esc(e.location)}</span>` : ''}</div>`;

/* ================= Rendering ================= */
const chip = s => s ? `<span class="chip" style="background:${s.color}22;color:${s.color}"><i style="background:${s.color}"></i>${esc(s.name)}</span>` : '';
const typeBadge = ty => `<span class="badge">${esc(t('type.' + ty))}</span>`;
const openSlot = g => `<span class="chip slot">${esc(g)}</span>`;
function dueBadge(iso, done) {
  if (!validIso(iso)) return '';
  const n = dayDiff(today(), iso), cls = done ? '' : n < 0 ? ' red' : n <= 1 ? ' warn' : '';
  return `<span class="badge${cls}" title="${esc(fmtDate(iso, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}))}">${esc(relDay(iso))}</span>`;
}
function taskRow(x) {
  return `<div class="row${x.done ? ' done' : ''}${sel && sel.kind === 'task' && sel.id === x.id ? ' sel' : ''}" data-task="${x.id}">
    <input type="checkbox" data-done="${x.id}"${x.done ? ' checked' : ''} title="${esc(t('ui.markDone'))}">${chip(subj(x.subject))}
    <span class="grow">${esc(x.title)}</span>${dueBadge(x.due, x.done)}</div>`;
}
function eventRow(e, withDate = true) {
  return `<div class="row${sel && sel.kind === 'event' && sel.id === e.id ? ' sel' : ''}" data-event="${e.id}">
    ${typeBadge(e.type)}${chip(subj(e.subject))}<span class="grow">${esc(e.title)}</span>
    ${withDate && validIso(e.date) ? `<span class="meta">${esc(fmtDate(e.date))}${e.time ? ' · ' + esc(e.time) : ''}</span>` : ''}${validIso(e.date) ? dueBadge(e.date, dayDiff(today(), e.date) < 0) : ''}</div>`;
}
const VIEWS = {
  today() {
    const d = today(), w = weekday(d), now = currentPeriod();
    const hol = holidayOn(d);
    const lessons = w < plan.days ? plan.periods.slice(0, periodsOn(w)).flatMap((p, i) => lessonsAt(w, i, d).map(l => [i, p, l])) : [];
    const items = [...lessons.map(([i, p, l]) => { const c = choiceOn(l, d), tm = timeOf(l, p);
        return {at: minutesOf(tm.start), html: `<div class="row${i === now ? ' now' : ''}" data-goto="${d}|${w}|${i}"><span class="lesson-no">${i + 1}</span><span class="lesson-time">${esc(tm.start)}–${esc(tm.end)}</span>
            ${c.subject ? chip(c.subject) : l.group ? openSlot(l.group) : ''}<span class="grow meta">${esc(c.off ? t('tt.off') : !c.subject && l.group ? t('tt.notChosen') : l.room || (c.subject || {}).room || '')}</span></div>`}; }),
      ...classesOn(d).map(e => ({at: minutesOf(e.time), html: `<div class="row${sel && sel.kind === 'event' && sel.id === e.id ? ' sel' : ''}" data-event="${e.id}"><span class="lesson-no">•</span>
            <span class="lesson-time">${e.time ? esc(e.time) + '–' + esc(classEnd(e)) : esc(t('cal.allDay'))}</span>${chip(subj(e.subject))}<span class="grow">${esc(e.title)}</span></div>`}))]
      .sort((a, b) => a.at - b.at);
    const open = plan.tasks.filter(x => !x.done);
    const overdue = open.filter(x => validIso(x.due) && x.due < d), soon = open.filter(x => validIso(x.due) && x.due >= d && dayDiff(d, x.due) <= 7);
    const nextEvents = plan.events.filter(e => e.type !== 'class' && validIso(e.date) && e.date >= d && dayDiff(d, e.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));
    const byDue = (a, b) => (a.due || '').localeCompare(b.due || '');
    return `<div class="view-title"><h1>${esc(fmtDate(d, {weekday: 'long', day: 'numeric', month: 'long'}))}</h1><span class="sub">${esc(t('ui.todayHint'))}</span></div>
      <div class="cards">
        <div class="pcard"><h2>${esc(t('ui.lessonsToday'))}<button class="btn-sm" data-act="viewWeek">${esc(t('a.viewWeek'))}</button></h2>
          ${items.length ? items.map(x => x.html).join('')
            : `<div class="empty-s">${esc(hol ? t('tt.holiday', {name: hol.name}) : w >= plan.days ? t('ui.noSchool') : plan.lessons.length ? t('ui.noLessons') : t('ui.setupTimetable'))}</div>`}</div>
        ${(() => {
          const open = openChoices(d, 7), warn = ruleWarnings(mondayOf(d));
          if (!open.length && !warn.length) return '';
          return `<div class="pcard"><h2>${esc(t('area.card'))}</h2>${warn.map(x => `<div class="row warn-row">${esc(x)}</div>`).join('')}
            ${open.map(o => { const dl = areaOf(o.l.group).deadline, late = dl && (o.date < d || (o.date === d && minutesOf(dl) <= new Date().getHours() * 60 + new Date().getMinutes()));
              const tm = timeOf(o.l, o.p);
              return `<div class="row" data-goto="${o.date}|${o.day}|${o.period}">${openSlot(o.l.group)}<span class="grow">${esc(o.date === d ? t('d.today') : o.date === addDays(d, 1) ? t('d.tomorrow') : fmtDate(o.date))} · ${esc(tm.start)}</span>
                ${dl ? `<span class="badge${late ? ' red' : o.date === d ? ' warn' : ''}">${esc(t('area.until', {time: dl}))}</span>` : ''}</div>`; }).join('')}</div>`;
        })()}
        <div class="pcard"><h2>${esc(t('ui.homework'))}<button class="btn-sm" data-act="newTask">${esc(t('ui.add'))}</button></h2>
          ${overdue.length ? `<div class="group-h red">${esc(t('g.overdue'))}</div>${overdue.sort(byDue).map(taskRow).join('')}` : ''}
          ${soon.length ? soon.sort(byDue).map(taskRow).join('') : overdue.length ? '' : `<div class="empty-s">${esc(t('ui.noHomework'))}</div>`}</div>
        <div class="pcard"><h2>${esc(t('ui.nextDates'))}<button class="btn-sm" data-act="newEvent">${esc(t('ui.add'))}</button></h2>
          ${nextEvents.length ? nextEvents.map(e => eventRow(e, false)).join('') : `<div class="empty-s">${esc(t('ui.noDates'))}</div>`}</div>
        <div class="pcard"><h2>${esc(t('cal.card'))}<button class="btn-sm" data-act="calendarSettings">${esc(t(calendars().length ? 'cal.manage' : 'cal.link'))}</button></h2>
          ${calendars().length ? (() => {
            const days = Array.from({length: 7}, (_, i) => addDays(d, i)).map(day => [day, calEventsOn(day)]).filter(([, l]) => l.length);
            return days.length ? days.map(([day, l]) => `<div class="group-h">${esc(day === d ? t('d.today') : day === addDays(d, 1) ? t('d.tomorrow') : fmtDate(day, {weekday: 'long', day: 'numeric', month: 'short'}))}</div>${l.map(calRow).join('')}`).join('')
              : `<div class="empty-s">${esc(t('cal.nothing'))}</div>`;
          })() : `<div class="empty-s">${esc(t('cal.intro'))}</div>`}</div>
      </div>`;
  },
  week() {
    const d = today(), now = currentPeriod(), ws = shownMonday();
    const dates = Array.from({length: plan.days}, (_, i) => addDays(ws, i));
    const termNames = [...new Set(dates.flatMap(x => termsOn(x).map(y => y.name)))];
    const range = `${fmtDate(dates[0], {day: 'numeric', month: 'short'})} – ${fmtDate(dates[dates.length - 1], {day: 'numeric', month: 'short', year: 'numeric'})}`;
    let h = `<div class="view-title"><h1>${esc(t('a.viewWeek'))}</h1><span class="sub">${esc(t('ui.weekHint'))}</span></div>
      <div class="weeknav"><button class="btn-sm" data-week="-1" title="${esc(t('tt.prevWeek'))}">‹</button><button class="btn-sm" data-week="0"${ws === mondayOf(d) ? ' disabled' : ''}>${esc(t('tt.thisWeek'))}</button>
        <button class="btn-sm" data-week="1" title="${esc(t('tt.nextWeek'))}">›</button><b>${esc(t('tt.week', {n: isoWeek(ws)}))}</b><span class="meta">${esc(range)}</span>
        ${cycle() ? `<button class="badge wt" data-wt title="${esc(t('tt.wtHint'))}">${esc(t('tt.weekType', {name: weekTypeOf(ws)}))}</button>` : ''}
        ${termNames.map(n => `<span class="badge">${esc(n)}</span>`).join('')}
        ${[...new Set(dates.map(holidayOn).filter(Boolean))].map(x => `<span class="badge warn">${esc(x.name)}</span>`).join('')}
        ${ruleWarnings(ws).map(x => `<span class="badge red">${esc(x)}</span>`).join('')}</div>
      <table class="tt"><tr><th></th>${dates.map((x, i) => `<th class="${x === d ? 'today' : ''}">${esc(dayName(i))}<span class="dt">${esc(holidayOn(x) ? holidayOn(x).name : fmtDate(x, {day: 'numeric', month: 'numeric'}))}</span></th>`).join('')}</tr>`;
    const placed = new Set();
    plan.periods.forEach((p, i) => {
      h += `<tr><td class="p"><b>${i + 1}.</b>${esc(p.start)}–${esc(p.end)}</td>`;
      dates.forEach((date, day) => {
        if (i >= periodsOn(day)) { h += '<td class="c off"></td>'; return; }
        const hol = holidayOn(date), ls = hol ? [] : lessonsAt(day, i, date, false), cls = classesOn(date).filter(e => overlaps(e, p));
        cls.forEach(e => placed.add(e.id));
        const live = ls.filter(l => !(l.skip || []).includes(date));
        const s = live.map(l => choiceOn(l, date).subject).find(Boolean) || cls.map(e => subj(e.subject)).find(Boolean);
        const open = live.length && live.every(l => l.group && !choiceOn(l, date).subject && !choiceOn(l, date).off);
        const isSel = sel && sel.kind === 'cell' && sel.day === day && sel.period === i;
        const style = s ? ` style="background:${s.color}22;border-color:${s.color}88;color:var(--strong)"` : '';
        h += `<td class="c${s ? ' full' : ''}${open ? ' slot' : ''}${hol ? ' hol' : ''}${isSel ? ' sel' : ''}${date === d && i === now ? ' now' : ''}" data-day="${day}" data-period="${i}"${style}>
          ${ls.map(l => { const c = choiceOn(l, date), ss = c.subject, gone = (l.skip || []).includes(date);
            const time = l.start || l.end ? `<span class="r">${esc(timeOf(l, p).start)}–${esc(timeOf(l, p).end)}</span>` : '';
            if (gone) return `<span class="n cancel">${esc(ss ? ss.name : l.group || '')}</span><span class="r">${esc(t('tt.cancelled'))}</span>`;
            if (c.off) return `<span class="n">${esc(l.group)}</span><span class="r">${esc(t('tt.off'))}</span>`;
            return ss ? `<span class="n" style="color:${ss.color}">${esc(ss.name)}</span><span class="r">${esc(l.room || ss.room || '')}</span>${time}`
              : l.group ? `<span class="n">${esc(l.group)}</span><span class="r">${esc(t('tt.choose'))}</span>${time}` : ''; }).join('')}
          ${cls.map(e => `<span class="ev" data-event="${e.id}" title="${esc(`${e.time}–${classEnd(e)} ${e.title || (subj(e.subject) || {}).name || ''}`)}">${esc(e.time)} ${esc(e.title || (subj(e.subject) || {}).name || t('type.class'))}</span>`).join('')}</td>`;
      });
      h += '</tr>';
      // A longer pause before the next period shows as a gap.
      const next = plan.periods[i + 1];
      if (next && minutesOf(next.start) - minutesOf(p.end) >= 15) h += `<tr class="brk"><td colspan="${plan.days + 1}"></td></tr>`;
    });
    h += '</table>';
    // Class sessions that fit no period (no time, after the last period, on a free day) are listed below.
    const rest = Array.from({length: 7}, (_, i) => addDays(ws, i)).flatMap(x => classesOn(x)).filter(e => !placed.has(e.id));
    if (rest.length) h += `<div class="group-h">${esc(t('tt.moreClasses'))}</div>` + rest.map(e => eventRow(e)).join('');
    return h;
  },
  tasks() {
    const d = today(), open = plan.tasks.filter(x => !x.done), done = plan.tasks.filter(x => x.done);
    const groups = [['g.overdue', x => validIso(x.due) && x.due < d, true], ['g.today', x => x.due === d], ['g.tomorrow', x => x.due === addDays(d, 1)],
      ['g.week', x => validIso(x.due) && dayDiff(d, x.due) >= 2 && dayDiff(d, x.due) <= 7], ['g.later', x => validIso(x.due) && dayDiff(d, x.due) > 7], ['g.noDate', x => !validIso(x.due)]];
    let h = `<div class="view-title"><h1>${esc(t('ui.homework'))}</h1><span class="sub">${esc(t('ui.openCount', {n: open.length}))}</span></div>
      <div class="quick"><input class="field-in title-in" id="qTitle" placeholder="${esc(t('ui.taskPh'))}">
        <select id="qSubject">${subjectOptions('')}</select><input type="date" id="qDue" title="${esc(t('ui.due'))}"><button class="btn-sm primary" id="qAdd">${esc(t('ui.add'))}</button></div>`;
    const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
    for (const [k, f, red] of groups) {
      const list = open.filter(f).sort(byDue);
      if (list.length) h += `<div class="group-h${red ? ' red' : ''}">${esc(t(k))} · ${list.length}</div>${list.map(taskRow).join('')}`;
    }
    if (!open.length) h += `<div class="empty-s">${esc(t('ui.allDone'))}</div>`;
    if (done.length) h += `<div class="group-h"><label style="cursor:pointer"><input type="checkbox" id="showDone"${settings.showDone ? ' checked' : ''}> ${esc(t('g.done'))} · ${done.length}</label></div>` +
      (settings.showDone ? done.sort((a, b) => (b.due || '').localeCompare(a.due || '')).map(taskRow).join('') : '');
    return h;
  },
  events() {
    const d = today(), list = plan.events.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const future = list.filter(e => !validIso(e.date) || e.date >= d), past = list.filter(e => validIso(e.date) && e.date < d);
    let h = `<div class="view-title"><h1>${esc(t('ui.dates'))}</h1><span class="sub">${esc(t('ui.datesHint'))}</span></div>
      <div class="quick"><select id="qType">${EVENT_TYPES.map(ty => `<option value="${ty}">${esc(t('type.' + ty))}</option>`).join('')}</select>
        <select id="qSubject">${subjectOptions('')}</select><input class="field-in title-in" id="qTitle" placeholder="${esc(t('ui.eventPh'))}">
        <input type="date" id="qDate"><input type="time" id="qTime" title="${esc(t('ui.time'))}"><button class="btn-sm primary" id="qAdd">${esc(t('ui.add'))}</button></div>`;
    let month = '';
    for (const e of future) {
      const m = validIso(e.date) ? fmtDate(e.date, {month: 'long', year: 'numeric'}) : t('g.noDate');
      if (m !== month) { month = m; h += `<div class="group-h">${esc(m)}</div>`; }
      h += eventRow(e);
    }
    if (!future.length) h += `<div class="empty-s">${esc(t('ui.noDates'))}</div>`;
    if (past.length) h += `<div class="group-h">${esc(t('g.past'))} · ${past.length}</div>` + past.reverse().slice(0, 30).map(e => eventRow(e)).join('');
    return h;
  },
  subjects() {
    return `<div class="view-title"><h1>${esc(t('ui.subjects'))}</h1><span class="sub">${esc(t('ui.subjectsHint'))}</span></div>
      <div class="quick"><input class="field-in title-in" id="qTitle" placeholder="${esc(t('ui.subjectPh'))}"><button class="btn-sm primary" id="qAdd">${esc(t('ui.add'))}</button></div>
      ${['', ...groups()].map(g => {
        const list = plan.subjects.filter(s => (s.group || '').trim() === g).sort((a, b) => g ? (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name) : 0);
        return (g ? `<div class="group-h">${esc(t('ui.catalog', {name: g}))} · ${list.length}</div>` : '') + list.map(s => `<div class="row${sel && sel.kind === 'subject' && sel.id === s.id ? ' sel' : ''}" data-subject="${s.id}">
        ${chip(s)}${s.category ? `<span class="badge">${esc(s.category)}</span>` : ''}${s.weekType && cycle() ? `<span class="badge">${esc(t('tt.weekType', {name: s.weekType}))}</span>` : ''}<span class="grow meta">${esc([s.teacher, s.room].filter(Boolean).join(' · '))}</span>
        ${g ? '' : `<span class="meta">${esc(t('ui.lessonsPerWeek', {n: plan.lessons.filter(l => l.subject === s.id && termOk(l, today())).length}))}</span>`}</div>`).join('');
      }).join('')}`;
  }
};
const subjectOptions = cur => {
  const o = list => list.map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  return `<option value="">${esc(t('ui.noSubject'))}</option>` + o(plan.subjects.filter(s => !(s.group || '').trim()))
    + groups().map(g => `<optgroup label="${esc(g)}">${o(plan.subjects.filter(s => (s.group || '').trim() === g))}</optgroup>`).join('');
};
const groupList = () => `<datalist id="groupList">${groups().map(g => `<option value="${esc(g)}">`).join('')}</datalist>`;

function renderView() {
  const v = $('#view');
  const focus = document.activeElement && document.activeElement.id;
  const keep = {title: $('#qTitle') && $('#qTitle').value, subject: $('#qSubject') && $('#qSubject').value};
  v.innerHTML = VIEWS[settings.view] ? VIEWS[settings.view]() : '';
  // Quick-add fields keep what was being typed when the view is redrawn.
  if (keep.title && $('#qTitle')) $('#qTitle').value = keep.title;
  if (keep.subject && $('#qSubject')) $('#qSubject').value = keep.subject;
  if ($('#qDue') && !$('#qDue').value) $('#qDue').value = nextLesson($('#qSubject').value);
  if ($('#qDate') && !$('#qDate').value) $('#qDate').value = addDays(today(), 7);
  if (focus && $('#' + focus)) $('#' + focus).focus();
  $$('#tools .ibtn.view').forEach(b => b.classList.toggle('active', b.dataset.act === 'view' + settings.view[0].toUpperCase() + settings.view.slice(1)));
}
/* The panel on the right: details of what is selected (or of the selected timetable cell). */
function renderDetails() {
  const box = $('#details');
  const field = (label, html) => `<div class="ed-field"><label>${esc(t(label))}</label>${html}</div>`;
  if (!sel) { box.innerHTML = `<div class="empty">${esc(t('ui.selectHint'))}</div>`; return; }
  if (sel.kind === 'cell') {
    const p = plan.periods[sel.period], date = addDays(shownMonday(), sel.day), hol = holidayOn(date);
    const all = plan.lessons.filter(l => l.day === sel.day && l.period === sel.period), l = lessonAt(sel.day, sel.period, date, false);
    const c = l ? choiceOn(l, date) : {}, weekly = l && weeklyArea(l.group);
    const cur = weekly ? (c.subject || {}).id : l && l.subject;
    const pal = list => `<div class="palette">${list.map(s => `<button data-assign="${s.id}" class="${cur === s.id ? 'on' : ''}" title="${esc([s.category, s.room, s.teacher].filter(Boolean).join(' · '))}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}</div>`;
    const offers = l && l.group ? offersFor(l.group, sel.day, sel.period, date) : [];
    const cats = [...new Set(offers.map(s => (s.category || '').trim()))];
    const catalog = cats.map(k => `${cats.length > 1 || k ? `<div class="sub-sect">${esc(k || t('area.noCategory'))}</div>` : ''}${pal(offers.filter(s => (s.category || '').trim() === k))}`).join('');
    const lessonBox = x => {
      const ss = subj(x.subject), x_on = x === l;
      return `<div class="lesson-box${x_on ? ' active' : ''}">
        <div class="lb-h">${ss ? chip(ss) : x.group ? openSlot(x.group) : `<span class="meta">${esc(t('tt.empty'))}</span>`}
          ${x_on ? `<span class="badge ok">${esc(t('tt.thisWeekOn'))}</span>` : ''}<span class="flex"></span><button class="btn-sm danger-btn" data-ldel="${x.id}">${esc(t('a.delete'))}</button></div>
        ${field(x.group && weeklyArea(x.group) ? 'tt.fixedChoice' : 'ui.subject', `<select data-l="subject" data-lid="${x.id}">${subjectOptions(weeklyArea(x.group) && !x.everyWeek ? '' : x.subject)}</select>`)}
        ${field('ui.room', `<input class="field-in" data-l="room" data-lid="${x.id}" value="${esc(x.room || '')}" placeholder="${esc((ss || {}).room || '')}">`)}
        <details class="more"${x.group || !x.subject || (x.terms || []).length || x.weekType || x.start || x.end || (x.skip || []).includes(date) ? ' open' : ''}><summary>${esc(t('tt.moreOptions'))}</summary>
        ${field('tt.group', `<input class="field-in" data-l="group" data-lid="${x.id}" list="groupList" value="${esc(x.group || '')}" placeholder="${esc(t('tt.groupPh'))}">`)}
        ${terms().length ? field('tt.terms', `<div class="term-checks">${terms().map(tm => `<label><input type="checkbox" data-lterm="${x.id}|${tm.id}"${(x.terms || []).includes(tm.id) ? ' checked' : ''}> ${esc(tm.name)}</label>`).join('')}</div>
          <div class="meta">${esc(t('tt.termsHint'))}</div>`) : ''}
        ${cycle() ? field('tt.weekTypeOnly', `<select data-l="weekType" data-lid="${x.id}"><option value="">${esc(t('tt.everyWeek'))}</option>${cycle().names.map(n => `<option value="${esc(n)}"${x.weekType === n ? ' selected' : ''}>${esc(t('tt.weekType', {name: n}))}</option>`).join('')}</select>`) : ''}
        ${field('tt.ownTime', `<div class="two"><input type="time" data-l="start" data-lid="${x.id}" value="${esc(x.start || '')}" placeholder="${esc(p.start)}"><input type="time" data-l="end" data-lid="${x.id}" value="${esc(x.end || '')}"></div><div class="meta">${esc(t('tt.ownTimeHint', {start: p.start, end: p.end}))}</div>`)}
        <label class="switch"><input type="checkbox" data-lskip="${x.id}"${(x.skip || []).includes(date) ? ' checked' : ''}><span></span>${esc(t('tt.skipDay', {date: fmtDate(date)}))}</label></details></div>`;
    };
    box.innerHTML = `<div class="sect">${esc(dayName(sel.day))}, ${esc(fmtDate(date, {day: 'numeric', month: 'short'}))} · ${sel.period + 1}. ${esc(periodName())} (${esc(p.start)}–${esc(p.end)})${cycle() ? ' · ' + esc(t('tt.weekType', {name: weekTypeOf(date)})) : ''}</div>
      ${hol ? `<p class="hint warn-row">${esc(t('tt.holiday', {name: hol.name}))}</p>` : ''}
      ${l && l.group ? `<div class="sect">${esc(t(weekly ? 'area.chooseFor' : 'ui.catalog', {name: l.group, date: fmtDate(date)}))}</div>
        <div class="seg" title="${esc(t('area.modeHint'))}"><button data-area-mode="1" class="${weekly ? 'on' : ''}">${esc(t('area.modeWeekly'))}</button><button data-area-mode="0" class="${weekly ? '' : 'on'}">${esc(t('area.modeFixed'))}</button></div>
        ${offers.length ? catalog : `<p class="hint" style="color:var(--dim)">${esc(t('area.noOffers'))}</p>`}
        ${weekly ? `<p class="pick-btns"><button class="btn-sm${c.off ? ' on' : ''}" data-pick-off>${esc(t('area.off'))}</button>
          ${c.picked && c.subject ? `<button class="btn-sm" data-pick-fixed>${esc(t('area.everyWeek'))}</button>` : ''}
          ${c.picked ? `<button class="btn-sm" data-pick-clear>${esc(t('area.clear'))}</button>` : ''}</p>
          <p class="hint" style="color:var(--dim)">${esc(t(c.picked ? 'area.pickedHint' : l.subject && l.everyWeek ? 'area.fixedHint' : 'area.weeklyHint'))}</p>` : ''}
        <details class="more"><summary>${esc(t('tt.allSubjects'))}</summary>${pal(plan.subjects.filter(s => !offers.includes(s)))}</details>`
      : pal(plan.subjects)}
      ${all.length ? '' : `<p class="hint" style="color:var(--dim)">${esc(t('ui.cellHint'))}</p>`}
      ${all.map(lessonBox).join('')}${groupList()}
      <p><button class="btn-sm" data-ladd>${esc(t(all.length ? 'tt.addAnother' : 'tt.addSlot'))}</button></p>
      ${all.length > 1 || terms().length ? `<p class="hint" style="color:var(--dim)">${esc(t('tt.cellTermsHint'))}</p>` : ''}`;
    return;
  }
  if (sel.kind === 'task') {
    const x = plan.tasks.find(y => y.id === sel.id); if (!x) return;
    box.innerHTML = `<div class="sect">${esc(t('ui.homeworkOne'))}</div>
      ${field('ui.title', `<input class="field-in" data-f="title" value="${esc(x.title)}">`)}
      ${field('ui.subject', `<select data-f="subject">${subjectOptions(x.subject)}</select>`)}
      ${field('ui.due', `<div class="two"><input type="date" data-f="due" value="${esc(x.due || '')}"><button class="btn-sm" data-next-lesson>${esc(t('ui.nextLesson'))}</button></div>`)}
      ${field('ui.notes', `<textarea data-f="notes">${esc(x.notes || '')}</textarea>`)}
      <label class="switch"><input type="checkbox" data-f="done"${x.done ? ' checked' : ''}><span></span>${esc(t('ui.markDone'))}</label>
      <p><button class="btn-sm danger-btn" data-act="deleteSel">${esc(t('a.delete'))}</button></p>`;
  } else if (sel.kind === 'event') {
    const e = plan.events.find(y => y.id === sel.id); if (!e) return;
    box.innerHTML = `<div class="sect">${esc(t('type.' + e.type))}</div>
      ${field('ui.type', `<select data-f="type">${EVENT_TYPES.map(ty => `<option value="${ty}"${ty === e.type ? ' selected' : ''}>${esc(t('type.' + ty))}</option>`).join('')}</select>`)}
      ${field('ui.title', `<input class="field-in" data-f="title" value="${esc(e.title)}">`)}
      ${field('ui.subject', `<select data-f="subject">${subjectOptions(e.subject)}</select>`)}
      ${field('ui.dateTime', `<div class="two"><input type="date" data-f="date" value="${esc(e.date || '')}"><input type="time" data-f="time" value="${esc(e.time || '')}"></div>`)}
      ${e.time ? field('ui.minutes', `<input class="field-in" type="number" min="5" max="600" step="5" data-f="minutes" value="${esc(e.minutes || 90)}">`) : ''}
      ${field('ui.notes', `<textarea data-f="notes" placeholder="${esc(t('ui.eventNotesPh'))}">${esc(e.notes || '')}</textarea>`)}
      <p><button class="btn-sm" data-copy-week>${esc(t('ui.copyWeek'))}</button> <button class="btn-sm danger-btn" data-act="deleteSel">${esc(t('a.delete'))}</button></p>`;
  } else if (sel.kind === 'subject') {
    const s = subj(sel.id); if (!s) return;
    box.innerHTML = `<div class="sect">${esc(t('ui.subject'))}</div>
      ${field('ui.name', `<input class="field-in" data-f="name" value="${esc(s.name)}">`)}
      ${field('ui.short', `<input class="field-in" data-f="short" value="${esc(s.short || '')}" maxlength="5">`)}
      ${field('ui.color', `<div class="colors">${COLORS.map(c => `<button data-color="${c}" class="${c === s.color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`)}
      ${field('ui.teacher', `<input class="field-in" data-f="teacher" value="${esc(s.teacher || '')}">`)}
      ${field('ui.roomDefault', `<input class="field-in" data-f="room" value="${esc(s.room || '')}">`)}
      ${field('tt.group', `<input class="field-in" data-f="group" list="groupList" value="${esc(s.group || '')}" placeholder="${esc(t('tt.groupPh'))}">${groupList()}<div class="meta">${esc(t('tt.groupHint'))}</div>`)}
      ${s.group ? (() => {
        const slots = [...new Set(plan.lessons.filter(l => l.group === s.group).map(l => `${l.day}|${l.period}`))].sort();
        return field('area.category', `<input class="field-in" data-f="category" list="catList" value="${esc(s.category || '')}" placeholder="${esc(t('area.categoryPh'))}"><datalist id="catList">${categoriesOf(s.group).map(k => `<option value="${esc(k)}">`).join('')}</datalist>`)
          + (cycle() ? field('tt.weekTypeOnly', `<select data-f="weekType"><option value="">${esc(t('tt.everyWeek'))}</option>${cycle().names.map(n => `<option value="${esc(n)}"${s.weekType === n ? ' selected' : ''}>${esc(t('tt.weekType', {name: n}))}</option>`).join('')}</select>`) : '')
          + (slots.length ? field('area.offeredIn', `<div class="term-checks">${slots.map(k => { const [dd, pp] = k.split('|').map(Number);
              return `<label><input type="checkbox" data-offered="${k}"${(s.offered || []).includes(k) ? ' checked' : ''}> ${esc(dayName(dd, 'short'))} ${pp + 1}.</label>`; }).join('')}</div><div class="meta">${esc(t('area.offeredHint'))}</div>`) : '');
      })() : ''}
      <p><button class="btn-sm danger-btn" data-act="deleteSel">${esc(t('a.delete'))}</button></p>`;
  }
}
/* The coming seven days at a glance. */
function renderWeekAhead() {
  const d = today();
  $('#weekAhead').innerHTML = Array.from({length: 7}, (_, i) => {
    const day = addDays(d, i), w = weekday(day);
    const tasks = plan.tasks.filter(x => !x.done && x.due === day), events = plan.events.filter(e => e.date === day), cal = calEventsOn(day);
    const n = (w < plan.days ? plan.lessons.filter(l => l.day === w && l.period < periodsOn(w) && lessonOn(l, day) && !choiceOn(l, day).off).length : 0) + classesOn(day).length;
    return `<div class="sect">${esc(i === 0 ? t('d.today') : i === 1 ? t('d.tomorrow') : fmtDate(day, {weekday: 'long', day: 'numeric', month: 'short'}))}
      <span style="float:right;text-transform:none;letter-spacing:0;font-weight:400">${n ? esc(t(n === 1 ? 'ui.nLesson' : 'ui.nLessons', {n})) : ''}</span></div>
      ${events.map(e => eventRow(e, false)).join('')}${tasks.map(taskRow).join('')}${cal.map(calRow).join('')}${!events.length && !tasks.length && !cal.length ? `<div class="empty-s">—</div>` : ''}`;
  }).join('');
}
function updateStatus() {
  if (!plan) return;
  const open = plan.tasks.filter(x => !x.done).length, d = today();
  const next = plan.events.filter(e => e.type !== 'class' && validIso(e.date) && e.date >= d).sort((a, b) => a.date.localeCompare(b.date))[0];
  const st = $('#stState');
  st.className = 'st-state' + (dirty ? ' dirty' : '');
  st.textContent = dirty ? t('st.saving') : t('st.saved');
  $('#stTasks').textContent = t('st.tasks', {n: open});
  $('#stNext').textContent = next ? t('st.next', {what: [t('type.' + next.type), (subj(next.subject) || {}).name].filter(Boolean).join(' '), when: relDay(next.date)}) : '';
  $('#stDate').textContent = fmtDate(d, {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
  $('#apptitle').textContent = `${t('view.' + settings.view)}  —  Plan Studio`;
  document.title = 'Plan Studio';
  syncDisabled();
}
function renderAll() { if (!plan) return; wtCache = {}; renderView(); renderDetails(); renderWeekAhead(); updateStatus(); }

/* ================= Interaction ================= */
const view = $('#view');
view.addEventListener('click', e => {
  const done = e.target.closest('[data-done]');
  if (done) { const x = plan.tasks.find(y => y.id === done.dataset.done); change(() => { x.done = done.checked; }); return; }
  if (e.target.id === 'showDone') { settings.showDone = e.target.checked; saveSettings(); renderView(); return; }
  if (e.target.id === 'qAdd') return quickAdd();
  const go = e.target.closest('[data-goto]');
  if (go) { const [date, day, period] = go.dataset.goto.split('|'); weekStart = mondayOf(date); sel = {kind: 'cell', day: +day, period: +period}; settings.view = 'week'; showDetails(); renderAll(); return; }
  if (e.target.closest('[data-wt]')) { const c = cycle(); change(() => { c.start = ((c.start || 0) + 1) % c.names.length; }); return; }
  const wk = e.target.closest('[data-week]');
  if (wk) { const n = +wk.dataset.week; weekStart = n ? addDays(shownMonday(), 7 * n) : null; renderView(); renderDetails(); return; }
  const ev = e.target.closest('.ev[data-event]');
  if (ev) { sel = {kind: 'event', id: ev.dataset.event}; showDetails(); return; }
  const cell = e.target.closest('td.c:not(.off)');
  if (cell) { sel = {kind: 'cell', day: +cell.dataset.day, period: +cell.dataset.period}; showDetails(); return; }
  const row = e.target.closest('[data-task],[data-event],[data-subject]');
  if (row && !e.target.closest('input')) {
    sel = row.dataset.task ? {kind: 'task', id: row.dataset.task} : row.dataset.event ? {kind: 'event', id: row.dataset.event} : {kind: 'subject', id: row.dataset.subject};
    showDetails();
  }
});
$('#weekAhead').addEventListener('click', e => {
  const done = e.target.closest('[data-done]');
  if (done) { const x = plan.tasks.find(y => y.id === done.dataset.done); change(() => { x.done = done.checked; }); return; }
  const row = e.target.closest('[data-task],[data-event]');
  if (row) { sel = row.dataset.task ? {kind: 'task', id: row.dataset.task} : {kind: 'event', id: row.dataset.event}; settings.dockTab = 'details'; applySettings(); renderView(); }
});
view.addEventListener('change', e => { if (e.target.id === 'qSubject' && $('#qDue')) $('#qDue').value = nextLesson(e.target.value); });
view.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.quick')) { e.preventDefault(); quickAdd(); } });
function showDetails() { settings.dockTab = 'details'; if (!settings.dock) settings.dock = true; applySettings(); renderView(); }
function quickAdd() {
  const title = ($('#qTitle').value || '').trim();
  if (settings.view === 'tasks') {
    if (!title) return $('#qTitle').focus();
    const x = {id: uid(), title, subject: $('#qSubject').value, due: $('#qDue').value || '', done: false, notes: ''};
    change(() => plan.tasks.push(x));
    $('#qTitle').value = ''; $('#qDue').value = nextLesson($('#qSubject').value); $('#qTitle').focus();
    toast(t('toast.taskAdded'));
  } else if (settings.view === 'events') {
    const e = {id: uid(), type: $('#qType').value, subject: $('#qSubject').value, title, date: $('#qDate').value || '', time: $('#qTime').value || '', notes: ''};
    if (!title && !e.subject) return $('#qTitle').focus();
    change(() => plan.events.push(e));
    $('#qTitle').value = ''; $('#qTime').value = '';
    toast(t('toast.eventAdded'));
  } else if (settings.view === 'subjects') {
    if (!title) return $('#qTitle').focus();
    const s = {id: uid(), name: title, short: title.slice(0, 2), color: COLORS[plan.subjects.length % COLORS.length], teacher: '', room: ''};
    change(() => plan.subjects.push(s));
    $('#qTitle').value = ''; sel = {kind: 'subject', id: s.id}; renderAll();
  }
}
/* Editing in the details panel: text fields save when they lose focus or on Enter, the rest at once. */
$('#details').addEventListener('change', e => {
  const f = e.target.dataset.f;
  if (e.target.dataset.l) {
    const l = plan.lessons.find(x => x.id === e.target.dataset.lid), k = e.target.dataset.l;
    if (l) change(() => { l[k] = e.target.value.trim(); if (k === 'subject') l.everyWeek = !!l.subject; });
    return;
  }
  if (e.target.dataset.lskip) {
    const l = plan.lessons.find(x => x.id === e.target.dataset.lskip), date = addDays(shownMonday(), sel.day);
    if (l) change(() => { const set = new Set(l.skip || []); e.target.checked ? set.add(date) : set.delete(date); l.skip = [...set].filter(x => x >= addDays(today(), -400)).sort(); });
    return;
  }
  if (e.target.dataset.offered) {
    const s = subj(sel.id), k = e.target.dataset.offered;
    if (s) change(() => { const set = new Set(s.offered || []); e.target.checked ? set.add(k) : set.delete(k); s.offered = [...set].sort(); });
    return;
  }
  if (e.target.dataset.lterm) {
    const [lid, tid] = e.target.dataset.lterm.split('|'), l = plan.lessons.find(x => x.id === lid);
    if (l) change(() => { const set = new Set(l.terms || []); e.target.checked ? set.add(tid) : set.delete(tid); l.terms = terms().map(x => x.id).filter(id => set.has(id)); });
    return;
  }
  if (!f || !sel) return;
  const obj = sel.kind === 'task' ? plan.tasks.find(x => x.id === sel.id) : sel.kind === 'event' ? plan.events.find(x => x.id === sel.id) : subj(sel.id);
  if (!obj) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  change(() => { obj[f] = f === 'minutes' ? clamp(Math.round(+v) || 90, 5, 600) : typeof v === 'string' && f !== 'notes' ? v.trim() : v; });
});
$('#details').addEventListener('click', e => {
  const a = e.target.closest('[data-assign]');
  if (a) {
    const {day, period} = sel, date = addDays(shownMonday(), day), l = lessonAt(day, period, date, false);
    const others = plan.lessons.some(x => x.day === day && x.period === period);
    if (l && weeklyArea(l.group)) { setPick(l, date, choiceOn(l, date).picked && (choiceOn(l, date).subject || {}).id === a.dataset.assign ? null : a.dataset.assign); return; }
    change(() => {
      // Clicking the same subject again clears it (an elective slot stays, only the choice goes).
      if (l && l.subject === a.dataset.assign) { if (l.group) l.subject = ''; else plan.lessons = plan.lessons.filter(x => x !== l); }
      else if (l) l.subject = a.dataset.assign;
      // A new lesson next to lessons of other terms applies to the terms of the week shown.
      else plan.lessons.push({id: uid(), day, period, subject: a.dataset.assign, room: '', terms: others ? termsOn(date).map(x => x.id) : []});
    });
    return;
  }
  const mode = e.target.closest('[data-area-mode]');
  if (mode) {
    const l = lessonAt(sel.day, sel.period, addDays(shownMonday(), sel.day), false); if (!l || !l.group) return;
    change(() => { plan.areas = {...(plan.areas || {}), [l.group]: {...areaOf(l.group), weekly: mode.dataset.areaMode === '1'}}; });
    return;
  }
  if (e.target.closest('[data-pick-off],[data-pick-fixed],[data-pick-clear]')) {
    const date = addDays(shownMonday(), sel.day), l = lessonAt(sel.day, sel.period, date, false); if (!l) return;
    if (e.target.closest('[data-pick-off]')) setPick(l, date, choiceOn(l, date).off ? null : OFF);
    else if (e.target.closest('[data-pick-clear]')) setPick(l, date, null);
    else { const id = (choiceOn(l, date).subject || {}).id; change(() => { l.subject = id; l.everyWeek = true; if (l.picks) delete l.picks[date]; }); }
    return;
  }
  const ld = e.target.closest('[data-ldel]');
  if (ld) { change(() => { plan.lessons = plan.lessons.filter(x => x.id !== ld.dataset.ldel); }); return; }
  if (e.target.closest('[data-ladd]')) {
    const {day, period} = sel, date = addDays(shownMonday(), day), cur = lessonAt(day, period, date);
    const used = new Set(plan.lessons.filter(x => x.day === day && x.period === period).flatMap(x => x.terms || []));
    const free = terms().find(x => !used.has(x.id) && x.to >= date) || terms().find(x => !used.has(x.id));
    const first = !plan.lessons.some(x => x.day === day && x.period === period);
    change(() => plan.lessons.push({id: uid(), day, period, subject: '', group: cur ? cur.group || '' : '', room: '', terms: !first && free ? [free.id] : []}));
    return;
  }
  if (e.target.closest('[data-copy-week]')) {
    const ev = plan.events.find(y => y.id === sel.id); if (!ev || !validIso(ev.date)) return;
    const copy = {...ev, id: uid(), date: addDays(ev.date, 7)};
    change(() => plan.events.push(copy));
    sel = {kind: 'event', id: copy.id}; renderAll(); toast(t('toast.copiedWeek', {date: fmtDate(copy.date)}));
    return;
  }
  const c = e.target.closest('[data-color]');
  if (c && sel && sel.kind === 'subject') { const s = subj(sel.id); change(() => { s.color = c.dataset.color; }); return; }
  if (e.target.closest('[data-next-lesson]')) { const x = plan.tasks.find(y => y.id === sel.id); change(() => { x.due = nextLesson(x.subject); }); }
});
/* The choice of a weekly elective slot for one date (null = none); old choices are dropped after a year. */
function setPick(l, date, id) {
  change(() => {
    const picks = {};
    for (const [k, v] of Object.entries(l.picks || {})) if (k >= addDays(today(), -400)) picks[k] = v;
    if (id) picks[date] = id; else delete picks[date];
    l.picks = picks;
  });
}
function deleteSel() {
  if (!sel) return;
  if (sel.kind === 'cell') { const l = lessonAt(sel.day, sel.period, addDays(shownMonday(), sel.day), false); if (l) change(() => { plan.lessons = plan.lessons.filter(x => x !== l); }); return; }
  if (sel.kind === 'subject') {
    const used = plan.lessons.some(l => l.subject === sel.id) || plan.tasks.some(x => x.subject === sel.id) || plan.events.some(x => x.subject === sel.id);
    if (used && !confirm(t('confirm.deleteSubject'))) return;
    const id = sel.id;
    change(() => { plan.subjects = plan.subjects.filter(s => s.id !== id); plan.lessons = plan.lessons.filter(l => l.subject !== id); });
  } else {
    const key = sel.kind === 'task' ? 'tasks' : 'events', id = sel.id;
    change(() => { plan[key] = plan[key].filter(x => x.id !== id); });
  }
  sel = null; renderAll();
}
/* Arrow keys move through the timetable. */
function moveCell(dx, dy) {
  if (!sel || sel.kind !== 'cell') { sel = {kind: 'cell', day: 0, period: 0}; }
  else {
    const day = clamp(sel.day + dx, 0, plan.days - 1);
    sel = {kind: 'cell', day, period: clamp(sel.period + dy, 0, periodsOn(day) - 1)};
  }
  renderView(); renderDetails();
}

/* ================= Files: import, backup, calendar, print ================= */
let toastT;
function toast(msg) { const n = $('#toast'); n.textContent = msg; n.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => n.classList.remove('show'), 2600); }
function download(text, name, type) { const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(new Blob([text], {type})), download: name}); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
async function exportText(name, filter, ext, text, mime) {
  try {
    if (invoke) { const p = await invoke('export_file', {suggestedName: name, filterName: filter, ext, content: text}); if (p) toast(t('toast.exported', {path: p})); }
    else download(text, name, mime);
  } catch (e) { toast(t('toast.saveFail', {e})); }
}
const exportBackup = () => exportText(`Plan ${today()}.plan`, 'Plan Studio', 'plan', JSON.stringify({...plan, calendars: undefined, calCache: undefined}, null, 1), 'application/json');
/* The timetable of the coming weeks as single lessons — with terms, week types, holidays, cancelled days and the
   choices of elective slots (slots without a choice are left out). For the calendar export. */
function lessonOccurrences(weeks, from = today()) {
  const out = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(from, i), w = weekday(date);
    if (w >= plan.days) continue;
    plan.periods.slice(0, periodsOn(w)).forEach((p, period) => lessonsAt(w, period, date).forEach(l => {
      const c = choiceOn(l, date);
      if (c.off || !c.subject) return;
      const tm = timeOf(l, p);
      out.push({id: `${l.id}-${date}`, date, start: tm.start, end: tm.end, title: c.subject.name, room: l.room || c.subject.room || '', teacher: c.subject.teacher || ''});
    }));
  }
  return out;
}
async function exportIcs() {
  if (!invoke) return toast(t('toast.appOnly'));
  const lessonEvents = settings.icsWeeks > 0 ? lessonOccurrences(settings.icsWeeks) : [];
  const ics = await invoke('plan_ics', {plan: {...plan, calendars: undefined, calCache: undefined, lessonEvents}, lang, tasks: !!settings.icsTasks});
  exportText(lang === 'de' ? 'Schule.ics' : 'School.ics', t('ui.calendar'), 'ics', ics, 'text/calendar');
}
async function importPlan(file) {
  let f = file;
  if (!f) {
    if (invoke) { try { f = await invoke('import_file'); } catch (e) { return toast(String(e)); } if (!f) return; }
    else { const inp = $('#fileIn'); inp.value = ''; inp.onchange = async () => { const x = inp.files[0]; if (x) importPlan({name: x.name, content: await x.text()}); }; inp.click(); return; }
  }
  let p; try { p = JSON.parse(f.content); } catch (e) { p = null; }
  if (!validPlan(p)) return toast(t('toast.notPlan', {name: f.name}));
  if (!(await ask(t('confirm.import', {name: f.name})))) return;
  change(() => { plan = {...p, calendars: plan.calendars, calCache: plan.calCache}; });
  sel = null; renderAll(); toast(t('toast.imported'));
}
async function ask(message) { return invoke ? invoke('confirm', {title: t('confirm.title'), message, okLabel: t('confirm.ok'), cancelLabel: t('confirm.cancel')}) : confirm(message); }
function print() { const v = settings.view; if (v !== 'week' && v !== 'tasks' && v !== 'events') setView('week'); setTimeout(() => invoke ? invoke('print_page').catch(e => toast(String(e))) : window.print(), 200); }

/* ================= Actions, menus, shortcuts ================= */
function setView(v) { settings.view = v; if (sel && sel.kind === 'cell' && v !== 'week') sel = null; saveSettings(); renderAll(); }
const A = {
  newTask: () => { setView('tasks'); setTimeout(() => $('#qTitle') && $('#qTitle').focus(), 0); },
  newEvent: () => { setView('events'); setTimeout(() => $('#qTitle') && $('#qTitle').focus(), 0); },
  newSubject: () => { setView('subjects'); setTimeout(() => $('#qTitle') && $('#qTitle').focus(), 0); },
  importPlan: () => importPlan(), exportBackup, exportIcs, print,
  undo, redo, deleteSel,
  viewToday: () => setView('today'), viewWeek: () => setView('week'), viewTasks: () => setView('tasks'), viewEvents: () => setView('events'), viewSubjects: () => setView('subjects'),
  togglePanels: () => { settings.dock = !settings.dock; applySettings(); },
  toggleAutoHide: () => { settings.autoHide = !settings.autoHide; applySettings(); },
  settings: () => openSettings(), timetableSettings: () => openSettings('timetable'), calendarSettings: () => openSettings('calendars'),
  refreshCalendars: () => { if (!invoke) return toast(t('cal.appOnly')); refreshCalendars().then(() => toast(t('cal.refreshed'))); },
  langAuto: () => setLang('auto'), langEn: () => setLang('en'), langDe: () => setLang('de'),
  themeDark: () => setTheme('dark'), themeLight: () => setTheme('light'), themeGithub: () => setTheme('github'), themeGithubDark: () => setTheme('github-dark'),
  shortcuts: () => {
    let h = '';
    MENUS.forEach(([m, items]) => {
      const rows = items.filter(it => Array.isArray(it) && it[1]);
      if (rows.length) h += `<h4>${esc(t('menu.' + m))}</h4><table>` + rows.map(it => `<tr><td>${esc(t('a.' + it[0]))}</td><td><kbd>${esc(fmtKey(it[1]))}</kbd></td></tr>`).join('') + '</table>';
    });
    h += `<h4>${esc(t('a.viewWeek'))}</h4><table><tr><td>${esc(t('ed.move'))}</td><td><kbd>← ↑ → ↓</kbd></td></tr><tr><td>${esc(t('ui.clearCell'))}</td><td><kbd>${esc(fmtKey('Delete'))}</kbd></td></tr></table>`;
    modal(t('a.shortcuts'), h);
  },
  about: async () => {
    const v = invoke ? await window.__TAURI__.app.getVersion().catch(() => '') : '';
    modal(t('a.about'), `${v ? `<p><b>${esc(t('about.version', {v}))}</b></p>` : ''}<p>${esc(t('about.p1'))}</p><p>${esc(t('about.p2'))}</p>`);
  }
};
// Menu items: [action, shortcut, checked(), fixed]; '-' is a separator, '#key' a section label (as in every Studio app).
const MENUS = [
  ['file', [['importPlan', 'Ctrl+O'], ['exportBackup', 'Ctrl+S'], '-', ['exportIcs', 'Ctrl+E'], ['print', 'Ctrl+P']]],
  ['edit', [['undo', 'Ctrl+Z', null, false, ['Ctrl+Shift+Z']], ['redo', 'Ctrl+Y'], '-', ['deleteSel', 'Delete', null, true]]],
  ['plan', [['newTask', 'Ctrl+N'], ['newEvent', 'Ctrl+Shift+N'], ['newSubject'], '-', ['timetableSettings'], ['calendarSettings'], ['refreshCalendars', 'F5']]],
  ['view', [['viewToday', 'Alt+1', () => settings.view === 'today'], ['viewWeek', 'Alt+2', () => settings.view === 'week'], ['viewTasks', 'Alt+3', () => settings.view === 'tasks'],
    ['viewEvents', 'Alt+4', () => settings.view === 'events'], ['viewSubjects', 'Alt+5', () => settings.view === 'subjects'], '-',
    ['togglePanels', 'Ctrl+\\', () => settings.dock], ['toggleAutoHide', null, () => settings.autoHide]]],
  ['settings', [['settings', 'Ctrl+,'], '-', '#menu.language',
    ['langAuto', null, () => settings.lang === 'auto'], ['langEn', null, () => settings.lang === 'en'], ['langDe', null, () => settings.lang === 'de'],
    '-', '#menu.theme',
    ['themeDark', null, () => settings.theme === 'dark'], ['themeLight', null, () => settings.theme === 'light'],
    ['themeGithub', null, () => settings.theme === 'github'], ['themeGithubDark', null, () => settings.theme === 'github-dark']]],
  ['help', [['shortcuts', 'F1'], '-', ['about']]]
];
const allowed = act => !!plan && (act !== 'undo' || hist.back.length > 0) && (act !== 'redo' || hist.fwd.length > 0) && (act !== 'deleteSel' || !!sel);
function run(act) { if (A[act] && allowed(act)) A[act](); }
function syncDisabled() { $$('[data-act]').forEach(b => b.disabled = !allowed(b.dataset.act)); }
const KEYMAP = {};
function buildKeymap() {
  for (const k in KEYMAP) delete KEYMAP[k];
  MENUS.forEach(([, items]) => items.forEach(it => { if (Array.isArray(it) && !it[3]) [it[1], ...(it[4] || [])].forEach(k => { if (k) KEYMAP[k] = it[0]; }); }));
}
let menuOpen = null;
function openMenu(m, items) {
  closeMenus();
  const dd = m.querySelector('.dropdown'); dd.innerHTML = '';
  items.forEach(it => {
    if (it === '-') return dd.append(document.createElement('hr'));
    if (typeof it === 'string') return dd.append(Object.assign(document.createElement('div'), {className: 'dd-label', textContent: t(it.slice(1))}));
    const [act, key, check] = it, b = document.createElement('button');
    b.innerHTML = `<span class="chk">${check && check() ? '&#10003;' : ''}</span><span>${esc(t('a.' + act))}</span><kbd>${esc(key ? fmtKey(key) : '')}</kbd>`;
    b.disabled = !allowed(act);
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => { closeMenus(); run(act); };
    dd.append(b);
  });
  m.classList.add('open'); menuOpen = m;
}
function closeMenus() { $$('.menu.open').forEach(x => x.classList.remove('open')); menuOpen = null; }
function buildMenubar() {
  const nav = $('#menus'); nav.innerHTML = ''; menuOpen = null;
  MENUS.forEach(([name, items]) => {
    const m = document.createElement('div'), b = document.createElement('button'), dd = document.createElement('div');
    m.className = 'menu'; dd.className = 'dropdown'; b.textContent = t('menu.' + name);
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => menuOpen === m ? closeMenus() : openMenu(m, items);
    b.onmouseenter = () => { if (menuOpen && menuOpen !== m) openMenu(m, items); };
    m.append(b, dd); nav.append(m);
  });
}
document.addEventListener('mousedown', e => { if (menuOpen && !e.target.closest('.menu')) closeMenus(); });
const keyOf = act => { for (const [, items] of MENUS) for (const it of items) if (Array.isArray(it) && it[0] === act && it[1]) return it[1]; return ''; };
const tip = act => t('a.' + act) + (keyOf(act) ? ` (${fmtKey(keyOf(act))})` : '');

const SV = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
const ICONS = {
  today: SV('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><circle cx="12" cy="15" r="2" fill="currentColor"/>'),
  week: SV('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16M15 4v16M3 14.5h18"/>'),
  tasks: SV('<path d="m4 7 2 2 4-4M4 17l2 2 4-4M13 7h8M13 17h8"/>'),
  events: SV('<path d="M12 2 3 6v6c0 5 4 9 9 10 5-1 9-5 9-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  subjects: SV('<path d="M4 19V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13"/>'),
  open: SV('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  save: SV('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>'),
  undo: SV('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: SV('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  ics: SV('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 12v6M9 15l3 3 3-3"/>'),
  print: SV('<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>'),
  panel: SV('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>'),
  help: SV('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01"/>'),
  gear: SV('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>')
};
function makeBtn(act, html, cls = '') {
  const b = document.createElement('button');
  b.className = 'ibtn' + (cls ? ' ' + cls : ''); b.innerHTML = html; b.title = tip(act); b.dataset.act = act;
  return b;
}
function buildToolbars() {
  const fill = (id, list) => { const box = $(id); box.innerHTML = ''; list.forEach(([a, i]) => box.append(makeBtn(a, i))); };
  fill('#fileBtns', [['importPlan', ICONS.open], ['exportBackup', ICONS.save], ['undo', ICONS.undo], ['redo', ICONS.redo]]);
  fill('#viewBtns', [['exportIcs', ICONS.ics], ['print', ICONS.print], ['togglePanels', ICONS.panel], ['settings', ICONS.gear], ['shortcuts', ICONS.help]]);
  const tools = $('#tools'); tools.innerHTML = '';
  [['viewToday', 'today'], ['viewWeek', 'week'], ['viewTasks', 'tasks'], ['viewEvents', 'events'], ['viewSubjects', 'subjects']].forEach(([a, i]) => tools.append(makeBtn(a, ICONS[i], 'view')));
  $('#ctxBar').innerHTML = '';
  $$('[data-act="togglePanels"]').forEach(b => b.classList.toggle('active', settings.dock));
  syncDisabled();
}
document.addEventListener('mousedown', e => { if (e.target.closest('.ibtn,.cta')) e.preventDefault(); });
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) run(b.dataset.act); });

/* ================= Modal, settings ================= */
let settingsOpen = false, prefsSection = 'general';
function modal(title, html) {
  $('.modal').classList.remove('wide'); $('#modalFoot').hidden = true; settingsOpen = false;
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').classList.add('show');
}
function closeModal() { $('#modal').classList.remove('show'); settingsOpen = false; }
$('#modalClose').onclick = closeModal;
$('#modal').onmousedown = e => { if (e.target.id === 'modal') closeModal(); };
function openSettings(section) {
  if (section) prefsSection = section;
  $('.modal').classList.add('wide'); $('#modalFoot').hidden = false;
  settingsOpen = true; renderSettings(); $('#modal').classList.add('show');
}
function renderSettings() {
  const opt = (v, label, c) => `<option value="${v}"${String(v) === String(c) ? ' selected' : ''}>${esc(label)}</option>`;
  const sw = (name, label) => `<label class="switch"><input type="checkbox" data-sw="${name}"${settings[name] ? ' checked' : ''}><span></span>${esc(label)}</label>`;
  const mock = th => `<div class="tc-mock" data-theme="${th}"><div class="tc-bar"><i></i><i></i><i></i><b></b></div>
    <div class="tc-body" style="grid-template-columns:14px 1fr 38px"><div class="tc-rail"></div>
    <div class="tc-pv" style="padding:10px 12px"><div class="tc-paper" style="border-radius:3px;border-bottom:var(--paper-border)"><i></i><i style="width:70%"></i><i style="width:50%"></i></div></div><div class="tc-dock"></div></div></div>`;
  const body = {
    general: `<h3>${esc(t('set.language'))}</h3><p class="hint">${esc(t('set.languageHint'))}</p>
      <select class="wide-sel" data-sel="lang">${opt('auto', t('a.langAuto'), settings.lang)}${opt('en', 'English', settings.lang)}${opt('de', 'Deutsch', settings.lang)}</select>
      <h3>${esc(t('set.layout'))}</h3>${sw('dock', t('set.panels'))}${sw('autoHide', t('set.autoHide'))}
      <h3>${esc(t('ui.calendar'))}</h3>${sw('icsTasks', t('set.icsTasks'))}
      <p class="hint">${esc(t('set.icsWeeksHint'))}</p><select class="wide-sel" data-sel="icsWeeks">${[0, 2, 4, 8, 12, 20].map(n => opt(n, n ? t('set.icsWeeksN', {n}) : t('set.icsWeeks0'), settings.icsWeeks || 0)).join('')}</select>`,
    appearance: `<h3>${esc(t('set.theme'))}</h3><div class="theme-grid">` + THEMES.map(th =>
      `<button class="theme-card${settings.theme === th ? ' active' : ''}" data-theme-pick="${th}">${mock(th)}
       <div class="theme-name">${esc(t('theme.' + th))}<span>${settings.theme === th ? '&#10003;' : ''}</span></div></button>`).join('') + '</div>',
    timetable: `<h3>${esc(t('set.days'))}</h3><select class="wide-sel" data-plan="days">${opt(5, t('set.days5'), plan.days)}${opt(6, t('set.days6'), plan.days)}</select>
      <h3>${esc(t('set.periods'))}</h3><p class="hint">${esc(t('set.periodsHint'))}</p>
      <div class="ed-field" style="max-width:360px"><label>${esc(t('set.periodName'))}</label><input class="field-in" data-plan-text="periodName" value="${esc(plan.periodName || '')}" placeholder="${esc(t('ui.period'))}"></div>
      <div class="periods">${plan.periods.map((p, i) => `<b>${i + 1}.</b><input type="time" data-pstart="${i}" value="${esc(p.start)}"><input type="time" data-pend="${i}" value="${esc(p.end)}">`).join('')}</div>
      <p><button class="btn-sm" data-period="add">${esc(t('set.addPeriod'))}</button> <button class="btn-sm" data-period="remove"${plan.periods.length <= 1 ? ' disabled' : ''}>${esc(t('set.removePeriod'))}</button></p>
      <h3>${esc(t('set.dayLength'))}</h3><p class="hint">${esc(t('set.dayLengthHint'))}</p>
      <div class="daylen">${Array.from({length: plan.days}, (_, d) => `<label>${esc(dayName(d))}</label><select data-dayp="${d}">${opt(0, t('set.allPeriods'), (plan.dayPeriods || [])[d] || 0)}${plan.periods.slice(0, -1).map((p, i) => opt(i + 1, t('set.untilPeriod', {n: i + 1, end: p.end}), (plan.dayPeriods || [])[d] || 0)).join('')}</select>`).join('')}</div>
`,
    year: (() => {
      const rows = (kind, list) => list.map(x => `<div class="term-row"><input class="field-in" data-range="${kind}|${x.id}|name" value="${esc(x.name)}"><input type="date" data-range="${kind}|${x.id}|from" value="${esc(x.from)}"><span>–</span><input type="date" data-range="${kind}|${x.id}|to" value="${esc(x.to)}"><button class="btn-sm danger-btn" data-range-del="${kind}|${x.id}">${esc(t('cal.remove'))}</button></div>`).join('');
      const c = plan.weekCycle || {};
      return `<h3>${esc(t('set.terms'))}</h3><p class="hint">${esc(t('set.termsHint'))}</p>${rows('terms', terms())}
        <p><button class="btn-sm" data-range-add="terms">${esc(t('set.addTerm'))}</button></p>
        <h3>${esc(t('set.holidays'))}</h3><p class="hint">${esc(t('set.holidaysHint'))}</p>${rows('holidays', holidays())}
        <p><button class="btn-sm" data-range-add="holidays">${esc(t('set.addHoliday'))}</button></p>
        <h3>${esc(t('set.weekTypes'))}</h3><p class="hint">${esc(t('set.weekTypesHint'))}</p>
        <div class="daylen"><label>${esc(t('set.weekNames'))}</label><input class="field-in" data-cycle="names" value="${esc((c.names || []).join(', '))}" placeholder="A, B">
        ${cycle() ? `<label>${esc(t('set.thisWeekIs'))}</label><select data-cycle="now">${c.names.map(n => `<option value="${esc(n)}"${weekTypeOf(today()) === n ? ' selected' : ''}>${esc(t('tt.weekType', {name: n}))}</option>`).join('')}</select>` : ''}</div>
        ${cycle() ? `<label class="switch"><input type="checkbox" data-cycle="skip"${c.skipHolidays ? ' checked' : ''}><span></span>${esc(t('set.skipHolidayWeeks'))}</label>` : ''}`;
    })(),
    electives: (() => {
      const gs = groups();
      const areaBox = g => { const a = areaOf(g), cats = categoriesOf(g);
        return `<div class="lesson-box"><div class="lb-h">${openSlot(g)}<span class="meta">${esc(t('area.count', {n: plan.subjects.filter(s => (s.group || '').trim() === g).length}))}</span></div>
          <label class="switch"><input type="checkbox" data-area="${esc(g)}|weekly"${weeklyArea(g) ? ' checked' : ''}><span></span>${esc(t('area.weekly'))}</label>
          <div class="daylen"><label>${esc(t('area.deadline'))}</label><input type="time" data-area="${esc(g)}|deadline" value="${esc(a.deadline || '')}">
          <label>${esc(t('area.rule'))}</label><div class="rule"><input type="number" min="0" max="20" data-area="${esc(g)}|min" value="${esc(a.min || '')}" placeholder="0">
            <span>× ${esc(t('area.from'))}</span><input class="field-in" data-area="${esc(g)}|category" list="cat-${esc(g)}" value="${esc(a.category || '')}" placeholder="${esc(t('area.categoryPh'))}"><datalist id="cat-${esc(g)}">${cats.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
            ${cycle() ? `<select data-area="${esc(g)}|ruleWeek"><option value="">${esc(t('tt.everyWeek'))}</option>${cycle().names.map(n => `<option value="${esc(n)}"${a.ruleWeek === n ? ' selected' : ''}>${esc(t('tt.weekType', {name: n}))}</option>`).join('')}</select>` : ''}</div></div></div>`; };
      return `<h3>${esc(t('set.electives'))}</h3><p class="hint">${esc(t('area.intro'))}</p>
        ${gs.length ? gs.map(areaBox).join('') : `<p class="hint">${esc(t('area.none'))}</p>`}
        <h3>${esc(t('area.import'))}</h3><p class="hint">${esc(t('area.importHint'))}</p>
        <div class="ed-field" style="max-width:360px"><label>${esc(t('tt.group'))}</label><input class="field-in" id="catGroup" list="groupList" value="${esc(gs[0] || '')}" placeholder="${esc(t('tt.groupPh'))}">${groupList()}</div>
        <textarea id="catPaste" class="cat-paste" placeholder="${esc(t('area.importPh'))}"></textarea>
        <p><button class="btn-sm primary" data-cat-import>${esc(t('area.importBtn'))}</button></p>`;
    })(),
    calendars: (() => {
      const list = calendars().map(c => {
        const cache = (plan.calCache || {})[c.id] || {};
        const state = cache.error ? `<span style="color:var(--danger)">${esc(t('cal.error', {e: cache.error}))}</span>`
          : cache.at ? esc(t('cal.updated', {n: (cache.events || []).length, when: new Date(cache.at).toLocaleString(effectiveLang() === 'de' ? 'de-DE' : 'en-GB', {dateStyle: 'short', timeStyle: 'short'})})) : esc(t('cal.notYet'));
        return `<div class="row" style="align-items:flex-start"><span class="colors">${CAL_COLORS.map(col => `<button data-cal-color="${c.id}|${col}" class="${col === c.color ? 'on' : ''}" style="background:${col};width:16px;height:16px"></button>`).join('')}</span>
          <span class="grow" style="white-space:normal"><b>${esc(c.name || t('cal.unnamed'))}</b><br><span class="meta">${state}</span></span>
          <label class="switch" style="margin:0"><input type="checkbox" data-cal-on="${c.id}"${c.off ? '' : ' checked'}><span></span></label>
          <button class="btn-sm danger-btn" data-cal-del="${c.id}">${esc(t('cal.remove'))}</button></div>`;
      }).join('');
      return `<h3>${esc(t('set.calendars'))}</h3><p class="hint">${esc(t('cal.hint'))}</p>${list || `<p class="hint">${esc(t('cal.none'))}</p>`}
        <h3>${esc(t('cal.add'))}</h3>
        <div class="ed-field"><input class="field-in" id="calUrl" placeholder="${esc(t('cal.urlPh'))}" style="width:100%;max-width:520px"></div>
        <div class="ed-field"><input class="field-in" id="calName" placeholder="${esc(t('cal.namePh'))}" style="width:100%;max-width:520px"></div>
        <p><button class="btn-sm primary" data-cal-add>${esc(t('cal.add'))}</button> ${calendars().length ? `<button class="btn-sm" data-act="refreshCalendars">${esc(t('a.refreshCalendars'))}</button>` : ''}</p>
        <h3>${esc(t('cal.howTitle'))}</h3><p class="hint"><b>Google:</b> ${esc(t('cal.howGoogle'))}</p><p class="hint"><b>Apple / iCloud:</b> ${esc(t('cal.howApple'))}</p>
        <p class="hint"><b>Outlook:</b> ${esc(t('cal.howOutlook'))}</p><p class="hint">${esc(t('cal.secret'))}</p>`;
    })(),
    keys: '<div id="keysBox"></div>'
  };
  const sections = ['general', 'appearance', 'timetable', 'year', 'electives', 'calendars', 'keys'];
  $('#modalTitle').textContent = t('set.title');
  $('#modalBody').innerHTML = `<div class="prefs"><nav>${sections.map(k =>
    `<button data-sec="${k}" class="${k === prefsSection ? 'active' : ''}">${esc(t('set.' + k))}</button>`).join('')}</nav><section>${body[prefsSection]}</section></div>`;
  if (prefsSection === 'keys') Shortcuts.editor($('#keysBox'), {MENUS, keys: settings.keys || {}, t, fmtKey, comboOf, label: a => t('a.' + a),
    onChange: keys => { settings.keys = keys; applySettings(); }});
  $('#modalFoot').innerHTML = `<button class="btn-sm" data-pref="reset">${esc(t('set.reset'))}</button><span class="flex"></span>
    <button class="btn-sm primary" data-pref="done">${esc(t('set.done'))}</button>`;
}
$('#modal').addEventListener('click', e => {
  if (!settingsOpen) return;
  const ra = e.target.closest('[data-range-add]');
  if (ra) {
    const kind = ra.dataset.rangeAdd, list = plan[kind] || [], last = list[list.length - 1];
    const from = last && validIso(last.to) ? addDays(last.to, 1) : today();
    change(() => { plan[kind] = [...list, {id: uid(), name: t(kind === 'terms' ? 'set.termN' : 'set.holidayN', {n: list.length + 1}), from, to: addDays(from, kind === 'terms' ? 69 : 13)}]; });
    renderSettings(); return;
  }
  const rd = e.target.closest('[data-range-del]');
  if (rd) {
    const [kind, id] = rd.dataset.rangeDel.split('|');
    change(() => { plan[kind] = (plan[kind] || []).filter(x => x.id !== id); if (kind === 'terms') plan.lessons.forEach(l => { if (l.terms) l.terms = l.terms.filter(y => y !== id); }); });
    renderSettings(); return;
  }
  if (e.target.closest('[data-cat-import]')) {
    const g = ($('#catGroup').value || '').trim(), n = importCatalog(g, $('#catPaste').value);
    if (!g) return toast(t('area.needGroup'));
    toast(t('area.imported', {n, area: g})); renderSettings(); return;
  }
  const cal = e.target.closest('[data-cal-add],[data-cal-del],[data-cal-color]');
  if (cal) return calendarClick(cal);
  const x = e.target.closest('[data-sec],[data-theme-pick],[data-pref],[data-period]'); if (!x) return;
  if (x.dataset.sec) prefsSection = x.dataset.sec;
  else if (x.dataset.themePick) settings.theme = x.dataset.themePick;
  else if (x.dataset.period === 'add') {
    const last = plan.periods[plan.periods.length - 1], s = minutesOf(last.end) + 5, f = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
    change(() => plan.periods.push({start: f(s), end: f(s + 45)}));
  } else if (x.dataset.period === 'remove') {
    const n = plan.periods.length - 1;
    change(() => { plan.periods.pop(); plan.lessons = plan.lessons.filter(l => l.period < n); });
  }
  else if (x.dataset.pref === 'done') return closeModal();
  else if (x.dataset.pref === 'reset') { settings = {...DEF, view: settings.view}; toast(t('set.resetDone')); }
  applySettings(); renderSettings();
});
$('#modal').addEventListener('change', e => {
  const d = e.target.dataset;
  if (d.sel) { settings[d.sel] = d.sel === 'icsWeeks' ? +e.target.value : e.target.value; applySettings(); renderSettings(); }
  if (d.sw) { settings[d.sw] = e.target.checked; applySettings(); }
  if (d.calOn) { const c = calendars().find(x => x.id === d.calOn); change(() => { c.off = !e.target.checked; }); renderSettings(); return; }
  if (d.dayp != null) { const day = +d.dayp, n = +e.target.value; change(() => { plan.dayPeriods = Array.from({length: 7}, (_, i) => i === day ? n : (plan.dayPeriods || [])[i] || 0); }); return; }
  if (d.range) {
    const [kind, id, k] = d.range.split('|'), x = (plan[kind] || []).find(y => y.id === id), v = e.target.value.trim();
    if (x && (k === 'name' ? v : validIso(v))) change(() => { x[k] = v; if (x.from > x.to) x[k === 'from' ? 'to' : 'from'] = v; });
    renderSettings(); return;
  }
  if (d.planText) { change(() => { plan[d.planText] = e.target.value.trim(); }); return; }
  if (d.cycle) {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
    change(() => {
      const c = plan.weekCycle = plan.weekCycle || {};
      if (d.cycle === 'names') {
        c.names = [...new Set(v.split(/[,;/]/).map(x => x.trim()).filter(Boolean))].slice(0, 6);
        if (!validIso(c.anchor)) { c.anchor = mondayOf(today()); c.start = 0; }
      } else if (d.cycle === 'skip') c.skipHolidays = v;
      else if (d.cycle === 'now') { c.anchor = mondayOf(today()); c.start = Math.max(0, c.names.indexOf(v)); }
    });
    renderSettings(); return;
  }
  if (d.area) {
    const i = d.area.lastIndexOf('|'), g = d.area.slice(0, i), k = d.area.slice(i + 1);
    const v = e.target.type === 'checkbox' ? e.target.checked : k === 'min' ? Math.max(0, Math.round(+e.target.value) || 0) : e.target.value.trim();
    change(() => { plan.areas = {...(plan.areas || {}), [g]: {...areaOf(g), [k]: v}}; });
    return;
  }
  if (d.plan === 'days') { const n = +e.target.value; change(() => { plan.days = n; plan.lessons = plan.lessons.filter(l => l.day < n); }); renderSettings(); }
  if (d.pstart != null) { const i = +d.pstart; change(() => { plan.periods[i].start = e.target.value; }); }
  if (d.pend != null) { const i = +d.pend; change(() => { plan.periods[i].end = e.target.value; }); }
});
/* A pasted catalog: one offer per line — "name; category; room; teacher; week" (tabs from a spreadsheet work too).
   An offer with the same name, category and week is updated instead of added twice. */
function importCatalog(group, text) {
  if (!group) return 0;
  const rows = String(text || '').split(/\r?\n/).map(r => r.split(r.includes('\t') ? '\t' : ';').map(x => x.trim())).filter(r => r[0]);
  if (!rows.length) return 0;
  change(() => {
    for (const [name, category = '', room = '', teacher = '', week = ''] of rows) {
      const weekType = cycle() && cycle().names.includes(week) ? week : '';
      const old = plan.subjects.find(s => (s.group || '').trim() === group && s.name === name && (s.category || '') === category && (s.weekType || '') === weekType);
      if (old) { Object.assign(old, {room: room || old.room, teacher: teacher || old.teacher}); continue; }
      const cats = categoriesOf(group), k = cats.includes(category) ? cats.indexOf(category) : cats.length;
      plan.subjects.push({id: uid(), name, short: name.slice(0, 3), color: COLORS[(k * 3 + 1) % COLORS.length], teacher, room, group, category, weekType});
    }
  });
  return rows.length;
}
async function calendarClick(el) {
  if (el.dataset.calAdd != null) {
    const url = $('#calUrl').value.trim(), name = $('#calName').value.trim();
    if (!/^(https?|webcals?):\/\//i.test(url)) return toast(t('cal.badUrl'));
    if (!invoke) return toast(t('cal.appOnly'));
    if (calendars().some(c => c.url === url)) return toast(t('cal.already'));
    el.disabled = true; el.textContent = t('cal.adding');
    try {
      const r = await invoke('calendar_fetch', {url, from: addDays(today(), -7), to: addDays(today(), 180)});
      const c = {id: uid(), name: name || r.name || '', url, color: CAL_COLORS[calendars().length % CAL_COLORS.length]};
      change(() => { plan.calendars = [...calendars(), c]; plan.calCache = {...(plan.calCache || {}), [c.id]: {at: Date.now(), events: r.events, error: ''}}; });
      toast(t('cal.added', {name: c.name || t('cal.unnamed'), n: r.events.length}));
    } catch (e) {
      toast(t('cal.error', {e}));
      renderSettings(); $('#calUrl').value = url; $('#calName').value = name;
      return;
    }
    renderSettings();
    return;
  }
  if (el.dataset.calDel) { const id = el.dataset.calDel; change(() => { plan.calendars = calendars().filter(c => c.id !== id); if (plan.calCache) delete plan.calCache[id]; }); }
  if (el.dataset.calColor) { const [id, col] = el.dataset.calColor.split('|'); const c = calendars().find(x => x.id === id); change(() => { c.color = col; }); }
  renderSettings();
}
function setLang(l) { settings.lang = l; applySettings(); }
function setTheme(th) { settings.theme = th; applySettings(); }
function applyLanguage() {
  document.documentElement.lang = lang;
  $$('[data-i18n]').forEach(n => n.textContent = t(n.dataset.i18n));
  buildMenubar(); buildToolbars();
  if (booted) renderAll();
}
let appliedKeys = null;
function applySettings() {
  if (window.AutoHide) AutoHide.set(settings.autoHide);
  if (!THEMES.includes(settings.theme)) settings.theme = 'dark';
  if (window.Shared) Shared.push({theme: settings.theme, lang: settings.lang});
  document.documentElement.dataset.theme = settings.theme;
  if (JSON.stringify(settings.keys || {}) !== appliedKeys) { appliedKeys = JSON.stringify(settings.keys || {}); Shortcuts.apply(MENUS, settings.keys || {}); buildKeymap(); buildToolbars(); }
  const nl = effectiveLang();
  if (nl !== lang) { lang = nl; applyLanguage(); }
  $('#dock').classList.toggle('hidden', !settings.dock);
  $$('[data-act="togglePanels"]').forEach(b => b.classList.toggle('active', settings.dock));
  $$('#dockTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === settings.dockTab));
  $$('.dpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === settings.dockTab));
  if (booted) { renderDetails(); renderWeekAhead(); updateStatus(); }
  saveSettings();
}
$$('#dockTabs button').forEach(b => b.onclick = () => { settings.dockTab = b.dataset.tab; applySettings(); });

/* ================= Keyboard ================= */
function comboOf(e) {
  let k = e.key;
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Backslash' || e.code === 'IntlBackslash') k = '\\';
  else if (k.length === 1) k = k.toUpperCase();
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + k;
}
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
window.addEventListener('keydown', e => {
  if (window.Shortcuts && Shortcuts.recording) return;
  if (e.key === 'Escape') {
    if ($('#modal').classList.contains('show')) closeModal();
    else if (menuOpen) closeMenus();
    else if (sel) { sel = null; renderAll(); }
    return;
  }
  if (e.ctrlKey && e.altKey) return;
  const combo = comboOf(e);
  if (typing() && ['Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Delete', 'Backspace', 'Ctrl+A'].includes(combo)) return;
  if ($('#modal').classList.contains('show')) return;
  const act = KEYMAP[combo];
  if (act) { e.preventDefault(); e.stopPropagation(); run(act); return; }
  if (typing()) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSel(); }
  else if (settings.view === 'week' && /^Arrow/.test(e.key)) { e.preventDefault(); moveCell(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0); }
}, true);

/* Native right-click menus (native.js) */
{
  const item = act => ({id: act, label: t('a.' + act), accel: keyOf(act) || null, enabled: allowed(act)});
  Native.setProvider(e => {
    const row = e.target.closest('[data-task],[data-event],[data-subject],td.c');
    if (row) {
      row.click();
      return [item('deleteSel')];
    }
    if (e.target.closest('#view')) return [item('newTask'), item('newEvent'), null, item('print')];
    return null;
  });
  Native.setHandler(id => run(id));
}

/* Test hook (like Md's __md / Dt's __dt). */
window.__pl = {get plan() { return plan; }, get sel() { return sel; }, A, run, nextLesson, setView, change};

/* ================= Boot ================= */
(async function boot() {
  await loadTexts();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) {}
  if (saved && saved.settings) settings = {...DEF, ...saved.settings};
  // Theme and language shared by all Studio apps (shared.js); the shared values win over this app's own.
  if (window.Shared) await Shared.init({apply: sh => {
    if (sh.theme) settings.theme = sh.theme;
    if (sh.lang) settings.lang = sh.lang;
    if (booted) applySettings();
  }});
  lang = effectiveLang();
  applyLanguage();
  try {
    const text = invoke ? await invoke('plan_load') : saved && saved.plan ? JSON.stringify(saved.plan) : null;
    const p = text ? JSON.parse(text) : null;
    plan = validPlan(p) ? p : newPlan();
    if (!validPlan(p)) { persist(); }
  } catch (e) { plan = newPlan(); toast(t('toast.loadFail', {e})); }
  booted = true;
  applySettings();
  renderAll();
  // The date changes at midnight; the current period every few minutes.
  setInterval(() => { if (!typing()) { renderView(); updateStatus(); } }, 60000);
  refreshCalendars();
  setInterval(() => refreshCalendars(), 30 * 60000);
  if (invoke) {
    // A .plan file opened with the app ("Open with") is offered for import.
    invoke('initial_files').then(list => list[0] && importPlan(list[0])).catch(() => {});
    window.__TAURI__.event.listen('open-files', e => e.payload[0] && importPlan(e.payload[0]));
  }
})();
