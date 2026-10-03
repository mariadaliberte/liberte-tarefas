// Servidor do Liberte (Cloudflare Worker + banco D1).
// 1. Login durável: guarda a autorização do Google da dona (refresh token) e entrega
//    acessos novos ao app quando ele pede — sem a janelinha do Google todo dia.
// 2. Caixa de entrada: recebe mensagens (WhatsApp via Make, atalhos, e-mail) que viram tarefas.
// 3. Equipe: cada pessoa entra com o próprio Google, vê as tarefas atribuídas a ela,
//    conclui e comenta; o app da dona recebe essas atualizações.
// Os dados das tarefas continuam no Google Drive da dona; aqui só passa o necessário.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SESSION_DAYS = 180;
const MAX_FILE = 1_800_000; // limite de um anexo da caixa de entrada (~1,8 MB)

const now = () => new Date().toISOString();

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Em testes locais (wrangler dev) qualquer localhost é aceito.
  const ok = allowed.includes(origin) || (env.DEV === '1' && /^http:\/\/localhost(:\d+)?$/.test(origin));
  return ok ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Inbox-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } : { Vary: 'Origin' };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function decodeJwt(idToken) {
  const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(part + '='.repeat((4 - (part.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

const owners = (env) => (env.OWNER_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);

async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

// ---------- Sessões ----------

async function createSession(env, email, device) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, email, device, created_at, last_used) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), email, device || null, now(), now()).run();
  return token;
}

async function auth(env, req) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Sem sessão.');
  const hash = await sha256(m[1]);
  const row = await env.DB.prepare(
    'SELECT s.email, s.last_used, u.role, u.name FROM sessions s JOIN users u ON u.email = s.email WHERE s.token_hash = ?',
  ).bind(hash).first();
  if (!row) throw new HttpError(401, 'Sessão encerrada. Entre de novo.');
  if (Date.now() - Date.parse(row.last_used) > SESSION_DAYS * 86_400_000) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    throw new HttpError(401, 'Sessão expirada. Entre de novo.');
  }
  // Sessão deslizante: cada uso renova o prazo (no máximo uma gravação por hora).
  if (Date.now() - Date.parse(row.last_used) > 3_600_000) {
    await env.DB.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').bind(now(), hash).run();
  }
  return { email: row.email, role: row.role, name: row.name, hash };
}

const requireOwner = (user) => {
  if (user.role !== 'owner') throw new HttpError(403, 'Só a dona da conta pode fazer isso.');
};

// ---------- Google ----------

async function google(env, params) {
  const res = await fetch(env.GOOGLE_TOKEN_URL || GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new HttpError(data.error === 'invalid_grant' ? 401 : 502, data.error_description || data.error || `Google respondeu ${res.status}`);
    err.code = data.error;
    throw err;
  }
  return data;
}

// Login com o código de autorização do Google (janelinha do app, modo "popup").
async function exchange(env, req) {
  const { code, device } = await body(req);
  if (!code) throw new HttpError(400, 'Falta o código do Google.');
  const data = await google(env, { code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
  const claims = decodeJwt(data.id_token || '');
  // O id_token veio direto do Google (HTTPS, com nosso segredo); conferimos o destino mesmo assim.
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !claims.email_verified) throw new HttpError(401, 'Login do Google inválido.');
  const email = String(claims.email).toLowerCase();
  const name = claims.name || email.split('@')[0];

  const isOwner = owners(env).includes(email);
  if (!isOwner) {
    const member = await env.DB.prepare('SELECT name FROM members WHERE email = ?').bind(email).first();
    if (!member) throw new HttpError(403, `${email} ainda não faz parte da equipe. Peça para ser cadastrada(o) em Pessoas, com este e-mail.`);
  }
  const existing = await env.DB.prepare('SELECT refresh_token FROM users WHERE email = ?').bind(email).first();
  // O Google só manda o refresh token na primeira autorização (ou com prompt=consent): guarda o mais novo.
  const refresh = isOwner ? (data.refresh_token || existing?.refresh_token || null) : null;
  await env.DB.prepare(`INSERT INTO users (email, name, role, refresh_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, refresh_token = excluded.refresh_token, updated_at = excluded.updated_at`)
    .bind(email, name, isOwner ? 'owner' : 'member', refresh, now(), now()).run();
  if (isOwner && !refresh) throw new HttpError(409, 'O Google não enviou a autorização permanente. Tente conectar de novo.');

  const session = await createSession(env, email, device);
  return json({
    session, email, name, role: isOwner ? 'owner' : 'member',
    ...(isOwner ? { access_token: data.access_token, expires_in: data.expires_in } : {}),
  });
}

// Acesso novo ao Google para o app da dona (vale ~1 hora; o app pede outro sozinho).
async function token(env, user) {
  requireOwner(user);
  const row = await env.DB.prepare('SELECT refresh_token FROM users WHERE email = ?').bind(user.email).first();
  if (!row?.refresh_token) throw new HttpError(401, 'Conecte o Google de novo.');
  try {
    const data = await google(env, { refresh_token: row.refresh_token, grant_type: 'refresh_token' });
    return json({ access_token: data.access_token, expires_in: data.expires_in, email: user.email });
  } catch (e) {
    if (e.code === 'invalid_grant') {
      // Autorização revogada ou vencida: limpa para o app pedir login de novo.
      await env.DB.prepare('UPDATE users SET refresh_token = NULL WHERE email = ?').bind(user.email).run();
      throw new HttpError(401, 'O Google pediu para conectar de novo.');
    }
    throw e;
  }
}

async function logout(env, user, req) {
  const { everywhere } = await req.json().catch(() => ({}));
  if (everywhere) {
    await env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(user.email).run();
    if (user.role === 'owner') await env.DB.prepare('UPDATE users SET refresh_token = NULL WHERE email = ?').bind(user.email).run();
  } else {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.hash).run();
  }
  return json({ ok: true });
}

// ---------- Caixa de entrada ----------

async function download(url, type, name) {
  if (!/^https:\/\//.test(url)) throw new HttpError(400, 'Link do arquivo inválido.');
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(502, `Não consegui baixar o arquivo (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_FILE) throw new HttpError(413, 'Arquivo grande demais (máx. 1,8 MB).');
  const mime = type || res.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream';
  const ext = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[mime] || 'bin';
  return { name: name || `whatsapp.${ext}`, type: mime, bytes };
}

// Aceita JSON {text, from, mediaUrl?, mediaType?} ou {text, from, file: {name, type, base64}} ou formulário (multipart) com text, from e file.
async function inboxReceive(env, req, url) {
  const key = req.headers.get('X-Inbox-Key') || url.searchParams.get('key') || '';
  if (!env.INBOX_KEY || !safeEqual(key, env.INBOX_KEY)) throw new HttpError(401, 'Chave da caixa de entrada inválida.');
  let text = '';
  let sender = '';
  let file = null;
  const type = req.headers.get('Content-Type') || '';
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    text = String(form.get('text') || '');
    sender = String(form.get('from') || '');
    const f = form.get('file');
    if (f && typeof f !== 'string' && f.size) file = { name: f.name || 'arquivo', type: f.type || 'application/octet-stream', bytes: new Uint8Array(await f.arrayBuffer()) };
  } else {
    const data = await body(req);
    text = String(data.text || '');
    sender = String(data.from || '');
    if (data.file?.base64) {
      const bin = atob(data.file.base64);
      file = { name: data.file.name || 'arquivo', type: data.file.type || 'application/octet-stream', bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    } else if (data.mediaUrl) {
      // Áudio/foto do WhatsApp (Z-API manda um link público do arquivo): o servidor baixa e guarda.
      file = await download(String(data.mediaUrl), data.mediaType, data.mediaName);
    }
  }
  text = text.trim().slice(0, 4000);
  if (!text && !file) throw new HttpError(400, 'Mensagem vazia.');
  if (file && file.bytes.length > MAX_FILE) throw new HttpError(413, 'Arquivo grande demais (máx. 1,8 MB).');
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO inbox (id, text, sender, file_name, file_type, file, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, text, sender.slice(0, 200), file?.name || null, file?.type || null, file?.bytes || null, now()).run();
  return json({ ok: true, id });
}

async function inboxList(env, user) {
  requireOwner(user);
  const { results } = await env.DB.prepare(
    'SELECT id, text, sender, file_name, file_type, created_at FROM inbox ORDER BY created_at LIMIT 50',
  ).all();
  return json({ items: results.map((r) => ({ ...r, has_file: !!r.file_type })) });
}

async function inboxFile(env, user, id) {
  requireOwner(user);
  const row = await env.DB.prepare('SELECT file, file_type, file_name FROM inbox WHERE id = ?').bind(id).first();
  if (!row?.file) throw new HttpError(404, 'Arquivo não encontrado.');
  return new Response(new Uint8Array(row.file), { headers: { 'Content-Type': row.file_type || 'application/octet-stream' } });
}

async function inboxAck(env, user, req) {
  requireOwner(user);
  const { ids = [] } = await body(req);
  for (const id of ids.slice(0, 100)) await env.DB.prepare('DELETE FROM inbox WHERE id = ?').bind(String(id)).run();
  return json({ ok: true });
}

// ---------- Equipe ----------

// O app da dona envia quem é da equipe e as tarefas atribuídas a cada um (substitui o que havia).
async function teamPush(env, user, req) {
  requireOwner(user);
  const { members = [], tasks = [] } = await body(req);
  const valid = members
    .map((m) => ({ email: String(m.email || '').toLowerCase().trim(), name: String(m.name || '').trim() }))
    .filter((m) => /^[^@\s]+@[^@\s]+$/.test(m.email) && m.name);
  const emails = new Set(valid.map((m) => m.email));
  const stmts = [env.DB.prepare('DELETE FROM members'), env.DB.prepare('DELETE FROM team_tasks')];
  for (const m of valid) stmts.push(env.DB.prepare('INSERT OR REPLACE INTO members (email, name) VALUES (?, ?)').bind(m.email, m.name));
  for (const t of tasks.slice(0, 2000)) {
    const email = String(t.assigneeEmail || '').toLowerCase();
    if (!t.id || !emails.has(email)) continue;
    const data = {
      id: t.id, title: t.title, notes: t.notes || '', date: t.date || null, time: t.time || null,
      deadline: !!t.deadline, priority: t.priority || 'normal', status: t.status, kind: t.kind,
      checklist: t.checklist || [], project: t.project || null, comments: t.comments || [],
    };
    stmts.push(env.DB.prepare('INSERT OR REPLACE INTO team_tasks (id, assignee_email, data, updated_at) VALUES (?, ?, ?, ?)')
      .bind(String(t.id), email, JSON.stringify(data), now()));
  }
  // Quem saiu da equipe perde o acesso na hora.
  const { results } = await env.DB.prepare("SELECT email FROM users WHERE role = 'member'").all();
  for (const r of results) {
    if (!emails.has(r.email)) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE email = ?').bind(r.email));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, members: valid.length });
}

async function teamUpdates(env, user) {
  requireOwner(user);
  const { results } = await env.DB.prepare('SELECT * FROM team_updates ORDER BY id LIMIT 200').all();
  return json({ items: results });
}

async function teamAck(env, user, req) {
  requireOwner(user);
  const { upTo } = await body(req);
  await env.DB.prepare('DELETE FROM team_updates WHERE id <= ?').bind(Number(upTo) || 0).run();
  return json({ ok: true });
}

// Pessoa da equipe: suas tarefas.
async function myTasks(env, user) {
  const { results } = await env.DB.prepare('SELECT data FROM team_tasks WHERE assignee_email = ?').bind(user.email).all();
  return json({ name: user.name, email: user.email, tasks: results.map((r) => JSON.parse(r.data)) });
}

// Pessoa da equipe conclui, reabre ou comenta uma tarefa sua.
async function myUpdate(env, user, req, id) {
  const row = await env.DB.prepare('SELECT data, assignee_email FROM team_tasks WHERE id = ?').bind(id).first();
  if (!row || (row.assignee_email !== user.email && user.role !== 'owner')) throw new HttpError(404, 'Tarefa não encontrada.');
  const { status, comment, checklist } = await body(req);
  const data = JSON.parse(row.data);
  const stmts = [];
  const add = (kind, value) => stmts.push(env.DB.prepare(
    'INSERT INTO team_updates (task_id, member_email, member_name, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, user.email, user.name, kind, value, now()));
  if (status === 'feita' || status === 'aberta') { data.status = status; add('status', status); }
  if (typeof comment === 'string' && comment.trim()) {
    const c = { by: user.name, text: comment.trim().slice(0, 2000), at: now() };
    data.comments = [...(data.comments || []), c];
    add('comment', c.text);
  }
  if (Array.isArray(checklist)) {
    data.checklist = checklist.slice(0, 100).map((c) => ({ id: String(c.id), text: String(c.text).slice(0, 300), done: !!c.done }));
    add('checklist', JSON.stringify(data.checklist));
  }
  if (!stmts.length) throw new HttpError(400, 'Nada para atualizar.');
  stmts.push(env.DB.prepare('UPDATE team_tasks SET data = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(data), now(), id));
  await env.DB.batch(stmts);
  return json({ ok: true, task: data });
}

// ---------- Rotas ----------

async function route(env, req) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  if (p === '/' && m === 'GET') return json({ ok: true, app: 'Liberte', time: now() });
  if (p === '/auth/exchange' && m === 'POST') return exchange(env, req);
  if (p === '/inbox' && m === 'POST') return inboxReceive(env, req, url);

  const user = await auth(env, req);
  if (p === '/auth/token' && m === 'POST') return token(env, user);
  if (p === '/auth/logout' && m === 'POST') return logout(env, user, req);
  if (p === '/me' && m === 'GET') return json({ email: user.email, name: user.name, role: user.role });
  if (p === '/inbox' && m === 'GET') return inboxList(env, user);
  if (p === '/inbox/ack' && m === 'POST') return inboxAck(env, user, req);
  let r = /^\/inbox\/([\w-]+)\/file$/.exec(p);
  if (r && m === 'GET') return inboxFile(env, user, r[1]);
  if (p === '/team' && m === 'PUT') return teamPush(env, user, req);
  if (p === '/team/updates' && m === 'GET') return teamUpdates(env, user);
  if (p === '/team/updates/ack' && m === 'POST') return teamAck(env, user, req);
  if (p === '/my/tasks' && m === 'GET') return myTasks(env, user);
  r = /^\/my\/tasks\/([^/]+)$/.exec(p);
  if (r && m === 'POST') return myUpdate(env, user, req, decodeURIComponent(r[1]));
  throw new HttpError(404, 'Rota não encontrada.');
}

export default {
  async fetch(req, env) {
    const headers = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    try {
      const res = await route(env, req);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? 'Erro interno.' : e.message }, status, headers);
    }
  },
};
