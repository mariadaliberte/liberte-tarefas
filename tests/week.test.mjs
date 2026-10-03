import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleDays, shiftAnchor, buildItems, layoutDay } from '../js/week.js';

test('semana começa no domingo; 3 dias e dia partem da data', () => {
  assert.deepEqual(visibleDays('2026-10-07', 'semana'), [
    '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
  ]);
  assert.deepEqual(visibleDays('2026-10-07', '3dias'), ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(visibleDays('2026-10-07', 'dia'), ['2026-10-07']);
  assert.equal(shiftAnchor('2026-10-07', 'semana', 1), '2026-10-14');
  assert.equal(shiftAnchor('2026-10-07', '3dias', -1), '2026-10-04');
});

test('eventos do Google: com hora, dia inteiro e atravessando a meia-noite', () => {
  const days = visibleDays('2026-10-07', 'semana');
  const items = buildItems(days, {
    events: [
      { id: 'a', summary: 'Mentoria', start: { dateTime: new Date(2026, 9, 7, 14, 0).toISOString() }, end: { dateTime: new Date(2026, 9, 7, 15, 30).toISOString() } },
      { id: 'b', summary: 'Feriado', start: { date: '2026-10-08' }, end: { date: '2026-10-10' } },
      { id: 'c', summary: 'Viagem', start: { dateTime: new Date(2026, 9, 9, 22, 0).toISOString() }, end: { dateTime: new Date(2026, 9, 10, 2, 0).toISOString() } },
    ],
  });
  const a = items.find((i) => i.id === 'a');
  assert.equal(a.startMin, 14 * 60);
  assert.equal(a.endMin, 15 * 60 + 30);
  assert.deepEqual(items.filter((i) => i.id === 'b').map((i) => i.day), ['2026-10-08', '2026-10-09']);
  const c = items.filter((i) => i.id === 'c');
  assert.deepEqual(c.map((i) => [i.day, i.startMin, i.endMin]), [['2026-10-09', 22 * 60, 24 * 60], ['2026-10-10', 0, 120]]);
});

test('tarefas: com hora viram bloco, sem hora vão para o topo do dia', () => {
  const days = visibleDays('2026-10-07', 'semana');
  const items = buildItems(days, {
    tasks: [
      { id: 't1', title: 'Reunião', kind: 'compromisso', date: '2026-10-07', time: '10:00' },
      { id: 't2', title: 'Pagar DAS', kind: 'tarefa', date: '2026-10-08', time: null },
      { id: 't3', title: 'Fora', kind: 'tarefa', date: '2026-11-01', time: '10:00' },
    ],
    appointmentMinutes: 60,
  });
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.id === 't1').endMin, 11 * 60);
  assert.equal(items.find((i) => i.id === 't2').allDay, true);
});

test('sobreposição divide a coluna em faixas', () => {
  const out = layoutDay([
    { id: 1, startMin: 600, endMin: 660 },
    { id: 2, startMin: 630, endMin: 690 },
    { id: 3, startMin: 700, endMin: 760 },
  ]);
  const by = Object.fromEntries(out.map((o) => [o.id, o]));
  assert.equal(by[1].lanes, 2);
  assert.notEqual(by[1].lane, by[2].lane);
  assert.equal(by[3].lanes, 1);
});
