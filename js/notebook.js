// Modo Caderno (pensado para tablet com caneta).
// - Escrever: folha pautada; a caneta escreve e o tablet converte em texto
//   (Scribble no iPad, S Pen / teclado de escrita à mão no Android). Cada linha vira uma tarefa.
// - Desenhar: rascunho à mão livre, salvo como imagem anexada a uma tarefa.
// - Minha folha: o modelo de folha da própria usuária (imagem ou PDF) vira o fundo
//   onde ela escreve; também aceita enviar uma página já preenchida em outro app.

const DRAFT_KEY = 'lt.notebook.draft';
const LINE = 40; // altura da pauta, em px (igual ao CSS)
const TEMPLATE_ID = 'nb-template';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Não foi possível carregar o leitor de PDF. Verifique a internet.'));
    document.head.appendChild(el);
  });
}

// Converte cada página de um PDF em imagem (o worker roda na própria página).
async function pdfToImages(file, maxPages = 20) {
  await loadScript(`${PDFJS}pdf.min.js`);
  await loadScript(`${PDFJS}pdf.worker.min.js`);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const blobs = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1800 / base.width) });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport }).promise;
    blobs.push(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88)));
  }
  return blobs;
}

// Cores da caneta e do marca-texto. "screen" ajusta o preto para o tema escuro.
export const PEN_COLORS = [
  { id: 'preto', label: 'Preto', hex: '#1f1a1d' },
  { id: 'azul', label: 'Azul', hex: '#1d4ed8' },
  { id: 'vermelho', label: 'Vermelho', hex: '#d12a2a' },
  { id: 'verde', label: 'Verde', hex: '#18864b' },
  { id: 'roxo', label: 'Roxo', hex: '#6d2f8e' },
  { id: 'laranja', label: 'Laranja', hex: '#e07a10' },
];
export const MARKER_COLORS = [
  { id: 'amarelo', label: 'Amarelo', hex: '#ffe600' },
  { id: 'verde', label: 'Verde', hex: '#5ff26b' },
  { id: 'rosa', label: 'Rosa', hex: '#ff7ac8' },
  { id: 'azul', label: 'Azul', hex: '#5cd3ff' },
  { id: 'laranja', label: 'Laranja', hex: '#ffab40' },
];
const MARKER_ALPHA = 0.38;
const TOOLS_KEY = 'lt.notebook.tools';

// Imagem ou PDF -> lista de imagens (uma por página).
export async function fileToImages(file, compressImage) {
  if (isPdf(file)) return pdfToImages(file);
  return [await compressImage(file, 2000)];
}

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

export function initNotebook(deps) {
  const {
    $, esc, parseInput, createFromText, makeAttachment, createTask, openTask, toast, dateLabel, stamp, PRIORITIES,
    compressImage, putFile, getFile, removeFile, store, sync, openNote,
  } = deps;

  // ---------- Destino: tarefas soltas, tarefas de um projeto ou anotação de projeto ----------
  const dest = $('#nbDest');
  const DEST_KEY = 'lt.notebook.dest';

  function renderDestinations() {
    const current = dest.value || (() => { try { return localStorage.getItem(DEST_KEY) || ''; } catch { return ''; } })();
    const projs = store.allProjects({ includeArchived: false });
    dest.innerHTML = `<option value="">Tarefas (sem projeto)</option>${projs.length ? `
      <optgroup label="Tarefas do projeto">${projs.map((p) => `<option value="task:${p.id}">${esc(p.name)}</option>`).join('')}</optgroup>
      <optgroup label="Anotação no projeto">${projs.map((p) => `<option value="note:${p.id}">📓 ${esc(p.name)}</option>`).join('')}</optgroup>` : ''}`;
    dest.value = [...dest.options].some((o) => o.value === current) ? current : '';
    updateDestLabels();
  }

  function destination() {
    const [kind, projectId] = (dest.value || '').split(':');
    return { kind: kind === 'note' ? 'note' : 'task', projectId: projectId || null };
  }

  function updateDestLabels() {
    const d = destination();
    const note = d.kind === 'note';
    $('#nbSaveDrawing').textContent = note ? 'Salvar como anotação' : 'Salvar como tarefa';
    if (note) saveBtn.textContent = 'Salvar anotação';
    else updatePreview();
  }

  dest.addEventListener('change', () => {
    try { localStorage.setItem(DEST_KEY, dest.value); } catch { /* sem armazenamento */ }
    updateDestLabels();
    updatePreview();
  });

  // Página(s) prontas viram tarefa ou anotação conforme o destino escolhido.
  function saveImages(attachments, typedTitle, fallbackTitle) {
    const d = destination();
    if (d.kind === 'note' && d.projectId) {
      const note = store.createNote({ projectId: d.projectId, title: typedTitle || fallbackTitle, attachments });
      sync.scheduleSync();
      toast(`Anotação salva em ${store.getProject(d.projectId)?.name || 'projeto'} — toque para abrir`, { action: () => openNote(note.id) });
      return;
    }
    const task = typedTitle
      ? createFromText(typedTitle, { attachments, source: 'caderno', projectId: d.projectId })
      : createTask({ title: fallbackTitle, attachments, source: 'caderno', projectId: d.projectId });
    openTask(task.id, { focusTitle: !typedTitle });
  }

  const root = $('#notebook');
  const text = $('#nbText');
  const preview = $('#nbPreview');
  const saveBtn = $('#nbSave');
  const canvas = $('#nbCanvas');
  const ctx = canvas.getContext('2d');

  // ---------- Data no topo da folha ----------
  const d = new Date();
  const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  $('#nbDate').textContent = label.charAt(0).toUpperCase() + label.slice(1);

  // ---------- Alternar Escrever / Desenhar / Minha folha ----------
  let mode = 'escrever';
  for (const input of root.querySelectorAll('input[name="nbMode"]')) {
    input.addEventListener('change', () => {
      if (input.checked) setMode(input.value);
    });
  }

  // ---------- Escrever ----------
  try { text.value = localStorage.getItem(DRAFT_KEY) || ''; } catch { /* sem armazenamento */ }

  function lines() {
    return text.value.split('\n').map((l) => l.replace(/^\s*[-•*☐□]\s*/, '').trim()).filter(Boolean);
  }

  function updatePreview() {
    try { localStorage.setItem(DRAFT_KEY, text.value); } catch { /* sem armazenamento */ }
    const items = lines();
    const asNote = dest.value.startsWith('note:');
    saveBtn.textContent = asNote ? 'Salvar anotação' : items.length > 1 ? `Salvar ${items.length} tarefas` : 'Salvar tarefa';
    saveBtn.disabled = !items.length;
    preview.innerHTML = items.map((line) => {
      const p = parseInput(line);
      const chips = [];
      if (p.date) chips.push(`<span class="chip today">${p.deadline ? 'até ' : ''}${dateLabel(p.date)}${p.time ? ` · ${p.time}` : ''}</span>`);
      if (p.priority) chips.push(`<span class="chip prio-${p.priority}">${PRIORITIES[p.priority].label}</span>`);
      if (p.assignee) chips.push(`<span class="chip person">👤 ${esc(p.assignee)}</span>`);
      return `<li><span>${esc(p.title)}</span>${chips.join('')}</li>`;
    }).join('');
    preview.hidden = !items.length;
    preview.closest('.nb-side').hidden = !items.length;
  }

  text.addEventListener('input', updatePreview);
  saveBtn.addEventListener('click', () => {
    const items = lines();
    if (!items.length) return;
    const d = destination();
    if (d.kind === 'note' && d.projectId) {
      const note = store.createNote({ projectId: d.projectId, title: items[0].slice(0, 60), body: text.value.trim() });
      sync.scheduleSync();
      text.value = '';
      updatePreview();
      toast(`Anotação salva em ${store.getProject(d.projectId)?.name || 'projeto'} — toque para abrir`, { action: () => openNote(note.id) });
      return;
    }
    items.forEach((line) => createFromText(line, { source: 'caderno', projectId: d.projectId }));
    text.value = '';
    updatePreview();
    toast(items.length > 1 ? `${items.length} tarefas salvas.` : 'Tarefa salva.');
  });
  $('#nbClear').addEventListener('click', () => { text.value = ''; updatePreview(); text.focus(); });
  updatePreview();

  // ---------- Desenhar e Minha folha ----------
  // Pontos guardados em proporção da largura da folha: o traço acompanha
  // a folha quando a tela gira ou muda de tamanho.
  const strokesBy = { desenhar: [], folha: [] };
  const strokes = () => strokesBy[mode] || [];
  const wrap = $('#nbCanvasWrap');
  const templateImg = $('#nbTemplate');
  let template = null; // { url, w, h }
  let current = null;
  let tool = 'caneta';
  let toolPrefs = { caneta: 'azul', marca: 'amarelo' };
  try { toolPrefs = { ...toolPrefs, ...JSON.parse(localStorage.getItem(TOOLS_KEY) || '{}') }; } catch { /* sem armazenamento */ }
  let penSeen = false;
  let cssW = 0;
  let cssH = 0;
  let extraLines = 0;

  function css(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function setMode(next) {
    mode = next;
    const drawing = mode !== 'escrever';
    $('#nbWrite').hidden = drawing;
    $('#nbDraw').hidden = !drawing;
    $('#nbDrawHint').hidden = mode !== 'desenhar';
    $('#nbFolhaHint').hidden = mode !== 'folha';
    $('#nbMore').hidden = mode !== 'desenhar';
    $('#nbFolhaBar').hidden = mode !== 'folha' || !template;
    const empty = mode === 'folha' && !template;
    $('#nbFolhaEmpty').hidden = !empty;
    $('#nbDrawArea').hidden = empty;
    if (drawing && !empty) requestAnimationFrame(resizeCanvas);
  }

  function resizeCanvas() {
    const onTemplate = mode === 'folha' && template;
    wrap.classList.toggle('on-template', !!onTemplate);
    templateImg.hidden = !onTemplate;
    cssW = Math.floor(wrap.getBoundingClientRect().width);
    if (!cssW) return;
    cssH = onTemplate
      ? Math.round(cssW * (template.h / template.w))
      : Math.floor(Math.max(480, window.innerHeight * 0.62)) + extraLines * LINE;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw(ctx, cssW, cssH);
  }

  // Desenha um trecho; W é a largura (em px lógicos) da folha de destino.
  function segment(c, s, a, b, W) {
    c.save();
    c.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = c === ctx ? s.color : s.exportColor;
    const w = s.width * W;
    c.lineWidth = s.erase ? w : w * (0.45 + (a.p + b.p) / 2);
    c.beginPath();
    c.moveTo(a.x * W, a.y * W);
    c.lineTo(b.x * W, b.y * W);
    c.stroke();
    c.restore();
  }

  // Marca-texto: traço único, largo e translúcido (sem "bolinhas" escuras nas emendas).
  function drawMarker(c, s, W) {
    const pts = s.points;
    c.save();
    c.globalAlpha = MARKER_ALPHA;
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = c === ctx ? s.color : s.exportColor;
    c.lineWidth = s.width * W;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(pts[0].x * W, pts[0].y * W);
    if (pts.length === 1) c.lineTo(pts[0].x * W + 0.1, pts[0].y * W);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x * W, pts[i].y * W);
    c.stroke();
    c.restore();
  }

  // Redesenho: trechos com espessura parecida viram um caminho só (sem marcas nas emendas).
  function drawStroke(c, s, W) {
    if (s.marker) return drawMarker(c, s, W);
    const pts = s.points;
    if (pts.length === 1) return segment(c, s, pts[0], { ...pts[0], x: pts[0].x + 0.0002 }, W);
    if (s.erase) {
      for (let i = 1; i < pts.length; i++) segment(c, s, pts[i - 1], pts[i], W);
      return;
    }
    const base = s.width * W;
    const widthAt = (a, b) => Math.round(base * (0.45 + (a.p + b.p) / 2) * 4) / 4;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = c === ctx ? s.color : s.exportColor;
    let i = 1;
    while (i < pts.length) {
      const w = widthAt(pts[i - 1], pts[i]);
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(pts[i - 1].x * W, pts[i - 1].y * W);
      while (i < pts.length && widthAt(pts[i - 1], pts[i]) === w) {
        c.lineTo(pts[i].x * W, pts[i].y * W);
        i++;
      }
      c.stroke();
    }
    c.restore();
  }

  function redraw(c, W, H) {
    c.clearRect(0, 0, W, H);
    for (const s of strokes()) drawStroke(c, s, W);
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / cssW,
      y: (e.clientY - r.top) / cssW,
      p: e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5,
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penSeen = true;
    // Com caneta em uso, a palma da mão (toque) é ignorada.
    if (penSeen && e.pointerType === 'touch') return;
    canvas.setPointerCapture(e.pointerId);
    const erase = tool === 'borracha' || e.button === 5 || (e.buttons & 32);
    const marker = !erase && tool === 'marca';
    let hex = '#1f1a1d';
    let screen = hex;
    if (marker) {
      hex = (MARKER_COLORS.find((c) => c.id === toolPrefs.marca) || MARKER_COLORS[0]).hex;
      screen = hex;
    } else if (!erase) {
      const pen = PEN_COLORS.find((c) => c.id === toolPrefs.caneta) || PEN_COLORS[0];
      hex = pen.hex;
      // No tema escuro a folha pautada fica escura: o preto aparece claro na tela
      // (na imagem salva, que tem fundo branco, continua preto).
      screen = pen.id === 'preto' && mode !== 'folha' ? css('--text') : hex;
    }
    current = {
      erase,
      marker,
      color: screen,
      exportColor: hex,
      width: (erase ? 22 : marker ? 20 : 2.6) / cssW,
      points: [point(e)],
    };
    strokes().push(current);
    drawStroke(ctx, current, cssW);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const prev = current.points[current.points.length - 1];
      const next = point(ev);
      current.points.push(next);
      if (!current.marker) segment(ctx, current, prev, next, cssW);
    }
    if (current.marker) redraw(ctx, cssW, cssH);
    e.preventDefault();
  });

  const end = () => {
    if (current && !current.erase && !current.marker) redraw(ctx, cssW, cssH);
    current = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const swatches = $('#nbSwatches');

  function renderSwatches() {
    const list = tool === 'marca' ? MARKER_COLORS : tool === 'caneta' ? PEN_COLORS : [];
    const chosen = toolPrefs[tool];
    swatches.hidden = !list.length;
    swatches.innerHTML = list.map((c) => `<button type="button" class="swatch${tool === 'marca' ? ' marker' : ''}" data-color="${c.id}"
      style="--sw:${c.hex}" aria-label="${tool === 'marca' ? 'Marca-texto' : 'Caneta'} ${c.label}" aria-pressed="${c.id === chosen}"></button>`).join('');
    for (const b of root.querySelectorAll('[data-tool]')) {
      b.style.setProperty('--tool', b.dataset.tool === 'caneta'
        ? (PEN_COLORS.find((c) => c.id === toolPrefs.caneta) || PEN_COLORS[0]).hex
        : b.dataset.tool === 'marca' ? (MARKER_COLORS.find((c) => c.id === toolPrefs.marca) || MARKER_COLORS[0]).hex : 'transparent');
    }
  }

  swatches.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    toolPrefs[tool] = b.dataset.color;
    try { localStorage.setItem(TOOLS_KEY, JSON.stringify(toolPrefs)); } catch { /* sem armazenamento */ }
    renderSwatches();
  });

  for (const btn of root.querySelectorAll('[data-tool]')) {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderSwatches();
    });
  }
  renderSwatches();
  $('#nbUndo').addEventListener('click', () => { strokes().pop(); redraw(ctx, cssW, cssH); });
  $('#nbWipe').addEventListener('click', () => { strokes().length = 0; redraw(ctx, cssW, cssH); });
  $('#nbMore').addEventListener('click', () => { extraLines += 8; resizeCanvas(); });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Monta a imagem final: fundo (pauta ou modelo) + tinta numa camada própria,
  // para a borracha apagar só a tinta e nunca o modelo.
  async function exportBlob() {
    const ink = strokes().filter((s) => !s.erase);
    if (!ink.length) return null;
    let W;
    let H;
    let background;
    if (mode === 'folha' && template) {
      const img = await loadImage(template.url);
      W = Math.min(2000, template.w);
      H = Math.round(W * (template.h / template.w));
      background = (g) => g.drawImage(img, 0, 0, W, H);
    } else {
      W = cssW * 2;
      let maxY = 0;
      for (const s of ink) for (const p of s.points) maxY = Math.max(maxY, p.y * cssW);
      H = Math.min(cssH, Math.ceil((maxY + LINE) / LINE) * LINE) * 2;
      background = (g) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
        g.strokeStyle = '#dfe6ee';
        g.lineWidth = 2;
        for (let y = LINE * 2; y < H; y += LINE * 2) {
          g.beginPath();
          g.moveTo(0, y + 0.5);
          g.lineTo(W, y + 0.5);
          g.stroke();
        }
      };
    }
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const oc = out.getContext('2d');
    oc.fillStyle = '#ffffff';
    oc.fillRect(0, 0, W, H);
    background(oc);
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    redraw(layer.getContext('2d'), W, H);
    oc.drawImage(layer, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.88));
  }

  $('#nbSaveDrawing').addEventListener('click', async () => {
    const blob = await exportBlob();
    if (!blob) return toast('A folha está em branco.');
    const att = await makeAttachment(blob, 'image');
    const typed = $('#nbDrawTitle').value.trim();
    const label = mode === 'folha' ? 'Folha de gestão' : 'Anotação à mão';
    strokes().length = 0;
    redraw(ctx, cssW, cssH);
    $('#nbDrawTitle').value = '';
    saveImages([att], typed, `${label} de ${stamp()}`);
  });

  // ---------- Modelo da folha ----------
  async function showTemplate(blob) {
    if (template?.url) URL.revokeObjectURL(template.url);
    if (!blob) { template = null; templateImg.removeAttribute('src'); return; }
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    template = { url, w: img.naturalWidth, h: img.naturalHeight };
    templateImg.src = url;
  }

  const toImages = (file) => fileToImages(file, compressImage);

  async function chooseTemplate(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      toast('Preparando sua folha…');
      const [blob] = await toImages(file);
      await putFile(TEMPLATE_ID, blob);
      // O modelo vai para o Drive e aparece nos outros aparelhos na próxima sincronização.
      const templateId = Date.now().toString(36);
      localStorage.setItem('lt.template.localId', templateId);
      store.saveSettings({ templateId, templateDriveId: null });
      sync.scheduleSync(300);
      await showTemplate(blob);
      strokesBy.folha.length = 0;
      setMode('folha');
      toast('Modelo salvo. Escreva por cima com a caneta.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Não consegui abrir esse arquivo. Use imagem (JPG/PNG) ou PDF.');
    }
  }
  $('#nbTemplateInput').addEventListener('change', chooseTemplate);
  $('#nbTemplateInput2').addEventListener('change', chooseTemplate);
  $('#nbRemoveTemplate').addEventListener('click', async () => {
    await removeFile(TEMPLATE_ID).catch(() => {});
    localStorage.removeItem('lt.template.localId');
    store.saveSettings({ templateId: null, templateDriveId: null });
    sync.scheduleSync(300);
    await showTemplate(null);
    strokesBy.folha.length = 0;
    setMode('folha');
  });

  // ---------- Página já preenchida em outro app ----------
  async function uploadFilledPages(e) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    try {
      toast('Anexando…');
      const attachments = [];
      for (const file of files) {
        for (const blob of await toImages(file)) attachments.push(await makeAttachment(blob, 'image'));
      }
      const pages = attachments.length > 1 ? ` (${attachments.length} páginas)` : '';
      saveImages(attachments, '', `Folha de gestão de ${stamp()}${pages}`);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Não consegui abrir esse arquivo. Use imagem (JPG/PNG) ou PDF.');
    }
  }
  $('#nbPageInput').addEventListener('change', uploadFilledPages);
  $('#nbPageInput2').addEventListener('change', uploadFilledPages);

  const loadTemplate = () => getFile(TEMPLATE_ID)
    .then(async (blob) => {
      // Modelo enviado antes da sincronização existir: passa a ser compartilhado.
      if (blob && !store.getSettings().templateId && !localStorage.getItem('lt.template.localId')) {
        const templateId = Date.now().toString(36);
        localStorage.setItem('lt.template.localId', templateId);
        store.saveSettings({ templateId, templateDriveId: null });
      }
      await showTemplate(blob || null);
      if (mode === 'folha') setMode('folha');
    })
    .catch(() => {});
  loadTemplate();
  // Modelo chegou (ou foi removido) por outro aparelho.
  store.subscribe((reason) => { if (reason === 'template') loadTemplate(); });

  window.addEventListener('resize', () => { if (!$('#nbDraw').hidden) resizeCanvas(); });

  return {
    setDestination(value) {
      renderDestinations();
      dest.value = [...dest.options].some((o) => o.value === value) ? value : '';
      try { localStorage.setItem(DEST_KEY, dest.value); } catch { /* sem armazenamento */ }
      updateDestLabels();
      updatePreview();
    },
    show() {
      renderDestinations();
      if (!$('#nbDraw').hidden) resizeCanvas();
    },
  };
}
