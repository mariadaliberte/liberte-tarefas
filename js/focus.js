// Resumo da manhã ("Foco do dia"): um evento curto no Google Agenda, às 8h,
// com lembrete na hora. O celular avisa pela notificação do próprio Google Agenda,
// sem precisar de servidor. Um id fixo por dia evita duplicar entre aparelhos.

const RANK = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

function pad(n) {
  return String(n).padStart(2, '0');
}

export function focusEventId(date) {
  return `ltfoco${date.replaceAll('-', '')}`; // só letras a–v e dígitos (regra do Google)
}

// Tarefas que merecem atenção no dia: atrasadas, do dia e as que estão em andamento.
export function focusTasks(tasks, date) {
  return tasks
    .filter((t) => !t.deleted && t.status !== 'feita' && ((t.date && t.date <= date) || t.status === 'fazendo'))
    .sort((a, b) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2)
      || (a.date || '9999').localeCompare(b.date || '9999')
      || (a.time || '99').localeCompare(b.time || '99'));
}

export function buildFocusEvent(tasks, date, { time = '08:00', timeZone = 'America/Sao_Paulo', appUrl = '', max = 8 } = {}) {
  const list = focusTasks(tasks, date);
  if (!list.length) return null;
  const late = list.filter((t) => t.date && t.date < date).length;
  const urgent = list.filter((t) => t.priority === 'urgente').length;
  const bits = [`${list.length} ${list.length === 1 ? 'tarefa' : 'tarefas'}`];
  if (late) bits.push(`${late} ${late === 1 ? 'atrasada' : 'atrasadas'}`);
  if (urgent) bits.push(`${urgent} ${urgent === 1 ? 'urgente' : 'urgentes'}`);
  const top = list.slice(0, 3).map((t) => t.title).join(' · ');

  const lines = list.slice(0, max).map((t) => {
    const tags = [];
    if (t.date && t.date < date) tags.push('atrasada');
    if (t.time) tags.push(t.time);
    if (t.priority === 'urgente' || t.priority === 'alta') tags.push(t.priority);
    if (t.assignee) tags.push(t.assignee);
    return `• ${t.title}${tags.length ? ` (${tags.join(', ')})` : ''}`;
  });
  if (list.length > max) lines.push(`… e mais ${list.length - max}`);
  if (appUrl) lines.push('', `Abrir o app: ${appUrl}`);

  const [h, m] = time.split(':').map(Number);
  const end = h * 60 + m + 15;
  return {
    id: focusEventId(date),
    summary: `☀️ Foco do dia: ${bits.join(', ')} — ${top}`,
    description: lines.join('\n'),
    start: { dateTime: `${date}T${pad(h)}:${pad(m)}:00`, timeZone },
    end: { dateTime: `${date}T${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}:00`, timeZone },
    transparency: 'transparent',
    colorId: '5',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    extendedProperties: { private: { ltFocus: '1' } },
    status: 'confirmed',
  };
}
