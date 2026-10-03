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
const SESSION_KEY = 'lt.google.session';
// O Google limita apps sem servidor a acessos de 1 hora. O app renova sozinho
// (no próximo toque na tela) até o fim da "sessão do dia", às 18h.
const SESSION_END_HOUR = 18;
const TASKS_FILE = 'liberte-tarefas.json';
const ATTACH_FOLDER = 'Liberte Tarefas - Anexos';

let tokenClient = null;
let clientIdInUse = null;
let pending = null;
let token = loadToken();

// Quem já estava conectado antes da sessão diária existir ganha uma sessão até as 18h.
if (localStorage.getItem(CONNECTED_KEY) === '1' && !readSession().until) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...readSession(), until: nextSessionEnd() }));
}

function loadToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return t && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch { return {}; }
}

function nextSessionEnd(from = new Date()) {
  const end = new Date(from);
  end.setHours(SESSION_END_HOUR, 0, 0, 0);
  if (end <= from) end.setDate(end.getDate() + 1);
  return end.getTime();
}

export function sessionActive() {
  return (readSession().until || 0) > Date.now();
}

export function sessionEnd() {
  return readSession().until || null;
}

export function setAccountEmail(email) {
  const sess = readSession();
  if (email && sess.email !== email) localStorage.setItem(SESSION_KEY, JSON.stringify({ ...sess, email }));
}

// Precisa renovar e ainda está dentro da sessão do dia: dá para renovar num toque.
export function canAutoRenew() {
  return isConnected() && sessionActive() && !(token && token.expiresAt > Date.now() + 5 * 60_000);
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
        // Conexão feita (ou refeita) fora da sessão abre uma nova, até as próximas 18h.
        const sess = readSession();
        if (!sess.until || sess.until <= Date.now()) {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ ...sess, until: nextSessionEnd() }));
        }
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
    const hint = readSession().email;
    client.requestAccessToken({ prompt: silent ? '' : 'consent', ...(hint ? { login_hint: hint } : {}) });
  });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.accessToken, () => {});
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CONNECTED_KEY);
  localStorage.removeItem(SESSION_KEY);
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

let duplicateIds = [];

// Usa o arquivo mais recente. Se dois aparelhos criaram arquivos separados
// (primeira conexão quase simultânea), os outros são juntados e apagados na sincronização.
async function findTasksFile() {
  if (tasksFileId) return tasksFileId;
  const q = encodeURIComponent(`name='${TASKS_FILE}'`);
  const data = await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime%20desc`);
  const files = data.files || [];
  tasksFileId = files[0]?.id || null;
  duplicateIds = files.slice(1).map((f) => f.id);
  return tasksFileId;
}

export async function readDuplicateTasks() {
  await findTasksFile();
  const out = [];
  for (const id of duplicateIds) {
    try {
      const res = await api(`${DRIVE}/files/${id}?alt=media`, { raw: true });
      out.push(await res.json());
    } catch (e) {
      if (e instanceof AuthError) throw e;
    }
  }
  return out;
}

export async function deleteDuplicateTasks() {
  for (const id of duplicateIds) {
    await api(`${DRIVE}/files/${id}`, { method: 'DELETE' }).catch((e) => { if (e instanceof AuthError) throw e; });
  }
  duplicateIds = [];
}

export function accountEmail() {
  return readSession().email || null;
}

// Data da última gravação no Drive (consulta leve, para saber se outro aparelho mudou algo).
export async function remoteModifiedTime() {
  const id = await findTasksFile();
  if (!id) return null;
  const meta = await api(`${DRIVE}/files/${id}?fields=modifiedTime`);
  return meta.modifiedTime;
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
    const meta = await api(`${UPLOAD}/files/${id}?uploadType=media&fields=modifiedTime`, {
      method: 'PATCH', body: blob, headers: { 'Content-Type': 'application/json' },
    });
    return meta?.modifiedTime || null;
  } else {
    const created = await api(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
      method: 'POST', ...multipart({ name: TASKS_FILE, parents: ['appDataFolder'] }, blob),
    });
    tasksFileId = created.id;
    return created.modifiedTime || null;
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
