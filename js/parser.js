// Interpreta frases em português e extrai data, hora, prioridade e responsável.
// Ex.: "Reunião com fornecedor sexta às 15h urgente @Ana"
//   -> { title: "Reunião com fornecedor", date: "2026-10-02", time: "15:00",
//        priority: "urgente", assignee: "Ana", kind: "compromisso" }

const MONTHS = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4,
  maio: 5, mai: 5, junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8,
  setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

const NUMBER_WORDS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, trinta: 30,
};
const NUM_RE = `\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')}`;

const APPOINTMENT_WORDS =
  /\b(reuniao|consulta|call|chamada|almoco|jantar|cafe com|encontro|visita|aula|mentoria|evento|entrevista|dentista|medico|medica|exame|palestra|workshop|live|webinar|onboarding|sessao)\b/;

// Prefixos que só fazem sentido junto da data ("até sexta", "para amanhã", "no dia 10").
const DATE_PREFIX = '(?:(ate|para|pra|no|na|em|dia|de|do|a partir de)\\s+)?';

function fold(text) {
  // Minúsculas sem acento, preservando o tamanho da string para mapear posições.
  let out = '';
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += (base.length === ch.length ? base : ch).toLowerCase();
  }
  return out;
}

function toNumber(word) {
  return /^\d+$/.test(word) ? parseInt(word, 10) : NUMBER_WORDS[word];
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(base, n) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function validDate(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function parseTask(rawText, options = {}) {
  const now = options.now || new Date();
  const knownPeople = options.knownPeople || [];
  const knownProjects = options.knownProjects || [];
  const text = (rawText || '').normalize('NFC');
  const folded = fold(text);
  const spans = [];
  const result = {
    title: '', date: null, time: null, priority: null, assignee: null,
    kind: 'tarefa', deadline: false, project: null,
  };

  const take = (match, start = match.index, end = match.index + match[0].length) => {
    spans.push([start, end]);
  };
  const overlaps = (s, e) => spans.some(([a, b]) => s < b && e > a);
  const find = (re) => {
    let m;
    const g = new RegExp(re.source, 'dg');
    while ((m = g.exec(folded))) {
      if (!overlaps(m.index, m.index + m[0].length)) return m;
      if (m[0].length === 0) g.lastIndex++;
    }
    return null;
  };
  const markDeadline = (prefix) => { if (prefix === 'ate') result.deadline = true; };

  // ---- Prefixos tipo "me lembra de", "lembrete:" ----
  let m = find(/^\s*(?:me\s+)?(?:lembr(?:a|e|ar)(?:-me)?|lembrete)\s*(?:de|que|:)?\s+/);
  if (m) take(m);

  // ---- Prioridade ----
  const priorities = [
    [/\b(?:muito\s+)?urgen(?:te|cia)\b/, 'urgente'],
    [/\b(?:prioridade\s+(?:alta|maxima)|alta\s+prioridade|importante)\b/, 'alta'],
    [/\b(?:prioridade\s+(?:media|normal))\b/, 'normal'],
    [/\b(?:prioridade\s+baixa|baixa\s+prioridade|sem\s+pressa|quando\s+der)\b/, 'baixa'],
  ];
  for (const [re, level] of priorities) {
    m = find(re);
    if (m) { result.priority = level; take(m); break; }
  }

  // ---- Projeto (#nome) ----
  // "#lancamento" encontra o projeto "Lançamento Fluir" (sem acento, sem espaço, pelo começo do nome).
  m = /#([\p{L}\d][\p{L}\d_-]*)/u.exec(text);
  if (m) {
    const key = fold(m[1]).replace(/[_-]/g, '');
    const squash = (n) => fold(n).replace(/[^a-z0-9]/g, '');
    const found = knownProjects.find((n) => squash(n) === key)
      || knownProjects.find((n) => squash(n).startsWith(key))
      || knownProjects.find((n) => fold(n).split(/\s+/).some((w) => w.replace(/[^a-z0-9]/g, '').startsWith(key)));
    if (found) {
      result.project = found;
      take(m);
    }
  }

  // ---- Responsável ----
  m = /@([\p{L}][\p{L}\d_.-]*)/u.exec(text);
  if (m && !overlaps(m.index, m.index + m[0].length)) {
    result.assignee = m[1].replace(/[._-]/g, ' ').trim();
    take(m);
  } else {
    m = find(/\b(?:responsavel|resp\.?|delegar\s+(?:para|pra)(?:\s+[ao])?|delegado\s+(?:para|pra)(?:\s+[ao])?)\s*:?\s+([a-z]+)(?:\s+([a-z]+))?/);
    if (m) {
      const [s1, e1] = m.indices[1];
      let name = capitalize(text.slice(s1, e1));
      let end = e1;
      if (m[2]) {
        const [s2, e2] = m.indices[2];
        const full = fold(`${text.slice(s1, e1)} ${text.slice(s2, e2)}`);
        const known = knownPeople.find((p) => fold(p) === full);
        if (known) { name = known; end = e2; }
      }
      if (end === e1) {
        const known = knownPeople.find((p) => fold(p) === m[1]);
        if (known) name = known;
      }
      result.assignee = name;
      take(m, m.index, end);
    }
  }

  // ---- Hora ----
  const applyPeriod = (h, period) => {
    if (!period) return h;
    if ((period.includes('tarde') || period.includes('noite')) && h < 12) return h + 12;
    if (period.includes('manha') && h === 12) return 0;
    return h;
  };
  const PERIOD = '(?:\\s+(da\\s+manha|da\\s+tarde|da\\s+noite|de\\s+manha|de\\s+tarde|de\\s+noite))?';
  m = find(new RegExp(`\\b(?:as|a|ao|para\\s+as|pras|ate\\s+as)?\\s*\\b(meio[\\s-]dia)(?:\\s+e\\s+meia)?\\b`));
  if (m) {
    result.time = /meia/.test(m[0]) ? '12:30' : '12:00';
    take(m);
  } else {
    m = find(new RegExp(`(?:\\b(?:as|a|ao|para\\s+as|pras|ate\\s+as)\\s+)?\\b(\\d{1,2})\\s*(?:h|:|hs|hrs?\\b)\\s*(\\d{2})?(?:\\s*min)?\\b${PERIOD}`));
    if (!m) m = find(new RegExp(`\\b(?:as|pras|ate\\s+as)\\s+(\\d{1,2})(?:\\s*(?:horas?|e\\s+(meia)))?\\b${PERIOD}`));
    if (m) {
      let h = parseInt(m[1], 10);
      let min = m[2] === 'meia' ? 30 : m[2] ? parseInt(m[2], 10) : 0;
      h = applyPeriod(h, m[3]);
      if (h <= 23 && min <= 59) {
        result.time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        if (/^ate\b/.test(m[0].trim())) result.deadline = true;
        take(m);
      }
    }
  }

  // ---- Data ----
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date = null;

  const tryRelative = () => {
    const rel = [
      [/depois\s+de\s+amanha/, 2],
      [/amanha/, 1],
      [/hoje|hj/, 0],
      [/ontem/, -1],
    ];
    for (const [re, n] of rel) {
      const mm = find(new RegExp(`\\b${DATE_PREFIX}(?:${re.source})\\b(?:\\s+(?:de\\s+manha|a\\s+tarde|a\\s+noite|cedo))?`));
      if (mm) { markDeadline(mm[1]); take(mm); return addDays(today, n); }
    }
    return null;
  };

  const tryNumeric = () => {
    const mm = find(new RegExp(`\\b${DATE_PREFIX}(?:dia\\s+)?(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?\\b`));
    if (!mm) return null;
    const d = parseInt(mm[2], 10);
    const mo = parseInt(mm[3], 10);
    let y = mm[4] ? parseInt(mm[4], 10) : today.getFullYear();
    if (y < 100) y += 2000;
    let dt = validDate(y, mo, d);
    if (!dt) return null;
    if (!mm[4] && dt < today) dt = validDate(y + 1, mo, d);
    markDeadline(mm[1]);
    take(mm);
    return dt;
  };

  const tryMonthName = () => {
    const mm = find(new RegExp(`\\b${DATE_PREFIX}(?:dia\\s+)?(\\d{1,2})\\s+de\\s+(${MONTH_RE})\\b(?:\\s+de\\s+(\\d{4}))?`));
    if (!mm) return null;
    const d = parseInt(mm[2], 10);
    const mo = MONTHS[mm[3]];
    let y = mm[4] ? parseInt(mm[4], 10) : today.getFullYear();
    let dt = validDate(y, mo, d);
    if (!dt) return null;
    if (!mm[4] && dt < today) dt = validDate(y + 1, mo, d);
    markDeadline(mm[1]);
    take(mm);
    return dt;
  };

  const tryDayOnly = () => {
    const mm = find(new RegExp(`\\b(?:(ate|para|pra|no)\\s+)?(?:o\\s+)?dia\\s+(\\d{1,2})\\b`));
    if (!mm) return null;
    const d = parseInt(mm[2], 10);
    let dt = validDate(today.getFullYear(), today.getMonth() + 1, d);
    if (!dt || dt < today) {
      const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      dt = validDate(next.getFullYear(), next.getMonth() + 1, d);
    }
    if (!dt) return null;
    markDeadline(mm[1]);
    take(mm);
    return dt;
  };

  const tryWeekday = () => {
    const names = Object.keys(WEEKDAYS).join('|');
    const mm = find(new RegExp(`\\b${DATE_PREFIX}(?:(?:n?[ao])\\s+)?(?:(proxim[ao]|nest[ae]|ness[ae]|est[ae]|ess[ae])\\s+)?(${names})(?:[\\s-]feira)?(?:\\s+(que\\s+vem|da\\s+semana\\s+que\\s+vem))?\\b`));
    if (!mm) return null;
    const target = WEEKDAYS[mm[3]];
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    if (mm[4] && /semana/.test(mm[4])) {
      // "sexta da semana que vem": sempre na semana seguinte (segunda a domingo)
      const daysToNextMonday = ((1 - today.getDay() + 7) % 7) || 7;
      diff = daysToNextMonday + ((target + 6) % 7);
    }
    markDeadline(mm[1]);
    take(mm);
    return addDays(today, diff);
  };

  const tryInterval = () => {
    const mm = find(new RegExp(`\\b(ate\\s+)?(?:em|daqui\\s+a|daqui|dentro\\s+de)\\s+(${NUM_RE})\\s+(dias?|semanas?|mes|meses)\\b`));
    if (mm) {
      const n = toNumber(mm[2]);
      if (n === undefined) return null;
      take(mm);
      if (mm[1]) result.deadline = true;
      if (mm[3].startsWith('dia')) return addDays(today, n);
      if (mm[3].startsWith('semana')) return addDays(today, n * 7);
      const d = new Date(today);
      d.setMonth(d.getMonth() + n);
      return d;
    }
    const nw = find(/\b(ate\s+)?(?:a\s+)?(semana\s+que\s+vem|proxima\s+semana|mes\s+que\s+vem|proximo\s+mes|fim\s+do\s+mes|final\s+do\s+mes)\b/);
    if (!nw) return null;
    take(nw);
    if (nw[1]) result.deadline = true;
    if (/semana/.test(nw[2])) {
      const daysToMonday = ((1 - today.getDay() + 7) % 7) || 7;
      return addDays(today, daysToMonday);
    }
    if (/fim|final/.test(nw[2])) return new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return new Date(today.getFullYear(), today.getMonth() + 1, 1);
  };

  date = tryRelative() || tryNumeric() || tryMonthName() || tryDayOnly() || tryWeekday() || tryInterval();

  if (find(/\bprazo\b/)) {
    result.deadline = true;
    take(find(/\b(?:com\s+)?prazo(?:\s+(?:ate|para|pra|:))?\b/));
  }

  if (!date && result.time) {
    date = new Date(today);
    const [h, mi] = result.time.split(':').map(Number);
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, mi);
    if (at < now) date = addDays(today, 1);
  }
  if (date) result.date = formatDate(date);

  // ---- Tipo ----
  if (result.time && !result.deadline) result.kind = 'compromisso';
  else if (APPOINTMENT_WORDS.test(folded) && !result.deadline) result.kind = 'compromisso';

  // ---- Título limpo ----
  spans.sort((a, b) => b[0] - a[0]);
  // Só limpa preposições soltas nas pontas de onde algo foi retirado.
  const endTouched = spans.some(([, e]) => !text.slice(e).trim());
  const startTouched = spans.some(([st]) => !text.slice(0, st).trim());
  let title = text;
  for (const [s, e] of spans) title = `${title.slice(0, s)} ${title.slice(e)}`;
  title = title.replace(/\s+/g, ' ').trim();
  const dangling = /^(?:,|-|–|:|e|para|pra|ate|até|no|na|em|dia|de|do|da|às|as|a|com|o)$/i;
  let words = title.split(' ');
  while (endTouched && words.length > 1 && dangling.test(words[words.length - 1])) words.pop();
  while (startTouched && words.length > 1 && /^(?:,|-|–|:|e)$/.test(words[0])) words.shift();
  title = words.join(' ').replace(/\s+([,.;:!?])/g, '$1').replace(/[,;:\-–]+$/, '').trim();
  result.title = capitalize(title || text.trim());

  return result;
}
