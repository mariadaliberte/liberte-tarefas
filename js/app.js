import * as store from './store.js';
import * as g from './google.js';
import * as sync from './sync.js';
import { parseTask, formatDate } from './parser.js';
import { CONFIG } from './config.js';
import { initNotebook, fileToImages } from './notebook.js';
import { initProjects } from './projects.js';
import * as week from './week.js';
import { initDashboard } from './dashboard.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  view: 'tudo',
  search: '',
  priority: '',
  person: '',
  agenda: null,
  agendaLoadedAt: 0,
  editingId: null,
  projectId: null,
  projectTab: 'tarefas',
};

if (!store.getSettings().clientId && CONFIG.googleClientId) {
  store.saveSettings({ clientId: CONFIG.googleClientId });
}

// ---------- Utilidades ----------

function localGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function localSet(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* sem armazenamento */ }
}

// Tema: automático (segue o aparelho), claro ou escuro.
function applyTheme(choice) {
  localSet('lt.theme', choice === 'auto' ? '' : choice);
  const root = document.documentElement;
  if (choice === 'claro') root.dataset.theme = 'light';
  else if (choice === 'escuro') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  const dark = root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1e1a1d' : '#5b2a4e');
}

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return formatDate(d);
}

function dateLabel(date) {
  if (!date) return '';
  if (date === todayStr()) return 'Hoje';
  if (date === todayStr(1)) return 'Amanhã';
  if (date === todayStr(-1)) return 'Ontem';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const label = `${WEEKDAY[dt.getDay()]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  return y === new Date().getFullYear() ? label : `${label}/${y}`;
}

function toast(msg, { action, ms = 3500 } = {}) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.onclick = () => { el.hidden = true; action?.(); };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

// Confirmação dentro do app (no lugar da janela padrão do navegador).
function ask(message, okLabel = 'Confirmar') {
  const dlg = $('#confirmDialog');
  $('#confirmText').textContent = message;
  $('#confirmOk').textContent = okLabel;
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

function sortTasks(a, b) {
  const pr = (store.PRIORITIES[a.priority]?.rank ?? 2) - (store.PRIORITIES[b.priority]?.rank ?? 2);
  if (a.date !== b.date) return (a.date || '9999') < (b.date || '9999') ? -1 : 1;
  if (pr) return pr;
  if ((a.time || '') !== (b.time || '')) return (a.time || '99') < (b.time || '99') ? -1 : 1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

function sortByPriority(a, b) {
  const pr = (store.PRIORITIES[a.priority]?.rank ?? 2) - (store.PRIORITIES[b.priority]?.rank ?? 2);
  return pr || sortTasks(a, b);
}

function matchesFilters(t) {
  if (state.priority && t.priority !== state.priority) return false;
  if (state.person) {
    if (state.person === '__eu' ? t.assignee : t.assignee !== state.person) return false;
  }
  // Dentro de um projeto o filtro de projeto não se aplica.
  if (state.project && state.view !== 'projetos') {
    if (state.project === '__sem' ? store.getProject(t.projectId) : t.projectId !== state.project) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    if (![t.title, t.notes, t.assignee].some((x) => x && x.toLowerCase().includes(q))) return false;
  }
  return true;
}

// ---------- Renderização ----------

const objectUrls = new Map();

async function fileUrl(att) {
  if (objectUrls.has(att.id)) return objectUrls.get(att.id);
  let blob = await store.getFile(att.id).catch(() => null);
  if (!blob && att.driveId && g.hasValidToken()) {
    blob = await g.downloadAttachment(att.driveId).catch(() => null);
    if (blob) await store.putFile(att.id, blob);
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(att.id, url);
  return url;
}

const SOURCE_LABEL = { texto: 'digitada', voz: 'por voz', foto: 'por foto', audio: 'por áudio', caderno: 'no caderno' };

function daysSince(iso) {
  const a = new Date(iso);
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - start) / 86_400_000);
}

function shortDate(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function createdChip(t) {
  if (t.status === 'feita' && t.doneAt) {
    return `<span class="chip age">criada ${shortDate(t.createdAt)} · feita ${shortDate(t.doneAt)}</span>`;
  }
  const days = daysSince(t.createdAt);
  const label = days === 0 ? 'criada hoje' : days === 1 ? 'criada ontem' : `criada ${shortDate(t.createdAt)}`;
  const stale = days >= 7 ? ` · há ${days} dias` : '';
  return `<span class="chip age${stale ? ' stale' : ''}" title="Data de criação">${label}${stale}</span>`;
}

function taskCard(t) {
  const today = todayStr();
  const chips = [];
  if (t.date) {
    const late = t.status !== 'feita' && t.date < today;
    const cls = late ? 'late' : t.date === today ? 'today' : '';
    const label = `${t.deadline ? 'até ' : ''}${dateLabel(t.date)}${t.time ? ` · ${t.time}` : ''}`;
    chips.push(`<span class="chip ${cls}">${t.kind === 'compromisso' ? '📅' : '🗓'} ${esc(label)}</span>`);
  }
  if (t.priority && t.priority !== 'normal') {
    chips.push(`<span class="chip prio-${t.priority}">${store.PRIORITIES[t.priority].label}</span>`);
  }
  if (t.assignee) chips.push(`<span class="chip person">👤 ${esc(t.assignee)}</span>`);
  const project = store.getProject(t.projectId);
  if (project && !(state.view === 'projetos' && state.projectId === project.id)) {
    chips.push(`<span class="chip project" style="--pc:${esc(project.color)}">${esc(project.name)}</span>`);
  }
  const imgs = (t.attachments || []).filter((a) => a.type === 'image');
  const audios = (t.attachments || []).filter((a) => a.type === 'audio');
  if (audios.length) chips.push('<span class="chip">🎙 áudio</span>');
  if (imgs.length > 1) chips.push(`<span class="chip">📷 ${imgs.length}</span>`);
  if (t.notes) chips.push('<span class="chip">📝</span>');
  if (t.calendar?.eventId) chips.push('<span class="chip" title="No Google Agenda">✓ agenda</span>');
  chips.push(createdChip(t));

  return `
    <article class="card ${t.status === 'feita' ? 'done' : ''}" data-id="${t.id}" data-priority="${t.priority}">
      <button class="check-btn" data-action="toggle" aria-label="${t.status === 'feita' ? 'Reabrir' : 'Concluir'}"></button>
      <div class="body">
        <div class="title">${esc(t.title)}</div>
        ${chips.length ? `<div class="meta">${chips.join('')}</div>` : ''}
      </div>
      ${imgs.length ? `<img class="thumb" data-file="${imgs[0].id}" alt="">` : ''}
    </article>`;
}

function eventCard(ev) {
  const time = ev.start?.dateTime
    ? new Date(ev.start.dateTime).toTimeString().slice(0, 5)
    : 'dia todo';
  return `
    <article class="card event">
      <div class="body">
        <div class="title">${esc(ev.summary || '(sem título)')}</div>
        <div class="meta"><span class="chip">📅 ${time}</span><span class="chip">Google Agenda</span></div>
      </div>
    </article>`;
}

function group(title, items, { cls = '', render = taskCard } = {}) {
  if (!items.length) return '';
  return `<div class="group-title ${cls}"><span>${title}</span><span>${items.length}</span></div>${items.map(render).join('')}`;
}

function emptyState() {
  const filtered = state.search || state.priority || state.person;
  return filtered
    ? '<div class="empty"><b>Nada encontrado</b>Ajuste os filtros acima.</div>'
    : `<div class="empty"><b>Tudo em dia ✨</b>Escreva, fale ou fotografe lá embaixo.<br>
       Ex.: “pagar DAS dia 20 urgente” ou “reunião com Ana sexta às 15h @Ana”.</div>`;
}

function renderTudo(open) {
  const today = todayStr();
  const tomorrow = todayStr(1);
  const week = todayStr(7);
  const buckets = { late: [], today: [], tomorrow: [], week: [], later: [], none: [] };
  for (const t of open) {
    if (!t.date) buckets.none.push(t);
    else if (t.date < today) buckets.late.push(t);
    else if (t.date === today) buckets.today.push(t);
    else if (t.date === tomorrow) buckets.tomorrow.push(t);
    else if (t.date <= week) buckets.week.push(t);
    else buckets.later.push(t);
  }
  const actions = '<div class="list-actions"><button type="button" class="btn primary" data-new-task>+ Nova tarefa</button></div>';
  const html = [
    group('Atrasadas', buckets.late.sort(sortTasks), { cls: 'overdue' }),
    group('Hoje', buckets.today.sort(sortTasks)),
    group('Amanhã', buckets.tomorrow.sort(sortTasks)),
    group('Próximos 7 dias', buckets.week.sort(sortTasks)),
    group('Mais adiante', buckets.later.sort(sortTasks)),
    group('Sem data', buckets.none.sort(sortByPriority)),
  ].join('');
  return actions + (html || emptyState());
}

// ---------- Agenda no formato do Google Agenda ----------

const GCAL_COLORS = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
};
const WEEKDAY_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MONTH_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTH_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

let agendaHour = null;
function hourH() {
  if (agendaHour == null) agendaHour = Number(localGet('lt.agenda.hour')) || week.HOUR_HEIGHT;
  return agendaHour;
}

// Zoom da agenda: muda só a altura da hora (sem redesenhar), mantendo o horário sob o dedo.
function setHourHeight(next, anchorY) {
  const body = $('#wkBody');
  const wk = body?.closest('.wk');
  if (!wk) return;
  const h = Math.max(24, Math.min(140, next));
  const old = hourH();
  const ay = anchorY ?? body.clientHeight / 2;
  const time = (body.scrollTop + ay) / old;
  agendaHour = h;
  wk.style.setProperty('--hour', `${h}px`);
  body.scrollTop = time * h - ay;
  state.agendaScroll = body.scrollTop;
  clearTimeout(setHourHeight.t);
  setHourHeight.t = setTimeout(() => localSet('lt.agenda.hour', String(Math.round(h))), 300);
}

// Arrastar para o lado troca de semana; pinça com dois dedos dá zoom.
function bindAgendaGestures(body) {
  let start = null;
  let pinch = null;
  body.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      const r = body.getBoundingClientRect();
      pinch = { dist: Math.abs(a.clientY - b.clientY) + Math.abs(a.clientX - b.clientX), h: hourH(), y: (a.clientY + b.clientY) / 2 - r.top };
      start = null;
    } else if (e.touches.length === 1) {
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }
  }, { passive: true });
  body.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const dist = Math.abs(a.clientY - b.clientY) + Math.abs(a.clientX - b.clientX);
      if (pinch.dist > 20) setHourHeight(pinch.h * (dist / pinch.dist), pinch.y);
    }
  }, { passive: false });
  body.addEventListener('touchend', (e) => {
    if (pinch && e.touches.length < 2) { pinch = null; return; }
    if (!start || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    const quick = Date.now() - start.t < 700;
    start = null;
    if (quick && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      e.preventDefault();
      swipeAgenda(dx < 0 ? 1 : -1);
    }
  });
  body.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setHourHeight(hourH() * (e.deltaY < 0 ? 1.1 : 0.9), e.clientY - body.getBoundingClientRect().top);
  }, { passive: false });
}

function swipeAgenda(dir) {
  state.agendaAnchor = week.shiftAnchor(state.agendaAnchor || todayStr(), agendaMode(), dir);
  state.agendaSlide = dir;
  render();
  loadAgenda();
}

function agendaMode() {
  return state.agendaMode || (window.innerWidth >= 768 ? 'semana' : '3dias');
}

function agendaDays() {
  return week.visibleDays(state.agendaAnchor || todayStr(), agendaMode());
}

function agendaTitle(days) {
  const a = week.parseYmd(days[0]);
  const b = week.parseYmd(days[days.length - 1]);
  if (days.length === 1) return `${a.getDate()} de ${MONTH_LONG[a.getMonth()]} de ${a.getFullYear()}`;
  if (a.getMonth() === b.getMonth()) return `${MONTH_LONG[a.getMonth()]} de ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) return `${MONTH_SHORT[a.getMonth()]} – ${MONTH_SHORT[b.getMonth()]} de ${b.getFullYear()}`;
  return `${MONTH_SHORT[a.getMonth()]} de ${a.getFullYear()} – ${MONTH_SHORT[b.getMonth()]} de ${b.getFullYear()}`;
}

function hhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function itemColor(it) {
  if (it.kind === 'evento') return GCAL_COLORS[it.ref.colorId] || '#039be5';
  const t = it.ref;
  if (t.priority === 'urgente') return 'var(--urgente)';
  return store.getProject(t.projectId)?.color || 'var(--brand)';
}

function renderAgenda() {
  const slide = state.agendaSlide;
  setTimeout(() => { if (state.agendaSlide === slide) state.agendaSlide = 0; }, 0);
  const days = agendaDays();
  const today = todayStr();
  const settings = store.getSettings();
  const tasks = store.allTasks().filter(matchesFilters);
  const items = week.buildItems(days, {
    events: state.agenda || [],
    tasks,
    appointmentMinutes: settings.appointmentMinutes,
  });
  const late = tasks.filter((t) => t.status !== 'feita' && t.date && t.date < today).length;
  const H = hourH();
  const mode = agendaMode();

  const head = days.map((d) => {
    const dt = week.parseYmd(d);
    return `<div class="wk-dayhead${d === today ? ' today' : ''}">
      <span>${WEEKDAY_SHORT[dt.getDay()]}</span><b>${dt.getDate()}</b></div>`;
  }).join('');

  const chip = (it) => {
    const done = it.kind === 'tarefa' && it.ref.status === 'feita';
    const attr = it.kind === 'tarefa' ? `data-task="${it.id}"` : `data-event="${esc(it.id)}"`;
    const prefix = it.kind === 'tarefa' ? (it.ref.kind === 'compromisso' ? '' : it.ref.deadline ? '⏰ ' : '☐ ') : '';
    return `<button type="button" class="wk-chip${done ? ' done' : ''}" ${attr} style="--c:${itemColor(it)}">${prefix}${esc(it.title)}</button>`;
  };
  const allDay = days.map((d) => `<div class="wk-allday-cell">${items.filter((i) => i.allDay && i.day === d).map(chip).join('')}</div>`).join('');

  const hours = Array.from({ length: 24 }, (_, h) => `<div class="wk-hour" style="top:calc(var(--hour) * ${h})"><span>${h ? `${String(h).padStart(2, '0')}:00` : ''}</span></div>`).join('');
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const cols = days.map((d) => {
    const placed = week.layoutDay(items.filter((i) => !i.allDay && i.day === d));
    const blocks = placed.map((it) => {
      const height = Math.max(((it.endMin - it.startMin) / 60) * H - 2, 18);
      const done = it.kind === 'tarefa' && it.ref.status === 'feita';
      const attr = it.kind === 'tarefa' ? `data-task="${it.id}"` : `data-event="${esc(it.id)}"`;
      const short = height < 34;
      const who = it.kind === 'tarefa' && it.ref.assignee ? ` · ${esc(it.ref.assignee)}` : '';
      return `<button type="button" class="wk-event${done ? ' done' : ''}${it.kind === 'tarefa' && it.ref.kind !== 'compromisso' ? ' task' : ''}${short ? ' short' : ''}" ${attr}
        style="top:calc(var(--hour) * ${it.startMin / 60});height:max(18px, calc(var(--hour) * ${(it.endMin - it.startMin) / 60} - 2px));left:calc(${(it.lane / it.lanes) * 100}% + 1px);width:calc(${100 / it.lanes}% - 3px);--c:${itemColor(it)}">
        <b>${esc(it.title)}</b>${short ? ` <i>${hhmm(it.startMin)}</i>` : `<i>${hhmm(it.startMin)} – ${hhmm(it.endMin)}${who}</i>`}
      </button>`;
    }).join('');
    const nowLine = d === today ? `<div class="wk-now" style="top:calc(var(--hour) * ${nowMin / 60})"></div>` : '';
    return `<div class="wk-col${d === today ? ' today' : ''}" data-day="${d}">${blocks}${nowLine}</div>`;
  }).join('');

  return `
    <div class="wk${state.agendaSlide ? (state.agendaSlide > 0 ? ' slide-next' : ' slide-prev') : ''}" style="--days:${days.length};--hour:${H}px">
      <div class="wk-toolbar">
        <button type="button" class="btn small primary" data-wk="new">+ Novo</button>
        <button type="button" class="btn small" data-wk="today">Hoje</button>
        <button type="button" class="icon-btn small-icon" data-wk="prev" aria-label="Anterior">‹</button>
        <button type="button" class="icon-btn small-icon" data-wk="next" aria-label="Próximo">›</button>
        <h2 class="wk-title">${(() => { const t = agendaTitle(days); return t.charAt(0).toUpperCase() + t.slice(1); })()}</h2>
        <span class="nb-zoom-ctrl wk-zoom" role="group" aria-label="Zoom da agenda">
          <button type="button" class="btn small ghost" data-wk="zoomout" aria-label="Diminuir zoom">−</button>
          <button type="button" class="btn small ghost" data-wk="zoomin" aria-label="Aumentar zoom">+</button>
        </span>
        <div class="seg wk-mode" role="radiogroup" aria-label="Visão">
          <label><input type="radio" name="wkmode" value="dia" ${mode === 'dia' ? 'checked' : ''}><span>Dia</span></label>
          <label><input type="radio" name="wkmode" value="3dias" ${mode === '3dias' ? 'checked' : ''}><span>3 dias</span></label>
          <label><input type="radio" name="wkmode" value="semana" ${mode === 'semana' ? 'checked' : ''}><span>Semana</span></label>
        </div>
      </div>
      ${late ? `<button type="button" class="link wk-late" data-wk="late">${late} tarefa${late > 1 ? 's' : ''} atrasada${late > 1 ? 's' : ''} — ver</button>` : ''}
      ${!g.isConnected() ? '<p class="muted small">Conecte o Google em Ajustes para ver seus compromissos aqui.</p>' : ''}
      <div class="wk-grid">
        <div class="wk-head"><div class="wk-gutter"></div>${head}</div>
        <div class="wk-allday"><div class="wk-gutter small muted">dia todo</div>${allDay}</div>
        <div class="wk-body" id="wkBody">
          <div class="wk-inner">
            <div class="wk-hours">${hours}</div>
            <div class="wk-cols">${cols}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderPessoas(open) {
  const byPerson = new Map();
  for (const t of open) {
    const key = t.assignee || '';
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(t);
  }
  // Pessoas cadastradas aparecem mesmo sem tarefas.
  for (const p of store.getSettings().people) if (!byPerson.has(p.name)) byPerson.set(p.name, []);
  const keys = [...byPerson.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'pt-BR')));
  const html = keys.map((k) => {
    const items = byPerson.get(k).sort(sortByPriority);
    const email = k ? store.personEmail(k) : '';
    return `<div class="person-head">
        <div><span class="person-name">${esc(k || 'Comigo')}</span>${email ? `<span class="muted small"> · ${esc(email)}</span>` : ''}
          <span class="muted small"> · ${items.length} aberta${items.length === 1 ? '' : 's'}</span></div>
        <div class="row">
          ${k ? `<button type="button" class="link small" data-edit-person="${esc(k)}">Editar</button>` : ''}
          <button type="button" class="btn small ghost" data-new-task data-assignee="${esc(k)}">+ Tarefa</button>
        </div>
      </div>${items.map(taskCard).join('') || '<p class="muted small person-empty">Nenhuma tarefa em aberto.</p>'}`;
  }).join('');
  return `<div class="list-actions"><button type="button" class="btn primary" data-new-person>+ Nova pessoa</button></div>${html || emptyState()}`;
}

function renderFeitas(all) {
  const done = all.filter((t) => t.status === 'feita').sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1)).slice(0, 300);
  return group('Concluídas', done) || '<div class="empty"><b>Nada concluído ainda</b>Toque no círculo de uma tarefa para concluir.</div>';
}

function currentProjectId() {
  return state.view === 'projetos' ? store.getProject(state.projectId)?.id || null : null;
}

function render() {
  const notebookOpen = state.view === 'caderno';
  document.body.classList.toggle('notebook-open', notebookOpen);
  // Na lista de projetos os filtros de tarefa não se aplicam.
  document.body.classList.toggle('projects-list', state.view === 'projetos' && !currentProjectId());
  document.body.classList.toggle('agenda-view', state.view === 'agenda');
  $('#notebook').hidden = !notebookOpen;
  if (notebookOpen) {
    notebook?.show();
    return;
  }
  const project = store.getProject(currentProjectId());
  input.placeholder = project ? 'Nova tarefa do projeto…' : 'Anote, fale ou fotografe…';
  const all = store.allTasks().filter(matchesFilters);
  const open = all.filter((t) => t.status !== 'feita');
  const views = { tudo: renderTudo, agenda: renderAgenda, pessoas: renderPessoas };
  document.body.classList.toggle('painel-view', state.view === 'painel');
  if (state.view === 'painel') {
    $('#list').innerHTML = dashboard.renderView();
    dashboard.loadToday();
  } else if (state.view === 'projetos') {
    $('#list').innerHTML = projects.renderView(matchesFilters);
    projects.hydrate($('#list'));
  } else {
    $('#list').innerHTML = state.view === 'feitas' ? renderFeitas(all) : views[state.view](open);
  }
  if (state.view === 'agenda') {
    const body = $('#wkBody');
    // Abre na hora atual (ou 7h), e mantém a rolagem entre atualizações.
    const nowTop = (new Date().getHours() - 1.5) * hourH();
    body.scrollTop = state.agendaScroll ?? Math.max(7 * hourH(), Math.min(nowTop, 16 * hourH()));
    bindAgendaGestures(body);
    body.addEventListener('scroll', () => { state.agendaScroll = body.scrollTop; }, { passive: true });
  }

  for (const img of $$('img[data-file]')) {
    const task = store.getTask(img.closest('.card').dataset.id);
    const att = task?.attachments.find((a) => a.id === img.dataset.file);
    if (att) fileUrl(att).then((url) => { if (url) img.src = url; else img.remove(); });
  }
  renderPeopleFilter();
  updateBadge(open);
}

function renderPeopleFilter() {
  const sel = $('#filterPerson');
  const current = sel.value;
  const people = store.knownPeople();
  sel.innerHTML = `<option value="">Todos</option><option value="__eu">Comigo</option>${people.map((p) => `<option>${esc(p)}</option>`).join('')}`;
  sel.value = people.includes(current) || current === '__eu' ? current : '';
  const ps = $('#filterProject');
  const curProject = ps.value;
  const projs = store.allProjects({ includeArchived: false });
  ps.innerHTML = `<option value="">Todo projeto</option><option value="__sem">Sem projeto</option>${projs.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}`;
  ps.value = projs.some((p) => p.id === curProject) || curProject === '__sem' ? curProject : '';
  state.project = ps.value;
  $('#peopleList').innerHTML = people.map((p) => `<option value="${esc(p)}">`).join('');
}

function updateBadge(open) {
  const urgent = open.filter((t) => (t.date && t.date <= todayStr()) || t.priority === 'urgente').length;
  if ('setAppBadge' in navigator) (urgent ? navigator.setAppBadge(urgent) : navigator.clearAppBadge()).catch(() => {});
}

async function loadAgenda(force = false) {
  if (!g.hasValidToken()) return;
  const days = agendaDays();
  const key = `${days[0]}_${days[days.length - 1]}`;
  if (!force && state.agendaKey === key && Date.now() - state.agendaLoadedAt < 5 * 60_000) return;
  try {
    const events = await sync.fetchAgenda(days[0], week.addDays(days[days.length - 1], 1));
    if (!events) return;
    state.agenda = events;
    state.agendaKey = key;
    state.agendaLoadedAt = Date.now();
    if (state.view === 'agenda') render();
  } catch (e) {
    console.warn(e);
  }
}

// ---------- Captura rápida ----------

const input = $('#captureInput');

function parseInput(text) {
  return parseTask(text, {
    knownPeople: store.knownPeople(),
    knownProjects: store.allProjects({ includeArchived: false }).map((p) => p.name),
  });
}

function projectIdByName(name) {
  return name ? store.allProjects().find((p) => p.name === name)?.id || null : null;
}

function updatePreview() {
  const text = input.value.trim();
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  const box = $('#preview');
  if (!text) { box.hidden = true; return; }
  const p = parseInput(text);
  const chips = [];
  chips.push(`<span class="chip">${p.kind === 'compromisso' ? '📅 Compromisso' : '☐ Tarefa'}</span>`);
  if (p.date) chips.push(`<span class="chip today">${p.deadline ? 'até ' : ''}${dateLabel(p.date)}${p.time ? ` · ${p.time}` : ''}</span>`);
  if (p.priority) chips.push(`<span class="chip prio-${p.priority}">${store.PRIORITIES[p.priority].label}</span>`);
  if (p.assignee) chips.push(`<span class="chip person">👤 ${esc(p.assignee)}</span>`);
  const project = store.getProject(projectIdByName(p.project) || currentProjectId());
  if (project) chips.push(`<span class="chip project" style="--pc:${esc(project.color)}">${esc(project.name)}</span>`);
  box.innerHTML = chips.join('');
  box.hidden = false;
}

function createFromText(text, extra = {}) {
  const p = parseInput(text);
  const task = store.createTask({
    title: p.title,
    kind: p.kind,
    date: p.date,
    time: p.time,
    deadline: p.deadline,
    priority: p.priority || 'normal',
    assignee: p.assignee,
    assigneeEmail: store.personEmail(p.assignee),
    ...extra,
    // "#projeto" escrito no texto vale mais que o projeto aberto na tela.
    projectId: projectIdByName(p.project) || extra.projectId || null,
  });
  sync.scheduleSync();
  return task;
}

function submitCapture(source = 'texto') {
  const text = input.value.trim();
  if (!text) return;
  const task = createFromText(text, { source, projectId: currentProjectId() });
  input.value = '';
  updatePreview();
  const when = task.date ? ` · ${dateLabel(task.date)}${task.time ? ` ${task.time}` : ''}` : '';
  toast(`Salvo: ${task.title}${when} — toque para editar`, { action: () => openTask(task.id) });
}

input.addEventListener('input', updatePreview);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCapture(); }
});
$('#captureForm').addEventListener('submit', (e) => { e.preventDefault(); submitCapture(); });

// ---------- Foto ----------

async function compressImage(file, maxSide = 1600) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

function stamp() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.toTimeString().slice(0, 5)}`;
}

async function makeAttachment(blob, type) {
  const id = store.uid();
  const ext = type === 'image' ? 'jpg' : (blob.type.includes('mp4') ? 'm4a' : 'webm');
  await store.putFile(id, blob);
  return { id, type, name: `${type === 'image' ? 'foto' : 'audio'}-${formatDate(new Date())}-${id}.${ext}`, mime: blob.type };
}

$('#photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const att = await makeAttachment(await compressImage(file), 'image');
  const text = input.value.trim();
  const task = text
    ? createFromText(text, { attachments: [att], source: 'foto' })
    : store.createTask({ title: `Foto de ${stamp()}`, attachments: [att], source: 'foto' });
  input.value = '';
  updatePreview();
  sync.scheduleSync();
  openTask(task.id, { focusTitle: !text });
});

// ---------- Voz ----------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recorder = null;

function showRecording(label, onStop) {
  $('#recordingLabel').textContent = label;
  $('#recording').hidden = false;
  $('#stopRecording').onclick = onStop;
}

function hideRecording() {
  $('#recording').hidden = true;
  $('#micBtn').classList.remove('live');
}

function startDictation() {
  const base = input.value.trim();
  let finalText = '';
  let gotResult = false;
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = (e) => {
    gotResult = true;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += `${r[0].transcript} `;
      else interim += r[0].transcript;
    }
    input.value = `${base ? `${base} ` : ''}${finalText}${interim}`.trim();
    updatePreview();
  };
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') toast('Permita o uso do microfone para ditar.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Não consegui ouvir. Tente de novo ou grave um áudio.');
  };
  recognition.onend = () => {
    recognition = null;
    hideRecording();
    if (gotResult && store.getSettings().autoSaveDictation && input.value.trim()) submitCapture('voz');
  };
  recognition.start();
  $('#micBtn').classList.add('live');
  showRecording('Ouvindo… fale a tarefa', () => recognition?.stop());
}

async function recordAudio() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Este aparelho não permite gravar áudio pelo navegador. Use o microfone do teclado.');
    return null;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Permita o uso do microfone para gravar.');
    return null;
  }
  return new Promise((resolve) => {
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      hideRecording();
      recorder = null;
      resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type || 'audio/webm' }) : null);
    };
    recorder.start();
    $('#micBtn').classList.add('live');
    showRecording('Gravando áudio…', () => recorder?.stop());
  });
}

$('#micBtn').addEventListener('click', async () => {
  if (recognition) return recognition.stop();
  if (recorder) return recorder.stop();
  if (SpeechRecognition) return startDictation();
  // Sem reconhecimento de voz (ex.: alguns iPhones): guarda o áudio como anexo.
  const blob = await recordAudio();
  if (!blob) return;
  const att = await makeAttachment(blob, 'audio');
  const task = store.createTask({ title: `Áudio de ${stamp()}`, attachments: [att], source: 'audio' });
  sync.scheduleSync();
  toast('Áudio salvo — toque para dar um título', { action: () => openTask(task.id, { focusTitle: true }) });
});

// ---------- Edição ----------

const taskDialog = $('#taskDialog');
const taskForm = $('#taskForm');

function remindersToValue(r) {
  if (r == null) return '';
  if (!r.length) return 'none';
  const v = r.join(',');
  return [...taskForm.reminders.options].some((o) => o.value === v) ? v : '';
}

async function renderAttachments(task) {
  const box = $('#attachments');
  box.innerHTML = '';
  for (const att of task.attachments || []) {
    const fig = document.createElement('figure');
    const url = await fileUrl(att);
    if (att.type === 'image') {
      fig.innerHTML = url
        ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Foto anexada"></a>`
        : `<a href="${esc(att.driveLink || '#')}" target="_blank" rel="noopener" class="btn small">Abrir foto no Drive</a>`;
    } else {
      fig.innerHTML = url
        ? `<audio controls src="${url}"></audio>`
        : `<a href="${esc(att.driveLink || '#')}" target="_blank" rel="noopener" class="btn small">Ouvir no Drive</a>`;
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'remove';
    rm.textContent = '✕';
    rm.setAttribute('aria-label', 'Remover anexo');
    rm.onclick = async () => {
      if (!(await ask('Remover este anexo?', 'Remover'))) return;
      const t = store.updateTask(task.id, { attachments: task.attachments.filter((a) => a.id !== att.id) });
      await store.removeFile(att.id).catch(() => {});
      sync.scheduleSync();
      renderAttachments(t);
    };
    fig.appendChild(rm);
    box.appendChild(fig);
  }
  if (!task.attachments?.length) box.innerHTML = '<span class="muted small">Nenhum anexo.</span>';
}

// Abre a tarefa para edição, ou uma tarefa nova (id nulo) com campos pré-preenchidos.
function openTask(id, { focusTitle = false, prefill = {} } = {}) {
  const isNew = !id;
  const t = isNew
    ? { title: '', kind: 'tarefa', priority: 'normal', attachments: [], status: 'aberta', createdAt: new Date().toISOString(), ...prefill }
    : store.getTask(id);
  if (!t) return;
  state.editingId = id || null;
  $('#toggleDoneBtn').hidden = isNew;
  $('#taskDangerZone').hidden = isNew;
  const f = taskForm;
  f.title.value = t.title;
  f.kind.value = t.kind;
  f.date.value = t.date || '';
  f.time.value = t.time || '';
  f.deadline.checked = !!t.deadline;
  f.priority.value = t.priority || 'normal';
  f.assignee.value = t.assignee || '';
  f.assigneeEmail.value = t.assigneeEmail || '';
  f.reminders.value = remindersToValue(t.reminders);
  f.notes.value = t.notes || '';
  const projs = store.allProjects();
  f.projectId.innerHTML = `<option value="">Sem projeto</option>${projs.map((p) => `<option value="${p.id}">${esc(p.name)}${p.status === 'arquivado' ? ' (arquivado)' : ''}</option>`).join('')}`;
  f.projectId.value = store.getProject(t.projectId)?.id || '';
  f.startDate.value = t.startDate || '';
  const fromNote = t.noteId ? store.getNote(t.noteId) : null;
  $('#taskFromNote').hidden = !fromNote;
  if (fromNote) $('#taskFromNote').innerHTML = `Veio da anotação <button type="button" class="link" data-open-note="${fromNote.id}">“${esc(fromNote.title || 'sem título')}”</button>`;
  $('#taskDialogTitle').textContent = isNew ? 'Nova tarefa' : t.kind === 'compromisso' ? 'Compromisso' : 'Tarefa';
  $('#toggleDoneBtn').textContent = t.status === 'feita' ? '↺ Reabrir' : '✓ Concluir';
  const created = new Date(t.createdAt);
  $('#createdInfo').hidden = isNew;
  $('#createdInfo').textContent = `Criada em ${created.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} às ${created.toTimeString().slice(0, 5)}${SOURCE_LABEL[t.source] ? ` · ${SOURCE_LABEL[t.source]}` : ''}${t.doneAt && t.status === 'feita' ? ` · concluída em ${new Date(t.doneAt).toLocaleDateString('pt-BR')}` : ''}`;
  const info = $('#calendarInfo');
  if (t.calendar?.link) info.innerHTML = `No Google Agenda · <a href="${esc(t.calendar.link)}" target="_blank" rel="noopener">abrir evento</a>`;
  else if (t.date && g.isConnected()) info.textContent = 'Será enviado ao Google Agenda na próxima sincronização.';
  else if (t.date) info.textContent = 'Conecte o Google em Ajustes para receber lembretes pela Agenda.';
  else info.textContent = 'Sem data: fica na lista “Sem data” até você definir um dia.';
  renderAttachments(t);
  taskDialog.showModal();
  if (focusTitle || isNew) { f.title.focus(); f.title.select(); }
}

function openNewTask(prefill = {}) {
  const email = prefill.assignee ? store.personEmail(prefill.assignee) : null;
  openTask(null, { prefill: { ...prefill, assigneeEmail: email } });
}

taskForm.assignee.addEventListener('change', () => {
  const email = store.personEmail(taskForm.assignee.value.trim());
  if (email && !taskForm.assigneeEmail.value) taskForm.assigneeEmail.value = email;
});

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveTaskForm();
  taskDialog.close();
});

function saveTaskForm() {
  const f = taskForm;
  const rem = f.reminders.value;
  const assignee = f.assignee.value.trim() || null;
  const assigneeEmail = f.assigneeEmail.value.trim() || null;
  let date = f.date.value || null;
  const time = f.time.value || null;
  if (time && !date) date = todayStr();
  const data = {
    title: f.title.value.trim() || 'Sem título',
    kind: f.kind.value,
    date,
    time: date ? time : null,
    deadline: f.deadline.checked,
    priority: f.priority.value,
    assignee,
    assigneeEmail,
    reminders: rem === '' ? null : rem === 'none' ? [] : rem.split(',').map(Number),
    notes: f.notes.value.trim(),
    projectId: f.projectId.value || null,
    startDate: f.startDate.value && date && f.startDate.value < date ? f.startDate.value : null,
  };
  if (state.editingId) {
    store.updateTask(state.editingId, data);
  } else {
    const created = store.createTask({ ...data, source: 'texto' });
    state.editingId = created.id;
    $('#toggleDoneBtn').hidden = false;
    $('#taskDangerZone').hidden = false;
    $('#taskDialogTitle').textContent = created.kind === 'compromisso' ? 'Compromisso' : 'Tarefa';
    toast(`Criada: ${created.title}`);
  }
  if (assignee && assigneeEmail) store.rememberPerson(assignee, assigneeEmail);
  sync.scheduleSync();
  return store.getTask(state.editingId);
}

$('#toggleDoneBtn').addEventListener('click', () => {
  store.toggleDone(state.editingId);
  sync.scheduleSync();
  taskDialog.close();
});

$('#deleteBtn').addEventListener('click', async () => {
  if (!(await ask('Excluir esta tarefa? Ela também sai do Google Agenda.', 'Excluir'))) return;
  const t = store.getTask(state.editingId);
  store.deleteTask(state.editingId);
  for (const a of t.attachments || []) store.removeFile(a.id).catch(() => {});
  sync.scheduleSync();
  taskDialog.close();
  toast('Tarefa excluída.');
});

$('#addPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const att = await makeAttachment(await compressImage(file), 'image');
  // Tarefa nova: salva antes de anexar.
  const t = state.editingId ? store.getTask(state.editingId) : saveTaskForm();
  const updated = store.updateTask(t.id, { attachments: [...(t.attachments || []), att] });
  sync.scheduleSync();
  renderAttachments(updated);
});

$('#recordAudio').addEventListener('click', async () => {
  const blob = await recordAudio();
  if (!blob) return;
  const att = await makeAttachment(blob, 'audio');
  // Tarefa nova: salva antes de anexar.
  const t = state.editingId ? store.getTask(state.editingId) : saveTaskForm();
  const updated = store.updateTask(t.id, { attachments: [...(t.attachments || []), att] });
  sync.scheduleSync();
  renderAttachments(updated);
});

// ---------- Lista ----------

function agendaClick(e) {
  const nav = e.target.closest('[data-wk]')?.dataset.wk;
  if (nav) {
    const anchor = state.agendaAnchor || todayStr();
    if (nav === 'today') state.agendaAnchor = todayStr();
    if (nav === 'prev') state.agendaAnchor = week.shiftAnchor(anchor, agendaMode(), -1);
    if (nav === 'next') state.agendaAnchor = week.shiftAnchor(anchor, agendaMode(), 1);
    if (nav === 'late') { selectTab('tudo'); render(); window.scrollTo({ top: 0 }); return true; }
    if (nav === 'new') { openNewAppointment(todayStr(), new Date().getHours() + 1); return true; }
    if (nav === 'zoomin') { setHourHeight(hourH() * 1.25); return true; }
    if (nav === 'zoomout') { setHourHeight(hourH() / 1.25); return true; }
    if (nav === 'prev' || nav === 'next') { swipeAgenda(nav === 'next' ? 1 : -1); return true; }
    render();
    loadAgenda();
    return true;
  }
  const taskId = e.target.closest('[data-task]')?.dataset.task;
  if (taskId) { openTask(taskId); return true; }
  const evId = e.target.closest('[data-event]')?.dataset.event;
  if (evId) {
    const ev = (state.agenda || []).find((x) => x.id === evId);
    if (ev) openEvent(ev);
    return true;
  }
  // Toque num horário vazio: começa uma tarefa naquele dia e hora (como no Google Agenda).
  const col = e.target.closest('.wk-col');
  if (col) {
    const y = e.clientY - col.getBoundingClientRect().top;
    const h = Math.max(0, Math.min(23, Math.floor(y / hourH())));
    openNewAppointment(col.dataset.day, h);
    return true;
  }
  return false;
}

// ---------- Compromissos do Google Agenda (abrir, criar, editar, excluir) ----------

const eventDialog = $('#eventDialog');
const eventForm = $('#eventForm');
let editingEvent = null;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toggleEventTimes() {
  for (const el of $$('.ev-time', eventForm)) el.hidden = eventForm.allDay.checked;
}
eventForm.allDay.addEventListener('change', toggleEventTimes);

async function fillCalendarSelect(selected) {
  const sel = eventForm.calendarId;
  const s = store.getSettings();
  sel.innerHTML = `<option value="${esc(s.calendarId || 'primary')}">${esc(s.calendarName || 'Agenda principal')}</option>`;
  sel.value = selected || s.calendarId || 'primary';
  try {
    const cals = await g.listCalendars();
    sel.innerHTML = cals.map((c) => `<option value="${esc(c.primary ? 'primary' : c.id)}">${esc(c.name)}</option>`).join('');
    sel.value = selected || s.calendarId || 'primary';
  } catch { /* mantém a agenda padrão */ }
}

function openEvent(ev) {
  editingEvent = ev;
  const f = eventForm;
  const allDay = !!ev.start?.date;
  const s = allDay ? week.parseYmd(ev.start.date) : new Date(ev.start.dateTime);
  const e = allDay ? null : new Date(ev.end?.dateTime || s.getTime() + 3_600_000);
  f.summary.value = ev.summary || '';
  f.allDay.checked = allDay;
  f.date.value = allDay ? ev.start.date : week.ymd(s);
  f.start.value = allDay ? '09:00' : `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
  f.end.value = allDay ? '10:00' : `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
  f.location.value = ev.location || '';
  f.description.value = ev.description || '';
  $('#eventCalendarField').hidden = true;
  $('#eventDialogTitle').textContent = 'Compromisso';
  $('#eventDangerZone').hidden = false;
  const link = $('#eventOpenGoogle');
  link.hidden = !ev.htmlLink;
  if (ev.htmlLink) link.href = ev.htmlLink;
  const notes = [];
  if (ev.recurringEventId) notes.push('Compromisso que se repete: a alteração vale só para esta data.');
  if (ev.organizer && !ev.organizer.self) notes.push(`Convite de ${ev.organizer.displayName || ev.organizer.email}: algumas alterações podem não ser permitidas pelo Google.`);
  $('#eventInfo').textContent = notes.join(' ');
  toggleEventTimes();
  eventDialog.showModal();
}

function openNewAppointment(date, hour) {
  // Sem Google conectado, o compromisso nasce como item do app.
  if (!g.isConnected()) {
    openNewTask({ kind: 'compromisso', date, time: `${pad2(Math.min(23, hour))}:00` });
    return;
  }
  editingEvent = null;
  const f = eventForm;
  const h = Math.min(22, Math.max(0, hour));
  f.summary.value = '';
  f.allDay.checked = false;
  f.date.value = date;
  f.start.value = `${pad2(h)}:00`;
  f.end.value = `${pad2(h + 1)}:00`;
  f.location.value = '';
  f.description.value = '';
  $('#eventCalendarField').hidden = false;
  fillCalendarSelect();
  $('#eventDialogTitle').textContent = 'Novo compromisso';
  $('#eventDangerZone').hidden = true;
  $('#eventOpenGoogle').hidden = true;
  $('#eventInfo').textContent = 'Será criado no seu Google Agenda.';
  toggleEventTimes();
  eventDialog.showModal();
  f.summary.focus();
}

function eventBody() {
  const f = eventForm;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = { summary: f.summary.value.trim() || '(sem título)', location: f.location.value.trim(), description: f.description.value };
  if (f.allDay.checked) {
    body.start = { date: f.date.value, dateTime: null, timeZone: null };
    body.end = { date: week.addDays(f.date.value, 1), dateTime: null, timeZone: null };
  } else {
    const startT = f.start.value || '09:00';
    let endT = f.end.value || startT;
    if (endT <= startT) {
      const [h, m] = startT.split(':').map(Number);
      endT = `${pad2(Math.min(23, h + 1))}:${pad2(h >= 23 ? 59 : m)}`;
    }
    body.start = { dateTime: `${f.date.value}T${startT}:00`, timeZone: tz, date: null };
    body.end = { dateTime: `${f.date.value}T${endT}:00`, timeZone: tz, date: null };
  }
  return body;
}

eventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!g.hasValidToken()) {
    toast('Conexão com o Google expirada: toque em qualquer lugar e tente de novo.');
    return;
  }
  const btn = eventForm.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const body = eventBody();
    if (editingEvent) {
      await g.patchEvent(editingEvent.calendarId || 'primary', editingEvent.id, body);
      toast('Compromisso atualizado.');
    } else {
      // Na criação, campos vazios (null) não são enviados.
      const clean = JSON.parse(JSON.stringify(body, (k, v) => (v === null ? undefined : v)));
      await g.insertEvent(eventForm.calendarId.value || 'primary', clean);
      toast('Compromisso criado.');
    }
    eventDialog.close();
    await loadAgenda(true);
  } catch (err) {
    toast(`Não foi possível salvar: ${err.message}`, { ms: 7000 });
  } finally {
    btn.disabled = false;
  }
});

$('#eventDeleteBtn').addEventListener('click', async () => {
  if (!editingEvent) return;
  if (!(await ask(`Excluir “${editingEvent.summary || 'compromisso'}” do Google Agenda?`, 'Excluir'))) return;
  try {
    await g.deleteEvent(editingEvent.calendarId || 'primary', editingEvent.id);
    eventDialog.close();
    toast('Compromisso excluído.');
    await loadAgenda(true);
  } catch (err) {
    toast(`Não foi possível excluir: ${err.message}`, { ms: 7000 });
  }
});

// ---------- Nova tarefa / pessoas ----------

const personDialog = $('#personDialog');
const personForm = $('#personForm');
let editingPerson = null;

function openPerson(name = null) {
  editingPerson = name;
  personForm.name.value = name || '';
  personForm.email.value = name ? store.personEmail(name) || '' : '';
  $('#personDialogTitle').textContent = name ? 'Editar pessoa' : 'Nova pessoa';
  personDialog.showModal();
  personForm.name.focus();
}

personForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = personForm.name.value.trim();
  const email = personForm.email.value.trim();
  if (!name) return;
  if (editingPerson && editingPerson !== name) {
    // Renomear: atualiza as tarefas e a lista de pessoas.
    for (const t of store.allTasks()) {
      if (t.assignee === editingPerson) store.updateTask(t.id, { assignee: name }, { silent: true });
    }
    store.saveSettings({ people: store.getSettings().people.filter((p) => p.name !== editingPerson) });
  }
  store.rememberPerson(name, email);
  for (const t of store.allTasks()) {
    if (t.assignee === name && t.status !== 'feita' && email && t.assigneeEmail !== email) store.updateTask(t.id, { assigneeEmail: email }, { silent: true });
  }
  sync.scheduleSync();
  personDialog.close();
  render();
  toast(editingPerson ? 'Pessoa atualizada.' : `${name} adicionada.`);
});

function listActions(e) {
  const nt = e.target.closest('[data-new-task]');
  if (nt) {
    openNewTask({
      assignee: nt.dataset.assignee || null,
      projectId: nt.dataset.project || (state.view === 'projetos' ? state.projectId : null),
    });
    return true;
  }
  if (e.target.closest('[data-new-person]')) { openPerson(); return true; }
  const ep = e.target.closest('[data-edit-person]');
  if (ep) { openPerson(ep.dataset.editPerson); return true; }
  return false;
}

$('#list').addEventListener('click', (e) => {
  if (listActions(e)) return;
  if (state.view === 'painel' && dashboard.onClick(e)) return;
  if (state.view === 'agenda' && agendaClick(e)) return;
  const card = e.target.closest('.card[data-id]');
  if (!card) {
    if (state.view === 'projetos') projects.onListClick(e);
    return;
  }
  if (e.target.closest('[data-action="toggle"]')) {
    const t = store.toggleDone(card.dataset.id);
    sync.scheduleSync();
    if (t.status === 'feita') toast(`Concluída: ${t.title} — desfazer`, { action: () => { store.toggleDone(t.id); sync.scheduleSync(); } });
    return;
  }
  openTask(card.dataset.id);
});

for (const tab of $$('.tabs [data-view]')) {
  tab.addEventListener('click', () => {
    // Tocar em "Projetos" de dentro de um projeto volta para a lista.
    if (tab.dataset.view === 'projetos' && state.view === 'projetos') state.projectId = null;
    state.view = tab.dataset.view;
    localSet('lt.view', state.view);
    $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
    if (state.view === 'agenda') loadAgenda();
    render();
    window.scrollTo({ top: 0 });
  });
}
$('#search').addEventListener('input', (e) => { state.search = e.target.value.trim(); render(); });
$('#filterPriority').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
$('#filterPerson').addEventListener('change', (e) => { state.person = e.target.value; render(); });
$('#filterProject').addEventListener('change', (e) => { state.project = e.target.value; render(); });

for (const btn of $$('[data-close]')) btn.addEventListener('click', () => btn.closest('dialog').close());
for (const dlg of $$('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- Ajustes ----------

const settingsDialog = $('#settingsDialog');
const settingsForm = $('#settingsForm');

function personRow(p = { name: '', email: '' }) {
  const row = document.createElement('div');
  row.className = 'person-row';
  row.innerHTML = `<input placeholder="Nome" value="${esc(p.name)}" data-k="name">
    <input type="email" placeholder="e-mail (opcional)" value="${esc(p.email)}" data-k="email">
    <button type="button" class="btn ghost small" aria-label="Remover">✕</button>`;
  row.querySelector('button').onclick = () => row.remove();
  return row;
}

function refreshGoogleState() {
  const s = store.getSettings();
  const connected = g.isConnected();
  $('#googleState').textContent = connected
    ? `Conectado. Eventos vão para: ${s.calendarName}.${s.lastSyncAt ? ` Última sincronização: ${new Date(s.lastSyncAt).toLocaleString('pt-BR')}.` : ''}${g.sessionEnd() ? ` A conexão se renova sozinha até ${new Date(g.sessionEnd()).toLocaleString('pt-BR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}.` : ''} Tablet e celular sincronizam em segundos quando conectados à mesma conta.`
    : s.clientId
      ? 'Não conectado. Conecte para criar eventos com lembrete na sua agenda e ter backup no Drive.'
      : 'Falta configurar o Client ID do Google (veja “Configuração técnica”).';
  $('#connectBtn').textContent = connected ? 'Reconectar' : 'Conectar Google';
  $('#syncBtn').hidden = !connected;
  $('#disconnectBtn').hidden = !connected;
  $('#notifyBtn').textContent = s.localNotifications ? 'Desativar notificações neste aparelho' : 'Ativar notificações neste aparelho';
}

async function loadCalendars() {
  const sel = $('#calendarSelect');
  const s = store.getSettings();
  if (!g.hasValidToken()) {
    sel.innerHTML = `<option value="${esc(s.calendarId)}">${esc(s.calendarName)}</option>`;
    return;
  }
  try {
    const cals = await g.listCalendars();
    sel.innerHTML = cals.map((c) => `<option value="${esc(c.primary ? 'primary' : c.id)}">${esc(c.name)}${c.primary ? ' (principal)' : ''}</option>`).join('');
    sel.value = s.calendarId;
    if (!sel.value) sel.value = 'primary';
  } catch (e) {
    console.warn(e);
  }
}

function openSettings() {
  const s = store.getSettings();
  const f = settingsForm;
  f.clientId.value = s.clientId;
  f.defaultTaskTime.value = s.defaultTaskTime;
  f.appointmentMinutes.value = s.appointmentMinutes;
  f.inviteAssignee.checked = s.inviteAssignee;
  f.autoSaveDictation.checked = s.autoSaveDictation;
  f.theme.value = localGet('lt.theme') || 'auto';
  $('#aiKey').value = localGet('lt.ai.key') || '';
  const editor = $('#peopleEditor');
  editor.innerHTML = '';
  s.people.forEach((p) => editor.appendChild(personRow(p)));
  refreshGoogleState();
  loadCalendars();
  settingsDialog.showModal();
}

$('#openSettings').addEventListener('click', openSettings);
for (const b of $$('[data-open-settings]')) b.addEventListener('click', openSettings);

// Menu lateral recolhível (tablet): mais espaço útil de tela.
function setNavCollapsed(collapsed) {
  document.body.classList.toggle('nav-collapsed', collapsed);
  const btn = $('#navToggle');
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
  try { localStorage.setItem('lt.nav.collapsed', collapsed ? '1' : ''); } catch { /* sem armazenamento */ }
  // Caderno e cronograma recalculam o tamanho depois da animação.
  setTimeout(() => window.dispatchEvent(new Event('resize')), 220);
}
$('#navToggle').addEventListener('click', () => setNavCollapsed(!document.body.classList.contains('nav-collapsed')));
try { if (localStorage.getItem('lt.nav.collapsed')) setNavCollapsed(true); } catch { /* sem armazenamento */ }
$('#addPerson').addEventListener('click', () => $('#peopleEditor').appendChild(personRow()));

function readSettingsForm() {
  const f = settingsForm;
  const sel = $('#calendarSelect');
  const people = $$('.person-row', $('#peopleEditor'))
    .map((r) => ({ name: $('[data-k=name]', r).value.trim(), email: $('[data-k=email]', r).value.trim() }))
    .filter((p) => p.name);
  return {
    clientId: f.clientId.value.trim(),
    calendarId: sel.value || 'primary',
    calendarName: sel.selectedOptions[0]?.textContent.replace(' (principal)', '') || 'Agenda principal',
    defaultTaskTime: f.defaultTaskTime.value || '09:00',
    appointmentMinutes: Math.max(5, parseInt(f.appointmentMinutes.value, 10) || 60),
    inviteAssignee: f.inviteAssignee.checked,
    autoSaveDictation: f.autoSaveDictation.checked,
    people,
  };
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  store.saveSettings(readSettingsForm());
  applyTheme(settingsForm.theme.value);
  localSet('lt.ai.key', $('#aiKey').value.trim());
  // Atualiza e-mails das tarefas abertas de quem ganhou e-mail agora.
  for (const t of store.allTasks()) {
    const email = store.personEmail(t.assignee);
    if (t.status !== 'feita' && email && !t.assigneeEmail) store.updateTask(t.id, { assigneeEmail: email }, { silent: true });
  }
  sync.scheduleSync(300);
  settingsDialog.close();
  toast('Ajustes salvos.');
});

async function connectGoogle({ silent = false } = {}) {
  const clientId = settingsDialog.open ? settingsForm.clientId.value.trim() : store.getSettings().clientId;
  try {
    if (clientId !== store.getSettings().clientId) store.saveSettings({ clientId });
    await g.connect(clientId, { silent });
    if (!silent) toast('Google conectado.');
    rememberAccount();
    await sync.syncNow();
    loadAgenda(true);
    if (settingsDialog.open) { refreshGoogleState(); loadCalendars(); }
  } catch (e) {
    toast(e.message, { ms: 6000 });
  }
}

$('#connectBtn').addEventListener('click', () => connectGoogle());
$('#syncBtn').addEventListener('click', async () => { await sync.syncNow(); refreshGoogleState(); loadAgenda(true); });
$('#disconnectBtn').addEventListener('click', async () => {
  if (!(await ask('Desconectar o Google neste aparelho? Suas tarefas continuam salvas aqui e no Drive.', 'Desconectar'))) return;
  g.disconnect();
  refreshGoogleState();
  render();
});

$('#syncStatus').addEventListener('click', () => {
  const st = sync.getStatus().state;
  if (st === 'auth' && !renewing) connectGoogle({ silent: true });
  else if (st === 'error') sync.syncNow();
});

$('#dailyReviewBtn').addEventListener('click', async () => {
  if (!g.hasValidToken()) return toast('Conecte o Google primeiro.');
  const time = $('#dailyReviewTime').value || '08:30';
  const [h, m] = time.split(':').map(Number);
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(h, m, 0, 0);
  const end = new Date(start.getTime() + 15 * 60_000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = (d) => `${formatDate(d)}T${d.toTimeString().slice(0, 8)}`;
  try {
    await g.insertEvent(store.getSettings().calendarId || 'primary', {
      summary: '🗂 Revisar Liberte Tarefas',
      description: `Revise as tarefas sem data, atrasadas e de hoje.\n${location.href.split('?')[0]}`,
      start: { dateTime: local(start), timeZone: tz },
      end: { dateTime: local(end), timeZone: tz },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      transparency: 'transparent',
    });
    toast(`Revisão diária criada às ${time}, de segunda a sexta.`);
  } catch (e) {
    toast(`Não foi possível criar: ${e.message}`);
  }
});

$('#notifyBtn').addEventListener('click', async () => {
  const s = store.getSettings();
  if (s.localNotifications) {
    store.saveSettings({ localNotifications: false });
    refreshGoogleState();
    return;
  }
  if (!('Notification' in window)) return toast('Este navegador não suporta notificações. Use os lembretes do Google Agenda.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return toast('Notificações bloqueadas. Libere nas configurações do navegador.');
  store.saveSettings({ localNotifications: true });
  refreshGoogleState();
  toast('Notificações ativadas enquanto o app estiver aberto ou em segundo plano.');
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `liberte-tarefas-backup-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    store.mergeRemote(data);
    sync.scheduleSync();
    toast(`Backup restaurado (${(data.tasks || []).length} tarefas, ${(data.projects || []).length} projetos).`);
  } catch {
    toast('Arquivo de backup inválido.');
  }
});

// ---------- Lembretes no aparelho ----------

const FIRED_KEY = 'lt.fired.v1';

function checkLocalReminders() {
  const s = store.getSettings();
  if (!s.localNotifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  let fired = {};
  try { fired = JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch { /* vazio */ }
  const now = Date.now();
  for (const t of store.allTasks()) {
    if (t.status === 'feita' || !t.date) continue;
    if (t.kind === 'compromisso' && !t.time) continue;
    const [y, m, d] = t.date.split('-').map(Number);
    const [h, mi] = (t.time || s.defaultTaskTime).split(':').map(Number);
    const due = new Date(y, m - 1, d, h, mi).getTime();
    const list = t.reminders ?? (t.kind === 'compromisso' ? s.appointmentReminders : s.taskReminders);
    for (const min of list) {
      const at = due - min * 60_000;
      const key = `${t.id}:${t.date}:${t.time}:${min}`;
      if (now >= at && now - at < 15 * 60_000 && !fired[key]) {
        fired[key] = now;
        const when = min === 0 ? 'agora' : min >= 1440 ? 'amanhã' : `em ${min} min`;
        navigator.serviceWorker?.ready.then((reg) => reg.showNotification(t.title, {
          body: `${t.kind === 'compromisso' ? 'Compromisso' : 'Tarefa'} ${when}${t.assignee ? ` · ${t.assignee}` : ''}`,
          tag: key,
          icon: 'icons/icon-192.png',
          data: { url: location.href.split('?')[0] },
        }));
      }
    }
  }
  for (const [k, v] of Object.entries(fired)) if (now - v > 3 * 86_400_000) delete fired[k];
  localStorage.setItem(FIRED_KEY, JSON.stringify(fired));
}

// ---------- Caderno ----------

const projects = initProjects({
  $, esc, store, sync, state, render, taskCard, sortTasks, group, parseInput, createFromText,
  toast, ask, openTask, makeAttachment, fileUrl, dateLabel,
  fileToImages: (file) => fileToImages(file, compressImage),
  openNotebookFor: (projectId) => openNotebookFor(projectId),
});

$('#list').addEventListener('change', (e) => {
  if (state.view === 'projetos') projects.onListChange(e);
  if (state.view === 'agenda' && e.target.name === 'wkmode') {
    state.agendaMode = e.target.value;
    try { localStorage.setItem('lt.agenda.mode', e.target.value); } catch { /* sem armazenamento */ }
    render();
    loadAgenda();
  }
});
try { state.agendaMode = localStorage.getItem('lt.agenda.mode') || null; } catch { /* sem armazenamento */ }
$('#list').addEventListener('keydown', (e) => { if (state.view === 'projetos') projects.onListKey(e); });
$('#taskFromNote').addEventListener('click', (e) => {
  const id = e.target.closest('[data-open-note]')?.dataset.openNote;
  if (!id) return;
  taskDialog.close();
  projects.openNote(id);
});

function selectTab(view) {
  state.view = view;
  localSet('lt.view', view);
  $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
}

function openNotebookFor(projectId) {
  selectTab('caderno');
  notebook.setDestination(projectId ? `note:${projectId}` : '');
  render();
  window.scrollTo({ top: 0 });
}

const dashboard = initDashboard({
  $, esc, store, state, openTask, toast, selectTab, render, sync, openSettings,
  PRIORITIES: store.PRIORITIES,
});
// Dicas dos gráficos do Painel (passar o mouse ou tocar).
$('#list').addEventListener('pointermove', (e) => { if (state.view === 'painel') dashboard.showTip(e); });
$('#list').addEventListener('pointerdown', (e) => { if (state.view === 'painel') dashboard.showTip(e); });
$('#list').addEventListener('pointerleave', () => dashboard.hideTip());
window.addEventListener('scroll', () => dashboard.hideTip(), { passive: true });

const notebook = initNotebook({
  $, esc, parseInput, createFromText, makeAttachment, openTask, toast, dateLabel, stamp,
  createTask: (data) => { const t = store.createTask(data); sync.scheduleSync(); return t; },
  PRIORITIES: store.PRIORITIES,
  compressImage, putFile: store.putFile, getFile: store.getFile, removeFile: store.removeFile,
  store, sync,
  openNote: (id) => projects.openNote(id),
});

// ---------- Inicialização ----------

function renderSyncStatus({ state: st, message }) {
  const el = $('#syncStatus');
  el.hidden = !g.isConnected();
  el.dataset.state = st;
  el.textContent = st === 'ok' && store.getSettings().lastSyncAt ? 'Google Agenda conectado' : message;
}

store.subscribe((reason) => {
  if (reason === 'change') render();
});
sync.onStatus(renderSyncStatus);

// Texto compartilhado de outro app (ex.: WhatsApp → Compartilhar → Liberte Tarefas)
const params = new URLSearchParams(location.search);
const shared = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join(' ').trim();
if (shared) {
  input.value = shared;
  updatePreview();
  history.replaceState(null, '', location.pathname);
}
if (params.has('focus')) {
  input.focus();
  history.replaceState(null, '', location.pathname);
}

applyTheme(localGet('lt.theme') || 'auto');
{
  // Abre na última aba usada (na primeira vez, no Painel).
  const last = localGet('lt.view');
  const valid = ['painel', 'tudo', 'agenda', 'projetos', 'pessoas', 'feitas', 'caderno'];
  selectTab(valid.includes(last) ? last : 'painel');
}
render();

// E-mail da conta, para a renovação automática não pedir para escolher a conta.
function rememberAccount() {
  g.listCalendars()
    .then((cals) => g.setAccountEmail(cals.find((c) => c.primary)?.id))
    .catch(() => {});
}

// Renovação automática: o Google dá acesso por 1 hora; no primeiro toque depois
// disso, o app renova sozinho (até o fim da sessão do dia, às 18h).
let renewing = false;
document.addEventListener('click', () => {
  if (renewing || !g.canAutoRenew()) return;
  renewing = true;
  g.connect(store.getSettings().clientId, { silent: true })
    .then(() => sync.syncNow())
    .then(() => loadAgenda(true))
    .catch(() => {})
    .finally(() => { renewing = false; });
}, true);

if (g.isConnected()) {
  if (g.hasValidToken()) {
    rememberAccount();
    sync.syncNow().then(() => { loadAgenda(true); dashboard.loadToday(true); });
  } else {
    renderSyncStatus({ state: 'auth', message: g.sessionActive() ? 'Toque na tela para reconectar ao Google' : 'Sessão do dia encerrada (18h) — toque para reconectar' });
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    render();
    sync.scheduleSync(200);
    checkLocalReminders();
  }
});
setInterval(() => sync.scheduleSync(0), 5 * 60_000);
// Mudanças feitas em outro aparelho chegam em até ~15 segundos com o app aberto.
setInterval(() => { if (document.visibilityState === 'visible') sync.checkRemote(); }, 15_000);
window.addEventListener('focus', () => sync.checkRemote());
setInterval(checkLocalReminders, 30_000);
checkLocalReminders();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}
