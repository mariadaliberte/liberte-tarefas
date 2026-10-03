// Modelos de projeto: tarefas com prazos relativos ao início do projeto (em dias).
// start/due: dias a partir do início. kind 'compromisso' vira evento na agenda.

export const BUILTIN_TEMPLATES = [
  {
    id: 'onboarding', name: 'Onboarding de cliente', description: 'Da assinatura ao plano de ação do cliente.',
    tasks: [
      { title: 'Reunião de boas-vindas', due: 0, kind: 'compromisso', priority: 'alta' },
      { title: 'Enviar contrato e confirmar pagamento', start: 0, due: 1, priority: 'alta' },
      { title: 'Coletar acessos e documentos do cliente', start: 1, due: 3 },
      { title: 'Diagnóstico do negócio', start: 3, due: 10, priority: 'alta' },
      { title: 'Apresentar plano de ação', due: 12, kind: 'compromisso' },
      { title: 'Acompanhamento de 30 dias', due: 30, kind: 'compromisso' },
    ],
  },
  {
    id: 'lancamento', name: 'Lançamento de turma ou mentoria', description: 'Oferta, aquecimento, carrinho aberto e encerramento.',
    tasks: [
      { title: 'Definir oferta, bônus e preço', start: 0, due: 5, priority: 'alta' },
      { title: 'Página de vendas', start: 3, due: 10, priority: 'alta' },
      { title: 'Sequência de e-mails', start: 5, due: 12 },
      { title: 'Conteúdos de aquecimento', start: 5, due: 20 },
      { title: 'Configurar anúncios', start: 12, due: 18 },
      { title: 'Live de abertura do carrinho', due: 21, kind: 'compromisso', priority: 'urgente' },
      { title: 'Acompanhar vendas e responder leads', start: 21, due: 28, priority: 'alta' },
      { title: 'Encerramento e pesquisa com alunas', start: 29, due: 31 },
    ],
  },
  {
    id: 'evento', name: 'Evento ou workshop', description: 'Planejamento, divulgação, realização e pós-evento.',
    tasks: [
      { title: 'Definir tema, data e formato', start: 0, due: 2, priority: 'alta' },
      { title: 'Reservar local ou plataforma', start: 2, due: 5 },
      { title: 'Divulgação', start: 5, due: 20 },
      { title: 'Preparar material e apresentação', start: 10, due: 18, priority: 'alta' },
      { title: 'Realização do evento', due: 21, kind: 'compromisso', priority: 'urgente' },
      { title: 'Pós-evento: certificados, pesquisa e oferta', start: 22, due: 25 },
    ],
  },
  {
    id: 'contratacao', name: 'Contratação', description: 'Da descrição da vaga à integração.',
    tasks: [
      { title: 'Descrição da vaga e perfil', start: 0, due: 2 },
      { title: 'Divulgar vaga', start: 2, due: 5 },
      { title: 'Triagem de currículos', start: 5, due: 12 },
      { title: 'Entrevistas', start: 12, due: 18, kind: 'compromisso' },
      { title: 'Proposta e contratação', start: 18, due: 20, priority: 'alta' },
      { title: 'Integração (primeiras semanas)', start: 21, due: 35 },
    ],
  },
];

function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00`) - Date.parse(`${a}T12:00`)) / 86_400_000);

// Tarefas concretas a partir do modelo e da data de início.
export function instantiate(template, startDate) {
  const tasks = template.tasks.map((t) => ({
    title: t.title,
    kind: t.kind || 'tarefa',
    priority: t.priority || 'normal',
    assignee: t.assignee || null,
    date: addDays(startDate, t.due),
    time: t.kind === 'compromisso' ? t.time || '10:00' : null,
    startDate: t.start != null && t.start < t.due ? addDays(startDate, t.start) : null,
  }));
  const endDate = addDays(startDate, Math.max(0, ...template.tasks.map((t) => t.due)));
  return { tasks, endDate };
}

// Transforma um projeto existente em modelo (prazos relativos ao início).
export function fromProject(project, tasks, name) {
  const dated = tasks.filter((t) => t.date && !t.deleted);
  const base = project.startDate
    || dated.map((t) => t.startDate || t.date).sort()[0]
    || new Date().toISOString().slice(0, 10);
  return {
    id: `meu-${Date.now().toString(36)}`,
    name: name || project.name,
    description: `Criado a partir de “${project.name}”.`,
    tasks: tasks.filter((t) => !t.deleted && !t.seriesId).map((t) => ({
      title: t.title,
      kind: t.kind,
      priority: t.priority,
      assignee: t.assignee || undefined,
      due: t.date ? Math.max(0, dayDiff(base, t.date)) : 0,
      start: t.startDate ? Math.max(0, dayDiff(base, t.startDate)) : undefined,
      time: t.time || undefined,
    })),
  };
}
