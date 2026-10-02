// Modo Caderno (pensado para tablet com caneta).
// - Escrever: folha pautada; a caneta escreve e o tablet converte em texto
//   (Scribble no iPad, S Pen / teclado de escrita à mão no Android). Cada linha vira uma tarefa.
// - Desenhar: rascunho à mão livre, salvo como imagem anexada a uma tarefa.

const DRAFT_KEY = 'lt.notebook.draft';
const LINE = 40; // altura da pauta, em px (igual ao CSS)

export function initNotebook(deps) {
  const { $, esc, parseInput, createFromText, makeAttachment, createTask, openTask, toast, dateLabel, stamp, PRIORITIES } = deps;

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

  // ---------- Alternar Escrever / Desenhar ----------
  for (const input of root.querySelectorAll('input[name="nbMode"]')) {
    input.addEventListener('change', () => {
      const draw = input.value === 'desenhar' && input.checked;
      $('#nbWrite').hidden = draw;
      $('#nbDraw').hidden = !draw;
      if (draw) resizeCanvas();
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
    saveBtn.textContent = items.length > 1 ? `Salvar ${items.length} tarefas` : 'Salvar tarefa';
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
  }

  text.addEventListener('input', updatePreview);
  saveBtn.addEventListener('click', () => {
    const items = lines();
    if (!items.length) return;
    items.forEach((line) => createFromText(line, { source: 'caderno' }));
    text.value = '';
    updatePreview();
    toast(items.length > 1 ? `${items.length} tarefas salvas.` : 'Tarefa salva.');
  });
  $('#nbClear').addEventListener('click', () => { text.value = ''; updatePreview(); text.focus(); });
  updatePreview();

  // ---------- Desenhar ----------
  const strokes = [];
  let current = null;
  let tool = 'caneta';
  let penSeen = false;
  let cssW = 0;
  let cssH = 0;

  function css(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  function resizeCanvas() {
    const box = canvas.parentElement.getBoundingClientRect();
    cssW = Math.floor(box.width);
    cssH = Math.max(cssH, Math.floor(Math.max(480, window.innerHeight * 0.62)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw(ctx);
  }

  function segment(c, s, a, b) {
    c.save();
    if (s.erase) c.globalCompositeOperation = c === ctx ? 'destination-out' : 'source-over';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = c === ctx ? s.color : s.exportColor;
    c.lineWidth = s.erase ? s.width : s.width * (0.45 + (a.p + b.p) / 2);
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.restore();
  }

  function drawStroke(c, s) {
    const pts = s.points;
    if (pts.length === 1) segment(c, s, pts[0], { ...pts[0], x: pts[0].x + 0.1 });
    for (let i = 1; i < pts.length; i++) segment(c, s, pts[i - 1], pts[i]);
  }

  function redraw(c) {
    if (c === ctx) c.clearRect(0, 0, cssW, cssH);
    for (const s of strokes) drawStroke(c, s);
  }

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure && e.pointerType === 'pen' ? e.pressure : 0.5 };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penSeen = true;
    // Com caneta em uso, a palma da mão (toque) é ignorada.
    if (penSeen && e.pointerType === 'touch') return;
    canvas.setPointerCapture(e.pointerId);
    const erase = tool === 'borracha' || e.button === 5 || (e.buttons & 32);
    current = {
      erase,
      color: css('--text'),
      exportColor: erase ? '#ffffff' : '#1f1a1d',
      width: erase ? 22 : 2.6,
      points: [point(e)],
    };
    strokes.push(current);
    drawStroke(ctx, current);
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const prev = current.points[current.points.length - 1];
      const next = point(ev);
      current.points.push(next);
      segment(ctx, current, prev, next);
    }
    e.preventDefault();
  });

  const end = () => { current = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  for (const btn of root.querySelectorAll('[data-tool]')) {
    btn.addEventListener('click', () => {
      tool = btn.dataset.tool;
      root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    });
  }
  $('#nbUndo').addEventListener('click', () => { strokes.pop(); redraw(ctx); });
  $('#nbWipe').addEventListener('click', () => { strokes.length = 0; redraw(ctx); });
  $('#nbMore').addEventListener('click', () => {
    cssH += LINE * 8;
    const saved = strokes.slice();
    resizeCanvas();
    strokes.splice(0, strokes.length, ...saved);
    redraw(ctx);
  });

  // Recorta a folha até a área usada para a imagem ficar leve e legível.
  function exportBlob() {
    const ink = strokes.filter((s) => !s.erase);
    if (!ink.length) return Promise.resolve(null);
    let maxY = 0;
    for (const s of ink) for (const p of s.points) maxY = Math.max(maxY, p.y);
    const h = Math.min(cssH, Math.ceil((maxY + LINE) / LINE) * LINE);
    const scale = 2;
    const out = document.createElement('canvas');
    out.width = cssW * scale;
    out.height = h * scale;
    const oc = out.getContext('2d');
    oc.scale(scale, scale);
    oc.fillStyle = '#ffffff';
    oc.fillRect(0, 0, cssW, h);
    // Pauta clara na imagem final, como no caderno.
    oc.strokeStyle = '#dfe6ee';
    oc.lineWidth = 1;
    for (let y = LINE; y < h; y += LINE) {
      oc.beginPath();
      oc.moveTo(0, y + 0.5);
      oc.lineTo(cssW, y + 0.5);
      oc.stroke();
    }
    redraw(oc);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.85));
  }

  $('#nbSaveDrawing').addEventListener('click', async () => {
    const blob = await exportBlob();
    if (!blob) return toast('A folha está em branco.');
    const att = await makeAttachment(blob, 'image');
    const typed = $('#nbDrawTitle').value.trim();
    const task = typed
      ? createFromText(typed, { attachments: [att], source: 'caderno' })
      : createTask({ title: `Anotação à mão de ${stamp()}`, attachments: [att], source: 'caderno' });
    strokes.length = 0;
    redraw(ctx);
    $('#nbDrawTitle').value = '';
    openTask(task.id, { focusTitle: !typed });
  });

  window.addEventListener('resize', () => { if (!$('#nbDraw').hidden) resizeCanvas(); });

  return {
    show() {
      if (!$('#nbDraw').hidden) resizeCanvas();
    },
  };
}
