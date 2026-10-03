// Página da equipe: cada pessoa entra com o próprio Google e vê só as tarefas
// atribuídas a ela. Pode concluir, reabrir, marcar o checklist e comentar.
// Tudo passa pelo servidor; o app da dona recebe as atualizações sozinho.

import { CONFIG } from './config.js';

const KEY = 'lt.team.v1';
const server = (CONFIG.serverUrl || '').replace(/\/+$/, '');
const main = document.getElementById('main');
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let tasks = [];

function session() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(server + path, {
    method,
    headers: { Authorization: `Bearer ${session()?.session}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    localStorage.removeItem(KEY);
    showLogin(data.error);
    throw new Error(data.error || 'Entre de novo.');
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Não foi possível carregar o login do Google.'));
    document.head.appendChild(s);
  });
}

async function login() {
  await loadGis();
  const code = await new Promise((resolve, reject) => {
    google.accounts.oauth2.initCodeClient({
      client_id: CONFIG.googleClientId,
      scope: 'openid email profile',
      ux_mode: 'popup',
      prompt: 'select_account',
      callback: (r) => (r.error ? reject(new Error(r.error)) : resolve(r.code)),
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Login cancelado.' : 'Falha no login do Google.')),
    }).requestCode();
  });
  const res = await fetch(`${server}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, device: 'equipe' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  localStorage.setItem(KEY, JSON.stringify({ session: data.session, email: data.email, name: data.name }));
}

function showLogin(error = '') {
  $('#logout').hidden = true;
  main.innerHTML = `<div class="center">
    <h2 style="text-transform:none;letter-spacing:0;font-size:20px;color:inherit">Suas tarefas na Liberte</h2>
    <p>Entre com a conta Google do e-mail que a Mariá cadastrou para você.</p>
    <button class="btn primary" id="loginBtn">Entrar com Google</button>
    ${error ? `<p class="error">${esc(error)}</p>` : ''}
  </div>`;
  $('#loginBtn').onclick = async () => {
    try {
      await login();
      await load();
    } catch (e) {
      showLogin(e.message);
    }
  };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function dateLabel(t) {
  if (!t.date) return '';
  const [y, m, d] = t.date.split('-').map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${t.deadline ? 'até ' : ''}${s}${t.time ? ` · ${t.time}` : ''}`;
}

function card(t) {
  const late = t.status !== 'feita' && t.date && t.date < today();
  const chips = [];
  if (t.date) chips.push(`<span class="chip${late ? ' late' : ''}">${late ? 'Atrasada · ' : ''}${esc(dateLabel(t))}</span>`);
  if (t.priority === 'urgente' || t.priority === 'alta') chips.push(`<span class="chip ${t.priority}">${t.priority === 'urgente' ? 'Urgente' : 'Alta'}</span>`);
  if (t.project) chips.push(`<span class="chip">${esc(t.project)}</span>`);
  const checklist = (t.checklist || []).map((c, i) => `<li><label><input type="checkbox" data-ck="${i}" ${c.done ? 'checked' : ''}> ${esc(c.text)}</label></li>`).join('');
  const comments = (t.comments || []).map((c) => `💬 ${esc(c.by)}: ${esc(c.text)}`).join('\n');
  return `<article class="card${t.status === 'feita' ? ' done' : ''}" data-id="${esc(t.id)}">
    <div class="top"><div class="title">${esc(t.title)}</div></div>
    ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}
    ${checklist ? `<ul class="checklist">${checklist}</ul>` : ''}
    ${comments ? `<div class="notes">${comments}</div>` : ''}
    <div class="row">
      ${t.status === 'feita'
    ? '<button class="btn" data-act="reabrir">Reabrir</button>'
    : '<button class="btn primary" data-act="concluir">✓ Concluir</button>'}
      <input placeholder="Comentar (ex.: enviei por e-mail)" data-comment aria-label="Comentário">
      <button class="btn" data-act="comentar">Enviar</button>
    </div>
  </article>`;
}

function render() {
  const s = session();
  $('#logout').hidden = false;
  const open = tasks.filter((t) => t.status !== 'feita');
  const done = tasks.filter((t) => t.status === 'feita');
  const by = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99');
  const groups = [
    ['Atrasadas', open.filter((t) => t.date && t.date < today())],
    ['Hoje', open.filter((t) => t.date === today())],
    ['Próximas', open.filter((t) => t.date && t.date > today())],
    ['Sem data', open.filter((t) => !t.date)],
    ['Concluídas recentemente', done],
  ];
  main.innerHTML = `<p>Olá, <b>${esc(s?.name || s?.email)}</b>. ${open.length ? `Você tem ${open.length} ${open.length === 1 ? 'tarefa aberta' : 'tarefas abertas'}.` : 'Nenhuma tarefa aberta. 🎉'}</p>
    ${groups.filter(([, list]) => list.length).map(([name, list]) => `<h2>${name}</h2>${list.sort(by).map(card).join('')}`).join('')}`;
}

async function load() {
  const data = await api('/my/tasks');
  tasks = data.tasks;
  render();
}

async function update(id, body, okMsg) {
  try {
    const { task } = await api(`/my/tasks/${encodeURIComponent(id)}`, { method: 'POST', body });
    tasks = tasks.map((t) => (t.id === id ? task : t));
    render();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(e.message);
  }
}

main.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const el = btn.closest('.card');
  const id = el.dataset.id;
  if (btn.dataset.act === 'concluir') update(id, { status: 'feita' }, 'Concluída. A Mariá já vai ver.');
  if (btn.dataset.act === 'reabrir') update(id, { status: 'aberta' }, 'Tarefa reaberta.');
  if (btn.dataset.act === 'comentar') {
    const text = $('[data-comment]', el).value.trim();
    if (text) update(id, { comment: text }, 'Comentário enviado.');
  }
});
main.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('[data-comment]')) $('[data-act="comentar"]', e.target.closest('.card')).click();
});
main.addEventListener('change', (e) => {
  if (!e.target.matches('[data-ck]')) return;
  const el = e.target.closest('.card');
  const t = tasks.find((x) => x.id === el.dataset.id);
  const checklist = t.checklist.map((c, i) => (i === Number(e.target.dataset.ck) ? { ...c, done: e.target.checked } : c));
  update(t.id, { checklist });
});
$('#logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  localStorage.removeItem(KEY);
  showLogin();
};

if (!server) {
  main.innerHTML = '<div class="center"><p>O acesso da equipe ainda não foi ativado.</p></div>';
} else if (session()) {
  load().catch((e) => { if (session()) main.innerHTML = `<div class="center"><p class="error">${esc(e.message)}</p></div>`; });
} else {
  showLogin();
}
setInterval(() => { if (session() && document.visibilityState === 'visible') load().catch(() => {}); }, 60_000);
