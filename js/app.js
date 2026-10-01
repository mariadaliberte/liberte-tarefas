import * as store from './store.js';
import * as g from './google.js';
import * as sync from './sync.js';
import { parseTask, formatDate } from './parser.js';
import { CONFIG } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  view: 'tudo',
  search: '',
  priority: '',
  person: '',
  agenda: null,
  agendaLoadedAt: 0,
  editingId: null,
};

if (!store.getSettings().clientId && CONFIG.googleClientId) {
  store.saveSettings({ clientId: CONFIG.googleClientId });
}

// ---------- Utilidades ----------

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return formatDate(d);
}

function dateLabel(date) {
  if (!date) return '';
  if (date === todayStr()) return 'Hoje';
  if (date === todayStr(1)) return 'Amanhã';
  if (date === todayStr(-1)) return 'Ontem';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const label = `${WEEKDAY[dt.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  return y === new Date().getFullYear() ? label : `${label}/${y}`;
}

function toast(msg, { action, ms = 3500 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.onclick = () => { el.hidden = true; action?.(); };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

function sortTasks(a, b) {
  const pr = (store.PRIORITIES[a.priority]?.rank ?? 2) - (store.PRIORITIES[b.priority]?.rank ?? 2);
  if (a.date !== b.date) return (a.date || '9999') < (b.date || '9999') ? -1 : 1;
  if (pr) return pr;
  if ((a.time || '') !== (b.time || '')) return (a.time || '99') < (b.time || '99') ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

function sortByPriority(a, b) {
  const pr = (store.PRIORITIES[a.priority]?.rank ?? 2) - (store.PRIORITIES[b.priority]?.rank ?? 2);
  return pr || sortTasks(a, b);
}

function matchesFilters(t) {
  if (state.priority && t.priority !== state.priority) return false;
  if (state.person) {
    if (state.person === '__eu' ? t.assignee : t.assignee !== state.person) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    if (![t.title, t.notes, t.assignee].some((x) => x && x.toLowerCase().includes(q))) return false;
  }
  return true;
}

// ---------- Renderização ----------

const objectUrls = new Map();

async function fileUrl(att) {
  if (objectUrls.has(att.id)) return objectUrls.get(att.id);
  let blob = await store.getFile(att.id).catch(() => null);
  if (!blob && att.driveId && g.hasValidToken()) {
    blob = await g.downloadAttachment(att.driveId).catch(() => null);
    if (blob) await store.putFile(att.id, blob);
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(att.id, url);
  return url;
}

function taskCard(t) {
  const today = todayStr();
  const chips = [];
  if (t.date) {
    const late = t.status !== 'feita' && t.date < today;
    const cls = late ? 'late' : t.date === today ? 'today' : '';
    const label = `${t.deadline ? 'até ' : ''}${dateLabel(t.date)}${t.time ? ` · ${t.time}` : ''}`;
    chips.push(`<span class="chip ${cls}">${t.kind === 'compromisso' ? '📅' : '🗓'} ${esc(label)}</span>`);
  }
  if (t.priority && t.priority !== 'normal') {
    chips.push(`<span class="chip prio-${t.priority}">${store.PRIORITIES[t.priority].label}</span>`);
  }
  if (t.assignee) chips.push(`<span class="chip person">👤 ${esc(t.assignee)}</span>`);
  const imgs = (t.attachments || []).filter((a) => a.type === 'image');
  const audios = (t.attachments || []).filter((a) => a.type === 'audio');
  if (audios.length) chips.push('<span class="chip">🎙 áudio</span>');
  if (imgs.length > 1) chips.push(`<span class="chip">📷 ${imgs.length}</span>`);
  if (t.notes) chips.push('<span class="chip">📝</span>');
  if (t.calendar?.eventId) chips.push('<span class="chip" title="No Google Agenda">✓ agenda</span>');

  return `
    <article class="card ${t.status === 'feita' ? 'done' : ''}" data-id="${t.id}" data-priority="${t.priority}">
      <button class="check-btn" data-action="toggle" aria-label="${t.status === 'feita' ? 'Reabrir' : 'Concluir'}"></button>
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        ${chips.length ? `<div class="meta">${chips.join('')}</div>` : ''}
      </div>
      ${imgs.length ? `<img class="thumb" data-file="${imgs[0].id}" alt="">` : ''}
    </article>`;
}

function eventCard(ev) {
  const time = ev.start?.dateTime
    ? new Date(ev.start.dateTime).toTimeString().slice(0, 5)
    : 'dia todo';
  return `
    <article class="card event">
      <div class="body">
        <div class="title">${esc(ev.summary || '(sem título)')}</div>
        <div class="meta"><span class="chip">📅 ${time}</span><span class="chip">Google Agenda</span></div>
      </div>
    </article>`;
}

function group(title, items, { cls = '', render = taskCard } = {}) {
  if (!items.length) return '';
  return `<div class="group-title ${cls}"><span>${title}</span><span>${items.length}</span></div>${items.map(render).join('')}`;
}

function emptyState() {
  const filtered = state.search || state.priority || state.person;
  return filtered
    ? '<div class="empty"><b>Nada encontrado</b>Ajuste os filtros acima.</div>'
    : `<div class="empty"><b>Tudo em dia ✨</b>Escreva, fale ou fotografe lá embaixo.<br>
       Ex.: “pagar DAS dia 20 urgente” ou “reunião com Ana sexta às 15h @Ana”.</div>`;
}

function renderTudo(open) {
  const today = todayStr();
  const tomorrow = todayStr(1);
  const week = todayStr(7);
  const buckets = { late: [], today: [], tomorrow: [], week: [], later: [], none: [] };
  for (const t of open) {
    if (!t.date) buckets.none.push(t);
    else if (t.date < today) buckets.late.push(t);
    else if (t.date === today) buckets.today.push(t);
    else if (t.date === tomorrow) buckets.tomorrow.push(t);
    else if (t.date <= week) buckets.week.push(t);
    else buckets.later.push(t);
  }
  const html = [
    group('Atrasadas', buckets.late.sort(sortTasks), { cls: 'overdue' }),
    group('Hoje', buckets.today.sort(sortTasks)),
    group('Amanhã', buckets.tomorrow.sort(sortTasks)),
    group('Próximos 7 dias', buckets.week.sort(sortTasks)),
    group('Mais adiante', buckets.later.sort(sortTasks)),
    group('Sem data', buckets.none.sort(sortByPriority)),
  ].join('');
  return html || emptyState();
}

function renderAgenda(open) {
  const days = [];
  const events = state.agenda || [];
  const late = open.filter((t) => t.date && t.date < todayStr()).sort(sortTasks);
  let html = group('Atrasadas', late, { cls: 'overdue' });
  for (let i = 0; i < 30; i++) {
    const day = todayStr(i);
    const tasks = open.filter((t) => t.date === day);
    const evs = events.filter((ev) => (ev.start?.date || formatDate(new Date(ev.start?.dateTime))) === day);
    const items = [
      ...evs.map((ev) => ({ sort: ev.start?.dateTime ? new Date(ev.start.dateTime).toTimeString().slice(0, 5) : '00:00', html: eventCard(ev) })),
      ...tasks.map((t) => ({ sort: t.time || (t.kind === 'compromisso' ? '00:00' : store.getSettings().defaultTaskTime), html: taskCard(t) })),
    ].sort((a, b) => (a.sort < b.sort ? -1 : 1));
    if (items.length) {
      days.push(`<div class="group-title"><span>${dateLabel(day)}</span><span>${items.length}</span></div>${items.map((x) => x.html).join('')}`);
    }
  }
  html += days.join('');
  if (!g.isConnected()) {
    html += '<p class="muted small" style="text-align:center">Conecte o Google em Ajustes para ver seus compromissos aqui.</p>';
  }
  return html || emptyState();
}

function renderPessoas(open) {
  const byPerson = new Map();
  for (const t of open) {
    const key = t.assignee || '';
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(t);
  }
  const keys = [...byPerson.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'pt-BR')));
  const html = keys.map((k) => group(k || 'Comigo', byPerson.get(k).sort(sortByPriority))).join('');
  return html || emptyState();
}

function renderFeitas(all) {
  const done = all.filter((t) => t.status === 'feita').sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, 300);
  return group('Concluídas', done) || '<div class="empty"><b>Nada concluído ainda</b>Toque no círculo de uma tarefa para concluir.</div>';
}

function render() {
  const all = store.allTasks().filter(matchesFilters);
  const open = all.filter((t) => t.status !== 'feita');
  const views = { tudo: renderTudo, agenda: renderAgenda, pessoas: renderPessoas };
  $('#list').innerHTML = state.view === 'feitas' ? renderFeitas(all) : views[state.view](open);

  for (const img of $$('img[data-file]')) {
    const task = store.getTask(img.closest('.card').dataset.id);
    const att = task?.attachments.find((a) => a.id === img.dataset.file);
    if (att) fileUrl(att).then((url) => { if (url) img.src = url; else img.remove(); });
  }
  renderPeopleFilter();
  updateBadge(open);
}

function renderPeopleFilter() {
  const sel = $('#filterPerson');
  const current = sel.value;
  const people = store.knownPeople();
  sel.innerHTML = `<option value="">Todos</option><option value="__eu">Comigo</option>${people.map((p) => `<option>${esc(p)}</option>`).join('')}`;
  sel.value = people.includes(current) || current === '__eu' ? current : '';
  $('#peopleList').innerHTML = people.map((p) => `<option value="${esc(p)}">`).join('');
}

function updateBadge(open) {
  const urgent = open.filter((t) => (t.date && t.date <= todayStr()) || t.priority === 'urgente').length;
  if ('setAppBadge' in navigator) (urgent ? navigator.setAppBadge(urgent) : navigator.clearAppBadge()).catch(() => {});
}

async function loadAgenda(force = false) {
  if (!g.hasValidToken()) return;
  if (!force && Date.now() - state.agendaLoadedAt < 5 * 60_000) return;
  try {
    state.agenda = await sync.fetchAgenda(30);
    state.agendaLoadedAt = Date.now();
    if (state.view === 'agenda') render();
  } catch (e) {
    console.warn(e);
  }
}

// ---------- Captura rápida ----------

const input = $('#captureInput');

function parseInput(text) {
  return parseTask(text, { knownPeople: store.knownPeople() });
}

function updatePreview() {
  const text = input.value.trim();
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  const box = $('#preview');
  if (!text) { box.hidden = true; return; }
  const p = parseInput(text);
  const chips = [];
  chips.push(`<span class="chip">${p.kind === 'compromisso' ? '📅 Compromisso' : '☐ Tarefa'}</span>`);
  if (p.date) chips.push(`<span class="chip today">${p.deadline ? 'até ' : ''}${dateLabel(p.date)}${p.time ? ` · ${p.time}` : ''}</span>`);
  if (p.priority) chips.push(`<span class="chip prio-${p.priority}">${store.PRIORITIES[p.priority].label}</span>`);
  if (p.assignee) chips.push(`<span class="chip person">👤 ${esc(p.assignee)}</span>`);
  box.innerHTML = chips.join('');
  box.hidden = false;
}

function createFromText(text, extra = {}) {
  const p = parseInput(text);
  const task = store.createTask({
    title: p.title,
    kind: p.kind,
    date: p.date,
    time: p.time,
    deadline: p.deadline,
    priority: p.priority || 'normal',
    assignee: p.assignee,
    assigneeEmail: store.personEmail(p.assignee),
    ...extra,
  });
  sync.scheduleSync();
  return task;
}

function submitCapture(source = 'texto') {
  const text = input.value.trim();
  if (!text) return;
  const task = createFromText(text, { source });
  input.value = '';
  updatePreview();
  const when = task.date ? ` · ${dateLabel(task.date)}${task.time ? ` ${task.time}` : ''}` : '';
  toast(`Salvo: ${task.title}${when} — toque para editar`, { action: () => openTask(task.id) });
}

input.addEventListener('input', updatePreview);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCapture(); }
});
$('#captureForm').addEventListener('submit', (e) => { e.preventDefault(); submitCapture(); });

// ---------- Foto ----------

async function compressImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

function stamp() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.toTimeString().slice(0, 5)}`;
}

async function makeAttachment(blob, type) {
  const id = store.uid();
  const ext = type === 'image' ? 'jpg' : (blob.type.includes('mp4') ? 'm4a' : 'webm');
  await store.putFile(id, blob);
  return { id, type, name: `${type === 'image' ? 'foto' : 'audio'}-${formatDate(new Date())}-${id}.${ext}`, mime: blob.type };
}

$('#photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const att = await makeAttachment(await compressImage(file), 'image');
  const text = input.value.trim();
  const task = text
    ? createFromText(text, { attachments: [att], source: 'foto' })
    : store.createTask({ title: `Foto de ${stamp()}`, attachments: [att], source: 'foto' });
  input.value = '';
  updatePreview();
  sync.scheduleSync();
  openTask(task.id, { focusTitle: !text });
});

// ---------- Voz ----------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recorder = null;

function showRecording(label, onStop) {
  $('#recordingLabel').textContent = label;
  $('#recording').hidden = false;
  $('#stopRecording').onclick = onStop;
}

function hideRecording() {
  $('#recording').hidden = true;
  $('#micBtn').classList.remove('live');
}

function startDictation() {
  const base = input.value.trim();
  let finalText = '';
  let gotResult = false;
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = (e) => {
    gotResult = true;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += `${r[0].transcript} `;
      else interim += r[0].transcript;
    }
    input.value = `${base ? `${base} ` : ''}${finalText}${interim}`.trim();
    updatePreview();
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') toast('Permita o uso do microfone para ditar.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Não consegui ouvir. Tente de novo ou grave um áudio.');
  };
  recognition.onend = () => {
    recognition = null;
    hideRecording();
    if (gotResult && store.getSettings().autoSaveDictation && input.value.trim()) submitCapture('voz');
  };
  recognition.start();
  $('#micBtn').classList.add('live');
  showRecording('Ouvindo… fale a tarefa', () => recognition?.stop());
}

async function recordAudio() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Este aparelho não permite gravar áudio pelo navegador. Use o microfone do teclado.');
    return null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Permita o uso do microfone para gravar.');
    return null;
  }
  return new Promise((resolve) => {
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      hideRecording();
      recorder = null;
      resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type || 'audio/webm' }) : null);
    };
    recorder.start();
    $('#micBtn').classList.add('live');
    showRecording('Gravando áudio…', () => recorder?.stop());
  });
}

$('#micBtn').addEventListener('click', async () => {
  if (recognition) return recognition.stop();
  if (recorder) return recorder.stop();
  if (SpeechRecognition) return startDictation();
  // Sem reconhecimento de voz (ex.: alguns iPhones): guarda o áudio como anexo.
  const blob = await recordAudio();
  if (!blob) return;
  const att = await makeAttachment(blob, 'audio');
  const task = store.createTask({ title: `Áudio de ${stamp()}`, attachments: [att], source: 'audio' });
  sync.scheduleSync();
  toast('Áudio salvo — toque para dar um título', { action: () => openTask(task.id, { focusTitle: true }) });
});

// ---------- Edição ----------

const taskDialog = $('#taskDialog');
const taskForm = $('#taskForm');

function remindersToValue(r) {
  if (r == null) return '';
  if (!r.length) return 'none';
  const v = r.join(',');
  return [...taskForm.reminders.options].some((o) => o.value === v) ? v : '';
}

async function renderAttachments(task) {
  const box = $('#attachments');
  box.innerHTML = '';
  for (const att of task.attachments || []) {
    const fig = document.createElement('figure');
    const url = await fileUrl(att);
    if (att.type === 'image') {
      fig.innerHTML = url
        ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Foto anexada"></a>`
        : `<a href="${esc(att.driveLink || '#')}" target="_blank" rel="noopener" class="btn small">Abrir foto no Drive</a>`;
    } else {
      fig.innerHTML = url
        ? `<audio controls src="${url}"></audio>`
        : `<a href="${esc(att.driveLink || '#')}" target="_blank" rel="noopener" class="btn small">Ouvir no Drive</a>`;
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove';
    rm.textContent = '✕';
    rm.setAttribute('aria-label', 'Remover anexo');
    rm.onclick = async () => {
      if (!confirm('Remover este anexo?')) return;
      const t = store.updateTask(task.id, { attachments: task.attachments.filter((a) => a.id !== att.id) });
      await store.removeFile(att.id).catch(() => {});
      sync.scheduleSync();
      renderAttachments(t);
    };
    fig.appendChild(rm);
    box.appendChild(fig);
  }
  if (!task.attachments?.length) box.innerHTML = '<span class="muted small">Nenhum anexo.</span>';
}

function openTask(id, { focusTitle = false } = {}) {
  const t = store.getTask(id);
  if (!t) return;
  state.editingId = id;
  const f = taskForm;
  f.title.value = t.title;
  f.kind.value = t.kind;
  f.date.value = t.date || '';
  f.time.value = t.time || '';
  f.deadline.checked = !!t.deadline;
  f.priority.value = t.priority || 'normal';
  f.assignee.value = t.assignee || '';
  f.assigneeEmail.value = t.assigneeEmail || '';
  f.reminders.value = remindersToValue(t.reminders);
  f.notes.value = t.notes || '';
  $('#taskDialogTitle').textContent = t.kind === 'compromisso' ? 'Compromisso' : 'Tarefa';
  $('#toggleDoneBtn').textContent = t.status === 'feita' ? 'Reabrir' : 'Concluir ✓';
  const info = $('#calendarInfo');
  if (t.calendar?.link) info.innerHTML = `No Google Agenda · <a href="${esc(t.calendar.link)}" target="_blank" rel="noopener">abrir evento</a>`;
  else if (t.date && g.isConnected()) info.textContent = 'Será enviado ao Google Agenda na próxima sincronização.';
  else if (t.date) info.textContent = 'Conecte o Google em Ajustes para receber lembretes pela Agenda.';
  else info.textContent = 'Sem data: fica na lista “Sem data” até você definir um dia.';
  renderAttachments(t);
  taskDialog.showModal();
  if (focusTitle) { f.title.focus(); f.title.select(); }
}

taskForm.assignee.addEventListener('change', () => {
  const email = store.personEmail(taskForm.assignee.value.trim());
  if (email && !taskForm.assigneeEmail.value) taskForm.assigneeEmail.value = email;
});

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = taskForm;
  const rem = f.reminders.value;
  const assignee = f.assignee.value.trim() || null;
  const assigneeEmail = f.assigneeEmail.value.trim() || null;
  let date = f.date.value || null;
  const time = f.time.value || null;
  if (time && !date) date = todayStr();
  store.updateTask(state.editingId, {
    title: f.title.value.trim() || 'Sem título',
    kind: f.kind.value,
    date,
    time: date ? time : null,
    deadline: f.deadline.checked,
    priority: f.priority.value,
    assignee,
    assigneeEmail,
    reminders: rem === '' ? null : rem === 'none' ? [] : rem.split(',').map(Number),
    notes: f.notes.value.trim(),
  });
  if (assignee && assigneeEmail) store.rememberPerson(assignee, assigneeEmail);
  sync.scheduleSync();
  taskDialog.close();
});

$('#toggleDoneBtn').addEventListener('click', () => {
  store.toggleDone(state.editingId);
  sync.scheduleSync();
  taskDialog.close();
});

$('#deleteBtn').addEventListener('click', async () => {
  if (!confirm('Excluir esta tarefa? Ela também sai do Google Agenda.')) return;
  const t = store.getTask(state.editingId);
  store.deleteTask(state.editingId);
  for (const a of t.attachments || []) store.removeFile(a.id).catch(() => {});
  sync.scheduleSync();
  taskDialog.close();
  toast('Tarefa excluída.');
});

$('#addPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const att = await makeAttachment(await compressImage(file), 'image');
  const t = store.getTask(state.editingId);
  const updated = store.updateTask(t.id, { attachments: [...(t.attachments || []), att] });
  sync.scheduleSync();
  renderAttachments(updated);
});

$('#recordAudio').addEventListener('click', async () => {
  const blob = await recordAudio();
  if (!blob) return;
  const att = await makeAttachment(blob, 'audio');
  const t = store.getTask(state.editingId);
  const updated = store.updateTask(t.id, { attachments: [...(t.attachments || []), att] });
  sync.scheduleSync();
  renderAttachments(updated);
});

// ---------- Lista ----------

$('#list').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-id]');
  if (!card) return;
  if (e.target.closest('[data-action="toggle"]')) {
    const t = store.toggleDone(card.dataset.id);
    sync.scheduleSync();
    if (t.status === 'feita') toast(`Concluída: ${t.title} — desfazer`, { action: () => { store.toggleDone(t.id); sync.scheduleSync(); } });
    return;
  }
  openTask(card.dataset.id);
});

for (const tab of $$('.tabs button')) {
  tab.addEventListener('click', () => {
    state.view = tab.dataset.view;
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
    if (state.view === 'agenda') loadAgenda();
    render();
    window.scrollTo({ top: 0 });
  });
}
$('#search').addEventListener('input', (e) => { state.search = e.target.value.trim(); render(); });
$('#filterPriority').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
$('#filterPerson').addEventListener('change', (e) => { state.person = e.target.value; render(); });

for (const btn of $$('[data-close]')) btn.addEventListener('click', () => btn.closest('dialog').close());
for (const dlg of $$('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- Ajustes ----------

const settingsDialog = $('#settingsDialog');
const settingsForm = $('#settingsForm');

function personRow(p = { name: '', email: '' }) {
  const row = document.createElement('div');
  row.className = 'person-row';
  row.innerHTML = `<input placeholder="Nome" value="${esc(p.name)}" data-k="name">
    <input type="email" placeholder="e-mail (opcional)" value="${esc(p.email)}" data-k="email">
    <button type="button" class="btn ghost small" aria-label="Remover">✕</button>`;
  row.querySelector('button').onclick = () => row.remove();
  return row;
}

function refreshGoogleState() {
  const s = store.getSettings();
  const connected = g.isConnected();
  $('#googleState').textContent = connected
    ? `Conectado. Eventos vão para: ${s.calendarName}.${s.lastSyncAt ? ` Última sincronização: ${new Date(s.lastSyncAt).toLocaleString('pt-BR')}.` : ''}`
    : s.clientId
      ? 'Não conectado. Conecte para criar eventos com lembrete na sua agenda e ter backup no Drive.'
      : 'Falta configurar o Client ID do Google (veja “Configuração técnica”).';
  $('#connectBtn').textContent = connected ? 'Reconectar' : 'Conectar Google';
  $('#syncBtn').hidden = !connected;
  $('#disconnectBtn').hidden = !connected;
  $('#notifyBtn').textContent = s.localNotifications ? 'Desativar notificações neste aparelho' : 'Ativar notificações neste aparelho';
}

async function loadCalendars() {
  const sel = $('#calendarSelect');
  const s = store.getSettings();
  if (!g.hasValidToken()) {
    sel.innerHTML = `<option value="${esc(s.calendarId)}">${esc(s.calendarName)}</option>`;
    return;
  }
  try {
    const cals = await g.listCalendars();
    sel.innerHTML = cals.map((c) => `<option value="${esc(c.primary ? 'primary' : c.id)}">${esc(c.name)}${c.primary ? ' (principal)' : ''}</option>`).join('');
    sel.value = s.calendarId;
    if (!sel.value) sel.value = 'primary';
  } catch (e) {
    console.warn(e);
  }
}

function openSettings() {
  const s = store.getSettings();
  const f = settingsForm;
  f.clientId.value = s.clientId;
  f.defaultTaskTime.value = s.defaultTaskTime;
  f.appointmentMinutes.value = s.appointmentMinutes;
  f.inviteAssignee.checked = s.inviteAssignee;
  f.autoSaveDictation.checked = s.autoSaveDictation;
  const editor = $('#peopleEditor');
  editor.innerHTML = '';
  s.people.forEach((p) => editor.appendChild(personRow(p)));
  refreshGoogleState();
  loadCalendars();
  settingsDialog.showModal();
}

$('#openSettings').addEventListener('click', openSettings);
$('#addPerson').addEventListener('click', () => $('#peopleEditor').appendChild(personRow()));

function readSettingsForm() {
  const f = settingsForm;
  const sel = $('#calendarSelect');
  const people = $$('.person-row', $('#peopleEditor'))
    .map((r) => ({ name: $('[data-k=name]', r).value.trim(), email: $('[data-k=email]', r).value.trim() }))
    .filter((p) => p.name);
  return {
    clientId: f.clientId.value.trim(),
    calendarId: sel.value || 'primary',
    calendarName: sel.selectedOptions[0]?.textContent.replace(' (principal)', '') || 'Agenda principal',
    defaultTaskTime: f.defaultTaskTime.value || '09:00',
    appointmentMinutes: Math.max(5, parseInt(f.appointmentMinutes.value, 10) || 60),
    inviteAssignee: f.inviteAssignee.checked,
    autoSaveDictation: f.autoSaveDictation.checked,
    people,
  };
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  store.saveSettings(readSettingsForm());
  // Atualiza e-mails das tarefas abertas de quem ganhou e-mail agora.
  for (const t of store.allTasks()) {
    const email = store.personEmail(t.assignee);
    if (t.status !== 'feita' && email && !t.assigneeEmail) store.updateTask(t.id, { assigneeEmail: email }, { silent: true });
  }
  sync.scheduleSync(300);
  settingsDialog.close();
  toast('Ajustes salvos.');
});

async function connectGoogle({ silent = false } = {}) {
  const clientId = settingsDialog.open ? settingsForm.clientId.value.trim() : store.getSettings().clientId;
  try {
    if (clientId !== store.getSettings().clientId) store.saveSettings({ clientId });
    await g.connect(clientId, { silent });
    toast('Google conectado.');
    await sync.syncNow();
    loadAgenda(true);
    if (settingsDialog.open) { refreshGoogleState(); loadCalendars(); }
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

$('#connectBtn').addEventListener('click', () => connectGoogle());
$('#syncBtn').addEventListener('click', async () => { await sync.syncNow(); refreshGoogleState(); loadAgenda(true); });
$('#disconnectBtn').addEventListener('click', () => {
  if (!confirm('Desconectar o Google neste aparelho? Suas tarefas continuam salvas aqui e no Drive.')) return;
  g.disconnect();
  refreshGoogleState();
  render();
});

$('#syncStatus').addEventListener('click', () => {
  const st = sync.getStatus().state;
  if (st === 'auth') connectGoogle({ silent: true });
  else if (st === 'error') sync.syncNow();
});

$('#dailyReviewBtn').addEventListener('click', async () => {
  if (!g.hasValidToken()) return toast('Conecte o Google primeiro.');
  const time = prompt('Horário da revisão diária (seg a sex):', '08:30');
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return;
  const [h, m] = time.split(':').map(Number);
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + 15 * 60_000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = (d) => `${formatDate(d)}T${d.toTimeString().slice(0, 8)}`;
  try {
    await g.insertEvent(store.getSettings().calendarId || 'primary', {
      summary: '🗂 Revisar Liberte Tarefas',
      description: `Revise as tarefas sem data, atrasadas e de hoje.\n${location.href.split('?')[0]}`,
      start: { dateTime: local(start), timeZone: tz },
      end: { dateTime: local(end), timeZone: tz },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      transparency: 'transparent',
    });
    toast(`Revisão diária criada às ${time}, de segunda a sexta.`);
  } catch (e) {
    toast(`Não foi possível criar: ${e.message}`);
  }
});

$('#notifyBtn').addEventListener('click', async () => {
  const s = store.getSettings();
  if (s.localNotifications) {
    store.saveSettings({ localNotifications: false });
    refreshGoogleState();
    return;
  }
  if (!('Notification' in window)) return toast('Este navegador não suporta notificações. Use os lembretes do Google Agenda.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Notificações bloqueadas. Libere nas configurações do navegador.');
  store.saveSettings({ localNotifications: true });
  refreshGoogleState();
  toast('Notificações ativadas enquanto o app estiver aberto ou em segundo plano.');
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `liberte-tarefas-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    store.mergeRemote(data.tasks || []);
    sync.scheduleSync();
    toast(`Backup restaurado (${(data.tasks || []).length} itens).`);
  } catch {
    toast('Arquivo de backup inválido.');
  }
});

// ---------- Lembretes no aparelho ----------

const FIRED_KEY = 'lt.fired.v1';

function checkLocalReminders() {
  const s = store.getSettings();
  if (!s.localNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  let fired = {};
  try { fired = JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch { /* vazio */ }
  const now = Date.now();
  for (const t of store.allTasks()) {
    if (t.status === 'feita' || !t.date) continue;
    if (t.kind === 'compromisso' && !t.time) continue;
    const [y, m, d] = t.date.split('-').map(Number);
    const [h, mi] = (t.time || s.defaultTaskTime).split(':').map(Number);
    const due = new Date(y, m - 1, d, h, mi).getTime();
    const list = t.reminders ?? (t.kind === 'compromisso' ? s.appointmentReminders : s.taskReminders);
    for (const min of list) {
      const at = due - min * 60_000;
      const key = `${t.id}:${t.date}:${t.time}:${min}`;
      if (now >= at && now - at < 15 * 60_000 && !fired[key]) {
        fired[key] = now;
        const when = min === 0 ? 'agora' : min >= 1440 ? 'amanhã' : `em ${min} min`;
        navigator.serviceWorker?.ready.then((reg) => reg.showNotification(t.title, {
          body: `${t.kind === 'compromisso' ? 'Compromisso' : 'Tarefa'} ${when}${t.assignee ? ` · ${t.assignee}` : ''}`,
          tag: key,
          icon: 'icons/icon-192.png',
          data: { url: location.href.split('?')[0] },
        }));
      }
    }
  }
  for (const [k, v] of Object.entries(fired)) if (now - v > 3 * 86_400_000) delete fired[k];
  localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
}

// ---------- Inicialização ----------

function renderSyncStatus({ state: st, message }) {
  const el = $('#syncStatus');
  el.hidden = !g.isConnected();
  el.dataset.state = st;
  el.textContent = st === 'ok' && store.getSettings().lastSyncAt ? 'Google Agenda conectado' : message;
}

store.subscribe((reason) => {
  if (reason === 'change') render();
});
sync.onStatus(renderSyncStatus);

// Texto compartilhado de outro app (ex.: WhatsApp → Compartilhar → Liberte Tarefas)
const params = new URLSearchParams(location.search);
const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
if (shared) {
  input.value = shared;
  updatePreview();
  history.replaceState(null, '', location.pathname);
}
if (params.has('focus')) {
  input.focus();
  history.replaceState(null, '', location.pathname);
}

render();

if (g.isConnected()) {
  if (g.hasValidToken()) {
    sync.syncNow().then(() => loadAgenda(true));
  } else {
    renderSyncStatus({ state: 'auth', message: 'Toque para reconectar ao Google' });
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    sync.scheduleSync(200);
    checkLocalReminders();
  }
});
setInterval(() => sync.scheduleSync(0), 5 * 60_000);
setInterval(checkLocalReminders, 30_000);
checkLocalReminders();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}
