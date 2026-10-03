// Sincronização: Drive (backup e outros aparelhos) + Google Agenda (lembretes).

import * as store from './store.js';
import * as g from './google.js';
import { buildEvent, eventHash } from './event-map.js';
import { buildFocusEvent, focusEventId } from './focus.js';
import { parseTask, formatDate } from './parser.js';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');

let running = null;
let lastRemoteModified = null;
const TEMPLATE_ID = 'nb-template';
const TEMPLATE_LOCAL_KEY = 'lt.template.localId';
let again = false;
let timer = null;
const statusListeners = new Set();
let status = { state: 'idle', message: '' };

function setStatus(state, message = '') {
  status = { state, message };
  for (const fn of statusListeners) fn(status);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status);
}

export function getStatus() {
  return status;
}

export function scheduleSync(delay = 1500) {
  if (!g.isConnected()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

function authMessage() {
  if (g.serverUrl()) return 'Toque aqui para conectar o Google (uma vez só)';
  return g.sessionActive() ? 'Toque na tela para reconectar ao Google' : 'Sessão do dia encerrada (18h) — toque para reconectar';
}

// Compara o conteúdo sem depender da ordem das listas nem da hora da exportação.
function canonical(data) {
  if (!data) return '';
  const byId = (list) => [...(list || [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  return JSON.stringify({
    tasks: byId(data.tasks), projects: byId(data.projects), notes: byId(data.notes), settings: data.settings || null,
  });
}

export async function syncNow() {
  if (!g.isConnected()) return;
  if (!(await g.ensureToken())) {
    setStatus('auth', authMessage());
    return;
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setStatus('syncing', 'Sincronizando…');
    try {
      const modified = await g.remoteModifiedTime();
      const remote = modified ? await g.readRemoteTasks() : null;
      if (remote) store.mergeRemote(remote);
      const duplicates = await g.readDuplicateTasks();
      for (const d of duplicates) store.mergeRemote(d);
      await syncTemplate();
      await uploadAttachments();
      await syncCalendar();
      await syncFocus().catch((e) => console.warn('Foco do dia:', e));
      await pushTeam().catch((e) => console.warn('Equipe:', e));
      // Só grava no Drive quando há algo novo (evita um aparelho "acordar" o outro à toa).
      const payload = store.exportData();
      lastRemoteModified = !duplicates.length && canonical(payload) === canonical(remote)
        ? modified
        : await g.writeRemoteTasks(payload);
      if (duplicates.length) await g.deleteDuplicateTasks();
      store.saveSettings({ lastSyncAt: new Date().toISOString() });
      for (const id of store.purgeTombstones()) store.removeFile(id).catch(() => {});
      setStatus('ok', 'Sincronizado');
    } catch (e) {
      console.error(e);
      if (e instanceof g.AuthError) setStatus('auth', authMessage());
      else setStatus('error', `Não sincronizou: ${e.message}`);
    } finally {
      running = null;
      if (again) {
        again = false;
        scheduleSync(500);
      }
    }
  })();
  return running;
}

// Verificação leve e frequente: se outro aparelho gravou algo, sincroniza na hora.
export async function checkRemote() {
  if (running || !g.isConnected() || !(await g.ensureToken())) return;
  pollServer();
  try {
    const modified = await g.remoteModifiedTime();
    if (modified && modified !== lastRemoteModified) await syncNow();
  } catch (e) {
    if (e instanceof g.AuthError) setStatus('auth', authMessage());
  }
}

// Modelo da folha do Caderno: enviado ao Drive por um aparelho, baixado pelos outros.
async function syncTemplate() {
  const s = store.getSettings();
  const localId = localStorage.getItem(TEMPLATE_LOCAL_KEY);
  if (s.templateId && localId === s.templateId && !s.templateDriveId) {
    const blob = await store.getFile(TEMPLATE_ID);
    if (blob) {
      const file = await g.uploadAttachment(blob, `modelo-folha-${s.templateId}.jpg`);
      store.saveSettings({ templateDriveId: file.id });
    }
  } else if (s.templateId && localId !== s.templateId && s.templateDriveId) {
    const blob = await g.downloadAttachment(s.templateDriveId);
    await store.putFile(TEMPLATE_ID, blob);
    localStorage.setItem(TEMPLATE_LOCAL_KEY, s.templateId);
    store.notify('template');
  } else if (!s.templateId && localId) {
    await store.removeFile(TEMPLATE_ID).catch(() => {});
    localStorage.removeItem(TEMPLATE_LOCAL_KEY);
    store.notify('template');
  }
}

async function uploadAttachments() {
  const items = [
    ...store.allTasks().map((x) => [x, store.updateTask]),
    ...store.allNotes().map((x) => [x, store.updateNote]),
  ];
  for (const [task, update] of items) {
    let changed = false;
    const attachments = [];
    for (const a of task.attachments || []) {
      if (a.driveId) { attachments.push(a); continue; }
      const blob = await store.getFile(a.id);
      if (!blob) { attachments.push(a); continue; }
      const file = await g.uploadAttachment(blob, a.name);
      attachments.push({ ...a, driveId: file.id, driveLink: file.webViewLink });
      changed = true;
    }
    if (changed) update(task.id, { attachments }, { silent: true, touch: false });
  }
}

async function syncCalendar() {
  const settings = store.getSettings();
  for (const task of store.allTasks({ includeDeleted: true })) {
    const projectName = store.getProject(task.projectId)?.name;
    const event = buildEvent(task, settings, { timeZone, appUrl, projectName });
    const cal = task.calendar;

    if (!event) {
      if (cal?.eventId) {
        await g.deleteEvent(cal.calendarId, cal.eventId);
        store.updateTask(task.id, { calendar: null }, { silent: true, touch: false });
      }
      continue;
    }

    const hash = eventHash(event);
    const calendarId = settings.calendarId || 'primary';
    if (cal?.eventId && cal.hash === hash && cal.calendarId === calendarId) continue;

    const invite = event.attendees.length && (!cal || cal.invited !== task.assigneeEmail) ? 'all' : 'none';
    let saved = null;
    if (cal?.eventId && cal.calendarId === calendarId) {
      try {
        saved = await g.patchEvent(calendarId, cal.eventId, event, invite);
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    } else if (cal?.eventId) {
      await g.deleteEvent(cal.calendarId, cal.eventId);
    }
    if (!saved) saved = await g.insertEvent(calendarId, event, invite);

    store.updateTask(task.id, {
      calendar: {
        calendarId,
        eventId: saved.id,
        link: saved.htmlLink,
        hash,
        invited: task.assigneeEmail || null,
        syncedAt: new Date().toISOString(),
      },
    }, { silent: true, touch: false });
  }
}

// Resumo da manhã: mantém o evento "Foco do dia" de hoje e de amanhã em dia.
const FOCUS_KEY = 'lt.focus.v1';

function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function syncFocus() {
  const settings = store.getSettings();
  const calendarId = settings.calendarId || 'primary';
  let sent = {};
  try { sent = JSON.parse(localStorage.getItem(FOCUS_KEY)) || {}; } catch { /* vazio */ }
  const now = new Date();
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const tasks = store.allTasks();
  const next = {};
  for (const date of [today, tomorrow]) {
    const event = settings.focusEnabled === false ? null
      : buildFocusEvent(tasks, date, { time: settings.focusTime || '08:00', timeZone, appUrl });
    const hash = event ? `${calendarId}|${eventHash(event)}` : `${calendarId}|-`;
    next[date] = hash;
    if (sent[date] === hash) continue;
    const old = sent[date]?.split('|')[0];
    if (old && old !== calendarId) await g.deleteEvent(old, focusEventId(date));
    if (!event) {
      if (sent[date] !== undefined || settings.focusEnabled === false) await g.deleteEvent(calendarId, focusEventId(date));
      continue;
    }
    const { id, ...body } = event;
    try {
      await g.patchEvent(calendarId, id, body);
    } catch (e) {
      if (e.status !== 404) throw e;
      try {
        await g.insertEvent(calendarId, event);
      } catch (e2) {
        if (e2.status !== 409) throw e2;
        await g.patchEvent(calendarId, id, body); // outro aparelho criou ao mesmo tempo
      }
    }
  }
  localStorage.setItem(FOCUS_KEY, JSON.stringify(next));
}

// Eventos da agenda (os que não foram criados pelo app) entre duas datas (AAAA-MM-DD, fim exclusivo).
export async function fetchAgenda(fromDate, toDate) {
  if (!(await g.ensureToken())) return null;
  const settings = store.getSettings();
  const [y1, m1, d1] = fromDate.split('-').map(Number);
  const [y2, m2, d2] = toDate.split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1);
  const end = new Date(y2, m2 - 1, d2);
  const ids = [...new Set(['primary', settings.calendarId || 'primary'])];
  if (!g.hasValidToken()) return null;
  // Cada evento guarda de qual agenda veio (para editar/excluir no lugar certo).
  const lists = await Promise.all(ids.map((id) => g.listEvents(id, start, end)
    .then((items) => items.map((ev) => ({ ...ev, calendarId: id })))
    .catch(() => [])));
  const seen = new Set();
  return lists.flat().filter((ev) => {
    if (ev.status === 'cancelled' || ev.extendedProperties?.private?.ltTaskId || ev.extendedProperties?.private?.ltFocus) return false;
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });
}

// ---------- Servidor: caixa de entrada (WhatsApp/Make) e equipe ----------

const TEAM_HASH_KEY = 'lt.team.hash';
const activityListeners = new Set();
let lastPoll = 0;
let polling = false;

export function onActivity(fn) {
  activityListeners.add(fn);
}

function activity(message) {
  for (const fn of activityListeners) fn(message);
}

const isOwner = () => g.serverSession()?.role === 'owner';

// Leve: no máximo a cada 45 s, só com servidor configurado e conectado.
export async function pollServer(force = false) {
  if (!isOwner() || polling || (!force && Date.now() - lastPoll < 45_000)) return;
  polling = true;
  lastPoll = Date.now();
  try {
    await pullInbox();
    await pullTeamUpdates();
  } catch (e) {
    console.warn('Servidor:', e.message);
  } finally {
    polling = false;
  }
}

function attachmentType(mime, name) {
  if ((mime || '').startsWith('image/')) return 'image';
  if ((mime || '').startsWith('audio/') || /\.(ogg|opus|m4a|mp3)$/i.test(name || '')) return 'audio';
  return 'file';
}

async function pullInbox() {
  const { items } = await g.serverFetch('/inbox');
  if (!items.length) return;
  const done = [];
  let created = 0;
  for (const it of items) {
    // Id fixo por mensagem: se dois aparelhos (ou duas abas) lerem juntos, vira uma tarefa só.
    const taskId = `in${it.id.replace(/-/g, '')}`;
    done.push(it.id);
    if (store.allTasks({ includeDeleted: true }).some((t) => t.id === taskId)) continue;
    created++;
    const attachments = [];
    if (it.has_file) {
      const blob = await (await g.serverFetch(`/inbox/${it.id}/file`, { raw: true })).blob();
      const id = `${taskId}f`;
      await store.putFile(id, blob);
      attachments.push({ id, type: attachmentType(it.file_type, it.file_name), name: it.file_name || `arquivo-${formatDate(new Date())}-${id}`, mime: it.file_type });
    }
    const when = new Date(it.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const notes = it.sender ? `Recebido de ${it.sender} em ${when}.` : `Recebido em ${when}.`;
    if (it.text) {
      const p = parseTask(it.text, {
        knownPeople: store.knownPeople(),
        knownProjects: store.allProjects({ includeArchived: false }).map((x) => x.name),
      });
      store.createTask({
        title: p.title, kind: p.kind, date: p.date, time: p.time, deadline: p.deadline, priority: p.priority || 'normal',
        assignee: p.assignee, assigneeEmail: store.personEmail(p.assignee), recurrence: p.recurrence,
        projectId: p.project ? store.allProjects().find((x) => x.name === p.project)?.id || null : null,
        notes, attachments, source: 'entrada', id: taskId,
      });
    } else {
      const kind = attachments[0]?.type === 'audio' ? 'Áudio' : attachments[0]?.type === 'image' ? 'Foto' : 'Arquivo';
      store.createTask({ title: `${kind} recebido ${when}`, notes, attachments, source: 'entrada', id: taskId });
    }
  }
  await g.serverFetch('/inbox/ack', { method: 'POST', body: { ids: done } });
  if (!created) return;
  activity(created === 1 ? 'Chegou 1 tarefa pela caixa de entrada.' : `Chegaram ${created} tarefas pela caixa de entrada.`);
  scheduleSync(300);
}

async function pullTeamUpdates() {
  const { items } = await g.serverFetch('/team/updates');
  if (!items.length) return;
  const msgs = [];
  for (const u of items) {
    const t = store.getTask(u.task_id);
    // teamSeq: última atualização já aplicada (evita aplicar duas vezes vindo de dois aparelhos).
    if (!t || t.deleted || (t.teamSeq || 0) >= u.id) continue;
    const who = u.member_name || u.member_email;
    if (u.kind === 'status' && u.value === 'feita' && t.status !== 'feita') {
      store.toggleDone(t.id);
      msgs.push(`${who} concluiu “${t.title}”`);
    } else if (u.kind === 'status' && u.value === 'aberta' && t.status === 'feita') {
      store.updateTask(t.id, { status: 'aberta', doneAt: null });
      msgs.push(`${who} reabriu “${t.title}”`);
    } else if (u.kind === 'comment') {
      const when = new Date(u.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const notes = `${t.notes ? `${t.notes}\n\n` : ''}💬 ${who} (${when}): ${u.value}`;
      store.updateTask(t.id, { notes });
      msgs.push(`${who} comentou em “${t.title}”`);
    } else if (u.kind === 'checklist') {
      try { store.setChecklist(t.id, JSON.parse(u.value)); } catch { /* ignora */ }
    }
    store.updateTask(t.id, { teamSeq: u.id }, { silent: true });
  }
  await g.serverFetch('/team/updates/ack', { method: 'POST', body: { upTo: items.at(-1).id } });
  if (msgs.length) activity(msgs.length > 2 ? `${msgs[0]} e mais ${msgs.length - 1} atualizações da equipe.` : msgs.join(' · '));
  scheduleSync(300);
}

// Envia ao servidor quem é da equipe e as tarefas de cada pessoa (só quando algo mudou).
async function pushTeam() {
  if (!isOwner()) return;
  // Primeiro aplica o que a equipe já fez (para não sobrescrever uma conclusão recente).
  await pullTeamUpdates();
  const settings = store.getSettings();
  const members = (settings.people || []).filter((p) => p.email).map((p) => ({ name: p.name, email: p.email.toLowerCase() }));
  const emails = new Set(members.map((m) => m.email));
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const tasks = store.allTasks()
    .filter((t) => t.assigneeEmail && emails.has(t.assigneeEmail.toLowerCase()) && (t.status !== 'feita' || (t.doneAt || t.updatedAt || '') > cutoff))
    .map((t) => ({
      id: t.id, title: t.title, notes: t.notes || '', date: t.date, time: t.time, deadline: !!t.deadline,
      priority: t.priority, status: t.status, kind: t.kind, checklist: t.checklist || [],
      assigneeEmail: t.assigneeEmail.toLowerCase(), project: store.getProject(t.projectId)?.name || null,
    }));
  const payload = { members, tasks };
  const hash = eventHash(payload);
  let prev = {};
  try { prev = JSON.parse(localStorage.getItem(TEAM_HASH_KEY)) || {}; } catch { /* vazio */ }
  if (prev.hash === hash && Date.now() - (prev.at || 0) < 6 * 3_600_000) return;
  await g.serverFetch('/team', { method: 'PUT', body: payload });
  localStorage.setItem(TEAM_HASH_KEY, JSON.stringify({ hash, at: Date.now() }));
}
