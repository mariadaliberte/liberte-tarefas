// Cronograma (Gantt) do projeto: calcula a régua de dias e a posição de cada tarefa.
// - Tarefa com início e prazo: barra do início ao prazo.
// - Tarefa só com data: marco (losango) no dia.
// - Tarefas sem data ficam de fora (são contadas à parte).

const DAY = 86_400_000;

function parse(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY);
}

function addDays(date, n) {
  const dt = parse(date);
  dt.setDate(dt.getDate() + n);
  return fmt(dt);
}

export function buildTimeline(tasks, project = {}, today = fmt(new Date())) {
  const dated = tasks.filter((t) => t.date && !t.deleted);
  const rows = dated.map((t) => {
    const start = t.startDate && t.startDate < t.date ? t.startDate : t.date;
    return {
      task: t,
      start,
      end: t.date,
      kind: start < t.date ? 'bar' : 'milestone',
      done: t.status === 'feita',
      late: t.status !== 'feita' && t.date < today,
    };
  }).sort((a, b) => (a.start === b.start ? (a.end < b.end ? -1 : 1) : a.start < b.start ? -1 : 1));

  const points = [today, ...rows.flatMap((r) => [r.start, r.end])];
  if (project.startDate) points.push(project.startDate);
  if (project.endDate) points.push(project.endDate);
  const min = points.reduce((a, b) => (b < a ? b : a));
  const max = points.reduce((a, b) => (b > a ? b : a));

  // Respiro nas pontas e no mínimo 3 semanas visíveis.
  const from = addDays(min, -3);
  let to = addDays(max, 7);
  if (diffDays(from, to) < 21) to = addDays(from, 21);

  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dt = parse(d);
    days.push({ date: d, day: dt.getDate(), weekday: dt.getDay(), month: dt.getMonth(), year: dt.getFullYear() });
  }

  return {
    from,
    to,
    days,
    rows: rows.map((r) => ({ ...r, startIdx: diffDays(from, r.start), endIdx: diffDays(from, r.end) })),
    todayIdx: diffDays(from, today),
    projectStartIdx: project.startDate ? diffDays(from, project.startDate) : null,
    projectEndIdx: project.endDate ? diffDays(from, project.endDate) : null,
    undated: tasks.filter((t) => !t.date && !t.deleted).length,
  };
}
