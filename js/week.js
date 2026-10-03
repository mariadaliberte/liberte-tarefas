// Visão de agenda no formato do Google Agenda (semana / 3 dias / dia).
// Este módulo só calcula: quais dias aparecem e onde cada item fica na grade.

export const HOUR_HEIGHT = 48; // px por hora
const DAY = 86_400_000;

export function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const dt = parseYmd(s);
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
}

// Dias visíveis. Semana começa no domingo, como no Google Agenda em português.
export function visibleDays(anchor, mode) {
  let start = anchor;
  let count = 1;
  if (mode === 'semana') {
    start = addDays(anchor, -parseYmd(anchor).getDay());
    count = 7;
  } else if (mode === '3dias') {
    count = 3;
  }
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export function shiftAnchor(anchor, mode, dir) {
  const step = mode === 'semana' ? 7 : mode === '3dias' ? 3 : 1;
  return addDays(anchor, step * dir);
}

const minutesOf = (dt) => dt.getHours() * 60 + dt.getMinutes();

// Converte eventos do Google e tarefas em itens da grade, por dia.
// item: { id, title, kind: 'evento'|'tarefa', allDay, day, startMin, endMin, ref }
export function buildItems(days, { events = [], tasks = [], appointmentMinutes = 60 } = {}) {
  const first = days[0];
  const last = days[days.length - 1];
  const items = [];

  for (const ev of events) {
    if (ev.start?.date) {
      // Dia inteiro: o fim (end.date) é exclusivo.
      for (const day of days) {
        if (ev.start.date <= day && day < (ev.end?.date || addDays(ev.start.date, 1))) {
          items.push({ id: ev.id, title: ev.summary || '(sem título)', kind: 'evento', allDay: true, day, ref: ev });
        }
      }
      continue;
    }
    if (!ev.start?.dateTime) continue;
    const s = new Date(ev.start.dateTime);
    const e = new Date(ev.end?.dateTime || s.getTime() + 3_600_000);
    for (const day of days) {
      const d0 = parseYmd(day).getTime();
      const d1 = d0 + DAY;
      if (e.getTime() <= d0 || s.getTime() >= d1) continue;
      const startMin = s.getTime() <= d0 ? 0 : minutesOf(s);
      const endMin = e.getTime() >= d1 ? 24 * 60 : minutesOf(e);
      items.push({ id: ev.id, title: ev.summary || '(sem título)', kind: 'evento', allDay: false, day, startMin, endMin: Math.max(endMin, startMin + 15), ref: ev });
    }
  }

  for (const t of tasks) {
    if (!t.date || t.deleted || t.date < first || t.date > last) continue;
    if (!t.time) {
      items.push({ id: t.id, title: t.title, kind: 'tarefa', allDay: true, day: t.date, ref: t });
      continue;
    }
    const [h, m] = t.time.split(':').map(Number);
    const startMin = h * 60 + m;
    const dur = t.kind === 'compromisso' ? appointmentMinutes : 30;
    items.push({ id: t.id, title: t.title, kind: 'tarefa', allDay: false, day: t.date, startMin, endMin: Math.min(24 * 60, startMin + dur), ref: t });
  }
  return items;
}

// Itens que se sobrepõem dividem a largura da coluna, lado a lado.
export function layoutDay(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const it of cluster) {
      let lane = lanes.findIndex((end) => end <= it.startMin);
      if (lane === -1) { lane = lanes.length; lanes.push(it.endMin); } else lanes[lane] = it.endMin;
      it.lane = lane;
    }
    for (const it of cluster) out.push({ ...it, lanes: lanes.length });
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}
