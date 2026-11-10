/* Practice tests: a mock test for an exam, test or presentation — made by Claude (from the exam's topics, notes, cards
   and the files of the school folder) or right here from the cards of a deck (works without Claude). A test has
   multiple-choice questions, answers to type (checked like in practising) and open questions (Claude's model answer;
   you give yourself the points). The result shows the points, the percent and the grade it would roughly be; every try
   is kept with the test, and the time counts as learned for the subject.
   Kept in plan.tests: {id, event, deck, subject, title, source: 'ai'|'cards', made, minutes, questions: [{kind: 'choice'|'write'|'open',
   q, options, answer, points, explain}], tries: [{at, points, max}]}. Loaded before app.js: uses its globals only when called. */
'use strict';
const PTest = (() => {
  let cur = null;   // the test being taken: {id, answers: {}, self: {}, checked, started, tryAt}
  const tests = () => plan.tests || [];
  const testOf = id => tests().find(x => x.id === id);
  const forEvent = id => tests().filter(x => x.event === id);
  const forDeck = id => tests().filter(x => x.deck === id);
  const maxOf = x => x.questions.reduce((n, q) => n + q.points, 0);

  /* The grade a share of the points would roughly be, in the school's scale. */
  function gradeOf(pct, scale = gradeCfg().scale) {
    if (scale === 'pct') return Math.round(pct) + ' %';
    if (scale === 'p15') { const steps = [95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 33, 27, 20]; const i = steps.findIndex(s => pct >= s); return String(i < 0 ? 0 : 15 - i); }
    const steps = [92, 81, 67, 50, 30]; const i = steps.findIndex(s => pct >= s); return String(i < 0 ? 6 : i + 1);
  }

  /* Questions from what Claude sent: {questions: [{type, q, options, answer, points, explain}]}. */
  function cleanQuestions(list) {
    return (Array.isArray(list) ? list : []).map(q => {
      if (!q || typeof q !== 'object' || !String(q.q || q.question || '').trim()) return null;
      const text = String(q.q || q.question).trim().slice(0, 2000), explain = String(q.explain || q.explanation || '').trim().slice(0, 2000);
      const points = Math.max(1, Math.min(20, Math.round(+q.points) || 1));
      const options = Array.isArray(q.options) ? q.options.map(o => String(o).trim().slice(0, 500)).filter(Boolean) : [];
      if ((q.type === 'choice' || options.length) && options.length >= 2) {
        let a = Number.isInteger(+q.answer) && +q.answer >= 0 && +q.answer < options.length ? +q.answer : options.findIndex(o => normAnswer(o) === normAnswer(q.answer));
        if (a < 0) return null;
        return {id: uid(), kind: 'choice', q: text, options, answer: a, points, explain};
      }
      const answer = String(q.answer || '').trim().slice(0, 3000);
      return answer ? {id: uid(), kind: 'open', q: text, answer, points, explain} : null;
    }).filter(Boolean).slice(0, 40);
  }

  /* The decks that belong to an exam: its own and, if none, those of its subject without an exam. */
  function decksFor(ev) {
    const own = decks().filter(k => k.event === ev.id);
    return own.length ? own : decks().filter(k => !k.event && ev.subject && k.subject === ev.subject);
  }

  /* A test from cards: up to 15 of them, half picked from four answers, half typed (vocabulary in both directions). */
  function fromCards(ks) {
    const cards = ks.flatMap(k => k.cards.map(c => ({c, k}))).filter(x => x.c.front && x.c.back);
    if (cards.length < 3) return null;
    // The ones known least first, so the test asks what needs it most.
    const pick = shuffle(cards.slice()).sort((a, b) => (a.c.box || 0) - (b.c.box || 0)).slice(0, 15);
    return shuffle(pick).map(({c, k}, i) => {
      const rev = k.kind === 'vocab' && i % 3 === 2, ask = rev ? c.back : c.front, ans = rev ? c.front : c.back;
      const other = cards.filter(x => x.c !== c).map(x => rev ? x.c.front : x.c.back);
      const seen = new Set([normAnswer(ans)]), wrong = [];
      for (const o of shuffle(other)) { const n = normAnswer(o); if (!seen.has(n)) { seen.add(n); wrong.push(o); } if (wrong.length === 3) break; }
      const side = sideName(k, !rev);
      if (i % 2 === 0 && wrong.length === 3) {
        const options = shuffle([ans, ...wrong]);
        return {id: uid(), kind: 'choice', q: ask, hint: side, options, answer: options.indexOf(ans), points: 1, explain: ''};
      }
      return {id: uid(), kind: 'write', q: ask, hint: side, answer: ans, points: 1, explain: ''};
    });
  }

  function save(x) {
    change(() => { plan.tests = [...tests(), x]; });
    toast(t('pt.made', {n: x.questions.length}));
    open(x.id);
  }
  function makeFromCards({event, deck}) {
    const ev = event && eventOf(event), k = deck && deckOf(deck), ks = k ? [k] : ev ? decksFor(ev) : [];
    const questions = fromCards(ks);
    if (!questions) { toast(t('pt.fewCards')); return; }
    const title = k ? k.name : ev.title || t('type.' + ev.type);
    save({id: uid(), event: ev ? ev.id : k.event || '', deck: k ? k.id : '', subject: (k || ev).subject || '', title: t('pt.title', {name: title}), source: 'cards',
      made: today(), minutes: Math.max(5, questions.length), questions, tries: []});
  }
  const FORMAT = '{"title": "…", "minutes": 45, "questions": [{"type": "choice", "q": "…", "options": ["…", "…", "…", "…"], "answer": 0, "points": 1, "explain": "…"}, {"type": "open", "q": "…", "answer": "…", "points": 3, "explain": "…"}]}';
  async function makeWithAi(eventId) {
    const ev = eventOf(eventId); if (!ev) return;
    const s = subj(ev.subject), root = Files.root(), name = ev.title || t('type.' + ev.type);
    const cards = decksFor(ev).flatMap(k => k.cards).slice(0, 80).map(c => `${c.front} = ${c.back}`).join('; ');
    const about = [t('type.' + ev.type), s ? s.name : '', ev.title, (ev.topics || []).length ? t('pt.topics', {list: ev.topics.map(x => x.text).join(', ')}) : '',
      ev.notes ? t('pt.notes', {text: ev.notes.slice(0, 800)}) : '', cards ? t('pt.cards', {list: cards.slice(0, 4000)}) : ''].filter(Boolean).join(' · ');
    const prompt = t('pt.task', {about, mins: ev.minutes || 45}) + (root ? '\n' + t('learn.agentWork') : '') + '\n' + t('ai.formatJson', {f: FORMAT});
    toast(t('ai.working')); renderDetails();
    const title = t('pt.title', {name});
    const res = await AI.ask({kind: 'ptest', title, dir: root, prompt});
    renderDetails();
    if (!res.ok) { if (!res.stopped) toast(t('ai.failed')); return; }
    const data = AI.jsonOf(res.text), questions = cleanQuestions(data && data.questions);
    if (!questions.length) { toast(t('pt.noQuestions')); return; }
    save({id: uid(), event: ev.id, deck: '', subject: ev.subject || '', title: data.title ? String(data.title).slice(0, 200) : title, source: 'ai',
      made: today(), minutes: Math.max(5, Math.min(240, Math.round(+data.minutes) || ev.minutes || 45)), questions, tries: []});
  }

  /* ---- Taking a test (in the dialog; leaving it keeps the answers until another test is opened) ---- */
  function open(id) {
    const x = testOf(id); if (!x) return;
    if (!cur || cur.id !== id) cur = {id, answers: {}, self: {}, checked: false, started: Date.now()};
    draw();
  }
  /* Points of a question once handed in (open questions: what you gave yourself). */
  function pointsOf(q) {
    const a = cur.answers[q.id];
    if (q.kind === 'choice') return a === q.answer ? q.points : 0;
    if (q.kind === 'write') return a && checkAnswer(a, q.answer) !== 'wrong' ? q.points : 0;
    return Math.round((cur.self[q.id] || 0) * q.points * 2) / 2;
  }
  const total = x => x.questions.reduce((n, q) => n + pointsOf(q), 0);
  const num = v => lang === 'de' ? String(v).replace('.', ',') : String(v);
  function draw() {
    const x = testOf(cur && cur.id); if (!x) { cur = null; return; }
    const max = maxOf(x), done = cur.checked;
    const qHtml = (q, i) => {
      const a = cur.answers[q.id], p = done ? pointsOf(q) : null;
      let body = '';
      if (q.kind === 'choice') body = `<div class="choices">${q.options.map((o, j) => `<button class="choice${done ? j === q.answer ? ' right' : j === a ? ' wrong' : '' : j === a ? ' on' : ''}" data-pt-pick="${q.id}|${j}"${done ? ' disabled' : ''}><kbd>${'ABCDEFGH'[j] || j + 1}</kbd><span>${esc(o)}</span></button>`).join('')}</div>`;
      else if (q.kind === 'write') body = done ? `<div class="fl-typed ${p ? 'right' : 'wrong'}">${esc(a || '—')}</div>${p && normAnswer(a) === normAnswer(q.answer) ? '' : `<div class="pt-ans">${esc(q.answer)}</div>`}`
        : `<input class="field-in pt-in" data-pt-in="${q.id}" autocomplete="off" spellcheck="false" value="${esc(a || '')}" placeholder="${esc(t('learn.typePh'))}">`;
      else body = done ? `<div class="pt-mine">${esc(a || '—')}</div><div class="meta">${esc(t('pt.model'))}</div><div class="pt-ans">${esc(q.answer)}</div>
          <div class="pt-self"><span class="meta">${esc(t('pt.self'))}</span>${[0, 0.5, 1].map(f => `<button class="btn-sm${cur.self[q.id] === f ? ' primary' : ''}" data-pt-self="${q.id}|${f}">${esc(t('pt.self.' + f))}</button>`).join('')}</div>`
        : `<textarea class="pt-in" data-pt-in="${q.id}" rows="3" placeholder="${esc(t('pt.openPh'))}">${esc(a || '')}</textarea>`;
      return `<div class="pt-q${done ? p >= q.points ? ' right' : p > 0 ? ' half' : ' wrong' : ''}"><div class="pt-head"><b>${i + 1}.</b><span class="grow">${esc(q.q)}</span>
        <span class="badge">${done ? `${num(p)} / ` : ''}${esc(t(q.points === 1 ? 'pt.point' : 'pt.points', {n: q.points}))}</span></div>
        ${q.hint ? `<div class="meta">${esc(q.hint)}</div>` : ''}${body}${done && q.explain ? `<div class="meta pt-explain">${esc(q.explain)}</div>` : ''}</div>`;
    };
    const got = done ? total(x) : 0, pct = max ? got / max * 100 : 0, unmarked = x.questions.filter(q => q.kind === 'open' && cur.self[q.id] == null).length;
    const result = done ? `<div class="pt-result"><b>${esc(t('pt.result', {got: num(got), max}))}</b><span class="badge">${Math.round(pct)} %</span><span class="badge ok">${esc(t('pt.grade', {g: gradeOf(pct)}))}</span>
        ${unmarked ? `<span class="meta">${esc(t('pt.openLeft', {n: unmarked}))}</span>` : ''}</div><div class="prog"><i style="width:${Math.round(pct)}%"></i></div>` : '';
    const tries = (x.tries || []).slice(-5).map(r => `${fmtDate(r.at.slice(0, 10), {day: 'numeric', month: 'numeric'})}: ${Math.round(r.points / (r.max || 1) * 100)} %`).join(' · ');
    const body = $('#modalBody'), same = $('#modal').classList.contains('show') && body.querySelector(`.ptest[data-id="${x.id}"]`), top = same ? body.scrollTop : 0;
    modal(x.title, `<div class="ptest" data-id="${x.id}"><p class="meta" style="margin-top:0">${esc(t('pt.intro', {n: x.questions.length, max, mins: x.minutes}))}${tries ? ' · ' + esc(t('pt.tries', {list: tries})) : ''}</p>
      ${result}${x.questions.map(qHtml).join('')}${result}</div>`);
    $('#modalFoot').hidden = false;
    $('#modalFoot').innerHTML = `<button class="btn-sm danger-btn" data-pt-del="${x.id}">${esc(t('a.delete'))}</button><span class="flex"></span>`
      + (done ? `<button class="btn-sm" data-pt-again>${esc(t('pt.again'))}</button><button class="btn-sm primary" data-pt-close>${esc(t('pt.close'))}</button>`
        : `<button class="btn-sm primary" data-pt-check>${esc(t('pt.check'))}</button>`);
    body.scrollTop = top;
  }
  function check() {
    const x = testOf(cur && cur.id); if (!x || cur.checked) return;
    const empty = x.questions.filter(q => cur.answers[q.id] == null || cur.answers[q.id] === '').length;
    const go = () => {
      cur.checked = true; cur.tryAt = new Date().toISOString();
      const minutes = Math.round((Date.now() - cur.started) / 60000);
      change(() => {
        x.tries = [...(x.tries || []), {at: cur.tryAt, points: total(x), max: maxOf(x)}].slice(-20);
        if (minutes >= 1) plan.studyLog = [...studyLog(), {date: today(), subject: x.subject || '', event: x.event || '', minutes: Math.min(minutes, 240)}].filter(l => l.date >= addDays(today(), -400));
      });
      draw();
    };
    if (!empty) return go();
    ask(t('pt.emptyAsk', {n: empty})).then(ok => { if (ok) go(); });
  }
  /* Giving yourself points for an open question changes the try just made. */
  function selfMark(qid, f) {
    const x = testOf(cur && cur.id); if (!x || !cur.checked) return;
    cur.self[qid] = f;
    const r = (x.tries || []).find(y => y.at === cur.tryAt);
    if (r) change(() => { r.points = total(x); });
    draw();
  }
  function remove(id) {
    const x = testOf(id); if (!x) return;
    ask(t('pt.deleteAsk', {name: x.title})).then(ok => {
      if (!ok) return;
      if (cur && cur.id === id) cur = null;
      change(() => { plan.tests = tests().filter(y => y.id !== id); });
      closeModal();
    });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-pt-open],[data-pt-cards],[data-pt-ai],[data-pt-pick],[data-pt-self],[data-pt-check],[data-pt-again],[data-pt-close],[data-pt-del]');
    if (!b) return;
    const d = b.dataset;
    if (d.ptOpen) open(d.ptOpen);
    else if (d.ptCards) { const [kind, id] = d.ptCards.split('|'); makeFromCards(kind === 'deck' ? {deck: id} : {event: id}); }
    else if (d.ptAi) makeWithAi(d.ptAi);
    else if (d.ptPick) { const [qid, j] = d.ptPick.split('|'); if (cur && !cur.checked) { cur.answers[qid] = +j; b.parentNode.querySelectorAll('.choice').forEach(c => c.classList.toggle('on', c === b)); } }
    else if (d.ptSelf) { const [qid, f] = d.ptSelf.split('|'); selfMark(qid, +f); }
    else if (d.ptCheck !== undefined) check();
    else if (d.ptAgain !== undefined) { const id = cur.id; cur = null; open(id); }
    else if (d.ptClose !== undefined) { cur = null; closeModal(); }
    else if (d.ptDel) remove(d.ptDel);
  });
  document.addEventListener('input', e => { const id = e.target.dataset && e.target.dataset.ptIn; if (id && cur && !cur.checked) cur.answers[id] = e.target.value; });

  /* The part in the details of an exam or a deck: the tests made for it and the buttons to make one. */
  function section({event, deck}) {
    const list = event ? forEvent(event) : forDeck(deck), ev = event && eventOf(event);
    const hasCards = deck ? (deckOf(deck) || {cards: []}).cards.length >= 3 : ev && decksFor(ev).reduce((n, k) => n + k.cards.length, 0) >= 3;
    const busy = AI.running('ptest');
    const last = x => { const r = (x.tries || []).slice(-1)[0]; return r ? `${Math.round(r.points / (r.max || 1) * 100)} %` : t('pt.notYet'); };
    return `<div class="sect">${esc(t('pt.sect'))}</div>
      ${list.map(x => `<div class="sess"><span class="grow" title="${esc(x.title)}">${esc(x.title)}</span><span class="meta">${esc(t('pt.nQ', {n: x.questions.length}))} · ${esc(last(x))}</span><button class="btn-sm" data-pt-open="${x.id}">${esc(t('pt.open'))}</button></div>`).join('')}
      <p class="pick-btns">${event && invoke ? `<button class="btn-sm primary" data-pt-ai="${event}"${busy ? ' disabled' : ''}>${esc(t(busy ? 'pt.aiBusy' : 'pt.ai'))}</button>` : ''}
        ${hasCards ? `<button class="btn-sm" data-pt-cards="${deck ? 'deck|' + deck : 'event|' + event}">${esc(t('pt.fromCards'))}</button>` : ''}</p>
      ${!hasCards && !(event && invoke) ? `<p class="meta">${esc(t('pt.needCards'))}</p>` : `<p class="meta">${esc(t(event && invoke ? 'pt.hint' : 'pt.hintCards'))}</p>`}`;
  }
  return {section, open, gradeOf, cleanQuestions, fromCards, forEvent, get cur() { return cur; }};
})();
