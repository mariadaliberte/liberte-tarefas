// Armazenamento local: tarefas e configurações no localStorage,
// fotos e áudios no IndexedDB (cabe muito mais que o localStorage).

const TASKS_KEY = 'lt.tasks.v1';
const SETTINGS_KEY = 'lt.settings.v1';

export const PRIORITIES = {
  urgente: { label: 'Urgente', rank: 0 },
  alta: { label: 'Alta', rank: 1 },
  normal: { label: 'Normal', rank: 2 },
  baixa: { label: 'Baixa', rank: 3 },
};

export const DEFAULT_SETTINGS = {
  clientId: '',
  calendarId: 'primary',
  calendarName: 'Agenda principal',
  defaultTaskTime: '09:00',
  appointmentMinutes: 60,
  appointmentReminders: [30, 1440],
  taskReminders: [0, 1440],
  autoSaveDictation: true,
  localNotifications: false,
  inviteAssignee: true,
  people: [],
  lastSyncAt: null,
};

const listeners = new Set();
let tasks = load(TASKS_KEY, []);
let settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- Tarefas ----

export function allTasks({ includeDeleted = false } = {}) {
  return includeDeleted ? tasks : tasks.filter((t) => !t.deleted);
}

export function getTask(id) {
  return tasks.find((t) => t.id === id);
}

export function createTask(data) {
  const now = new Date().toISOString();
  const task = {
    id: uid(),
    title: '',
    notes: '',
    kind: 'tarefa',
    date: null,
    time: null,
    deadline: false,
    priority: 'normal',
    assignee: null,
    assigneeEmail: null,
    status: 'aberta',
    doneAt: null,
    attachments: [],
    reminders: null,
    calendar: null,
    source: 'texto',
    deleted: false,
    createdAt: now,
    ...data,
    updatedAt: now,
  };
  tasks.unshift(task);
  persist();
  emit('change');
  return task;
}

export function updateTask(id, patch, { silent = false, touch = true } = {}) {
  const task = getTask(id);
  if (!task) return null;
  Object.assign(task, patch);
  if (touch) task.updatedAt = new Date().toISOString();
  persist();
  if (!silent) emit('change');
  return task;
}

export function deleteTask(id) {
  // Mantém um "registro de exclusão" para a sincronização entre aparelhos.
  return updateTask(id, { deleted: true });
}

export function toggleDone(id) {
  const task = getTask(id);
  if (!task) return null;
  const done = task.status !== 'feita';
  return updateTask(id, { status: done ? 'feita' : 'aberta', doneAt: done ? new Date().toISOString() : null });
}

// Mescla tarefas vindas de outro aparelho (via Google Drive): vence a edição mais recente.
export function mergeRemote(remoteTasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let changed = false;
  for (const remote of remoteTasks || []) {
    const local = byId.get(remote.id);
    if (!local) {
      byId.set(remote.id, remote);
      changed = true;
      continue;
    }
    const merged = mergeTask(local, remote);
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      byId.set(remote.id, merged);
      changed = true;
    }
  }
  if (changed) {
    tasks = [...byId.values()].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    persist();
    emit('change');
  }
  return changed;
}

// Dados de integração (evento da Agenda, arquivo no Drive) são gravados sem mudar
// updatedAt, então são mesclados à parte: vence o que foi sincronizado por último.
function mergeTask(local, remote) {
  const winner = remote.updatedAt > local.updatedAt ? remote : local;
  const other = winner === remote ? local : remote;
  const calSyncedAt = (t) => t.calendar?.syncedAt || '';
  const calendar = calSyncedAt(remote) > calSyncedAt(local) ? remote.calendar : local.calendar;
  const otherFiles = new Map((other.attachments || []).map((a) => [a.id, a]));
  const attachments = (winner.attachments || []).map((a) => {
    const o = otherFiles.get(a.id);
    return a.driveId || !o?.driveId ? a : { ...a, driveId: o.driveId, driveLink: o.driveLink };
  });
  return { ...winner, calendar, attachments };
}

export function exportData() {
  return { version: 1, exportedAt: new Date().toISOString(), tasks };
}

// ---- Pessoas (responsáveis) ----

export function knownPeople() {
  const names = new Set(settings.people.map((p) => p.name));
  for (const t of tasks) if (t.assignee && !t.deleted) names.add(t.assignee);
  return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function personEmail(name) {
  if (!name) return null;
  const p = settings.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return p?.email || null;
}

export function rememberPerson(name, email) {
  if (!name) return;
  const people = settings.people.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  const existing = settings.people.find((p) => p.name.toLowerCase() === name.toLowerCase());
  people.push({ name, email: email || existing?.email || '' });
  saveSettings({ people });
}

// ---- Configurações ----

export function getSettings() {
  return settings;
}

export function saveSettings(patch) {
  settings = { ...settings, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  emit('settings');
  return settings;
}

// ---- Arquivos (IndexedDB) ----

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('liberte-tarefas', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const t = database.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putFile = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
export const getFile = (id) => tx('readonly', (s) => s.get(id));
export const removeFile = (id) => tx('readwrite', (s) => s.delete(id));
