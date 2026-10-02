import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent, eventHash } from '../js/event-map.js';

const settings = {
  defaultTaskTime: '09:00',
  appointmentMinutes: 60,
  appointmentReminders: [30, 1440],
  taskReminders: [0, 1440],
  inviteAssignee: true,
};
const base = {
  id: 'abc', title: 'Enviar proposta', notes: '', kind: 'tarefa', date: '2026-10-02', time: null,
  deadline: false, priority: 'normal', assignee: null, assigneeEmail: null, status: 'aberta',
  attachments: [], reminders: null, deleted: false,
};

test('tarefa sem data não gera evento', () => {
  assert.equal(buildEvent({ ...base, date: null }, settings), null);
});

test('tarefa com data vira bloco curto no horário padrão, livre na agenda', () => {
  const ev = buildEvent(base, settings);
  assert.equal(ev.summary, '☐ Enviar proposta');
  assert.equal(ev.start.dateTime, '2026-10-02T09:00:00');
  assert.equal(ev.end.dateTime, '2026-10-02T09:15:00');
  assert.equal(ev.transparency, 'transparent');
  assert.deepEqual(ev.reminders.overrides.map((r) => r.minutes), [0, 1440]);
  assert.equal(ev.extendedProperties.private.ltTaskId, 'abc');
});

test('compromisso com hora usa duração e lembretes de compromisso', () => {
  const ev = buildEvent({ ...base, kind: 'compromisso', title: 'Reunião', time: '23:30', priority: 'urgente' }, settings);
  assert.equal(ev.start.dateTime, '2026-10-02T23:30:00');
  assert.equal(ev.end.dateTime, '2026-10-03T00:30:00');
  assert.equal(ev.colorId, '11');
  assert.equal(ev.transparency, 'opaque');
  assert.deepEqual(ev.reminders.overrides.map((r) => r.minutes), [30, 1440]);
});

test('compromisso sem hora vira dia inteiro', () => {
  const ev = buildEvent({ ...base, kind: 'compromisso', title: 'Aniversário', date: '2026-10-31' }, settings);
  assert.deepEqual(ev.start, { date: '2026-10-31' });
  assert.deepEqual(ev.end, { date: '2026-11-01' });
});

test('responsável com e-mail é convidado; tarefa feita fica sem lembretes', () => {
  const ev = buildEvent({ ...base, assignee: 'Ana', assigneeEmail: 'ana@x.com', status: 'feita' }, settings);
  assert.equal(ev.summary, '✔ Enviar proposta · Ana');
  assert.deepEqual(ev.attendees, [{ email: 'ana@x.com', displayName: 'Ana' }]);
  assert.deepEqual(ev.reminders.overrides, []);
});

test('descrição do evento traz a data de criação', () => {
  const ev = buildEvent({ ...base, createdAt: new Date(2026, 9, 1, 14, 5).toISOString() }, settings);
  assert.match(ev.description, /Criada em: 01\/10\/2026 às 14:05/);
});

test('hash muda quando a tarefa muda', () => {
  assert.notEqual(eventHash(buildEvent(base, settings)), eventHash(buildEvent({ ...base, title: 'X' }, settings)));
});
