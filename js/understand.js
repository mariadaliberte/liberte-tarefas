// Entende pedidos falados ou escritos do jeito natural — sem IA, sem custo, sem internet.
// "Cria uma tarefa pra Ana, prazo sexta, a tarefa é revisar o contrato, é urgente"
//   -> { title: "Revisar o contrato", assignee: "Ana", date: sexta, deadline: true, priority: "urgente" }
// Também separa vários pedidos numa mesma fala ("… e também me lembra de …", "Outra tarefa: …"),
// manda o "porquê" para os detalhes e transforma listas ("x: a, b, c") em checklist.
// Datas, horas, prioridade e repetição continuam com o interpretador (parser.js).

import { parseTask } from './parser.js';

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Palavras com maiúscula que não são nomes de pessoa.
const NOT_NAMES = new Set(['eu', 'ele', 'ela', 'voce', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo',
  'hoje', 'amanha', 'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
  'novembro', 'dezembro', 'cliente', 'equipe', 'todos', 'todas', 'gente', 'mim', 'nos', 'tarefa']);

// ---- Vícios de fala no começo e no fim ----
const LEAD_FILLER = /^\s*(?:ok(?:ay)?|oi|ol[aá]|bom(?:\s+dia)?|boa\s+(?:tarde|noite)|bem|ent[aã]o|ah|olha|tipo|beleza|certo|assim|por\s+favor|[eé]|e\s+tamb[eé]m|tamb[eé]m|al[eé]m\s+disso|outra\s+(?:coisa|tarefa)|mais\s+uma(?:\s+tarefa)?|e\s+mais|e)(?=[\s,.:;!?-]|$)[\s,.:;!?–-]*/iu;
const TRAIL_FILLER = /[\s,.;:!?–-]*(?<![\p{L}\d])(?:t[aá]|n[eé]|ok(?:ay)?|obrigad[ao]|valeu|por\s+favor|beleza|t[aá]\s+bom|pode\s+ser|(?:ent[aã]o\s+)?(?:v[eê]|veja|resolve|resolva|cuida|cuide)\s+(?:disso|isso)(?:\s+pra\s+mim)?|isso\s+a[ií])[\s.!?]*$/iu;

function stripFillers(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(LEAD_FILLER, '').replace(TRAIL_FILLER, '');
  } while (s !== prev);
  return s.trim();
}

// ---- Abertura do pedido ("cria uma tarefa", "me lembra de", "eu preciso") ----
const COMMAND = /^\s*(?:(?:uma?\s+)?(?:nov[ao]\s+)?(tarefa|lembrete|compromisso)\b(?=\s*(?:para|pra|pro|:|-))\s*[:–-]?\s*|(?:(?:voc[eê]|vc)\s+)?(?:(?:pode|poderia|consegue)\s+)?(?:cri[ae]r?|coloc[ae]r?|bot[ae]r?|adicion[ae]r?|anot[ae]r?|registr[ae]r?|inclu[ia]r?|p[oõ]e|agend[ae]|marqu?[ae])\s+(?:a[ií][\s,]+)?(?:(?:pra|para)\s+mim\s+)?(?:a[ií][\s,]+)?(?:uma?\s+|a\s+|o\s+)?(?:nov[ao]\s+)?(?:(tarefa|lembrete|atividade|compromisso|anota[cç][aã]o|pend[eê]ncia)\b\s*)?(?:recorrente\s+)?(?:(urgente|importante)\s+)?(?:(?:pra|para)\s+mim\s+)?(?:a[ií]\s*)?[:,–-]?\s*(?:(?:de|que|pra\s+eu|para\s+eu)\s+)?)/iu;
const NEED = /^\s*(?:(?:me\s+)?lembr(?:a|e|ar)(?:-me)?\s+(?:de\s+|que\s+(?:eu\s+)?(?:preciso|tenho\s+que)\s+(?:de\s+)?)?|(?:eu\s+)?(?:preciso|tenho\s+que|vou\s+ter\s+que|vou\s+precisar|devo)\s+(?:de\s+)?|n[aã]o\s+(?:posso\s+|pode\s+|vou\s+)?(?:esquecer|deixar\s+de)\s+(?:de\s+)?|n[aã]o\s+esque[cç]a\s+de\s+)/iu;

// Começo de frase que indica um pedido novo (para separar vários pedidos numa fala).
const NEW_REQUEST = /^\s*(?:e\s+)?(?:tamb[eé]m\s+|al[eé]m\s+disso\s*,?\s*)?(?:(?:voc[eê]|vc)\s+)?(?:(?:pode|poderia)\s+)?(?:cri[ae]r?|coloc[ae]r?|bot[ae]|adicion[ae]r?|anot[ae]r?|registr[ae]|agend[ae]|marqu?[ae]|(?:me\s+)?lembr[ae]|preciso|tenho\s+que|n[aã]o\s+(?:posso\s+)?esquecer|pe[dç][ae]\s+(?:pra|para|pro|à|ao)|outra\s+(?:coisa|tarefa)|mais\s+uma)\b/iu;
const SUBJECT_START = /^\s*(?:e\s+)?(?:a\s+|o\s+)?\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?\s*,?\s+(?:precisa|tem\s+que|vai|deve)\b/u;
const MID_SPLIT = /\s*,?\s*\b(?=(?:e\s+tamb[eé]m|al[eé]m\s+disso|outra\s+tarefa|mais\s+uma\s+tarefa|e\s+(?:me\s+)?lembr[ae]\s+(?:de|que)|e\s+(?:cri[ae]|anot[ae]|agend[ae]|coloc[ae])\s+(?:uma?|a[ií]|outra|tamb[eé]m)\b))/giu;

// ---- Pessoa responsável ----
function personMatcher(knownPeople) {
  const people = knownPeople.map((full) => ({ full, f: fold(full), first: fold(full).split(/\s+/)[0] }));
  // Tenta reconhecer um nome no começo de `s`. Devolve { name, length } ou null.
  return (s, { knownOnly = false } = {}) => {
    const m = /^([\p{L}]+)(?:\s+([\p{L}]+))?/u.exec(s);
    if (!m) return null;
    const w1 = fold(m[1]);
    const two = m[2] ? `${w1} ${fold(m[2])}` : null;
    const full = two && people.find((p) => p.f === two);
    if (full) return { name: full.full, length: m[0].length };
    const known = people.find((p) => p.f === w1) || people.find((p) => p.first === w1);
    if (known) return { name: known.full, length: m[1].length };
    // Nome fora da equipe só vale com maiúscula (o ditado costuma acertar nomes próprios).
    if (!knownOnly && /^\p{Lu}\p{Ll}+$/u.test(m[1]) && !NOT_NAMES.has(w1)) return { name: m[1], length: m[1].length };
    return null;
  };
}

const IRREGULAR = {
  faca: 'fazer', faça: 'fazer', traga: 'trazer', diga: 'dizer', veja: 'ver', ponha: 'pôr', va: 'ir', vá: 'ir', de: 'dar', dê: 'dar',
  seja: 'ser', tenha: 'ter', abra: 'abrir', peca: 'pedir', peça: 'pedir', siga: 'seguir', suba: 'subir', divida: 'dividir',
  inclua: 'incluir', conclua: 'concluir', resolva: 'resolver', escreva: 'escrever', responda: 'responder', mexa: 'mexer',
  envie: 'enviar', confira: 'conferir', descubra: 'descobrir', preencha: 'preencher', leia: 'ler', venda: 'vender',
  agende: 'agendar', marque: 'marcar', comece: 'começar', esqueca: 'esquecer', esqueça: 'esquecer', reuna: 'reunir', reúna: 'reunir',
};
function toInfinitive(word) {
  const w = word.toLowerCase();
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/(?:ar|er|ir)$/.test(w)) return w;
  if (/que$/.test(w)) return w.replace(/que$/, 'car');
  if (/gue$/.test(w)) return w.replace(/gue$/, 'gar');
  if (/ce$/.test(w)) return w.replace(/ce$/, 'çar');
  if (/e$/.test(w)) return w.replace(/e$/, 'ar');
  if (/a$/.test(w)) return w.replace(/a$/, 'er');
  return w;
}

function extractAssignee(s, matchPerson) {
  // "quero que a Ana ligue…", "(preciso) que o Marcos envie…"
  const q = /^(?:(?:eu\s+)?(?:quero|queria|gostaria)\s+)?que\s+(?:a\s+|o\s+)?/iu.exec(s);
  if (q) {
    const rest = s.slice(q[0].length);
    const p = matchPerson(rest);
    if (p) {
      const after = rest.slice(p.length).trim().replace(/^([\p{L}]+)/u, (v) => toInfinitive(v));
      return { assignee: p.name, text: after };
    }
  }
  // "Marcos, organizar…" (só para pessoas da equipe)
  const v = /^([\p{L}]+(?:\s+[\p{L}]+)?)\s*[,:–-]\s+/u.exec(s);
  if (v) {
    const p = matchPerson(v[1], { knownOnly: true });
    if (p && p.length >= v[1].split(/\s+/)[0].length) return { assignee: p.name, text: s.slice(v[0].length) };
  }
  const rules = [
    // "para a Ana revisar…" logo no começo (depois de "cria uma tarefa")
    /^(?:para|pra|pro|à|ao)\s+(?:a\s+|o\s+)?/iu,
    // "a Ana precisa / tem que / vai…" no começo
    /^(?:a\s+|o\s+)?(?=\S+(?:\s+\S+)?\s+(?:precisa|tem\s+que|vai|deve|fica|pode|t[aá]\s+(?:responsável|encarregad[ao])))/iu,
  ];
  for (const re of rules) {
    const m = re.exec(s);
    if (!m) continue;
    const rest = s.slice(m[0].length);
    const p = matchPerson(rest);
    if (!p) continue;
    let after = rest.slice(p.length);
    after = after.replace(/^\s*,?\s*(?:precisa|tem\s+que|vai|deve|pode)\s+(?:de\s+)?/iu, ' ')
      .replace(/^\s*,?\s*(?:fica|t[aá])\s+(?:respons[aá]vel|encarregad[ao])\s+(?:de|por|pela?|pelo)\s+/iu, ' ')
      .replace(/^\s*,?\s*fazer\s+/iu, ' ');
    return { assignee: p.name, text: after.trim() };
  }
  // Em qualquer lugar: "pede pra Ana…", "responsável é a Ana", "delega pra Ana", "quem faz é a Ana"
  const anywhere = /(?:^|[\s,;])(?:(?:pe[dç][ae]r?|pedi|avis[ae]r?|delegu?[ae]r?|pass[ae]r?)\s+(?:pra|para|pro|à|ao)\s+(?:a\s+|o\s+)?|(?:o\s+|a\s+)?respons[aá]vel\s*(?:[eé]|ser[aá]|vai\s+ser|fica\s+sendo|:)?\s*(?:a\s+|o\s+)?|quem\s+(?:faz|vai\s+fazer)\s+[eé]\s+(?:a\s+|o\s+)?)/giu;
  let m;
  while ((m = anywhere.exec(s))) {
    const start = m.index + m[0].length;
    const p = matchPerson(s.slice(start));
    if (!p) continue;
    const text = `${s.slice(0, m.index)} ${s.slice(start + p.length)}`.replace(/^\s*(?:de|que)\s+/iu, '');
    return { assignee: p.name, text: text.trim() };
  }
  return { assignee: null, text: s };
}

// ---- Prazo e "a tarefa é" ----
function normalizeDeadline(s) {
  return s
    .replace(/(?:\bcom\s+)?(?:\bo\s+)?\b(?:prazo|data\s+(?:de|da)\s+entrega|entrega)\s+(?:de\s+entrega\s+)?(?:(?:[eé]|ser[aá]|vai\s+ser|fica)\s+|:\s*|(?:pra|para|de)\s+)?(?:at[eé]\s+)?(?:o\s+(?=dia))?(?=(?:dia\s|hoje|amanh|depois|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|\d|semana|m[eê]s|fim|final|pr[oó]xim))/giu, ' até ')
    .replace(/(?:\b(?:e|,)\s+)?\b(?:a\s+)?(?:tarefa|atividade|ideia)\s+(?:[eé]|seria|vai\s+ser|:)\s+(?:(?:de|pra|para)\s+)?/giu, ' ');
}

// ---- Pedaços que vão para detalhes e checklist ----
function splitChecklist(s) {
  const i = s.indexOf(':');
  if (i < 3) return { head: s, items: [] };
  const items = s.slice(i + 1).split(/\s*(?:[,;]|\s+e\s+(?=\S+\s+\S+))\s*/u).map((x) => x.trim().replace(/[.!]+$/, '')).filter(Boolean);
  if (items.length < 2) return { head: s, items: [] };
  return { head: s.slice(0, i).trim(), items: items.map(cap) };
}

const REASON = /\s*,?\s+(?=(?:porque|pois|j[aá]\s+que|para\s+que|pra\s+que|uma\s+vez\s+que|caso|sen[aã]o|lembrando\s+que|obs:?)\b)/iu;

function cleanTitle(title) {
  let t = title.replace(/\s+/g, ' ').trim();
  let prev;
  do {
    prev = t;
    t = t.replace(/[.!?]+$/u, '').replace(/^(?:e|com|que|de|pra|para|,|:|;|-|–)\s+/iu, '')
      .replace(/[\s,;:–-]+(?:e|[eé]\s+isso|isso\s+[eé]|[eé]|com|que|de|pra|para|a|o|t[aá]|n[eé])$/iu, '')
      .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '');
    t = stripFillers(t);
  } while (t !== prev);
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/,{2,}/g, ',');
}

// Um pedido -> uma tarefa.
export function understandOne(rawText, options = {}) {
  const knownPeople = options.knownPeople || [];
  const matchPerson = personMatcher(knownPeople);
  let s = stripFillers((rawText || '').normalize('NFC').replace(/\s+/g, ' '));
  const original = s;

  // Abertura ("cria uma tarefa…", "me lembra de…"); "compromisso" marca o tipo.
  let kindHint = null;
  let prioHint = null;
  const c = COMMAND.exec(s);
  if (c && c[0].trim()) {
    if (/compromisso/i.test(c[1] || c[2] || '')) kindHint = 'compromisso';
    if (c[3]) prioHint = /urgente/i.test(c[3]) ? 'urgente' : 'alta';
    s = s.slice(c[0].length);
  }
  s = s.replace(NEED, '');

  const a = extractAssignee(s, matchPerson);
  s = a.text.replace(NEED, '');

  s = normalizeDeadline(s);
  const { head, items } = splitChecklist(s);

  const p = parseTask(head, { ...options, knownPeople });
  let title = cleanTitle(p.title);

  // "porque…", "pois…" e títulos longos: o essencial no título, o resto nos detalhes.
  let notes = '';
  const r = REASON.exec(title);
  if (r && r.index > 8) {
    notes = cleanTitle(title.slice(r.index));
    title = cleanTitle(title.slice(0, r.index));
  } else if (title.length > 90) {
    const cut = title.search(/[,;.]\s/);
    if (cut > 15) {
      notes = cleanTitle(title.slice(cut + 1));
      title = cleanTitle(title.slice(0, cut));
    }
  }
  title = cap(title || cleanTitle(original) || original);

  return {
    ...p,
    title,
    notes,
    assignee: a.assignee || p.assignee,
    // Começa com verbo ("ligar…", "preparar…") e não tem hora: é tarefa, mesmo citando "reunião".
    kind: kindHint || (p.kind === 'compromisso' && !p.time && /^\p{L}+(?:ar|er|ir|or|ôr)\b/iu.test(title) ? 'tarefa' : p.kind),
    priority: p.priority || prioHint,
    checklist: items,
  };
}

// Separa uma fala com vários pedidos.
export function splitRequests(rawText) {
  const text = (rawText || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  // Frases (sem quebrar números como 1.500 ou e-mails).
  const sentences = text.split(/(?<=[.!?;])\s+|\n+/u).map((x) => x.trim()).filter(Boolean);
  const parts = [];
  for (const sentence of sentences) {
    for (const piece of sentence.split(MID_SPLIT).map((x) => x.trim()).filter(Boolean)) {
      const body = stripFillers(piece);
      if (!body) continue;
      if (!parts.length || NEW_REQUEST.test(piece) || SUBJECT_START.test(piece)) parts.push(piece);
      else parts[parts.length - 1] = `${parts[parts.length - 1].replace(/[.!?;]+$/, '')}, ${piece}`;
    }
  }
  return parts.length ? parts : [text];
}

// Fala inteira -> lista de tarefas.
export function understand(rawText, options = {}) {
  return splitRequests(rawText)
    .map((part) => understandOne(part, options))
    .filter((t) => t.title && t.title.length > 1);
}
