// Converte uma tarefa em evento do Google Agenda.
// - Compromisso com hora: evento normal com a duração padrão.
// - Compromisso sem hora: evento de dia inteiro (lembrete na véspera às 9h).
// - Tarefa com data: bloco curto no horário padrão (ex.: 9h), marcado como "livre"
//   para não bloquear a agenda, com lembrete no horário e na véspera.

export const PRIORITY_COLORS = { urgente: '11', alta: '6', normal: undefined, baixa: '8' };
const PRIORITY_LABELS = { urgente: 'URGENTE', alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };

function pad(n) {
  return String(n).padStart(2, '0');
}

function localDateTime(date, time, plusMinutes = 0) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const dt = new Date(y, m - 1, d, h, mi + plusMinutes);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
}

function nextDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function buildEvent(task, settings, { timeZone = 'America/Sao_Paulo', appUrl = '' } = {}) {
  if (!task.date || task.deleted) return null;

  const isAppointment = task.kind === 'compromisso';
  const done = task.status === 'feita';
  const prefix = done ? '✔ ' : isAppointment ? '' : task.deadline ? '⏰ Prazo: ' : '☐ ';
  const who = task.assignee ? ` · ${task.assignee}` : '';
  const summary = `${prefix}${task.title}${who}`;

  const lines = [];
  if (task.notes) lines.push(task.notes, '');
  lines.push(`Prioridade: ${PRIORITY_LABELS[task.priority] || 'Normal'}`);
  if (task.assignee) lines.push(`Responsável: ${task.assignee}`);
  const links = (task.attachments || []).filter((a) => a.driveLink);
  if (links.length) {
    lines.push('', 'Anexos:');
    links.forEach((a) => lines.push(a.driveLink));
  }
  if (task.createdAt) {
    const c = new Date(task.createdAt);
    lines.push(`Criada em: ${pad(c.getDate())}/${pad(c.getMonth() + 1)}/${c.getFullYear()} às ${pad(c.getHours())}:${pad(c.getMinutes())}`);
  }
  lines.push('', `Criado no Liberte Tarefas${appUrl ? ` — ${appUrl}` : ''}`);

  const event = {
    summary,
    description: lines.join('\n'),
    extendedProperties: { private: { ltTaskId: task.id } },
    colorId: done ? '8' : PRIORITY_COLORS[task.priority] || null,
    transparency: isAppointment ? 'opaque' : 'transparent',
  };

  let reminders;
  if (!task.time && isAppointment) {
    event.start = { date: task.date };
    event.end = { date: nextDay(task.date) };
    reminders = [900]; // véspera, 9h
  } else {
    const time = task.time || settings.defaultTaskTime || '09:00';
    const minutes = isAppointment ? settings.appointmentMinutes || 60 : 15;
    event.start = { dateTime: localDateTime(task.date, time), timeZone };
    event.end = { dateTime: localDateTime(task.date, time, minutes), timeZone };
    reminders = isAppointment ? settings.appointmentReminders : settings.taskReminders;
  }
  if (Array.isArray(task.reminders)) reminders = task.reminders;
  event.reminders = {
    useDefault: false,
    overrides: done ? [] : (reminders || []).slice(0, 5).map((minutes) => ({ method: 'popup', minutes })),
  };

  if (task.assigneeEmail && settings.inviteAssignee) {
    event.attendees = [{ email: task.assigneeEmail, displayName: task.assignee || undefined }];
  } else {
    event.attendees = [];
  }

  return event;
}

// Assinatura do evento, para só atualizar a Agenda quando algo mudou de fato.
export function eventHash(event) {
  const s = JSON.stringify(event);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}
