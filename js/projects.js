// Projetos: cada projeto reúne tarefas e um caderno de anotações próprio.
// Linhas de uma anotação podem virar tarefas do projeto.

import { buildTimeline } from './timeline.js';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function initProjects(deps) {
  const {
    $, esc, store, sync, state, render, taskCard, sortTasks, group, parseInput, createFromText,
    toast, ask, openTask, makeAttachment, fileToImages, fileUrl, dateLabel,
  } = deps;

  const projectDialog = $('#projectDialog');
  const projectForm = $('#projectForm');
  const noteDialog = $('#noteDialog');
  const noteForm = $('#noteForm');
  let editingProjectId = null;
  let editingNoteId = null;
  let draftAttachments = [];

  const shortDate = (iso) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  function stats(p) {
    const tasks = store.projectTasks(p.id);
    const done = tasks.filter((t) => t.status === 'feita').length;
    const open = tasks.filter((t) => t.status !== 'feita');
    const next = open.filter((t) => t.date).sort(sortTasks)[0];
    const late = open.filter((t) => t.date && t.date < todayStr()).length;
    return { total: tasks.length, done, open: open.length, next, late, notes: store.projectNotes(p.id).length };
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function progress(st) {
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso">
      <span style="width:${pct}%"></span></div>`;
  }

  // ---------- Lista de projetos ----------

  function projectCard(p) {
    const st = stats(p);
    const meta = [
      `${st.done} de ${st.total} tarefa${st.total === 1 ? '' : 's'}`,
      `${st.notes} anotaç${st.notes === 1 ? 'ão' : 'ões'}`,
    ];
    return `
      <article class="project-card" data-project="${p.id}" style="--pc:${esc(p.color)}" tabindex="0">
        <div class="pc-head"><span class="pc-dot"></span><h3>${esc(p.name)}</h3></div>
        ${p.description ? `<p class="pc-desc">${esc(p.description)}</p>` : ''}
        ${progress(st)}
        <div class="meta">
          <span class="chip">${meta.join(' · ')}</span>
          ${st.late ? `<span class="chip late">${st.late} atrasada${st.late > 1 ? 's' : ''}</span>` : ''}
          ${st.next ? `<span class="chip today">próxima: ${esc(dateLabel(st.next.date))}</span>` : ''}
        </div>
      </article>`;
  }

  function renderList() {
    const all = store.allProjects();
    const active = all.filter((p) => p.status !== 'arquivado');
    const archived = all.filter((p) => p.status === 'arquivado');
    let html = `
      <div class="section-head">
        <div><p class="nb-eyebrow">Projetos</p><h2>${active.length ? `${active.length} em andamento` : 'Seus projetos'}</h2></div>
        <button type="button" class="btn primary" data-action="new-project">+ Novo projeto</button>
      </div>`;
    if (!all.length) {
      html += `<div class="empty"><b>Nenhum projeto ainda</b>
        Crie um projeto para juntar tarefas e anotações de uma mesma frente.<br>
        Ex.: “Lançamento da Mentoria Fluir”, “Site novo”, “Contratação de assistente”.</div>`;
    }
    html += `<div class="project-grid">${active.map(projectCard).join('')}</div>`;
    if (archived.length) {
      html += `<details class="archived"><summary>Arquivados (${archived.length})</summary>
        <div class="project-grid">${archived.map(projectCard).join('')}</div></details>`;
    }
    return html;
  }

  // ---------- Cronograma ----------

  function brDate(date) {
    const [, m, d] = date.split('-');
    return `${d}/${m}`;
  }

  function renderTimeline(p, tasks) {
    const tl = buildTimeline(tasks, p, todayStr());
    if (!tl.rows.length) {
      return `<div class="empty"><b>O cronograma aparece quando as tarefas têm data</b>
        Dê um prazo às tarefas do projeto (e, se quiser, uma data de início para virar barra).<br>
        Defina também o início e a entrega do projeto em “Editar”.</div>`;
    }
    const zoom = state.timelineZoom || 'dias';
    const dayW = zoom === 'dias' ? 34 : 12;
    const n = tl.days.length;

    // Cabeçalho: meses e, abaixo, dias (no zoom "semanas" só as segundas-feiras).
    const months = [];
    for (const [i, d] of tl.days.entries()) {
      const last = months[months.length - 1];
      if (!last || last.month !== d.month) months.push({ month: d.month, year: d.year, start: i, span: 1 });
      else last.span++;
    }
    const monthCells = months.map((m) => `<div class="g-month" style="grid-column:${m.start + 1} / span ${m.span}"><span>${MONTHS[m.month]}${m.span * dayW > 70 ? ` ${m.year}` : ''}</span></div>`).join('');
    const dayCells = tl.days.map((d, i) => {
      const label = zoom === 'dias' ? `<b>${d.day}</b><i>${WEEK[d.weekday]}</i>` : d.weekday === 1 ? `<b>${d.day}</b>` : '';
      return `<div class="g-day${i === tl.todayIdx ? ' today' : ''}${d.weekday === 0 || d.weekday === 6 ? ' weekend' : ''}" style="grid-column:${i + 1}">${label}</div>`;
    }).join('');

    const weekends = tl.days.map((d, i) => (d.weekday === 0 || d.weekday === 6
      ? `<span class="g-weekend" style="left:calc(${i} * var(--day))"></span>` : '')).join('');
    const marks = [
      `<span class="g-line today" style="left:calc(${tl.todayIdx + 0.5} * var(--day))" title="Hoje"></span>`,
      tl.projectStartIdx != null ? `<span class="g-line start" style="left:calc(${tl.projectStartIdx} * var(--day))" title="Início do projeto: ${brDate(p.startDate)}"></span>` : '',
      tl.projectEndIdx != null ? `<span class="g-line end" style="left:calc(${tl.projectEndIdx + 1} * var(--day))" title="Entrega do projeto: ${brDate(p.endDate)}"><em>Entrega ${brDate(p.endDate)}</em></span>` : '',
    ].join('');

    const rows = tl.rows.map((r) => {
      const t = r.task;
      const cls = `${r.done ? ' done' : ''}${r.late ? ' late' : ''} prio-${t.priority}`;
      const range = r.kind === 'bar' ? `${brDate(r.start)} → ${brDate(r.end)}` : brDate(r.end);
      const mark = r.kind === 'bar'
        ? `<button type="button" class="g-bar${cls}" data-task="${t.id}" style="left:calc(${r.startIdx} * var(--day) + 2px);width:calc(${r.endIdx - r.startIdx + 1} * var(--day) - 4px)" title="${esc(t.title)} · ${range}"><span>${(r.endIdx - r.startIdx + 1) * dayW > 90 ? esc(t.title) : ''}</span></button>`
        : `<button type="button" class="g-milestone${cls}" data-task="${t.id}" style="left:calc(${r.endIdx + 0.5} * var(--day))" title="${esc(t.title)} · ${range}" aria-label="${esc(t.title)}, ${range}"></button>`;
      return `<div class="g-row">
          <button type="button" class="g-label${r.done ? ' done' : ''}" data-task="${t.id}">
            <span class="g-title">${esc(t.title)}</span>
            <span class="g-meta">${range}${t.assignee ? ` · ${esc(t.assignee)}` : ''}${r.late ? ' · <b>atrasada</b>' : ''}</span>
          </button>
          <div class="g-track">${mark}</div>
        </div>`;
    }).join('');

    return `
      <div class="row g-toolbar">
        <div class="seg g-zoom" role="radiogroup" aria-label="Escala">
          <label><input type="radio" name="gzoom" value="dias" ${zoom === 'dias' ? 'checked' : ''}><span>Dias</span></label>
          <label><input type="radio" name="gzoom" value="semanas" ${zoom === 'semanas' ? 'checked' : ''}><span>Semanas</span></label>
        </div>
        <button type="button" class="btn small ghost" data-action="timeline-today">Ir para hoje</button>
      </div>
      <div class="gantt-scroll" id="ganttScroll" data-today="${tl.todayIdx}" data-day="${dayW}">
        <div class="gantt" style="--day:${dayW}px;--days:${n}">
          <div class="g-head">
            <div class="g-corner">Tarefa</div>
            <div class="g-scale">
              <div class="g-months">${monthCells}</div>
              <div class="g-days">${dayCells}</div>
            </div>
          </div>
          <div class="g-body">
            <div class="g-layer">${weekends}${marks}</div>
            ${rows}
          </div>
        </div>
      </div>
      <p class="muted small g-legend">
        <span class="lg bar"></span> do início ao prazo
        <span class="lg ms"></span> data ou marco
        <span class="lg late"></span> atrasada
        <span class="lg today"></span> hoje
        ${p.endDate ? '<span class="lg end"></span> entrega do projeto' : ''}
      </p>
      <p class="muted small">Toque numa tarefa para editar. Para virar barra, preencha “Começa em” na tarefa.${tl.undated ? ` ${tl.undated} tarefa${tl.undated > 1 ? 's' : ''} sem data não aparece${tl.undated > 1 ? 'm' : ''} aqui.` : ''}</p>`;
  }

  // ---------- Página do projeto ----------

  function noteCard(n) {
    const excerpt = (n.body || '').split('\n').filter(Boolean).slice(0, 3).join(' · ');
    const img = (n.attachments || []).find((a) => a.type === 'image');
    const generated = store.allTasks().filter((t) => t.noteId === n.id).length;
    return `
      <article class="card note-card" data-note="${n.id}" tabindex="0">
        <div class="body">
          <div class="title">${esc(n.title || 'Anotação sem título')}</div>
          ${excerpt ? `<p class="note-excerpt">${esc(excerpt)}</p>` : ''}
          <div class="meta">
            <span class="chip age">editada ${shortDate(n.updatedAt)}</span>
            ${n.attachments?.length ? `<span class="chip">📎 ${n.attachments.length}</span>` : ''}
            ${generated ? `<span class="chip person">${generated} tarefa${generated > 1 ? 's' : ''} gerada${generated > 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        ${img ? `<img class="thumb" data-note-file="${img.id}" alt="">` : ''}
      </article>`;
  }

  function renderDetail(p, matchesFilters) {
    const st = stats(p);
    const tab = state.projectTab || 'tarefas';
    const tasks = store.projectTasks(p.id).filter(matchesFilters);
    const open = tasks.filter((t) => t.status !== 'feita').sort(sortTasks);
    const done = tasks.filter((t) => t.status === 'feita').sort((a, b) => (a.doneAt < b.doneAt ? 1 : -1));
    const notes = store.projectNotes(p.id);

    let body = '';
    if (tab === 'cronograma') {
      body = renderTimeline(p, store.projectTasks(p.id));
    } else if (tab === 'tarefas') {
      body = group('Abertas', open) + group('Concluídas', done)
        || '<div class="empty"><b>Nenhuma tarefa neste projeto</b>Escreva na barra de baixo: a tarefa entra direto aqui.<br>Ou gere tarefas a partir de uma anotação.</div>';
    } else {
      body = `<div class="row">
          <button type="button" class="btn primary" data-action="new-note">+ Nova anotação</button>
          <button type="button" class="btn ghost" data-action="note-notebook">✍︎ Escrever à mão no Caderno</button>
        </div>
        ${notes.map(noteCard).join('') || '<div class="empty"><b>Nenhuma anotação ainda</b>Use as anotações como o caderno do projeto: ideias, reuniões, rascunhos e páginas da sua folha.</div>'}`;
    }

    return `
      <div class="project-detail" style="--pc:${esc(p.color)}">
        <button type="button" class="link back" data-action="back-projects">← Projetos</button>
        <div class="section-head">
          <div class="pd-title">
            <span class="pc-dot"></span>
            <div>
              <h2>${esc(p.name)}${p.status === 'arquivado' ? ' <span class="chip">arquivado</span>' : ''}</h2>
              ${p.description ? `<p class="pc-desc">${esc(p.description)}</p>` : ''}
            </div>
          </div>
          <button type="button" class="btn ghost" data-action="edit-project">Editar</button>
        </div>
        ${progress(st)}
        <p class="muted small">${p.startDate || p.endDate ? `${p.startDate ? `Início ${brDate(p.startDate)}` : ''}${p.startDate && p.endDate ? ' · ' : ''}${p.endDate ? `Entrega ${brDate(p.endDate)}` : ''} · ` : ''}${st.done} de ${st.total} tarefas concluídas${st.late ? ` · <b class="late-text">${st.late} atrasada${st.late > 1 ? 's' : ''}</b>` : ''} · ${st.notes} anotações</p>
        <div class="seg pd-tabs" role="tablist">
          <label><input type="radio" name="ptab" value="tarefas" ${tab === 'tarefas' ? 'checked' : ''}><span>Tarefas (${st.open})</span></label>
          <label><input type="radio" name="ptab" value="cronograma" ${tab === 'cronograma' ? 'checked' : ''}><span>Cronograma</span></label>
          <label><input type="radio" name="ptab" value="anotacoes" ${tab === 'anotacoes' ? 'checked' : ''}><span>Anotações (${st.notes})</span></label>
        </div>
        ${body}
      </div>`;
  }

  function renderView(matchesFilters) {
    const p = store.getProject(state.projectId);
    if (!p) state.projectId = null;
    return p ? renderDetail(p, matchesFilters) : renderList();
  }

  // Miniaturas das anotações (as das tarefas o app já carrega).
  function scrollToToday(root, smooth = false) {
    const sc = root.querySelector('#ganttScroll');
    if (!sc) return;
    const left = (Number(sc.dataset.today) - 3) * Number(sc.dataset.day);
    sc.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' });
  }

  function hydrate(root) {
    scrollToToday(root);
    for (const img of root.querySelectorAll('img[data-note-file]')) {
      const note = store.getNote(img.closest('[data-note]').dataset.note);
      const att = note?.attachments.find((a) => a.id === img.dataset.noteFile);
      if (att) fileUrl(att).then((url) => { if (url) img.src = url; else img.remove(); });
    }
  }

  // ---------- Ações na lista ----------

  function onListClick(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'new-project') return openProject(null);
    if (action === 'edit-project') return openProject(state.projectId);
    if (action === 'back-projects') { state.projectId = null; render(); window.scrollTo({ top: 0 }); return; }
    if (action === 'new-note') return openNote(null);
    if (action === 'note-notebook') return deps.openNotebookFor(state.projectId);
    if (action === 'timeline-today') return scrollToToday(document, true);
    const tb = e.target.closest('[data-task]');
    if (tb) return openTask(tb.dataset.task);
    const pc = e.target.closest('[data-project]');
    if (pc) {
      state.projectId = pc.dataset.project;
      state.projectTab = 'tarefas';
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    const nc = e.target.closest('[data-note]');
    if (nc) openNote(nc.dataset.note);
  }

  function onListChange(e) {
    if (e.target.name === 'ptab') {
      state.projectTab = e.target.value;
      render();
    }
    if (e.target.name === 'gzoom') {
      state.timelineZoom = e.target.value;
      render();
    }
  }

  function onListKey(e) {
    if (e.key === 'Enter' && e.target.matches('[data-project], [data-note]')) onListClick(e);
  }

  // ---------- Editar projeto ----------

  function renderColorChoices(selected) {
    $('#projectColors').innerHTML = store.PROJECT_COLORS.map((c, i) => `
      <label class="color-choice" style="--sw:${c}">
        <input type="radio" name="color" value="${c}" ${c === selected ? 'checked' : ''} aria-label="Cor ${i + 1}"><span></span>
      </label>`).join('');
  }

  function openProject(id) {
    editingProjectId = id;
    const p = id ? store.getProject(id) : null;
    projectForm.name.value = p?.name || '';
    projectForm.description.value = p?.description || '';
    projectForm.archived.checked = p?.status === 'arquivado';
    projectForm.startDate.value = p?.startDate || '';
    projectForm.endDate.value = p?.endDate || '';
    renderColorChoices(p?.color || store.PROJECT_COLORS[store.allProjects().length % store.PROJECT_COLORS.length]);
    $('#projectDialogTitle').textContent = p ? 'Editar projeto' : 'Novo projeto';
    $('#deleteProjectBtn').hidden = !p;
    $('#archiveRow').hidden = !p;
    projectDialog.showModal();
    projectForm.name.focus();
  }

  projectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: projectForm.name.value.trim() || 'Projeto sem nome',
      description: projectForm.description.value.trim(),
      color: projectForm.color.value || store.PROJECT_COLORS[0],
      status: projectForm.archived.checked ? 'arquivado' : 'ativo',
      startDate: projectForm.startDate.value || null,
      endDate: projectForm.endDate.value || null,
    };
    if (editingProjectId) {
      // O nome do projeto vai na descrição dos eventos: a sincronização atualiza a Agenda.
      store.updateProject(editingProjectId, data);
    } else {
      const p = store.createProject(data);
      state.projectId = p.id;
      state.projectTab = 'tarefas';
    }
    sync.scheduleSync();
    projectDialog.close();
    render();
  });

  $('#deleteProjectBtn').addEventListener('click', async () => {
    const p = store.getProject(editingProjectId);
    if (!p) return;
    const ok = await ask(`Excluir o projeto “${p.name}”? As tarefas continuam na sua lista (sem projeto). As anotações do projeto são excluídas.`, 'Excluir projeto');
    if (!ok) return;
    store.deleteProject(p.id);
    sync.scheduleSync();
    projectDialog.close();
    state.projectId = null;
    render();
    toast('Projeto excluído.');
  });

  // ---------- Anotações ----------

  function noteLines() {
    return noteForm.body.value.split('\n').map((l) => l.replace(/^\s*[-•*☐□]\s*/, '').trim()).filter(Boolean);
  }

  function renderNoteLines() {
    const note = editingNoteId ? store.getNote(editingNoteId) : null;
    const converted = new Set(note?.converted || []);
    const lines = noteLines();
    const box = $('#noteLines');
    if (!lines.length) {
      box.innerHTML = '<p class="muted small">Escreva acima. Cada linha pode virar uma tarefa deste projeto.</p>';
      $('#noteMakeTasks').disabled = true;
      return;
    }
    box.innerHTML = lines.map((line, i) => {
      const p = parseInput(line);
      const isDone = converted.has(line);
      const chips = [];
      if (p.date) chips.push(`<span class="chip today">${p.deadline ? 'até ' : ''}${esc(dateLabel(p.date))}${p.time ? ` · ${p.time}` : ''}</span>`);
      if (p.priority) chips.push(`<span class="chip prio-${p.priority}">${p.priority}</span>`);
      if (p.assignee) chips.push(`<span class="chip person">👤 ${esc(p.assignee)}</span>`);
      if (isDone) chips.push('<span class="chip">já é tarefa ✓</span>');
      return `<label class="line-choice${isDone ? ' done' : ''}">
        <input type="checkbox" data-line="${i}" ${isDone ? 'disabled' : ''}>
        <span>${esc(p.title)}</span>${chips.join('')}
      </label>`;
    }).join('');
    updateMakeButton();
  }

  function updateMakeButton() {
    const n = noteForm.querySelectorAll('#noteLines input:checked').length;
    const btn = $('#noteMakeTasks');
    btn.disabled = !n;
    btn.textContent = n > 1 ? `Criar ${n} tarefas` : 'Criar tarefa';
  }

  async function renderNoteAttachments() {
    const box = $('#noteAttachments');
    box.innerHTML = '';
    for (const att of draftAttachments) {
      const fig = document.createElement('figure');
      const url = await fileUrl(att);
      fig.innerHTML = url
        ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Página anexada"></a>`
        : `<a href="${esc(att.driveLink || '#')}" target="_blank" rel="noopener" class="btn small">Abrir no Drive</a>`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'remove';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', 'Remover anexo');
      rm.onclick = async () => {
        if (!(await ask('Remover este anexo da anotação?', 'Remover'))) return;
        draftAttachments = draftAttachments.filter((a) => a.id !== att.id);
        renderNoteAttachments();
      };
      fig.appendChild(rm);
      box.appendChild(fig);
    }
    if (!draftAttachments.length) box.innerHTML = '<span class="muted small">Nenhum anexo.</span>';
  }

  function openNote(id, preset = {}) {
    editingNoteId = id;
    const n = id ? store.getNote(id) : null;
    const project = store.getProject(n?.projectId || preset.projectId || state.projectId);
    noteForm.title.value = n?.title || preset.title || '';
    noteForm.body.value = n?.body || preset.body || '';
    draftAttachments = [...(n?.attachments || preset.attachments || [])];
    noteForm.dataset.project = project?.id || '';
    $('#noteProject').textContent = project ? project.name : '';
    $('#noteProject').style.setProperty('--pc', project?.color || 'transparent');
    $('#noteMeta').textContent = n
      ? `Criada em ${new Date(n.createdAt).toLocaleDateString('pt-BR')} · editada ${new Date(n.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Nova anotação';
    $('#deleteNoteBtn').hidden = !n;
    renderNoteLines();
    renderNoteAttachments();
    noteDialog.showModal();
    if (!n) noteForm.title.focus();
  }

  // Salva a anotação (cria se ainda não existe) e devolve o registro.
  function saveNote() {
    const data = {
      title: noteForm.title.value.trim() || noteLines()[0]?.slice(0, 60) || 'Anotação',
      body: noteForm.body.value,
      attachments: draftAttachments,
      projectId: noteForm.dataset.project || null,
    };
    let note;
    if (editingNoteId) note = store.updateNote(editingNoteId, data);
    else {
      note = store.createNote(data);
      editingNoteId = note.id;
    }
    sync.scheduleSync();
    return note;
  }

  noteForm.body.addEventListener('input', renderNoteLines);
  $('#noteLines').addEventListener('change', updateMakeButton);

  noteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveNote();
    noteDialog.close();
    toast('Anotação salva.');
  });

  $('#noteMakeTasks').addEventListener('click', () => {
    const lines = noteLines();
    const picked = [...noteForm.querySelectorAll('#noteLines input:checked')].map((i) => lines[Number(i.dataset.line)]);
    if (!picked.length) return;
    const note = saveNote();
    for (const line of picked) createFromText(line, { projectId: note.projectId, noteId: note.id, source: 'projeto' });
    store.updateNote(note.id, { converted: [...new Set([...(note.converted || []), ...picked])] });
    renderNoteLines();
    toast(picked.length > 1 ? `${picked.length} tarefas criadas no projeto.` : 'Tarefa criada no projeto.');
  });

  $('#noteAddFile').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    try {
      for (const file of files) {
        for (const blob of await fileToImages(file)) draftAttachments.push(await makeAttachment(blob, 'image'));
      }
      renderNoteAttachments();
    } catch (err) {
      toast(err.message || 'Não consegui abrir esse arquivo. Use imagem (JPG/PNG) ou PDF.');
    }
  });

  $('#deleteNoteBtn').addEventListener('click', async () => {
    if (!(await ask('Excluir esta anotação? As tarefas que vieram dela continuam.', 'Excluir'))) return;
    store.updateNote(editingNoteId, { deleted: true });
    sync.scheduleSync();
    noteDialog.close();
    toast('Anotação excluída.');
  });

  return {
    renderView,
    hydrate,
    onListClick,
    onListChange,
    onListKey,
    openNote,
    openProject,
  };
}
