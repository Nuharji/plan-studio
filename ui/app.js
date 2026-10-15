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
const EVENT_TYPES = ['exam', 'test', 'talk', 'deadline', 'other'];
function newPlan(l = lang) {
  return {version: 1, days: 5, periods: DEFAULT_PERIODS.slice(0, 8),
    subjects: DEFAULT_SUBJECTS[l === 'de' ? 'de' : 'en'].map(([name, short], i) => ({id: uid(), name, short, color: COLORS[i % COLORS.length], teacher: '', room: ''})),
    lessons: [], tasks: [], events: []};
}
const validPlan = p => !!p && Array.isArray(p.subjects) && Array.isArray(p.lessons) && Array.isArray(p.tasks) && Array.isArray(p.events) && Array.isArray(p.periods);
let plan = null;
const subj = id => plan.subjects.find(s => s.id === id);
const lessonAt = (day, period) => plan.lessons.find(l => l.day === day && l.period === period);
/* The next school day (after `from`) with a lesson in this subject — the natural due date for homework. */
function nextLesson(subjectId, from = today()) {
  if (!subjectId) return addDays(from, 1);
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i), w = weekday(d);
    if (w < plan.days && plan.lessons.some(l => l.day === w && l.subject === subjectId)) return d;
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
const DEF = {keys: {}, autoHide: false, lang: 'auto', theme: 'dark', dock: true, dockTab: 'details', view: 'today', showDone: false, icsTasks: true};
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
function undo() { if (!hist.back.length) return; hist.fwd.push(JSON.stringify(plan)); plan = JSON.parse(hist.back.pop()); fixSel(); persist(); renderAll(); }
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
    const lessons = w < plan.days ? plan.periods.map((p, i) => [i, p, lessonAt(w, i)]).filter(([, , l]) => l) : [];
    const open = plan.tasks.filter(x => !x.done);
    const overdue = open.filter(x => validIso(x.due) && x.due < d), soon = open.filter(x => validIso(x.due) && x.due >= d && dayDiff(d, x.due) <= 7);
    const nextEvents = plan.events.filter(e => validIso(e.date) && e.date >= d && dayDiff(d, e.date) <= 30).sort((a, b) => a.date.localeCompare(b.date));
    const byDue = (a, b) => (a.due || '').localeCompare(b.due || '');
    return `<div class="view-title"><h1>${esc(fmtDate(d, {weekday: 'long', day: 'numeric', month: 'long'}))}</h1><span class="sub">${esc(t('ui.todayHint'))}</span></div>
      <div class="cards">
        <div class="pcard"><h2>${esc(t('ui.lessonsToday'))}<button class="btn-sm" data-act="viewWeek">${esc(t('a.viewWeek'))}</button></h2>
          ${lessons.length ? lessons.map(([i, p, l]) => `<div class="row${i === now ? ' now' : ''}"><span class="lesson-no">${i + 1}</span><span class="lesson-time">${esc(p.start)}–${esc(p.end)}</span>
            ${chip(subj(l.subject))}<span class="grow meta">${esc(l.room || (subj(l.subject) || {}).room || '')}</span></div>`).join('')
            : `<div class="empty-s">${esc(w >= plan.days ? t('ui.noSchool') : plan.lessons.length ? t('ui.noLessons') : t('ui.setupTimetable'))}</div>`}</div>
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
    const d = today(), w = weekday(d), now = currentPeriod();
    let h = `<div class="view-title"><h1>${esc(t('a.viewWeek'))}</h1><span class="sub">${esc(t('ui.weekHint'))}</span></div>
      <table class="tt"><tr><th></th>${Array.from({length: plan.days}, (_, i) => `<th class="${i === w ? 'today' : ''}">${esc(dayName(i))}</th>`).join('')}</tr>`;
    plan.periods.forEach((p, i) => {
      h += `<tr><td class="p"><b>${i + 1}.</b>${esc(p.start)}–${esc(p.end)}</td>`;
      for (let day = 0; day < plan.days; day++) {
        const l = lessonAt(day, i), s = l && subj(l.subject), isSel = sel && sel.kind === 'cell' && sel.day === day && sel.period === i;
        const style = s ? ` style="background:${s.color}22;border-color:${s.color}88;color:var(--strong)"` : '';
        h += `<td class="c${s ? ' full' : ''}${isSel ? ' sel' : ''}${day === w && i === now ? ' now' : ''}" data-day="${day}" data-period="${i}"${style}>
          ${s ? `<span class="n" style="color:${s.color}">${esc(s.name)}</span><span class="r">${esc(l.room || s.room || '')}</span>` : ''}</td>`;
      }
      h += '</tr>';
      // A longer pause before the next period shows as a gap.
      const next = plan.periods[i + 1];
      if (next && minutesOf(next.start) - minutesOf(p.end) >= 15) h += `<tr class="brk"><td colspan="${plan.days + 1}"></td></tr>`;
    });
    return h + '</table>';
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
      ${plan.subjects.map(s => `<div class="row${sel && sel.kind === 'subject' && sel.id === s.id ? ' sel' : ''}" data-subject="${s.id}">
        ${chip(s)}<span class="grow meta">${esc([s.teacher, s.room].filter(Boolean).join(' · '))}</span>
        <span class="meta">${esc(t('ui.lessonsPerWeek', {n: plan.lessons.filter(l => l.subject === s.id).length}))}</span></div>`).join('')}`;
  }
};
const subjectOptions = cur => `<option value="">${esc(t('ui.noSubject'))}</option>` + plan.subjects.map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}</option>`).join('');

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
    const l = lessonAt(sel.day, sel.period), p = plan.periods[sel.period];
    box.innerHTML = `<div class="sect">${esc(dayName(sel.day))} · ${sel.period + 1}. ${esc(t('ui.period'))} (${esc(p.start)}–${esc(p.end)})</div>
      <div class="palette">${plan.subjects.map(s => `<button data-assign="${s.id}" class="${l && l.subject === s.id ? 'on' : ''}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}</div>
      ${l ? `<div class="sect">${esc(t('ui.room'))}</div><input class="field-in" data-lesson-room value="${esc(l.room || '')}" placeholder="${esc((subj(l.subject) || {}).room || '')}" style="width:100%">
        <p><button class="btn-sm danger-btn" data-act="deleteSel">${esc(t('ui.clearCell'))}</button></p>` : `<p class="hint" style="color:var(--dim)">${esc(t('ui.cellHint'))}</p>`}`;
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
      ${field('ui.notes', `<textarea data-f="notes" placeholder="${esc(t('ui.eventNotesPh'))}">${esc(e.notes || '')}</textarea>`)}
      <p><button class="btn-sm danger-btn" data-act="deleteSel">${esc(t('a.delete'))}</button></p>`;
  } else if (sel.kind === 'subject') {
    const s = subj(sel.id); if (!s) return;
    box.innerHTML = `<div class="sect">${esc(t('ui.subject'))}</div>
      ${field('ui.name', `<input class="field-in" data-f="name" value="${esc(s.name)}">`)}
      ${field('ui.short', `<input class="field-in" data-f="short" value="${esc(s.short || '')}" maxlength="5">`)}
      ${field('ui.color', `<div class="colors">${COLORS.map(c => `<button data-color="${c}" class="${c === s.color ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`)}
      ${field('ui.teacher', `<input class="field-in" data-f="teacher" value="${esc(s.teacher || '')}">`)}
      ${field('ui.roomDefault', `<input class="field-in" data-f="room" value="${esc(s.room || '')}">`)}
      <p><button class="btn-sm danger-btn" data-act="deleteSel">${esc(t('a.delete'))}</button></p>`;
  }
}
/* The coming seven days at a glance. */
function renderWeekAhead() {
  const d = today();
  $('#weekAhead').innerHTML = Array.from({length: 7}, (_, i) => {
    const day = addDays(d, i), w = weekday(day);
    const tasks = plan.tasks.filter(x => !x.done && x.due === day), events = plan.events.filter(e => e.date === day), cal = calEventsOn(day);
    const n = w < plan.days ? plan.lessons.filter(l => l.day === w).length : 0;
    return `<div class="sect">${esc(i === 0 ? t('d.today') : i === 1 ? t('d.tomorrow') : fmtDate(day, {weekday: 'long', day: 'numeric', month: 'short'}))}
      <span style="float:right;text-transform:none;letter-spacing:0;font-weight:400">${n ? esc(t(n === 1 ? 'ui.nLesson' : 'ui.nLessons', {n})) : ''}</span></div>
      ${events.map(e => eventRow(e, false)).join('')}${tasks.map(taskRow).join('')}${cal.map(calRow).join('')}${!events.length && !tasks.length && !cal.length ? `<div class="empty-s">—</div>` : ''}`;
  }).join('');
}
function updateStatus() {
  if (!plan) return;
  const open = plan.tasks.filter(x => !x.done).length, d = today();
  const next = plan.events.filter(e => validIso(e.date) && e.date >= d).sort((a, b) => a.date.localeCompare(b.date))[0];
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
function renderAll() { if (!plan) return; renderView(); renderDetails(); renderWeekAhead(); updateStatus(); }

/* ================= Interaction ================= */
const view = $('#view');
view.addEventListener('click', e => {
  const done = e.target.closest('[data-done]');
  if (done) { const x = plan.tasks.find(y => y.id === done.dataset.done); change(() => { x.done = done.checked; }); return; }
  if (e.target.id === 'showDone') { settings.showDone = e.target.checked; saveSettings(); renderView(); return; }
  if (e.target.id === 'qAdd') return quickAdd();
  const cell = e.target.closest('td.c');
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
  if (e.target.matches('[data-lesson-room]')) { const l = lessonAt(sel.day, sel.period); if (l) change(() => { l.room = e.target.value.trim(); }); return; }
  if (!f || !sel) return;
  const obj = sel.kind === 'task' ? plan.tasks.find(x => x.id === sel.id) : sel.kind === 'event' ? plan.events.find(x => x.id === sel.id) : subj(sel.id);
  if (!obj) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  change(() => { obj[f] = typeof v === 'string' && f !== 'notes' ? v.trim() : v; });
});
$('#details').addEventListener('click', e => {
  const a = e.target.closest('[data-assign]');
  if (a) {
    const {day, period} = sel, l = lessonAt(day, period);
    change(() => {
      if (l && l.subject === a.dataset.assign) plan.lessons = plan.lessons.filter(x => x !== l);   // clicking the same subject again clears it
      else if (l) l.subject = a.dataset.assign;
      else plan.lessons.push({id: uid(), day, period, subject: a.dataset.assign, room: ''});
    });
    return;
  }
  const c = e.target.closest('[data-color]');
  if (c && sel && sel.kind === 'subject') { const s = subj(sel.id); change(() => { s.color = c.dataset.color; }); return; }
  if (e.target.closest('[data-next-lesson]')) { const x = plan.tasks.find(y => y.id === sel.id); change(() => { x.due = nextLesson(x.subject); }); }
});
function deleteSel() {
  if (!sel) return;
  if (sel.kind === 'cell') { const l = lessonAt(sel.day, sel.period); if (l) change(() => { plan.lessons = plan.lessons.filter(x => x !== l); }); return; }
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
  else sel = {kind: 'cell', day: clamp(sel.day + dx, 0, plan.days - 1), period: clamp(sel.period + dy, 0, plan.periods.length - 1)};
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
async function exportIcs() {
  if (!invoke) return toast(t('toast.appOnly'));
  const ics = await invoke('plan_ics', {plan, lang, tasks: !!settings.icsTasks});
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
      <h3>${esc(t('ui.calendar'))}</h3>${sw('icsTasks', t('set.icsTasks'))}`,
    appearance: `<h3>${esc(t('set.theme'))}</h3><div class="theme-grid">` + THEMES.map(th =>
      `<button class="theme-card${settings.theme === th ? ' active' : ''}" data-theme-pick="${th}">${mock(th)}
       <div class="theme-name">${esc(t('theme.' + th))}<span>${settings.theme === th ? '&#10003;' : ''}</span></div></button>`).join('') + '</div>',
    timetable: `<h3>${esc(t('set.days'))}</h3><select class="wide-sel" data-plan="days">${opt(5, t('set.days5'), plan.days)}${opt(6, t('set.days6'), plan.days)}</select>
      <h3>${esc(t('set.periods'))}</h3><p class="hint">${esc(t('set.periodsHint'))}</p>
      <div class="periods">${plan.periods.map((p, i) => `<b>${i + 1}.</b><input type="time" data-pstart="${i}" value="${esc(p.start)}"><input type="time" data-pend="${i}" value="${esc(p.end)}">`).join('')}</div>
      <p><button class="btn-sm" data-period="add">${esc(t('set.addPeriod'))}</button> <button class="btn-sm" data-period="remove"${plan.periods.length <= 1 ? ' disabled' : ''}>${esc(t('set.removePeriod'))}</button></p>`,
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
  const sections = ['general', 'appearance', 'timetable', 'calendars', 'keys'];
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
  if (d.sel) { settings[d.sel] = e.target.value; applySettings(); renderSettings(); }
  if (d.sw) { settings[d.sw] = e.target.checked; applySettings(); }
  if (d.calOn) { const c = calendars().find(x => x.id === d.calOn); change(() => { c.off = !e.target.checked; }); renderSettings(); return; }
  if (d.plan === 'days') { const n = +e.target.value; change(() => { plan.days = n; plan.lessons = plan.lessons.filter(l => l.day < n); }); }
  if (d.pstart != null) { const i = +d.pstart; change(() => { plan.periods[i].start = e.target.value; }); }
  if (d.pend != null) { const i = +d.pend; change(() => { plan.periods[i].end = e.target.value; }); }
});
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
