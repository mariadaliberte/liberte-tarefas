// Teste de ponta a ponta do servidor rodando localmente (wrangler dev + D1 local),
// com um "Google" falso para a troca de códigos e tokens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8799;
const GPORT = 8798;
const BASE = `http://localhost:${PORT}`;
const CLIENT = '559871219811-frs39k63p0hfc22f42ofdrt3p5687fro.apps.googleusercontent.com';
const ORIGIN = 'http://localhost:8080';
let worker;
let gserver;
const refreshCalls = [];

const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const people = {
  'code-dona': { email: 'dona@x.com', name: 'Mariá', refresh: 'rt-dona' },
  'code-ana': { email: 'ana@x.com', name: 'Ana' },
  'code-intruso': { email: 'intruso@x.com', name: 'Intruso' },
};

before(async () => {
  gserver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const f = new URLSearchParams(raw);
      const send = (status, o) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (f.get('client_secret') !== 'segredo') return send(401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        const p = people[f.get('code')];
        if (!p || f.get('redirect_uri') !== 'postmessage') return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: `at-${p.name}`, expires_in: 3599, refresh_token: p.refresh, id_token: jwt({ aud: CLIENT, email: p.email, email_verified: true, name: p.name }) });
      }
      refreshCalls.push(f.get('refresh_token'));
      if (f.get('refresh_token') === 'rt-dona') return send(200, { access_token: `at-novo-${refreshCalls.length}`, expires_in: 3599 });
      return send(400, { error: 'invalid_grant' });
    });
  }).listen(GPORT);

  const state = mkdtempSync(join(tmpdir(), 'liberte-d1-'));
  const wr = './node_modules/.bin/wrangler';
  execFileSync(wr, ['d1', 'execute', 'liberte', '--local', '--persist-to', state, '--file=schema.sql'], { stdio: 'ignore' });
  worker = spawn(wr, ['dev', '--local', '--port', String(PORT), '--persist-to', state,
    '--var', `GOOGLE_TOKEN_URL:http://localhost:${GPORT}/token`, '--var', 'DEV:1', '--var', 'OWNER_EMAILS:dona@x.com',
    '--var', 'GOOGLE_CLIENT_SECRET:segredo', '--var', 'INBOX_KEY:chave-inbox'], { stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev não subiu');
});

after(() => { worker?.kill(); gserver?.close(); });

const call = (path, { method = 'GET', session, body, headers = {} } = {}) => fetch(BASE + path, {
  method,
  headers: { Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session}` } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

let dona;

test('login da dona guarda a autorização e entrega acessos novos sem janelinha', async () => {
  const res = await call('/auth/exchange', { method: 'POST', body: { code: 'code-dona', device: 'tablet' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  const data = await res.json();
  assert.equal(data.role, 'owner');
  assert.equal(data.access_token, 'at-Mariá');
  assert.ok(data.session.length > 30);
  dona = data.session;
  const t = await (await call('/auth/token', { method: 'POST', session: dona })).json();
  assert.match(t.access_token, /^at-novo-/);
  assert.deepEqual(refreshCalls, ['rt-dona']);
  assert.equal((await call('/auth/token', { method: 'POST', session: 'falsa' })).status, 401);
});

test('caixa de entrada: Make envia, app lê arquivo e confirma', async () => {
  assert.equal((await call('/inbox', { method: 'POST', body: { text: 'oi' } })).status, 401);
  let res = await call('/inbox', { method: 'POST', headers: { 'X-Inbox-Key': 'chave-inbox' }, body: { text: 'Ligar para Joana amanhã às 10h', from: 'WhatsApp +55 11 9999' } });
  assert.equal(res.status, 200);
  const form = new FormData();
  form.append('text', '');
  form.append('from', 'WhatsApp');
  form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/ogg' }), 'audio.ogg');
  res = await fetch(`${BASE}/inbox?key=chave-inbox`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  res = await call('/inbox', { method: 'POST', headers: { 'X-Inbox-Key': 'chave-inbox' }, body: { text: 'x', mediaUrl: 'http://inseguro/a.ogg' } });
  assert.equal(res.status, 400);
  const { items } = await (await call('/inbox', { session: dona })).json();
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'Ligar para Joana amanhã às 10h');
  const audio = items.find((i) => i.has_file);
  const bytes = new Uint8Array(await (await call(`/inbox/${audio.id}/file`, { session: dona })).arrayBuffer());
  assert.deepEqual([...bytes], [1, 2, 3, 4]);
  await call('/inbox/ack', { method: 'POST', session: dona, body: { ids: items.map((i) => i.id) } });
  assert.equal((await (await call('/inbox', { session: dona })).json()).items.length, 0);
});

test('equipe: só quem foi cadastrado entra, vê as próprias tarefas, conclui e comenta', async () => {
  let res = await call('/auth/exchange', { method: 'POST', body: { code: 'code-ana' } });
  assert.equal(res.status, 403);
  await call('/team', { method: 'PUT', session: dona, body: {
    members: [{ name: 'Ana', email: 'ANA@x.com' }],
    tasks: [
      { id: 't1', title: 'Revisar contrato', assigneeEmail: 'ana@x.com', status: 'aberta', date: '2026-10-05', priority: 'alta' },
      { id: 't2', title: 'Tarefa da Bia', assigneeEmail: 'bia@x.com', status: 'aberta' },
    ],
  } });
  res = await call('/auth/exchange', { method: 'POST', body: { code: 'code-ana' } });
  const ana = await res.json();
  assert.equal(ana.role, 'member');
  assert.equal(ana.access_token, undefined);
  assert.equal((await call('/auth/token', { method: 'POST', session: ana.session })).status, 403);
  assert.equal((await call('/inbox', { session: ana.session })).status, 403);
  const mine = await (await call('/my/tasks', { session: ana.session })).json();
  assert.deepEqual(mine.tasks.map((t) => t.title), ['Revisar contrato']);
  assert.equal((await call('/my/tasks/t2', { method: 'POST', session: ana.session, body: { status: 'feita' } })).status, 404);
  res = await call('/my/tasks/t1', { method: 'POST', session: ana.session, body: { status: 'feita', comment: 'Enviei por e-mail' } });
  assert.equal((await res.json()).task.status, 'feita');
  const { items } = await (await call('/team/updates', { session: dona })).json();
  assert.deepEqual(items.map((u) => `${u.member_name}:${u.kind}:${u.value}`), ['Ana:status:feita', 'Ana:comment:Enviei por e-mail']);
  await call('/team/updates/ack', { method: 'POST', session: dona, body: { upTo: items.at(-1).id } });
  assert.equal((await (await call('/team/updates', { session: dona })).json()).items.length, 0);
  // Saiu da equipe: perde o acesso.
  await call('/team', { method: 'PUT', session: dona, body: { members: [], tasks: [] } });
  assert.equal((await call('/my/tasks', { session: ana.session })).status, 401);
  assert.equal((await call('/auth/exchange', { method: 'POST', body: { code: 'code-intruso' } })).status, 403);
});

test('autorização revogada no Google pede novo login', async () => {
  // Simula: a dona revogou o acesso nas configurações da conta Google.
  people['code-dona'].refresh = 'rt-revogado';
  const s = (await (await call('/auth/exchange', { method: 'POST', body: { code: 'code-dona' } })).json()).session;
  assert.equal((await call('/auth/token', { method: 'POST', session: s })).status, 401);
  assert.equal((await call('/auth/token', { method: 'POST', session: s })).status, 401);
});

test('outras origens não recebem permissão de CORS', async () => {
  const res = await fetch(BASE + '/', { headers: { Origin: 'https://site-estranho.com' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
