// Conexão com Google: login (Google Identity Services), Google Agenda e Google Drive.
// Roda 100% no navegador — não existe servidor intermediário guardando seus dados.

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

const TOKEN_KEY = 'lt.google.token';
const CONNECTED_KEY = 'lt.google.connected';
const TASKS_FILE = 'liberte-tarefas.json';
const ATTACH_FOLDER = 'Liberte Tarefas - Anexos';

let tokenClient = null;
let clientIdInUse = null;
let pending = null;
let token = loadToken();

function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return t && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

export function isConnected() {
  return localStorage.getItem(CONNECTED_KEY) === '1';
}

export function hasValidToken() {
  return !!(token && token.expiresAt > Date.now() + 60_000);
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o login do Google. Verifique a internet.'));
    document.head.appendChild(s);
  });
}

async function getClient(clientId) {
  if (!clientId) throw new Error('Configure o Client ID do Google em Ajustes.');
  await loadGis();
  if (!tokenClient || clientIdInUse !== clientId) {
    clientIdInUse = clientId;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (!pending) return;
        const { resolve, reject } = pending;
        pending = null;
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES.split(' '))) {
          return reject(new Error('Marque todas as permissões (Agenda e Drive) para o app funcionar.'));
        }
        token = { accessToken: resp.access_token, expiresAt: Date.now() + resp.expires_in * 1000 };
        localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
        localStorage.setItem(CONNECTED_KEY, '1');
        resolve(token);
      },
      error_callback: (err) => {
        if (!pending) return;
        const { reject } = pending;
        pending = null;
        reject(new Error(err?.type === 'popup_closed' ? 'Login cancelado.' : 'Falha no login do Google.'));
      },
    });
  }
  return tokenClient;
}

// Precisa ser chamado a partir de um toque/clique (o Google abre uma janelinha).
export async function connect(clientId, { silent = false } = {}) {
  const client = await getClient(clientId);
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.accessToken, () => {});
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CONNECTED_KEY);
}

export class AuthError extends Error {}

async function api(url, { method = 'GET', body, headers = {}, raw = false } = {}) {
  if (!hasValidToken()) throw new AuthError('Sessão do Google expirada.');
  const res = await fetch(url, {
    method,
    body,
    headers: { Authorization: `Bearer ${token.accessToken}`, ...headers },
  });
  if (res.status === 401) {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    throw new AuthError('Sessão do Google expirada.');
  }
  if (res.status === 204 || res.status === 410) return null;
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch { /* sem corpo */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

const json = (data) => ({ body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });

// ---- Google Agenda ----

const CAL = 'https://www.googleapis.com/calendar/v3';

export async function listCalendars() {
  const data = await api(`${CAL}/users/me/calendarList?minAccessRole=writer`);
  return data.items.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary }));
}

export async function listEvents(calendarId, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const data = await api(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return data.items || [];
}

export function insertEvent(calendarId, event, sendUpdates = 'none') {
  return api(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`, {
    method: 'POST', ...json(event),
  });
}

export function patchEvent(calendarId, eventId, event, sendUpdates = 'none') {
  return api(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=${sendUpdates}`, {
    method: 'PATCH', ...json(event),
  });
}

export async function deleteEvent(calendarId, eventId) {
  try {
    await api(`${CAL}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { method: 'DELETE' });
  } catch (e) {
    if (e.status !== 404) throw e;
  }
}

// ---- Google Drive ----

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

function multipart(metadata, blob) {
  const boundary = `lt${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  return { body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
}

let tasksFileId = null;

async function findTasksFile() {
  if (tasksFileId) return tasksFileId;
  const q = encodeURIComponent(`name='${TASKS_FILE}'`);
  const data = await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  tasksFileId = data.files[0]?.id || null;
  return tasksFileId;
}

export async function readRemoteTasks() {
  const id = await findTasksFile();
  if (!id) return null;
  const res = await api(`${DRIVE}/files/${id}?alt=media`, { raw: true });
  return res.json();
}

export async function writeRemoteTasks(data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const id = await findTasksFile();
  if (id) {
    await api(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH', body: blob, headers: { 'Content-Type': 'application/json' },
    });
  } else {
    const created = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST', ...multipart({ name: TASKS_FILE, parents: ['appDataFolder'] }, blob),
    });
    tasksFileId = created.id;
  }
}

let folderId = null;

async function attachmentsFolder() {
  if (folderId) return folderId;
  const q = encodeURIComponent(
    `name='${ATTACH_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const data = await api(`${DRIVE}/files?q=${q}&fields=files(id)`);
  if (data.files[0]) return (folderId = data.files[0].id);
  const created = await api(`${DRIVE}/files?fields=id`, {
    method: 'POST',
    ...json({ name: ATTACH_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (folderId = created.id);
}

export async function uploadAttachment(blob, name) {
  const parent = await attachmentsFolder();
  return api(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST', ...multipart({ name, parents: [parent] }, blob),
  });
}

export async function downloadAttachment(driveId) {
  const res = await api(`${DRIVE}/files/${driveId}?alt=media`, { raw: true });
  return res.blob();
}
