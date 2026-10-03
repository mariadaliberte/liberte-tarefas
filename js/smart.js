// Entender pedidos com IA: "crie uma tarefa para a Ana revisar o contrato até sexta, é urgente"
// vira { título: "Revisar o contrato", responsável: Ana, prazo: sexta, prioridade: urgente }.
// Serve para voz, fotos (print de conversa, bilhete, quadro), textos longos e mensagens do WhatsApp.
// Sem chave de IA ou sem internet, cai no interpretador simples — nada se perde.

import * as store from './store.js';
import { understand } from './understand.js';
import { firstOccurrence } from './recurrence.js';
import { aiKey, askClaude } from './ai-read.js';

const PENDING_KEY = 'lt.smart.pending';

export function smartEnabled() {
  if (!aiKey()) return false;
  try { return localStorage.getItem('lt.smart.off') !== '1'; } catch { return true; }
}

// Vale a pena chamar a IA? Voz, foto e compartilhado: sempre. Texto digitado: só se for um pedido longo.
export function worthAI(text, source) {
  if (!smartEnabled()) return false;
  if (['voz', 'foto', 'compartilhada', 'entrada'].includes(source)) return true;
  return (text || '').trim().split(/\s+/).length >= 12;
}

const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tarefas'],
  properties: {
    tarefas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['titulo', 'detalhes', 'tipo', 'data', 'hora', 'prazo', 'prioridade', 'responsavel', 'projeto', 'repeticao', 'checklist'],
        properties: {
          titulo: { type: 'string', description: 'O que fazer, curto (verbo + objeto), sem data, pessoa ou prioridade.' },
          detalhes: { type: 'string', description: 'Contexto útil que não cabe no título. Vazio se não houver.' },
          tipo: { type: 'string', enum: ['tarefa', 'compromisso'] },
          data: { ...NULLABLE_STRING, description: 'AAAA-MM-DD ou null.' },
          hora: { ...NULLABLE_STRING, description: 'HH:MM (24h) ou null.' },
          prazo: { type: 'boolean', description: 'true se a data é um limite ("até sexta"), false se é o dia de fazer.' },
          prioridade: { type: 'string', enum: ['urgente', 'alta', 'normal', 'baixa'] },
          responsavel: NULLABLE_STRING,
          projeto: NULLABLE_STRING,
          repeticao: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['freq', 'dias', 'diaDoMes'],
                properties: {
                  freq: { type: 'string', enum: ['diaria', 'uteis', 'semanal', 'mensal', 'anual'] },
                  dias: { type: 'array', items: { type: 'integer' }, description: 'Semanal: 0=domingo … 6=sábado.' },
                  diaDoMes: { anyOf: [{ type: 'integer' }, { type: 'string', enum: ['ultimo', 'ultimo-util'] }, { type: 'null' }] },
                },
              },
            ],
          },
          checklist: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `Você é a assistente de tarefas da Mariá, CEO da Liberte Soluções Empresariais. Ela fala ou escreve pedidos do jeito que vêm à cabeça, e você transforma cada pedido em tarefas bem preenchidas.

Regras:
- Entenda a INTENÇÃO. "Cria uma tarefa pra Ana revisar o contrato do cliente X até sexta, é urgente" = título "Revisar contrato do cliente X", responsável Ana, data = a próxima sexta, prazo = true, prioridade urgente.
- O título é curto e acionável (verbo no infinitivo + objeto). Nunca copie a fala inteira, nem frases como "cria uma tarefa", "lembra de", "anota aí", nem a data, a pessoa ou a prioridade.
- Um pedido com várias coisas diferentes vira várias tarefas. Passos de uma mesma coisa viram checklist.
- Datas relativas ("amanhã", "sexta", "semana que vem", "dia 20", "fim do mês") são calculadas a partir de hoje. Sem data mencionada: data null. "Semana que vem" sem dia: segunda-feira da próxima semana.
- "Reunião", "consulta", "call", "visita" com horário = tipo "compromisso". Demais = "tarefa".
- Responsável: só se ela atribuir a alguém; prefira o nome exatamente como está na lista de pessoas. Se for ela mesma, null.
- Projeto: só se ela citar um da lista de projetos (use o nome exato).
- Prioridade: "urgente", "pra ontem", "prioridade máxima" = urgente; "importante", "prioridade" = alta; "quando der", "sem pressa" = baixa; senão normal.
- Repetição só se ela disser ("todo dia 20", "toda segunda", "todo mês").
- Detalhes: guarde informações úteis (nomes, valores, telefones, contexto) que não couberem no título.
- Em imagens (print de conversa, bilhete, quadro, foto de caderno): extraia as tarefas pedidas ou combinadas. Itens riscados ou já feitos: ignore.
- Se não houver nenhuma tarefa, devolva a lista vazia.`;

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function matchName(name, list) {
  if (!name) return null;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const n = norm(name);
  return list.find((x) => norm(x) === n) || list.find((x) => norm(x).startsWith(n) || n.startsWith(norm(x))) || null;
}

// Converte a resposta da IA em dados de tarefa do app (validando cada campo).
export function toTaskData(item, { people = [], projects = [], today = ymd(new Date()) } = {}) {
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isTime = (s) => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
  let recurrence = null;
  const r = item.repeticao;
  if (r && ['diaria', 'uteis', 'semanal', 'mensal', 'anual'].includes(r.freq)) {
    recurrence = { freq: r.freq };
    if (r.freq === 'semanal' && r.dias?.length) recurrence.days = [...new Set(r.dias.filter((d) => d >= 0 && d <= 6))].sort();
    if (r.freq === 'mensal' && r.diaDoMes != null) recurrence.monthDay = r.diaDoMes;
  }
  let date = isDate(item.data) ? item.data : null;
  if (recurrence && !date) date = firstOccurrence(recurrence, today);
  const assignee = item.responsavel ? (matchName(item.responsavel, people) || item.responsavel.trim()) : null;
  const projectName = matchName(item.projeto, projects);
  const title = (item.titulo || '').trim().replace(/[.!]+$/, '');
  return {
    title: title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Nova tarefa',
    notes: (item.detalhes || '').trim(),
    kind: item.tipo === 'compromisso' ? 'compromisso' : 'tarefa',
    date,
    time: date && isTime(item.hora) ? item.hora : null,
    deadline: !!(date && item.prazo),
    priority: ['urgente', 'alta', 'normal', 'baixa'].includes(item.prioridade) ? item.prioridade : 'normal',
    assignee,
    projectName,
    recurrence,
    checklist: (item.checklist || []).map((t) => String(t).trim()).filter(Boolean)
      .map((text) => ({ id: store.uid(), text, done: false })),
  };
}

function context() {
  return {
    people: store.knownPeople(),
    projects: store.allProjects({ includeArchived: false }).map((p) => p.name),
    today: ymd(new Date()),
  };
}

// Pergunta à IA. Devolve a lista de tarefas (dados, ainda não criadas).
export async function interpret({ text = '', image = null }) {
  const ctx = context();
  const now = new Date();
  const hoje = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const content = [];
  if (image) {
    const media = /^image\/(png|jpeg|gif|webp)$/.test(image.type) ? image.type : 'image/jpeg';
    content.push({ type: 'image', source: { type: 'base64', media_type: media, data: await toBase64(image) } });
  }
  content.push({
    type: 'text',
    text: [
      `Hoje é ${hoje} (${ctx.today}), ${now.toTimeString().slice(0, 5)}.`,
      `Pessoas da equipe: ${ctx.people.join(', ') || 'nenhuma cadastrada'}.`,
      `Projetos: ${ctx.projects.join(', ') || 'nenhum'}.`,
      text ? `Pedido da Mariá:\n"""${text}"""` : 'Pedido da Mariá: veja a imagem.',
    ].join('\n'),
  });
  const raw = await askClaude({
    system: SYSTEM,
    content,
    effort: 'low',
    format: { type: 'json_schema', schema: SCHEMA },
  });
  const data = JSON.parse(raw);
  return (data.tarefas || []).map((t) => toTaskData(t, ctx));
}

// Entendedor gratuito (sem IA, no próprio aparelho), no mesmo formato.
export function interpretLocal(text) {
  return understand(text, {
    knownPeople: store.knownPeople(),
    knownProjects: store.allProjects({ includeArchived: false }).map((x) => x.name),
  }).map((p) => ({
    title: p.title, notes: p.notes || '', kind: p.kind, date: p.date, time: p.time, deadline: p.deadline,
    priority: p.priority || 'normal', assignee: p.assignee, projectName: p.project, recurrence: p.recurrence,
    checklist: (p.checklist || []).map((t) => ({ id: store.uid(), text: t, done: false })),
  }));
}

// Cria as tarefas no app a partir dos dados interpretados.
// O pedido original fica guardado nos detalhes da primeira tarefa (nada se perde).
export function createTasks(list, { source, attachments = [], projectId = null, original = '', firstId = null, extraNotes = '' } = {}) {
  return list.map((d, i) => {
    const pid = (d.projectName && store.allProjects().find((p) => p.name === d.projectName)?.id) || projectId || null;
    const notes = [d.notes, i === 0 && original ? `🗣 Pedido original: “${original}”` : '', i === 0 ? extraNotes : ''].filter(Boolean).join('\n\n');
    const { projectName, ...rest } = d;
    return store.createTask({
      ...rest,
      notes,
      assigneeEmail: store.personEmail(d.assignee),
      projectId: pid,
      source,
      attachments: i === 0 ? attachments : [],
      ...(i === 0 && firstId ? { id: firstId } : {}),
    });
  });
}

// Pedido completo: tenta a IA; se falhar, usa o interpretador simples.
// Enquanto a IA pensa, o pedido fica guardado no aparelho para não se perder se o app fechar.
export async function smartCreate({ text = '', image = null, source = 'texto', attachments = [], projectId = null, firstId = null, extraNotes = '', useAI = true }) {
  const pendingId = store.uid();
  savePending(pendingId, { text, source, projectId, attachments, at: Date.now() });
  try {
    let list = null;
    let usedAI = false;
    if (useAI && smartEnabled() && (text.trim() || image)) {
      try {
        list = await interpret({ text, image });
        usedAI = true;
      } catch (e) {
        console.warn('IA:', e.message);
      }
    }
    if (!list || (!list.length && !attachments.length && text.trim())) list = text.trim() ? interpretLocal(text) : [];
    if (!list.length) list = [{ title: image ? 'Foto recebida' : 'Nova tarefa', notes: '', kind: 'tarefa', date: null, time: null, deadline: false, priority: 'normal', assignee: null, projectName: null, recurrence: null, checklist: [] }];
    // Fala longa vira título resumido; o original vai para os detalhes.
    const original = text.trim().split(/\s+/).length > 10 ? text.trim() : '';
    const tasks = createTasks(list, { source, attachments, projectId, original, firstId, extraNotes });
    return { tasks, usedAI };
  } finally {
    removePending(pendingId);
  }
}

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || {}; } catch { return {}; }
}
function savePending(id, data) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...readPending(), [id]: data })); } catch { /* sem armazenamento */ }
}
function removePending(id) {
  const all = readPending();
  delete all[id];
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(all)); } catch { /* sem armazenamento */ }
}

// Pedidos que ficaram no meio (app fechado enquanto a IA pensava): cria com o interpretador simples.
export function recoverPending() {
  const all = readPending();
  const created = [];
  for (const [id, p] of Object.entries(all)) {
    if (Date.now() - p.at < 60_000) continue; // ainda pode estar em andamento nesta aba
    if (p.text?.trim()) created.push(...createTasks(interpretLocal(p.text), { source: p.source, attachments: p.attachments || [], projectId: p.projectId }));
    else if (p.attachments?.length) created.push(store.createTask({ title: 'Anexo recebido', attachments: p.attachments, source: p.source }));
    removePending(id);
  }
  return created;
}
