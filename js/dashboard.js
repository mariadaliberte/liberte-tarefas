// Painel: resumo do dia e da semana, gráficos de acompanhamento,
// análise automática (regras) e análise com IA (Claude, opcional).

import { aiKey, askClaude } from './ai-read.js';

const DAY = 86_400_000;
const AI_CACHE_KEY = 'lt.ai.last';
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

function dayOf(iso) {
  return iso ? ymd(new Date(iso)) : null;
}

function short(s) {
  const [, m, d] = s.split('-');
  return `${d}/${m}`;
}

function weekday(s) {
  const [y, m, d] = s.split('-').map(Number);
  return WEEK[new Date(y, m - 1, d).getDay()];
}

// ---------- Números ----------

export function computeStats(tasks, projects, today = ymd(new Date())) {
  const live = tasks.filter((t) => !t.deleted);
  const open = live.filter((t) => t.status !== 'feita');
  const done = live.filter((t) => t.status === 'feita');
  const weekStart = addDays(today, -new Date(`${today}T12:00`).getDay());
  const in7 = addDays(today, 7);
  const ageDays = (t) => Math.floor((Date.parse(`${today}T12:00`) - Date.parse(t.createdAt)) / DAY);

  const late = open.filter((t) => t.date && t.date < today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const todayOpen = open.filter((t) => t.date === today);
  const next7 = open.filter((t) => t.date && t.date > today && t.date <= in7);
  const noDate = open.filter((t) => !t.date);
  const stale = open.filter((t) => !t.date && ageDays(t) >= 7);
  const doneWeek = done.filter((t) => dayOf(t.doneAt) >= weekStart);
  const createdWeek = live.filter((t) => dayOf(t.createdAt) >= weekStart);

  // Ritmo: criadas x concluídas nos últimos 14 dias
  const rhythm = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    rhythm.push({
      day: d,
      criadas: live.filter((t) => dayOf(t.createdAt) === d).length,
      concluidas: done.filter((t) => dayOf(t.doneAt) === d).length,
    });
  }

  // Carga dos próximos 7 dias (inclui hoje)
  const load = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    load.push({ day: d, total: open.filter((t) => t.date === d).length });
  }

  const byPriority = ['urgente', 'alta', 'normal', 'baixa'].map((p) => ({
    key: p, total: open.filter((t) => (t.priority || 'normal') === p).length,
  }));

  const people = new Map();
  for (const t of open) {
    const k = t.assignee || 'Comigo';
    if (!people.has(k)) people.set(k, { name: k, emDia: 0, atrasadas: 0 });
    const row = people.get(k);
    if (t.date && t.date < today) row.atrasadas++;
    else row.emDia++;
  }
  const byPerson = [...people.values()].sort((a, b) => (b.emDia + b.atrasadas) - (a.emDia + a.atrasadas));

  const projectRows = projects.filter((p) => !p.deleted && p.status !== 'arquivado').map((p) => {
    const pt = live.filter((t) => t.projectId === p.id);
    const pd = pt.filter((t) => t.status === 'feita').length;
    return {
      id: p.id, name: p.name, color: p.color, endDate: p.endDate || null,
      total: pt.length, done: pd, pct: pt.length ? Math.round((pd / pt.length) * 100) : 0,
      late: pt.filter((t) => t.status !== 'feita' && t.date && t.date < today).length,
    };
  });

  return {
    today, open, late, todayOpen, next7, noDate, stale, doneWeek, createdWeek,
    rhythm, load, byPriority, byPerson, projectRows, ageDays,
  };
}

// ---------- Análise automática (sem IA) ----------

export function ruleInsights(st) {
  const out = [];
  if (st.late.length) {
    const oldest = st.late[0];
    const days = Math.round((Date.parse(`${st.today}T12:00`) - Date.parse(`${oldest.date}T12:00`)) / DAY);
    out.push({ level: 'alerta', text: `${st.late.length} tarefa${st.late.length > 1 ? 's' : ''} atrasada${st.late.length > 1 ? 's' : ''}. A mais antiga é “${oldest.title}” (venceu há ${days} dia${days > 1 ? 's' : ''}). Reprograme ou conclua hoje.` });
  }
  const urgentNoDate = st.open.filter((t) => t.priority === 'urgente' && !t.date);
  if (urgentNoDate.length) {
    out.push({ level: 'alerta', text: `${urgentNoDate.length} urgente${urgentNoDate.length > 1 ? 's' : ''} sem data. Urgência sem prazo tende a ficar para depois: defina o dia.` });
  }
  if (st.todayOpen.length >= 8) {
    out.push({ level: 'atencao', text: `Dia carregado: ${st.todayOpen.length} itens para hoje. Escolha os 3 mais importantes e remarque ou delegue o restante.` });
  }
  const totalOpen = st.open.length;
  const top = st.byPerson[0];
  if (top && totalOpen >= 6 && top.name !== 'Comigo' && (top.emDia + top.atrasadas) / totalOpen >= 0.4) {
    out.push({ level: 'atencao', text: `${top.name} concentra ${top.emDia + top.atrasadas} de ${totalOpen} tarefas abertas. Vale checar a capacidade e redistribuir.` });
  }
  const mine = st.byPerson.find((p) => p.name === 'Comigo');
  if (mine && totalOpen >= 6 && (mine.emDia + mine.atrasadas) / totalOpen >= 0.7) {
    out.push({ level: 'atencao', text: `${mine.emDia + mine.atrasadas} de ${totalOpen} tarefas estão com você. Há algo que a equipe pode assumir?` });
  }
  if (st.stale.length) {
    out.push({ level: 'atencao', text: `${st.stale.length} tarefa${st.stale.length > 1 ? 's' : ''} sem data parada${st.stale.length > 1 ? 's' : ''} há 7 dias ou mais. Revise a lista “Sem data”: agende, delegue ou exclua.` });
  }
  const c = st.createdWeek.length;
  const d = st.doneWeek.length;
  if (c >= 5 && c > d * 1.5) {
    out.push({ level: 'atencao', text: `Nesta semana entraram ${c} tarefas e saíram ${d}. A fila está crescendo.` });
  } else if (d >= 5 && d >= c) {
    out.push({ level: 'bom', text: `Boa semana: ${d} tarefas concluídas, mais do que as ${c} que entraram.` });
  }
  for (const p of st.projectRows) {
    if (!p.endDate || !p.total) continue;
    const daysLeft = Math.round((Date.parse(`${p.endDate}T12:00`) - Date.parse(`${st.today}T12:00`)) / DAY);
    if (daysLeft >= 0 && daysLeft <= 7 && p.pct < 70) {
      out.push({ level: 'alerta', text: `Projeto “${p.name}” entrega em ${daysLeft} dia${daysLeft === 1 ? '' : 's'} com ${p.pct}% concluído.` });
    }
  }
  if (!out.length) out.push({ level: 'bom', text: 'Tudo em dia: nenhuma tarefa atrasada e nenhum ponto de atenção agora.' });
  return out;
}

// ---------- Tela ----------

export function initDashboard(deps) {
  const { $, esc, store, state, openTask, toast, selectTab, render, PRIORITIES, sync } = deps;

  let tipEl = null;

  function tile(label, value, sub, cls = '', go = '') {
    return `<button type="button" class="kpi ${cls}" ${go ? `data-go="${go}"` : ''}>
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value}</span>
      ${sub ? `<span class="kpi-sub">${sub}</span>` : ''}
    </button>`;
  }

  // Barras verticais (1 ou 2 séries lado a lado), escala única, base em zero.
  function columnChart(rows, series, { labelOf, height = 150 }) {
    const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key])));
    const nice = max <= 4 ? max : Math.ceil(max / 2) * 2;
    const ticks = [...new Set([0, Math.round(nice / 2), nice])];
    const W = 100 / rows.length;
    const bars = rows.map((r, i) => {
      const group = series.map((s, j) => {
        const h = (r[s.key] / nice) * height;
        const bw = (W * 0.7) / series.length;
        const x = i * W + W * 0.15 + j * bw;
        return r[s.key] ? `<rect x="${x}%" y="${height - h}" width="${Math.max(bw - 0.5, 0.5)}%" height="${h}" rx="3" class="bar ${s.cls}"></rect>` : '';
      }).join('');
      const tip = `${labelOf(r)}: ${series.map((s) => `${s.label} ${r[s.key]}`).join(' · ')}`;
      return `<g class="hit" data-tip="${esc(tip)}">${group}<rect x="${i * W}%" y="0" width="${W}%" height="${height}" class="hit-area"></rect></g>`;
    }).join('');
    const grid = ticks.map((t) => {
      const y = height - (t / nice) * height;
      return `<line x1="0" x2="100%" y1="${y}" y2="${y}" class="grid"></line>`;
    }).join('');
    const yLabels = ticks.map((t) => `<span style="top:${height - (t / nice) * height}px">${t}</span>`).join('');
    const xLabels = rows.map((r) => `<span>${labelOf(r, true)}</span>`).join('');
    return `<div class="chart-col">
      <div class="y-axis" style="height:${height}px">${yLabels}</div>
      <div class="plot">
        <svg width="100%" height="${height}" style="height:${height}px" role="img" aria-label="${esc(series.map((s) => s.label).join(' e '))} por dia">${grid}${bars}</svg>
        <div class="x-axis" style="grid-template-columns:repeat(${rows.length},1fr)">${xLabels}</div>
      </div>
    </div>`;
  }

  // Barras horizontais com valor ao lado (sem escala separada: o número é o rótulo).
  function hbars(rows, { max, segments }) {
    const top = Math.max(1, max);
    return `<div class="hbars">${rows.map((r) => {
      const total = segments.reduce((a, s) => a + r[s.key], 0);
      const segs = segments.map((s) => (r[s.key]
        ? `<span class="seg-fill ${s.cls(r)}" style="width:${(r[s.key] / top) * 100}%" data-tip="${esc(`${r.label}: ${s.label} ${r[s.key]}`)}"></span>` : '')).join('');
      return `<div class="hrow">
        <span class="hlabel">${esc(r.label)}</span>
        <span class="htrack">${segs}</span>
        <span class="hval">${total}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function legend(items) {
    return `<div class="legend">${items.map((i) => `<span><i class="sw ${i.cls}"></i>${i.label}</span>`).join('')}</div>`;
  }

  function table(head, rows) {
    return `<details class="chart-table"><summary>Ver em tabela</summary><div class="table-wrap"><table>
      <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></details>`;
  }

  function aiBlock() {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(AI_CACHE_KEY)); } catch { /* sem cache */ }
    const hasKey = (() => { try { return !!localStorage.getItem('lt.ai.key'); } catch { return false; } })();
    const body = state.aiLoading
      ? '<p class="muted">Analisando suas tarefas…</p>'
      : cached
        ? `<div class="ai-text">${renderMarkdown(cached.text)}</div><p class="muted small">Gerada em ${new Date(cached.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.</p>`
        : `<p class="muted">${hasKey ? 'Peça uma leitura do seu momento: o que priorizar, riscos e sugestões práticas.' : 'Para ativar, coloque sua chave da API da Anthropic em Ajustes → Análise com IA.'}</p>`;
    return `<section class="dash-card ai-card">
      <div class="card-head">
        <h3>Análise com IA</h3>
        <button type="button" class="btn small ${hasKey ? 'primary' : 'ghost'}" data-dash="ai" ${state.aiLoading ? 'disabled' : ''}>
          ${hasKey ? (cached ? 'Atualizar análise' : 'Gerar análise') : 'Configurar'}
        </button>
      </div>
      ${body}
    </section>`;
  }

  function renderMarkdown(text) {
    const lines = esc(text).split('\n');
    let html = '';
    let inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (/^\s*[-•*]\s+/.test(raw)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${line.replace(/^\s*[-•*]\s+/, '')}</li>`;
        continue;
      }
      if (inList) { html += '</ul>'; inList = false; }
      if (/^#{1,4}\s+/.test(raw)) html += `<h4>${line.replace(/^#{1,4}\s+/, '')}</h4>`;
      else if (raw.trim()) html += `<p>${line}</p>`;
    }
    if (inList) html += '</ul>';
    return html;
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  }

  function renderView() {
    const st = computeStats(store.allTasks(), store.allProjects());
    const insights = ruleInsights(st);
    const todayLabel = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    const events = (state.dashEvents || []).filter((ev) => (ev.start?.dateTime || ev.start?.date || '').slice(0, 10) <= st.today);

    const todayItems = [
      ...events.map((ev) => ({
        time: ev.start?.dateTime ? new Date(ev.start.dateTime).toTimeString().slice(0, 5) : 'dia todo',
        title: ev.summary || '(sem título)', kind: 'evento',
      })),
      ...st.todayOpen.map((t) => ({ time: t.time || (t.kind === 'compromisso' ? 'dia todo' : '—'), title: t.title, kind: 'tarefa', id: t.id, priority: t.priority })),
    ].sort((a, b) => (a.time < b.time ? -1 : 1));

    const rhythmLabel = (r, axis) => (axis ? (r.day === st.today ? 'hoje' : short(r.day).slice(0, 2)) : `${weekday(r.day)}, ${short(r.day)}`);
    const loadLabel = (r, axis) => (axis ? (r.day === st.today ? 'hoje' : weekday(r.day)) : `${weekday(r.day)}, ${short(r.day)}`);
    const maxPerson = Math.max(1, ...st.byPerson.map((p) => p.emDia + p.atrasadas));
    const maxPrio = Math.max(1, ...st.byPriority.map((p) => p.total));

    return `<div class="dash">
      <header class="dash-head">
        <p class="nb-eyebrow">${esc(todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1))}</p>
        <h2>${greeting()}! Aqui está o seu momento.</h2>
      </header>

      <div class="kpis">
        ${tile('Para hoje', st.todayOpen.length, todayItems.length > st.todayOpen.length ? `+ ${todayItems.length - st.todayOpen.length} na agenda` : '', '', 'tudo')}
        ${tile('Atrasadas', st.late.length, st.late.length ? 'precisam de decisão' : 'nenhuma', st.late.length ? 'bad' : 'ok', 'tudo')}
        ${tile('Próximos 7 dias', st.next7.length, 'com prazo', '', 'agenda')}
        ${tile('Concluídas na semana', st.doneWeek.length, `${st.createdWeek.length} entraram`, st.doneWeek.length ? 'ok' : '', 'feitas')}
        ${tile('Sem data', st.noDate.length, st.stale.length ? `${st.stale.length} paradas há 7+ dias` : 'caixa de entrada', st.stale.length ? 'warn' : '', 'tudo')}
        ${tile('Em aberto', st.open.length, `${st.projectRows.length} projeto${st.projectRows.length === 1 ? '' : 's'} ativo${st.projectRows.length === 1 ? '' : 's'}`, '', 'tudo')}
      </div>

      <div class="dash-grid">
        <section class="dash-card">
          <div class="card-head"><h3>Hoje</h3><button type="button" class="link" data-go="agenda">Abrir agenda</button></div>
          ${todayItems.length ? `<ul class="today-list">${todayItems.map((i) => `
            <li ${i.id ? `data-task="${i.id}" class="clickable"` : ''}>
              <span class="t-time">${esc(i.time)}</span>
              <span class="t-title">${esc(i.title)}</span>
              <span class="chip ${i.kind === 'evento' ? '' : `prio-${i.priority}`}">${i.kind === 'evento' ? 'Agenda' : i.priority !== 'normal' ? PRIORITIES[i.priority]?.label || 'Tarefa' : 'Tarefa'}</span>
            </li>`).join('')}</ul>` : '<p class="muted">Nada marcado para hoje.</p>'}
        </section>

        <section class="dash-card">
          <div class="card-head"><h3>Análise automática</h3></div>
          <ul class="insights">${insights.map((i) => `<li class="ins-${i.level}"><span class="ins-dot" aria-hidden="true"></span><span><b class="sr-only">${i.level === 'alerta' ? 'Alerta: ' : i.level === 'bom' ? 'Ponto positivo: ' : 'Atenção: '}</b>${esc(i.text)}</span></li>`).join('')}</ul>
        </section>

        ${aiBlock()}

        <section class="dash-card wide">
          <div class="card-head"><h3>Ritmo das últimas 2 semanas</h3>${legend([{ cls: 's1', label: 'Concluídas' }, { cls: 's2', label: 'Criadas' }])}</div>
          ${columnChart(st.rhythm, [{ key: 'concluidas', label: 'Concluídas', cls: 's1' }, { key: 'criadas', label: 'Criadas', cls: 's2' }], { labelOf: rhythmLabel })}
          ${table(['Dia', 'Concluídas', 'Criadas'], st.rhythm.map((r) => [`${weekday(r.day)}, ${short(r.day)}`, r.concluidas, r.criadas]))}
        </section>

        <section class="dash-card">
          <div class="card-head"><h3>Carga dos próximos 7 dias</h3></div>
          ${columnChart(st.load, [{ key: 'total', label: 'Tarefas', cls: 's1' }], { labelOf: loadLabel, height: 130 })}
          ${table(['Dia', 'Tarefas'], st.load.map((r) => [`${weekday(r.day)}, ${short(r.day)}`, r.total]))}
        </section>

        <section class="dash-card">
          <div class="card-head"><h3>Abertas por prioridade</h3></div>
          ${hbars(st.byPriority.map((p) => ({ label: PRIORITIES[p.key].label, total: p.total, key: p.key })), {
            max: maxPrio,
            segments: [{ key: 'total', label: 'abertas', cls: (r) => `p-${r.key}` }],
          })}
        </section>

        <section class="dash-card">
          <div class="card-head"><h3>Por responsável</h3>${legend([{ cls: 's1', label: 'No prazo' }, { cls: 'late', label: 'Atrasadas' }])}</div>
          ${st.byPerson.length ? hbars(st.byPerson.slice(0, 8).map((p) => ({ label: p.name, emDia: p.emDia, atrasadas: p.atrasadas })), {
            max: maxPerson,
            segments: [{ key: 'emDia', label: 'no prazo', cls: () => 's1' }, { key: 'atrasadas', label: 'atrasadas', cls: () => 'late' }],
          }) : '<p class="muted">Nenhuma tarefa em aberto.</p>'}
        </section>

        <section class="dash-card">
          <div class="card-head"><h3>Projetos</h3><button type="button" class="link" data-go="projetos">Ver todos</button></div>
          ${st.projectRows.length ? `<div class="proj-rows">${st.projectRows.map((p) => `
            <button type="button" class="proj-row" data-project="${p.id}" style="--pc:${esc(p.color)}">
              <span class="pr-name"><i class="pc-dot"></i>${esc(p.name)}</span>
              <span class="progress"><span style="width:${p.pct}%"></span></span>
              <span class="pr-meta">${p.pct}% · ${p.done}/${p.total}${p.late ? ` · <b class="late-text">${p.late} atrasada${p.late > 1 ? 's' : ''}</b>` : ''}${p.endDate ? ` · entrega ${short(p.endDate)}` : ''}</span>
            </button>`).join('')}</div>` : '<p class="muted">Nenhum projeto ativo.</p>'}
        </section>
      </div>
    </div>`;
  }

  // ---------- Dica ao tocar/passar o dedo nos gráficos ----------
  function showTip(e) {
    const target = e.target.closest('[data-tip]');
    if (!target) { if (tipEl) tipEl.hidden = true; return; }
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      document.body.appendChild(tipEl);
    }
    tipEl.textContent = target.dataset.tip;
    tipEl.hidden = false;
    const x = Math.min(window.innerWidth - tipEl.offsetWidth - 8, Math.max(8, e.clientX - tipEl.offsetWidth / 2));
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${Math.max(8, e.clientY - tipEl.offsetHeight - 14)}px`;
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  // ---------- Análise com IA ----------
  function snapshot() {
    const st = computeStats(store.allTasks(), store.allProjects());
    const projName = (id) => store.getProject(id)?.name || null;
    const slim = (t) => ({
      titulo: t.title, tipo: t.kind, data: t.date, hora: t.time, prazo_final: !!t.deadline,
      prioridade: t.priority, responsavel: t.assignee || 'eu', projeto: projName(t.projectId),
      criada_em: dayOf(t.createdAt), notas: t.notes ? t.notes.slice(0, 200) : undefined,
    });
    return {
      hoje: st.today,
      dia_da_semana: new Date().toLocaleDateString('pt-BR', { weekday: 'long' }),
      numeros: {
        em_aberto: st.open.length, para_hoje: st.todayOpen.length, atrasadas: st.late.length,
        proximos_7_dias: st.next7.length, sem_data: st.noDate.length, paradas_7_dias: st.stale.length,
        concluidas_na_semana: st.doneWeek.length, criadas_na_semana: st.createdWeek.length,
      },
      agenda_de_hoje: (state.dashEvents || []).map((ev) => ({
        titulo: ev.summary, inicio: ev.start?.dateTime || ev.start?.date, fim: ev.end?.dateTime || ev.end?.date,
      })),
      tarefas_abertas: st.open.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1)).slice(0, 200).map(slim),
      concluidas_ultimos_7_dias: store.allTasks()
        .filter((t) => t.status === 'feita' && t.doneAt && Date.now() - Date.parse(t.doneAt) < 7 * DAY)
        .slice(0, 60).map((t) => ({ titulo: t.title, concluida_em: dayOf(t.doneAt), projeto: projName(t.projectId) })),
      projetos: st.projectRows.map((p) => ({ nome: p.name, progresso: `${p.pct}%`, concluidas: p.done, total: p.total, atrasadas: p.late, entrega: p.endDate })),
      pessoas: st.byPerson.map((p) => ({ nome: p.name, no_prazo: p.emDia, atrasadas: p.atrasadas })),
    };
  }

  const SYSTEM = `Você é a assistente de produtividade da Mariá, CEO da Liberte Soluções Empresariais (serviços e educação digital para empresárias, autônomas e prestadoras de serviços).
Você recebe um retrato em JSON das tarefas, agenda e projetos dela e escreve uma análise curta, em português do Brasil, com tom direto e executivo, sem rodeios nem teoria.

Use exatamente estas seções, com títulos em linhas iniciadas por "## ":
## Resumo
Duas ou três frases sobre o momento: carga, ritmo e o que mais importa hoje e nesta semana.
## Pontos de atenção
Até 4 itens em lista ("- "), cada um citando tarefas, pessoas ou projetos pelo nome, com o motivo (atraso, acúmulo, prazo próximo, urgência sem data).
## Sugestões
Até 5 ações práticas em lista ("- "), em ordem de impacto: o que fazer primeiro, o que delegar e para quem, o que remarcar ou cortar.
## Foco de hoje
As 3 tarefas que ela deve fechar hoje, em lista.

Baseie-se apenas nos dados recebidos. Se algo não estiver nos dados, não invente. Não repita os números brutos sem interpretá-los. Seja breve: no máximo 250 palavras.`;

  async function runAI() {
    if (!aiKey()) {
      deps.openSettings();
      setTimeout(() => document.getElementById('aiKey')?.focus(), 200);
      return;
    }
    state.aiLoading = true;
    render();
    try {
      const text = await askClaude({ system: SYSTEM, content: `Dados de hoje:\n${JSON.stringify(snapshot())}` });
      try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify({ text, at: new Date().toISOString() })); } catch { /* sem armazenamento */ }
    } catch (e) {
      console.error(e);
      toast(e.message || 'Não foi possível gerar a análise.', { ms: 7000 });
    } finally {
      state.aiLoading = false;
      render();
    }
  }

  // ---------- Eventos de hoje do Google ----------
  async function loadToday(force = false) {
    if (!force && Date.now() - (state.dashEventsAt || 0) < 5 * 60_000) return;
    const today = ymd(new Date());
    try {
      const events = await sync.fetchAgenda(today, addDays(today, 1));
      if (!events) return;
      state.dashEvents = events;
      state.dashEventsAt = Date.now();
      if (state.view === 'painel') render();
    } catch (e) {
      console.warn(e);
    }
  }

  function onClick(e) {
    const go = e.target.closest('[data-go]')?.dataset.go;
    if (go) { selectTab(go); render(); window.scrollTo({ top: 0 }); return true; }
    if (e.target.closest('[data-dash="ai"]')) { runAI(); return true; }
    const tid = e.target.closest('[data-task]')?.dataset.task;
    if (tid) { openTask(tid); return true; }
    const pid = e.target.closest('[data-project]')?.dataset.project;
    if (pid) {
      state.projectId = pid;
      state.projectTab = 'tarefas';
      selectTab('projetos');
      render();
      window.scrollTo({ top: 0 });
      return true;
    }
    return false;
  }

  return { renderView, onClick, showTip, hideTip, loadToday };
}
