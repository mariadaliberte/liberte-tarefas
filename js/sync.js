// Sincronização: Drive (backup e outros aparelhos) + Google Agenda (lembretes).

import * as store from './store.js';
import * as g from './google.js';
import { buildEvent, eventHash } from './event-map.js';

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');

let running = null;
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

export async function syncNow() {
  if (!g.isConnected()) return;
  if (!g.hasValidToken()) {
    setStatus('auth', 'Toque para reconectar ao Google');
    return;
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setStatus('syncing', 'Sincronizando…');
    try {
      const remote = await g.readRemoteTasks();
      if (remote) store.mergeRemote(remote);
      await uploadAttachments();
      await syncCalendar();
      await g.writeRemoteTasks(store.exportData());
      store.saveSettings({ lastSyncAt: new Date().toISOString() });
      setStatus('ok', 'Sincronizado');
    } catch (e) {
      console.error(e);
      if (e instanceof g.AuthError) setStatus('auth', 'Toque para reconectar ao Google');
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

// Eventos da agenda (os que não foram criados pelo app) para mostrar junto das tarefas.
export async function fetchAgenda(days = 7) {
  if (!g.hasValidToken()) return null;
  const settings = store.getSettings();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const ids = [...new Set(['primary', settings.calendarId || 'primary'])];
  const lists = await Promise.all(ids.map((id) => g.listEvents(id, start, end).catch(() => [])));
  const seen = new Set();
  return lists.flat().filter((ev) => {
    if (ev.status === 'cancelled' || ev.extendedProperties?.private?.ltTaskId) return false;
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });
}
