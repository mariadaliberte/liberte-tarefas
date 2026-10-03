// Tarefas recorrentes: regras de repetição e cálculo da próxima data.
// rec: { freq: 'diaria' | 'uteis' | 'semanal' | 'mensal' | 'anual', interval?: n,
//        days?: [0..6] (semanal), monthDay?: 1..31 | 'ultimo' | 'ultimo-util' (mensal) }

function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function addDays(s, n) {
  const dt = parse(s);
  dt.setDate(dt.getDate() + n);
  return fmt(dt);
}

function lastDay(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function monthDate(y, m, monthDay) {
  if (monthDay === 'ultimo') return fmt(new Date(y, m, lastDay(y, m)));
  if (monthDay === 'ultimo-util') {
    const dt = new Date(y, m, lastDay(y, m));
    while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() - 1);
    return fmt(dt);
  }
  return fmt(new Date(y, m, Math.min(Number(monthDay), lastDay(y, m))));
}

const isWeekday = (s) => { const d = parse(s).getDay(); return d !== 0 && d !== 6; };

// Primeira data que segue a regra a partir de `from` (inclusive).
export function firstOccurrence(rec, from) {
  if (!rec) return from;
  if (rec.freq === 'uteis') {
    let d = from;
    while (!isWeekday(d)) d = addDays(d, 1);
    return d;
  }
  if (rec.freq === 'semanal' && rec.days?.length) {
    let d = from;
    for (let i = 0; i < 7; i++) {
      if (rec.days.includes(parse(d).getDay())) return d;
      d = addDays(d, 1);
    }
  }
  if (rec.freq === 'mensal' && rec.monthDay != null) {
    const f = parse(from);
    const here = monthDate(f.getFullYear(), f.getMonth(), rec.monthDay);
    return here >= from ? here : monthDate(f.getFullYear(), f.getMonth() + 1, rec.monthDay);
  }
  return from;
}

// Próxima data depois de `date` (exclusivo).
export function nextOccurrence(rec, date) {
  const n = Math.max(1, Number(rec.interval) || 1);
  const dt = parse(date);
  switch (rec.freq) {
    case 'diaria':
      return addDays(date, n);
    case 'uteis': {
      let d = addDays(date, 1);
      while (!isWeekday(d)) d = addDays(d, 1);
      return d;
    }
    case 'semanal': {
      const days = rec.days?.length ? [...rec.days].sort() : [dt.getDay()];
      // Próximo dia da lista na mesma semana; senão, o primeiro da semana seguinte (pulando intervalo).
      for (let i = 1; i <= 7; i++) {
        const d = addDays(date, i);
        const wd = parse(d).getDay();
        if (days.includes(wd)) {
          const crossedWeek = wd <= dt.getDay();
          return crossedWeek && n > 1 ? addDays(d, 7 * (n - 1)) : d;
        }
      }
      return addDays(date, 7 * n);
    }
    case 'mensal': {
      const md = rec.monthDay ?? dt.getDate();
      return monthDate(dt.getFullYear(), dt.getMonth() + n, md);
    }
    case 'anual':
      return monthDate(dt.getFullYear() + n, dt.getMonth(), dt.getDate());
    default:
      return addDays(date, 1);
  }
}

const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function describe(rec) {
  if (!rec) return '';
  const n = Number(rec.interval) || 1;
  switch (rec.freq) {
    case 'diaria': return n > 1 ? `a cada ${n} dias` : 'todo dia';
    case 'uteis': return 'dias úteis';
    case 'semanal': {
      const days = (rec.days || []).map((d) => WEEK[d]);
      const base = days.length ? `toda ${days.join(', ')}` : 'toda semana';
      return n > 1 ? `${base} (a cada ${n} semanas)` : base;
    }
    case 'mensal':
      if (rec.monthDay === 'ultimo') return 'último dia do mês';
      if (rec.monthDay === 'ultimo-util') return 'último dia útil do mês';
      return `todo dia ${rec.monthDay}${n > 1 ? ` (a cada ${n} meses)` : ''}`;
    case 'anual': return 'todo ano';
    default: return 'repete';
  }
}
