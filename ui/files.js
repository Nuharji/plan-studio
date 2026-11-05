/* File management (Rust: files.rs): one school folder on this computer — by default the work folder of Studio Hub —
   with a folder per subject or as you like. Browse, search, new folder, rename, move (drag onto a folder or a part of
   the path), copy files in, into the system's trash and back, open with the usual program, show in Finder / Explorer.
   A file can get a subject and be attached to homework or a date (kept in the plan as plan.fileTags, by the path
   inside the school folder, so it works on every computer that shares the plan); the AI tools of ai.js work on a file
   or a whole folder. Loaded before app.js: everything here uses app.js's globals only when it is called. */
'use strict';
const Files = (() => {
  let cwd = '';            // the folder shown (a full path; '' = the school folder)
  let entries = [], error = '', query = '', found = null, loadedFor = null, busy = false;
  let lastTrash = null;    // {path, landed, name}: "Bring back"
  let drag = null;         // paths being dragged
  const has = () => typeof settings !== 'undefined' && typeof plan !== 'undefined' && plan;
  const root = () => (has() && settings.filesRoot) || (window.Shared && (Shared.values || {}).workFolder) || '';
  const ready = () => typeof invoke === 'function' && invoke;
  const sep = p => (p.includes('\\') && !p.includes('/')) ? '\\' : '/';
  const relOf = p => { const r = root(); return p && r && p.startsWith(r) ? p.slice(r.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') : ''; };
  const tags = () => plan.fileTags || (plan.fileTags = {});
  const tagOf = rel => tags()[rel] || {};
  const dir = () => cwd || root();

  async function load(force) {
    if (!ready() || !root()) return;
    const key = dir();
    if (!force && loadedFor === key) return;
    loadedFor = key; busy = true;
    try { entries = await invoke('files_list', {root: root(), dir: key}); error = ''; }
    catch (e) { entries = []; error = String(e); if (cwd) { cwd = ''; loadedFor = null; return load(true); } }
    busy = false;
    if (query.trim()) await search(query, true);
    if (settings.view === 'files') renderView();
  }
  /* After a change in the folder (also from ai.js): read it again and select `select`. */
  async function reload(select) {
    loadedFor = null;
    if (select) sel = {kind: 'file', id: select};
    await load(true);
    if (settings.view === 'files') { renderView(); renderDetails(); }
  }
  let searchT = 0;
  async function search(q, now) {
    query = q;
    clearTimeout(searchT);
    if (!q.trim()) { found = null; return renderList(); }
    const go = async () => { found = await invoke('files_search', {root: root(), query: q}).catch(() => []); renderList(); };
    if (now) return go();
    searchT = setTimeout(go, 220);
  }
  const shown = () => found || entries;
  const entryOf = path => shown().find(e => e.path === path) || entries.find(e => e.path === path) || (found || []).find(e => e.path === path);
  const selected = () => sel && sel.kind === 'file' ? entryOf(sel.id) : null;

  /* The subject of a file: its tag, else a folder on its way named like a subject ("Mathe/Klausur 2/…"). */
  function subjectOf(f) {
    const rel = f.rel || relOf(f.path), tg = tagOf(rel);
    if (tg.subject && subj(tg.subject)) return subj(tg.subject);
    const parts = rel.split('/').map(x => x.toLowerCase());
    return plan.subjects.find(s => parts.slice(0, f.isDir ? parts.length : -1).some(p => p === s.name.toLowerCase() || (s.short && p === s.short.toLowerCase()))) || null;
  }
  const kindOf = f => f.isDir ? 'dir' : ({pdf: 'pdf', md: 'md', markdown: 'md', txt: 'txt', doc: 'doc', docx: 'doc', odt: 'doc', pages: 'doc', rtf: 'doc', xls: 'sheet', xlsx: 'sheet', csv: 'sheet', numbers: 'sheet',
    ppt: 'slides', pptx: 'slides', key: 'slides', slides: 'slides', jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', heic: 'img', webp: 'img', svg: 'img', mp3: 'audio', m4a: 'audio', wav: 'audio',
    mp4: 'video', mov: 'video', zip: 'zip'})[f.ext] || 'file';
  const ICON = {dir: '📁', pdf: '📕', md: '📝', txt: '📄', doc: '📘', sheet: '📊', slides: '📙', img: '🖼️', audio: '🎵', video: '🎬', zip: '🗜️', file: '📄'};
  const size = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1).replace('.', lang === 'de' ? ',' : '.') + ' MB';
  const when = ms => ms ? new Date(ms).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : '';
  const readable = f => !f.isDir && ['pdf', 'md', 'txt', 'doc', 'slides', 'sheet', 'img'].includes(kindOf(f));

  /* ---- The view ---- */
  function view() {
    const r = root();
    if (!ready()) return `<div class="view-title"><h1>${esc(t('files.title'))}</h1></div><div class="empty-s">${esc(t('ai.appOnly'))}</div>`;
    if (!r) return `<div class="view-title"><h1>${esc(t('files.title'))}</h1></div>
      <div class="files-empty"><div class="big">📁</div><h2>${esc(t('files.noRoot'))}</h2><p>${esc(t('files.noRootHint'))}</p>
      <p><button class="btn-sm primary" data-files="root">${esc(t('files.pickRoot'))}</button></p></div>`;
    load();
    const parts = [], rel = relOf(dir());
    let acc = r;
    parts.push(`<button class="crumb" data-files-go="" data-drop="${esc(r)}">${esc(r.split(/[\\/]/).filter(Boolean).pop() || r)}</button>`);
    for (const p of rel ? rel.split('/') : []) { acc += sep(r) + p; parts.push(`<span class="crumb-sep">›</span><button class="crumb" data-files-go="${esc(acc)}" data-drop="${esc(acc)}">${esc(p)}</button>`); }
    const missing = plan.subjects.filter(s => !entries.some(e => e.isDir && e.name.toLowerCase() === s.name.toLowerCase())).length;
    return `<div class="view-title"><h1>${esc(t('files.title'))}</h1><span class="sub">${esc(t('files.sub'))}</span></div>
      <div class="files-bar"><div class="crumbs">${parts.join('')}</div><span class="flex"></span>
        <input class="field-in" id="filesQ" placeholder="${esc(t('files.searchPh'))}" value="${esc(query)}">
        <button class="btn-sm" data-files="mkdir">${esc(t('files.newFolder'))}</button>
        <button class="btn-sm" data-files="import">${esc(t('files.import'))}</button>
        <button class="btn-sm" data-files="reveal">${esc(t('files.reveal'))}</button></div>
      ${lastTrash ? `<div class="files-note">${esc(t('files.trashed', {name: lastTrash.name}))} <button class="btn-sm" data-files="untrash">${esc(t('files.untrash'))}</button></div>` : ''}
      ${!cwd && missing && plan.subjects.length ? `<div class="files-note">${esc(t('files.subjectFoldersHint', {n: missing}))} <button class="btn-sm" data-files="subjects">${esc(t('files.subjectFolders'))}</button></div>` : ''}
      <div class="pcard files-list" id="filesList">${listHtml()}</div>
      <p class="meta">${esc(t('files.dragHint'))}</p>`;
  }
  function listHtml() {
    if (error) return `<div class="empty-s" style="color:var(--danger)">${esc(error)}</div>`;
    const list = shown();
    if (busy && !list.length) return `<div class="empty-s">…</div>`;
    if (!list.length) return `<div class="empty-s">${esc(found ? t('files.noHits') : t('files.emptyFolder'))}</div>`;
    return list.map(f => {
      const s = subjectOf(f), tg = tagOf(f.rel), links = (tg.links || []).filter(linkTarget).length;
      return `<div class="row frow${sel && sel.kind === 'file' && sel.id === f.path ? ' sel' : ''}" data-file="${esc(f.path)}" draggable="true"${f.isDir ? ` data-drop="${esc(f.path)}"` : ''}>
        <span class="ficon">${ICON[kindOf(f)]}</span><span class="grow" title="${esc(f.rel)}">${esc(f.name)}${found && f.rel.includes('/') ? ` <span class="meta">${esc(f.rel.slice(0, f.rel.lastIndexOf('/')))}</span>` : ''}</span>
        ${links ? `<span class="badge">📎 ${links}</span>` : ''}${s && !(f.isDir && s.name.toLowerCase() === f.name.toLowerCase()) ? chip(s) : ''}
        <span class="meta fdate">${esc(when(f.modified))}</span><span class="meta fsize">${f.isDir ? esc(t('files.nItems', {n: f.count})) : esc(size(f.size))}</span></div>`;
    }).join('');
  }
  function renderList() { const el = document.getElementById('filesList'); if (el) el.innerHTML = listHtml(); }

  /* ---- The details panel of a file ---- */
  const linkTarget = l => l.kind === 'task' ? plan.tasks.find(x => x.id === l.id) : plan.events.find(x => x.id === l.id);
  function details(box, field) {
    const f = selected();
    if (!f) { box.innerHTML = `<div class="empty">${esc(t('ui.selectHint'))}</div>`; return; }
    const tg = tagOf(f.rel), s = subjectOf(f), links = (tg.links || []).filter(linkTarget);
    const d = today();
    const open = [...plan.tasks.filter(x => !x.done).map(x => ({kind: 'task', id: x.id, label: `${t('ui.homeworkOne')}: ${x.title || (subj(x.subject) || {}).name || ''}`})),
      ...plan.events.filter(e => e.type !== 'class' && validIso(e.date) && e.date >= d).sort((a, b) => a.date.localeCompare(b.date)).map(e => ({kind: 'event', id: e.id, label: `${t('type.' + e.type)}: ${e.title || (subj(e.subject) || {}).name || ''} (${fmtDate(e.date)})`}))]
      .filter(o => !links.some(l => l.kind === o.kind && l.id === o.id)).slice(0, 60);
    const tools = AI.FILE_TOOLS.filter(k => f.isDir ? ['sheet', 'quiz', 'cards', 'summary'].includes(k) : readable(f));
    box.innerHTML = `<div class="sect">${esc(f.isDir ? t('files.folder') : t('files.file'))}</div>
      <div class="file-head"><span class="ficon big">${ICON[kindOf(f)]}</span><b title="${esc(f.path)}">${esc(f.name)}</b></div>
      <div class="kv"><span>${esc(t('files.where'))}</span><b title="${esc(f.path)}">${esc(f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '/')}</b></div>
      ${f.isDir ? `<div class="kv"><span>${esc(t('files.items'))}</span><b>${f.count}</b></div>` : `<div class="kv"><span>${esc(t('files.size'))}</span><b>${esc(size(f.size))}</b></div>`}
      <div class="kv"><span>${esc(t('files.changed'))}</span><b>${esc(when(f.modified))}</b></div>
      <p class="fbtns"><button class="btn-sm primary" data-files="open">${esc(f.isDir ? t('files.openFolder') : t('files.open'))}</button>
        <button class="btn-sm" data-files="revealSel">${esc(t('files.reveal'))}</button><button class="btn-sm" data-files="rename">${esc(t('files.rename'))}</button>
        <button class="btn-sm danger-btn" data-files="trash">${esc(t('files.trash'))}</button></p>
      ${field('ui.subject', `<select data-file-subject>${subjectOptions(tg.subject || '')}</select>${!tg.subject && s ? `<div class="meta">${esc(t('files.subjectFromFolder', {name: s.name}))}</div>` : ''}`)}
      ${f.isDir ? '' : `<div class="sect">${esc(t('files.attached'))}</div>
        ${links.map(l => { const x = linkTarget(l); return `<div class="sess"><span class="grow">${esc(l.kind === 'task' ? x.title || t('ui.homeworkOne') : (t('type.' + x.type) + ': ' + (x.title || '')))}</span><button class="btn-sm" data-files-show="${l.kind}|${l.id}">${esc(t('files.show'))}</button><button class="x" data-files-unlink="${l.kind}|${l.id}" title="${esc(t('files.unlink'))}">×</button></div>`; }).join('') || `<p class="meta">${esc(t('files.noAttached'))}</p>`}
        ${open.length ? `<select data-file-link><option value="">${esc(t('files.attachTo'))}</option>${open.map(o => `<option value="${o.kind}|${o.id}">${esc(o.label)}</option>`).join('')}</select>` : ''}`}
      ${tools.length ? `<div class="sect">${esc(t('ai.fileTools'))}</div><div class="ai-tools">${tools.map(k => `<button class="btn-sm" data-ai-tool="${k}"${AI.running('file:' + k) ? ' disabled' : ''} title="${esc(t('ai.tool.' + k + '.hint'))}">${esc(t('ai.tool.' + k))}</button>`).join('')}</div>
        <p class="meta">${esc(t(f.isDir ? 'ai.folderToolsHint' : 'ai.fileToolsHint'))}</p>` : ''}
      ${!f.isDir && ['md', 'txt'].includes(kindOf(f)) ? `<div class="sect">${esc(t('files.preview'))}</div><pre class="fpreview" id="filePreview">…</pre>` : ''}`;
    const pv = document.getElementById('filePreview');
    if (pv) invoke('files_text', {root: root(), path: f.path}).then(s => { if (pv.isConnected) pv.textContent = s.slice(0, 4000) + (s.length > 4000 ? '\n…' : ''); }).catch(e => { pv.textContent = String(e); });
  }
  /* The files attached to homework / a date (in their details). */
  function attached(kind, id) {
    if (!plan.fileTags) return '';
    const list = Object.entries(plan.fileTags).filter(([, tg]) => (tg.links || []).some(l => l.kind === kind && l.id === id)).map(([rel]) => rel);
    if (!list.length) return '';
    return `<div class="sect">${esc(t('files.attached'))}</div>${list.map(rel => `<div class="sess"><span class="grow" title="${esc(rel)}">📎 ${esc(rel.split('/').pop())}</span><button class="btn-sm" data-files-open-rel="${esc(rel)}">${esc(t('files.open'))}</button></div>`).join('')}`;
  }
  const absOf = rel => root() + sep(root()) + rel.split('/').join(sep(root()));
  function setTag(rel, fn) {
    change(() => {
      const all = tags(), tg = {...(all[rel] || {})};
      fn(tg);
      if (!tg.subject) delete tg.subject;
      if (tg.links && !tg.links.length) delete tg.links;
      if (Object.keys(tg).length) all[rel] = tg; else delete all[rel];
    });
  }
  /* Tags follow a file that is renamed or moved inside the school folder. */
  function moveTags(fromRel, toRel) {
    if (!plan.fileTags || fromRel === toRel) return;
    const keys = Object.keys(plan.fileTags).filter(k => k === fromRel || k.startsWith(fromRel + '/'));
    if (!keys.length) return;
    change(() => { for (const k of keys) { plan.fileTags[toRel + k.slice(fromRel.length)] = plan.fileTags[k]; delete plan.fileTags[k]; } });
  }

  /* ---- Doing things ---- */
  async function act(what) {
    const f = selected(), r = root();
    try {
      if (what === 'root') {
        const p = await invoke('files_pick_folder'); if (!p) return;
        settings.filesRoot = p; saveSettings(); cwd = ''; query = ''; found = null; loadedFor = null; return renderView();
      }
      if (what === 'mkdir') return askName(t('files.newFolder'), '', async name => { const p = await invoke('files_mkdir', {root: r, dir: dir(), name}).catch(e => toast(String(e))); if (p) reload(p); });
      if (what === 'import') {
        const paths = await invoke('files_pick'); if (!paths.length) return;
        const got = await invoke('files_import', {root: r, paths, into: dir()});
        toast(t('files.imported', {n: got.length})); return reload(got[0]);
      }
      if (what === 'subjects') {
        const n = await invoke('files_mkdirs', {root: r, names: plan.subjects.map(s => s.name)});
        toast(t('files.subjectFoldersMade', {n})); return reload();
      }
      if (what === 'reveal') return invoke('files_reveal', {root: r, path: dir()});
      if (what === 'untrash' && lastTrash) {
        await invoke('files_untrash', {root: r, path: lastTrash.path, landed: lastTrash.landed});
        const p = lastTrash.path; lastTrash = null; toast(t('files.back')); return reload(p);
      }
      if (!f) return;
      if (what === 'open') return f.isDir ? go(f.path) : invoke('files_open', {root: r, path: f.path});
      if (what === 'revealSel') return invoke('files_reveal', {root: r, path: f.path});
      if (what === 'rename') return askName(t('files.rename'), f.name, async name => {
        const p = await invoke('files_rename', {root: r, path: f.path, name}).catch(e => toast(String(e)));
        if (p) { moveTags(f.rel, relOf(p)); reload(p); }
      });
      if (what === 'trash') {
        if (f.isDir && f.count && !await ask(t('files.trashAsk', {name: f.name, n: f.count}))) return;
        const landed = await invoke('files_trash', {root: r, path: f.path});
        lastTrash = {path: f.path, landed, name: f.name}; sel = null;
        toast(t('files.trashed', {name: f.name})); return reload();
      }
    } catch (e) { toast(String(e)); }
  }
  async function moveTo(paths, into) {
    paths = paths.filter(p => p !== into && !into.startsWith(p + sep(p)));
    if (!paths.length) return;
    try {
      const out = await invoke('files_move', {root: root(), paths, into});
      paths.forEach((p, i) => moveTags(relOf(p), relOf(out[i])));
      toast(t('files.moved', {n: paths.length, to: into === root() ? t('files.title') : into.split(/[\\/]/).pop()}));
      reload();
    } catch (e) { toast(String(e)); }
  }
  function go(path) { cwd = path === root() ? '' : path; query = ''; found = null; sel = null; loadedFor = null; renderAll(); }

  /* ---- Events (on the view and the panel) ---- */
  document.addEventListener('click', e => {
    if (!has()) return;
    const b = e.target.closest('[data-files],[data-files-go],[data-file],[data-files-show],[data-files-unlink],[data-files-open-rel]');
    if (!b) return;
    const d = b.dataset;
    if (d.files) return act(d.files);
    if (d.filesGo !== undefined) return go(d.filesGo || root());
    if (d.filesOpenRel) return invoke('files_open', {root: root(), path: absOf(d.filesOpenRel)}).catch(err => toast(String(err)));
    if (d.filesShow) { const [kind, id] = d.filesShow.split('|'); sel = {kind, id}; return setView(kind === 'task' ? 'tasks' : 'events'); }
    if (d.filesUnlink) { const f = selected(); if (!f) return; const [kind, id] = d.filesUnlink.split('|'); return setTag(f.rel, tg => { tg.links = (tg.links || []).filter(l => !(l.kind === kind && l.id === id)); }); }
    if (d.file && settings.view === 'files') { sel = {kind: 'file', id: d.file}; renderList(); renderDetails(); }
  });
  document.addEventListener('dblclick', e => {
    const row = has() && settings.view === 'files' && e.target.closest('[data-file]'); if (!row) return;
    const f = entryOf(row.dataset.file); if (!f) return;
    if (f.isDir) go(f.path); else invoke('files_open', {root: root(), path: f.path}).catch(err => toast(String(err)));
  });
  document.addEventListener('change', e => {
    const f = has() && selected(); if (!f) return;
    if (e.target.dataset.fileSubject !== undefined) setTag(f.rel, tg => { tg.subject = e.target.value; });
    if (e.target.dataset.fileLink !== undefined && e.target.value) { const [kind, id] = e.target.value.split('|'); setTag(f.rel, tg => { tg.links = [...(tg.links || []), {kind, id}]; }); }
  });
  document.addEventListener('input', e => { if (e.target.id === 'filesQ') search(e.target.value); });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'filesQ' && e.key === 'Escape') { e.stopPropagation(); e.target.value = ''; search(''); }
    if (has() && settings.view === 'files' && !typing() && selected() && e.key === 'Enter') { e.preventDefault(); act('open'); }
  }, true);
  document.addEventListener('dragstart', e => {
    const row = e.target.closest && e.target.closest('[data-file]'); if (!row || !has() || settings.view !== 'files') return;
    drag = [row.dataset.file]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', row.dataset.file);
  });
  document.addEventListener('dragover', e => { const t2 = drag && e.target.closest && e.target.closest('[data-drop]'); if (t2) { e.preventDefault(); t2.classList.add('drop-on'); } });
  document.addEventListener('dragleave', e => { const t2 = e.target.closest && e.target.closest('[data-drop]'); if (t2) t2.classList.remove('drop-on'); });
  document.addEventListener('drop', e => {
    const t2 = drag && e.target.closest && e.target.closest('[data-drop]'); if (!t2) return;
    e.preventDefault(); t2.classList.remove('drop-on');
    const paths = drag; drag = null; moveTo(paths, t2.dataset.drop);
  });
  document.addEventListener('dragend', () => { drag = null; document.querySelectorAll('.drop-on').forEach(x => x.classList.remove('drop-on')); });

  /* Delete key in the view: into the trash. */
  function deleteSelected() { return act('trash'); }
  return {root, view, details, attached, reload, selected, subjectOf, deleteSelected, go, moveTags, relOf, get cwd() { return cwd; }, _set(v) { entries = v; loadedFor = dir(); }};
})();
