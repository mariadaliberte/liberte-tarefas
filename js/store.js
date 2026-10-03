import { nextOccurrence } from './recurrence.js';

// Armazenamento local: tarefas e configurações no localStorage,
// fotos e áudios no IndexedDB (cabe muito mais que o localStorage).

const TASKS_KEY = 'lt.tasks.v1';
const PROJECTS_KEY = 'lt.projects.v1';
const NOTES_KEY = 'lt.notes.v1';
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
  focusEnabled: true,
  focusTime: '08:00',
  people: [],
  lastSyncAt: null,
};

const listeners = new Set();
let tasks = load(TASKS_KEY, []);
let projects = load(PROJECTS_KEY, []);
let notes = load(NOTES_KEY, []);
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

function persistProjects() {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function persistNotes() {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
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

export function restoreTask(id) {
  return updateTask(id, { deleted: false });
}

export function toggleDone(id) {
  const task = getTask(id);
  if (!task) return null;
  const done = task.status !== 'feita';
  // Recorrente: guarda a conclusão no histórico e a tarefa segue para a próxima data.
  if (done && task.recurrence) {
    const now = new Date().toISOString();
    const base = task.date || now.slice(0, 10);
    tasks.unshift({
      ...task, id: uid(), status: 'feita', doneAt: now, recurrence: null, seriesId: task.id,
      calendar: null, noCalendar: true, attachments: [], createdAt: now, updatedAt: now,
    });
    const next = nextOccurrence(task.recurrence, base);
    const shift = (d) => {
      if (!d || !task.date) return null;
      const diff = Math.round((Date.parse(`${next}T12:00`) - Date.parse(`${task.date}T12:00`)) / 86_400_000);
      const dt = new Date(`${d}T12:00`);
      dt.setDate(dt.getDate() + diff);
      return dt.toISOString().slice(0, 10);
    };
    return updateTask(id, {
      date: next,
      startDate: shift(task.startDate),
      checklist: (task.checklist || []).map((c) => ({ ...c, done: false })),
      lastDoneAt: now,
    });
  }
  return updateTask(id, { status: done ? 'feita' : 'aberta', doneAt: done ? new Date().toISOString() : null });
}

// ---- Checklist ----

export function setChecklist(id, checklist) {
  return updateTask(id, { checklist });
}

// Mescla dados vindos de outro aparelho (via Google Drive): vence a edição mais recente.
// Aceita o formato antigo (lista de tarefas) e o atual ({ tasks, projects, notes }).
export function mergeRemote(remote) {
  const data = Array.isArray(remote) ? { tasks: remote } : remote || {};
  let changed = false;
  const merge = (local, incoming) => {
    const byId = new Map(local.map((x) => [x.id, x]));
    let dirty = false;
    for (const r of incoming || []) {
      const l = byId.get(r.id);
      const merged = l ? mergeTask(l, r) : r;
      if (!l || JSON.stringify(merged) !== JSON.stringify(l)) {
        byId.set(r.id, merged);
        dirty = true;
      }
    }
    return dirty ? [...byId.values()].sort((x, y) => (y.createdAt > x.createdAt ? 1 : -1)) : null;
  };
  const t = merge(tasks, data.tasks);
  if (t) { tasks = t; persist(); changed = true; }
  const p = merge(projects, data.projects);
  if (p) { projects = p; persistProjects(); changed = true; }
  const n = merge(notes, data.notes);
  if (n) { notes = n; persistNotes(); changed = true; }
  if (data.settings?.updatedAt && data.settings.updatedAt > (settings.settingsUpdatedAt || '')) {
    // Pessoas: junta as listas (quem foi cadastrado em qualquer aparelho permanece).
    const people = mergePeople(data.settings.values.people || [], settings.people || []);
    saveSettings({ ...data.settings.values, people, settingsUpdatedAt: data.settings.updatedAt }, { fromRemote: true });
    changed = true;
  } else if (data.settings?.values?.people) {
    const people = mergePeople(settings.people || [], data.settings.values.people);
    if (people.length !== (settings.people || []).length) {
      saveSettings({ people });
      changed = true;
    }
  }
  if (changed) emit('change');
  return changed;
}

// União por nome (sem diferenciar maiúsculas); a primeira lista tem prioridade no e-mail.
export function mergePeople(primary, secondary) {
  const out = [...primary];
  const seen = new Set(primary.map((p) => p.name.toLowerCase()));
  for (const p of secondary) {
    if (!seen.has(p.name.toLowerCase())) {
      out.push(p);
      seen.add(p.name.toLowerCase());
    } else if (p.email) {
      const i = out.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
      if (!out[i].email) out[i] = { ...out[i], email: p.email };
    }
  }
  return out;
}

// Registros de exclusão servem para avisar os outros aparelhos; depois de 120 dias
// já foram propagados e só aumentam o arquivo. Devolve os anexos a apagar do aparelho.
export function purgeTombstones(now = Date.now(), days = 120) {
  const limit = new Date(now - days * 86_400_000).toISOString();
  const old = (x) => x.deleted && (x.updatedAt || '') < limit;
  const files = [...tasks, ...notes].filter(old).flatMap((x) => (x.attachments || []).map((a) => a.id));
  const before = tasks.length + notes.length + projects.length;
  tasks = tasks.filter((x) => !old(x));
  notes = notes.filter((x) => !old(x));
  projects = projects.filter((x) => !old(x));
  if (tasks.length + notes.length + projects.length !== before) {
    persist(); persistNotes(); persistProjects();
  }
  return files;
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

function sharedSettings() {
  const values = {};
  for (const k of SYNCED_SETTINGS) if (settings[k] !== undefined) values[k] = settings[k];
  return { values, updatedAt: settings.settingsUpdatedAt || '' };
}

export function exportData() {
  return { version: 3, exportedAt: new Date().toISOString(), tasks, projects, notes, settings: sharedSettings() };
}

// ---- Projetos ----

export const PROJECT_COLORS = ['#5b2a4e', '#c9963b', '#2f7d6d', '#3e6fb0', '#c2552d', '#7a5cc4', '#b03a6b', '#5c6b73'];

export function allProjects({ includeArchived = true } = {}) {
  return projects.filter((p) => !p.deleted && (includeArchived || p.status !== 'arquivado'));
}

export function getProject(id) {
  return id ? projects.find((p) => p.id === id && !p.deleted) || null : null;
}

export function createProject(data) {
  const now = new Date().toISOString();
  const project = {
    id: uid(), name: 'Novo projeto', description: '', color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
    status: 'ativo', deleted: false, createdAt: now, ...data, updatedAt: now,
  };
  projects.unshift(project);
  persistProjects();
  emit('change');
  return project;
}

export function updateProject(id, patch) {
  const project = projects.find((p) => p.id === id);
  if (!project) return null;
  Object.assign(project, patch, { updatedAt: new Date().toISOString() });
  persistProjects();
  emit('change');
  return project;
}

// Excluir o projeto apaga as anotações dele; as tarefas continuam, sem projeto.
export function deleteProject(id) {
  for (const t of tasks) if (t.projectId === id && !t.deleted) updateTask(t.id, { projectId: null }, { silent: true });
  for (const n of notes) if (n.projectId === id && !n.deleted) updateNote(n.id, { deleted: true }, { silent: true });
  return updateProject(id, { deleted: true });
}

export function projectTasks(id) {
  return tasks.filter((t) => t.projectId === id && !t.deleted);
}

// ---- Anotações (de projeto) ----

export function allNotes({ includeDeleted = false } = {}) {
  return includeDeleted ? notes : notes.filter((n) => !n.deleted);
}

export function projectNotes(id) {
  return notes.filter((n) => n.projectId === id && !n.deleted).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getNote(id) {
  return notes.find((n) => n.id === id && !n.deleted) || null;
}

export function createNote(data) {
  const now = new Date().toISOString();
  const note = {
    id: uid(), projectId: null, title: '', body: '', attachments: [], converted: [],
    deleted: false, createdAt: now, ...data, updatedAt: now,
  };
  notes.unshift(note);
  persistNotes();
  emit('change');
  return note;
}

export function updateNote(id, patch, { silent = false, touch = true } = {}) {
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  Object.assign(note, patch);
  if (touch) note.updatedAt = new Date().toISOString();
  persistNotes();
  if (!silent) emit('change');
  return note;
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

// Ajustes compartilhados entre aparelhos (o resto é de cada aparelho).
const SYNCED_SETTINGS = [
  'people', 'calendarId', 'calendarName', 'defaultTaskTime', 'appointmentMinutes',
  'appointmentReminders', 'taskReminders', 'inviteAssignee', 'templateId', 'templateDriveId', 'projectTemplates',
  'focusEnabled', 'focusTime',
];

export function notify(reason) {
  emit(reason);
}

export function saveSettings(patch, { fromRemote = false } = {}) {
  if (!fromRemote && Object.keys(patch).some((k) => SYNCED_SETTINGS.includes(k))) {
    patch = { ...patch, settingsUpdatedAt: new Date().toISOString() };
  }
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
