// Arrastar e soltar com mouse, caneta ou dedo.
// - Mouse/caneta: começa ao mover alguns pixels.
// - Dedo: segure ~0,4 s (para não brigar com a rolagem da tela) e arraste.
// Durante o arraste uma cópia do item segue o ponteiro; ao soltar chama onDrop(item, x, y, info).

let active = null;
let lastDropAt = 0;

// Impede a rolagem da página enquanto algo está sendo arrastado com o dedo.
document.addEventListener('touchmove', (e) => { if (active) e.preventDefault(); }, { passive: false });

export function enableDrag(root, { selector, onMove, onDrop, longPress = 400 }) {
  let pending = null;
  const owner = {}; // cada área arrastável cuida só dos próprios itens

  function begin(p) {
    const rect = p.el.getBoundingClientRect();
    const ghost = p.el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      margin: '0', zIndex: '50', pointerEvents: 'none',
    });
    document.body.appendChild(ghost);
    p.el.classList.add('drag-source');
    active = { ...p, owner, ghost, rect, offX: p.x - rect.left, offY: p.y - rect.top };
    navigator.vibrate?.(15);
  }

  function move(x, y) {
    active.ghost.style.left = `${x - active.offX}px`;
    active.ghost.style.top = `${y - active.offY}px`;
    onMove?.(active.el, x, y, active);
  }

  function finish(x, y, cancelled) {
    const a = active;
    active = null;
    a.ghost.remove();
    a.el.classList.remove('drag-source');
    // O clique que vem depois do arraste não deve abrir o item.
    const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', block, { capture: true }), 50);
    lastDropAt = Date.now();
    if (!cancelled) onDrop(a.el, x, y, a);
    else onMove?.(null, x, y, a);
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || active) return;
    const el = e.target.closest(selector);
    if (!el || !root.contains(el)) return;
    pending = { el, x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
    if (e.pointerType === 'touch') {
      const p = pending;
      p.timer = setTimeout(() => { if (pending === p) { begin(p); pending = null; } }, longPress);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (active && active.owner === owner && e.pointerId === active.id) { move(e.clientX, e.clientY); return; }
    if (!pending || e.pointerId !== pending.id) return;
    const d = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.type === 'touch') {
      // Mexeu antes do tempo: é rolagem, não arraste.
      if (d > 10) { clearTimeout(pending.timer); pending = null; }
      return;
    }
    if (d > 6) { const p = pending; pending = null; begin(p); move(e.clientX, e.clientY); }
  });

  const end = (e, cancelled) => {
    if (pending && e.pointerId === pending.id) { clearTimeout(pending.timer); pending = null; }
    if (active && active.owner === owner && e.pointerId === active.id) finish(e.clientX, e.clientY, cancelled);
  };
  window.addEventListener('pointerup', (e) => end(e, false));
  window.addEventListener('pointercancel', (e) => end(e, true));
}

export function isDragging() {
  return !!active || Date.now() - lastDropAt < 400;
}
