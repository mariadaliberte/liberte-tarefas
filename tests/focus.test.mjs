import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFocusEvent, focusEventId, focusTasks } from '../js/focus.js';

const tasks = [
  { id: 'a', title: 'Enviar proposta', date: '2026-10-01', priority: 'normal', status: 'aberta' },
  { id: 'b', title: 'Pagar DAS', date: '2026-10-03', priority: 'urgente', status: 'aberta' },
  { id: 'c', title: 'Artigo', status: 'fazendo', priority: 'baixa' },
  { id: 'd', title: 'Futuro', date: '2026-10-09', status: 'aberta' },
  { id: 'e', title: 'Feita', date: '2026-10-02', status: 'feita' },
  { id: 'f', title: 'Excluída', date: '2026-10-02', status: 'aberta', deleted: true },
];

test('seleciona atrasadas, do dia e em andamento, por prioridade', () => {
  assert.deepEqual(focusTasks(tasks, '2026-10-03').map((t) => t.id), ['b', 'a', 'c']);
});

test('monta o evento das 8h com lembrete na hora', () => {
  const ev = buildFocusEvent(tasks, '2026-10-03', { appUrl: 'https://x' });
  assert.equal(ev.id, 'ltfoco20261003');
  assert.match(ev.id, /^[a-v0-9]{5,}$/);
  assert.equal(ev.summary, '☀️ Foco do dia: 3 tarefas, 1 atrasada, 1 urgente — Pagar DAS · Enviar proposta · Artigo');
  assert.equal(ev.start.dateTime, '2026-10-03T08:00:00');
  assert.equal(ev.end.dateTime, '2026-10-03T08:15:00');
  assert.deepEqual(ev.reminders.overrides, [{ method: 'popup', minutes: 0 }]);
  assert.match(ev.description, /• Enviar proposta \(atrasada\)/);
  assert.match(ev.description, /Abrir o app: https:\/\/x/);
});

test('sem pendências não cria evento', () => {
  assert.equal(buildFocusEvent([tasks[3]], '2026-10-03'), null);
  assert.equal(focusEventId('2026-12-31'), 'ltfoco20261231');
});
