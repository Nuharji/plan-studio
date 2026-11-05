/* Plan Studio's own AI for school (Rust: ai.rs). Claude — with the person's own Claude sign-in — only reads (the school
   folder, the file asked about) and has no internet; its answer is taken over here: homework and dates in your own
   words, a study plan, flashcards for a deck, and the file tools (study sheet, quiz, flashcards, summary, explain).
   Before, these went through Agent Studio; now Plan Studio does them itself and Agent Studio is for building apps.
   Loaded before app.js: everything here uses app.js's globals only when it is called. */
'use strict';
const AI = (() => {
  let info = {path: null, version: '', loggedIn: false, who: '', checked: false};
  const jobs = {};        // id → {kind, title, started, resolve}
  let results = [];       // the last answers: {id, kind, title, text, data, ok, at, taken, file}
  let loginBusy = false;
  const ready = () => typeof invoke === 'function' && invoke;
  const own = () => settings.aiClaude || '';

  async function check() {
    if (!ready()) return;
    info = {...await invoke('ai_status', {own: own()}).catch(() => ({path: null, loggedIn: false})), checked: true};
    if (booted && settings.view === 'today' && !typing()) renderView();
    if (settingsOpen && prefsSection === 'ai') renderSettings();
  }
  /* Asks Claude; resolves with {ok, text}. `files` are read by Claude (their folders are allowed). */
  function ask({kind, title, prompt, dir = '', files = []}) {
    if (!ready()) { toast(t('ai.appOnly')); return Promise.resolve({ok: false, text: t('ai.appOnly')}); }
    if (info.checked && !info.path) { toast(t('ai.notFound')); openSettings('ai'); return Promise.resolve({ok: false, text: t('ai.notFound')}); }
    const id = uid();
    return new Promise(resolve => {
      jobs[id] = {kind, title, started: Date.now(), resolve};
      invoke('ai_ask', {id, prompt, dir, files, own: own(), model: settings.aiModel || '', lang}).catch(e => done({id, ok: false, text: String(e)}));
      redraw();
    });
  }
  function done(p) {
    const j = jobs[p.id]; if (!j) return;
    delete jobs[p.id];
    j.resolve({ok: !!p.ok, text: p.text || '', stopped: !!p.stopped});
    redraw();
  }
  function stop(id) { if (jobs[id]) { invoke('ai_stop', {id}).catch(() => {}); done({id, ok: false, stopped: true}); } }
  const redraw = () => { if (booted && !typing()) { if (settings.view === 'today' || settings.view === 'files') renderView(); renderDetails(); } };
  const running = kind => Object.values(jobs).some(j => !kind || j.kind === kind);

  /* The JSON in an answer: a ```json block, else the first {...}. */
  function jsonOf(text) {
    const s = String(text || ''), m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(s);
    const raw = m ? m[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  /* A result for the Today card (kept for this session). */
  function keep(r) { results = [r, ...results.filter(x => x.id !== r.id)].slice(0, 6); redraw(); return r; }
  function fail(res, title) { if (res.stopped) return toast(t('ai.stopped')); keep({id: uid(), kind: 'error', title, text: res.text || t('ai.failed'), ok: false, at: Date.now()}); toast(t('ai.failed')); }

  /* ---- Homework and dates in your own words ---- */
  async function entries(text) {
    const res = await ask({kind: 'entries', title: text.slice(0, 60), prompt: t('ai.entriesTask', {text}) + '\n' + agentContext() + '\n' + t('ai.formatJson', {f: ENTRY_FORMAT})});
    if (!res.ok) return fail(res, text.slice(0, 60));
    const x = agentEntries({data: jsonOf(res.text)});
    if (!x) return keep({id: uid(), kind: 'note', title: text.slice(0, 60), text: res.text, ok: true, at: Date.now()});
    keep({id: uid(), kind: 'entries', title: text.slice(0, 60), text: '', data: x, ok: true, at: Date.now()});
  }
  const ENTRY_FORMAT = '{"tasks": [{"title": "…", "subject": "…", "due": "YYYY-MM-DD"}], "events": [{"type": "exam|test|talk|deadline|other", "title": "…", "subject": "…", "date": "YYYY-MM-DD", "time": "HH:MM"}]}';
  function take(id) {
    const r = results.find(x => x.id === id); if (!r || r.taken) return;
    if (r.kind === 'entries') { change(() => { plan.tasks.push(...r.data.tasks); plan.events.push(...r.data.events); }); toast(t('agent.added', {n: r.data.tasks.length + r.data.events.length})); }
    if (r.kind === 'cards') agentTakeCards({data: r.data, title: r.title});
    r.taken = true; redraw();
  }

  /* ---- A study plan for the next exams (with topics from the school folder) ---- */
  async function studyPlan() {
    const d = today(), exams = plan.events.filter(e => STUDY_TYPES.includes(e.type) && validIso(e.date) && e.date >= d && dayDiff(d, e.date) <= 42).sort((a, b) => a.date.localeCompare(b.date));
    if (!exams.length) { toast(t('agent.noExams')); return; }
    const list = exams.map(e => `- ${e.date} · ${t('type.' + e.type)} · ${(subj(e.subject) || {}).name || ''}${e.title ? ' · ' + e.title : ''}${e.notes ? ' (' + e.notes.slice(0, 200) + ')' : ''}`).join('\n');
    const root = Files.root();
    const res = await ask({kind: 'study', title: t('agent.studyTitle'), dir: root, prompt: t('agent.studyTask', {list, mins: studyCfg().perDay || 60}) + '\n' + agentContext() + (root ? '\n' + t('agent.studyWork') : '')});
    if (!res.ok) return fail(res, t('agent.studyTitle'));
    keep({id: uid(), kind: 'note', title: t('agent.studyTitle'), text: res.text, ok: true, at: Date.now()});
    show(t('agent.studyTitle'), res.text);
  }

  /* ---- Flashcards for a deck ---- */
  async function deckCards(k) {
    const ev = eventOf(k.event), s = subj(k.subject), root = Files.root();
    const about = [k.name, s ? s.name : '', ev ? [ev.title, (ev.topics || []).map(x => x.text).join(', '), (ev.notes || '').slice(0, 400)].filter(Boolean).join(' · ') : ''].filter(Boolean).join(' — ');
    const task = t(k.kind === 'vocab' ? 'learn.agentVocab' : 'learn.agentTask', {about, a: k.a || t('learn.langA'), b: k.b || t('learn.langB'), have: k.cards.slice(0, 60).map(c => c.front).join('; ') || '—'})
      + (root ? '\n' + t('learn.agentWork') : '') + '\n' + t('ai.formatJson', {f: `{"deck": "${k.id}", "cards": [{"front": "…", "back": "…"}]}`});
    toast(t('ai.working'));
    const res = await ask({kind: 'cards', title: t('learn.agentTitle', {name: k.name}), dir: root, prompt: task});
    if (!res.ok) return fail(res, k.name);
    const x = agentCardList({data: jsonOf(res.text)});
    if (!x) return fail({text: t('ai.noCards')}, k.name);
    x.deck = k.id;
    const n = addCards(k.id, x.cards);
    toast(t('learn.imported', {n, skip: x.cards.length - n}));
    openDeck(k.id);
  }

  /* ---- Tools for a file of the school folder (Files) ---- */
  const FILE_TOOLS = ['sheet', 'quiz', 'cards', 'summary', 'explain'];
  async function fileTool(kind, f, extra = '') {
    const isDir = f.isDir, name = f.name.replace(/\.[^.]+$/, ''), subject = Files.subjectOf(f);
    const what = isDir ? t('ai.theFolder', {p: f.path}) : t('ai.theFile', {p: f.path});
    const sname = subject ? subject.name : '';
    const prompt = t('ai.tool.' + kind + '.task', {what, subject: sname || '—'}) + (extra ? '\n' + extra : '')
      + (kind === 'cards' ? '\n' + t('ai.formatJson', {f: '{"cards": [{"front": "…", "back": "…"}]}'}) : '');
    const title = t('ai.tool.' + kind) + ': ' + f.name;
    const dir = isDir ? f.path : f.path.replace(/[\\/][^\\/]*$/, '');
    const res = await ask({kind: 'file:' + kind, title, dir, files: isDir ? [] : [f.path], prompt});
    if (!res.ok) return fail(res, title);
    if (kind === 'cards') {
      const x = agentCardList({data: jsonOf(res.text)});
      if (!x) return fail({text: t('ai.noCards')}, title);
      const k = newDeck({name: name.slice(0, 80), subject: subject ? subject.id : ''});
      const n = addCards(k.id, x.cards);
      toast(t('learn.imported', {n, skip: x.cards.length - n}));
      return openDeck(k.id);
    }
    if (kind === 'sheet' || kind === 'quiz') {
      const file = `${name} – ${t('ai.tool.' + kind + '.file')}.md`;
      try {
        const p = await invoke('files_write', {root: Files.root(), dir, name: file, text: res.text.trim() + '\n'});
        keep({id: uid(), kind: 'file', title, text: res.text, ok: true, at: Date.now(), file: p});
        toast(t('ai.saved', {name: p.split(/[\\/]/).pop()}));
        Files.reload(p);
      } catch (e) { toast(String(e)); show(title, res.text); }
      return;
    }
    keep({id: uid(), kind: 'note', title, text: res.text, ok: true, at: Date.now(), dir});
    show(title, res.text, dir);
  }

  /* An answer in a dialog, with copy and "save as file". */
  let shown = null;
  function show(title, text, dir) {
    shown = {title, text, dir: dir || Files.root()};
    modal(title, `<div class="ai-answer">${mdLite(text)}</div>`);
    $('#modalFoot').hidden = false;
    $('#modalFoot').innerHTML = `<span class="flex"></span><button class="btn-sm" data-ai-copy>${esc(t('ai.copy'))}</button>
      ${Files.root() ? `<button class="btn-sm primary" data-ai-save>${esc(t('ai.saveFile'))}</button>` : ''}`;
  }
  document.addEventListener('click', async e => {
    if (!shown) return;
    if (e.target.closest('[data-ai-copy]')) { invoke ? invoke('clipboard_write', {text: shown.text}).then(() => toast(t('ai.copied'))) : navigator.clipboard.writeText(shown.text); }
    if (e.target.closest('[data-ai-save]')) {
      try {
        const p = await invoke('files_write', {root: Files.root(), dir: shown.dir, name: shown.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) + '.md', text: shown.text.trim() + '\n'});
        toast(t('ai.saved', {name: p.split(/[\\/]/).pop()})); closeModal(); Files.reload(p);
      } catch (err) { toast(String(err)); }
    }
  });
  /* A little Markdown: headings, bold, lists, code. */
  function mdLite(text) {
    return String(text || '').split(/```[^\n]*\n?([\s\S]*?)```/).map((p, i) => i % 2 ? `<pre>${esc(p)}</pre>` : esc(p)
      .replace(/^#{1,6} +(.+)$/gm, '<b class="md-h">$1</b>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>')).join('');
  }

  /* ---- Today: the card ---- */
  function card() {
    const run = Object.entries(jobs);
    const signIn = info.checked && (!info.path || !info.loggedIn);
    const time = ms => new Date(ms).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', {hour: '2-digit', minute: '2-digit'});
    return `<div class="pcard ai-card"><h2>${esc(t('ai.card'))}<button class="btn-sm" data-ai-set>${esc(t('ai.settings'))}</button></h2>
      ${signIn ? `<div class="row warn-row" data-ai-set>${esc(t(info.path ? 'ai.signInHint' : 'ai.notFound'))}</div>` : ''}
      ${run.map(([id, j]) => `<div class="row"><span class="badge warn">${esc(t('agent.running'))}</span><span class="grow">${esc(j.title)}</span><button class="btn-sm" data-ai-stop="${id}">${esc(t('ai.stop'))}</button></div>`).join('')}
      ${results.map(r => `<div class="row${r.ok ? '' : ' warn-row'}"><span class="lesson-time">${esc(time(r.at))}</span><span class="grow" title="${esc(r.text)}">${esc(r.title)}${r.kind === 'entries' ? ' · ' + esc(entryText(r.data)) : ''}</span>
        ${r.kind === 'entries' || r.kind === 'cards' ? (r.taken ? `<span class="meta">${esc(t('ai.taken'))}</span>` : `<button class="btn-sm primary" data-ai-take="${r.id}">${esc(t('agent.take', {n: r.kind === 'entries' ? r.data.tasks.length + r.data.events.length : r.data.cards.length}))}</button>`)
          : r.file ? `<button class="btn-sm" data-ai-open="${esc(r.file)}">${esc(t('files.open'))}</button>` : r.text ? `<button class="btn-sm" data-ai-show="${r.id}">${esc(t('ai.show'))}</button>` : ''}</div>`).join('')}
      <div class="agent-quick"><input class="field-in" id="agentIn" placeholder="${esc(t('agent.ph'))}"><button class="btn-sm primary" data-act="agentAdd"${running('entries') ? ' disabled' : ''}>${esc(t('agent.add'))}</button></div>
      <p class="meta" style="margin:6px 0 0"><button class="btn-sm" data-act="agentStudy"${running('study') ? ' disabled' : ''}>${esc(t('agent.study'))}</button> <span>${esc(t('ai.cardHint'))}</span></p></div>`;
  }
  const entryText = x => [x.tasks.length ? t('ai.nTasks', {n: x.tasks.length}) : '', x.events.length ? t('ai.nEvents', {n: x.events.length}) : ''].filter(Boolean).join(', ');
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ai-take],[data-ai-stop],[data-ai-show],[data-ai-open],[data-ai-set],[data-ai-login],[data-ai-check],[data-ai-tool]');
    if (!b) return;
    const d = b.dataset;
    if (d.aiTake) take(d.aiTake);
    else if (d.aiStop) stop(d.aiStop);
    else if (d.aiShow) { const r = results.find(x => x.id === d.aiShow); if (r) show(r.title, r.text, r.dir); }
    else if (d.aiOpen) invoke('files_open', {root: Files.root(), path: d.aiOpen}).catch(err => toast(String(err)));
    else if (d.aiSet !== undefined) openSettings('ai');
    else if (d.aiLogin !== undefined) login();
    else if (d.aiCheck !== undefined) { info.checked = false; renderSettings(); check(); }
    else if (d.aiTool) { const f = Files.selected(); if (f) fileTool(d.aiTool, f); }
  });

  /* ---- Settings → AI ---- */
  async function login() {
    loginBusy = true; renderSettings();
    try { await invoke('ai_login', {own: own()}); } catch (e) { loginBusy = false; toast(String(e)); renderSettings(); }
  }
  function settingsHtml() {
    const opt = (v, label) => `<option value="${v}"${(settings.aiModel || '') === v ? ' selected' : ''}>${esc(label)}</option>`;
    return `<h3>${esc(t('ai.title'))}</h3><p class="hint">${esc(t('ai.hint'))}</p>
      ${!ready() ? `<p class="hint">${esc(t('ai.appOnly'))}</p>` : `
      <p>${info.checked ? (info.path ? `<b>${esc(t('ai.found'))}</b> ${esc(info.version)}<br><span class="meta">${esc(info.path)}</span>` : `<b style="color:var(--danger)">${esc(t('ai.notFound'))}</b><br><span class="meta">${esc(t('ai.notFoundHint'))}</span>`) : esc(t('ai.checking'))}</p>
      <div class="ed-field" style="max-width:560px"><label>${esc(t('ai.own'))}</label><input class="field-in" data-ai-own value="${esc(own())}" placeholder="${esc(t('ai.auto'))}" style="width:100%"></div>
      <p><button class="btn-sm" data-ai-check>${esc(t('ai.check'))}</button></p>
      <h3>${esc(t('ai.account'))}</h3>
      ${info.path ? (info.loggedIn ? `<p>${esc(t('ai.ok', {who: info.who || 'Claude'}))}</p>` : `<p class="hint">${esc(t('ai.signInHint'))}</p><p><button class="btn-sm primary" data-ai-login${loginBusy ? ' disabled' : ''}>${esc(t(loginBusy ? 'ai.loginBusy' : 'ai.login'))}</button></p>`) : ''}
      <h3>${esc(t('ai.model'))}</h3><select class="wide-sel" data-ai-model>${opt('', t('ai.modelDefault'))}${opt('sonnet', 'Claude Sonnet')}${opt('haiku', t('ai.modelFast'))}${opt('opus', 'Claude Opus')}</select>
      <h3>${esc(t('ai.rights'))}</h3><p class="hint">${esc(t('ai.rightsHint'))}</p>`}`;
  }
  document.addEventListener('change', e => {
    if (e.target.dataset.aiOwn !== undefined) { settings.aiClaude = e.target.value.trim(); saveSettings(); info.checked = false; check(); }
    if (e.target.dataset.aiModel !== undefined) { settings.aiModel = e.target.value; saveSettings(); }
  });
  function init() {
    if (!ready()) return;
    window.__TAURI__.event.listen('ai-done', e => done(e.payload));
    window.__TAURI__.event.listen('ai-login-done', e => { loginBusy = false; toast(t(e.payload ? 'ai.loginOk' : 'ai.loginFail')); check(); });
    check();
  }
  return {init, check, ask, card, entries, studyPlan, deckCards, fileTool, FILE_TOOLS, settingsHtml, jsonOf, running, get info() { return info; }, get results() { return results; }, _done: done};
})();
