// Sincronização: Drive (backup e outros aparelhos) + Google Agenda (lembretes).

import * as store from './store.js';
import * as g from './google.js';
import { buildEvent, eventHash } from './event-map.js';

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
  if (!g.hasValidToken()) {
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
      await syncTemplate();
      await uploadAttachments();
      await syncCalendar();
      // Só grava no Drive quando há algo novo (evita um aparelho "acordar" o outro à toa).
      const payload = store.exportData();
      lastRemoteModified = canonical(payload) === canonical(remote)
        ? modified
        : await g.writeRemoteTasks(payload);
      store.saveSettings({ lastSyncAt: new Date().toISOString() });
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
  if (running || !g.isConnected() || !g.hasValidToken()) return;
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

// Eventos da agenda (os que não foram criados pelo app) entre duas datas (AAAA-MM-DD, fim exclusivo).
export async function fetchAgenda(fromDate, toDate) {
  if (!g.hasValidToken()) return null;
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
    if (ev.status === 'cancelled' || ev.extendedProperties?.private?.ltTaskId) return false;
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });
}
