import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, firstOccurrence, describe } from '../js/recurrence.js';
import { parseTask } from '../js/parser.js';

const now = new Date(2026, 9, 1, 10, 0); // quinta, 01/10/2026

test('próxima data: diária, dias úteis, semanal, mensal, anual', () => {
  assert.equal(nextOccurrence({ freq: 'diaria' }, '2026-10-01'), '2026-10-02');
  assert.equal(nextOccurrence({ freq: 'uteis' }, '2026-10-02'), '2026-10-05'); // sexta -> segunda
  assert.equal(nextOccurrence({ freq: 'semanal', days: [1, 3] }, '2026-10-05'), '2026-10-07'); // seg -> qua
  assert.equal(nextOccurrence({ freq: 'semanal', days: [1, 3] }, '2026-10-07'), '2026-10-12'); // qua -> seg
  assert.equal(nextOccurrence({ freq: 'semanal', days: [1], interval: 2 }, '2026-10-05'), '2026-10-19');
  assert.equal(nextOccurrence({ freq: 'mensal', monthDay: 20 }, '2026-10-20'), '2026-11-20');
  assert.equal(nextOccurrence({ freq: 'mensal', monthDay: 31 }, '2026-10-31'), '2026-11-30');
  assert.equal(nextOccurrence({ freq: 'mensal', monthDay: 'ultimo-util' }, '2026-10-30'), '2026-11-30');
  assert.equal(nextOccurrence({ freq: 'mensal', monthDay: 'ultimo-util' }, '2026-11-30'), '2026-12-31');
  assert.equal(nextOccurrence({ freq: 'anual' }, '2026-10-05'), '2027-10-05');
});

test('primeira ocorrência a partir de hoje', () => {
  assert.equal(firstOccurrence({ freq: 'mensal', monthDay: 20 }, '2026-10-01'), '2026-10-20');
  assert.equal(firstOccurrence({ freq: 'mensal', monthDay: 20 }, '2026-10-25'), '2026-11-20');
  assert.equal(firstOccurrence({ freq: 'semanal', days: [1] }, '2026-10-01'), '2026-10-05');
  assert.equal(firstOccurrence({ freq: 'uteis' }, '2026-10-03'), '2026-10-05');
  assert.equal(firstOccurrence({ freq: 'mensal', monthDay: 'ultimo-util' }, '2026-10-01'), '2026-10-30');
});

test('o interpretador entende repetições em português', () => {
  const p = (t) => parseTask(t, { now });
  let r = p('pagar DAS todo dia 20');
  assert.equal(r.title, 'Pagar DAS');
  assert.deepEqual(r.recurrence, { freq: 'mensal', monthDay: 20 });
  assert.equal(r.date, '2026-10-20');
  r = p('reunião de equipe toda segunda às 9h');
  assert.equal(r.title, 'Reunião de equipe');
  assert.deepEqual(r.recurrence, { freq: 'semanal', days: [1] });
  assert.equal(r.date, '2026-10-05');
  assert.equal(r.time, '09:00');
  r = p('fechamento financeiro todo último dia útil');
  assert.equal(r.title, 'Fechamento financeiro');
  assert.deepEqual(r.recurrence, { freq: 'mensal', monthDay: 'ultimo-util' });
  assert.equal(r.date, '2026-10-30');
  r = p('conferir caixa todos os dias úteis');
  assert.deepEqual(r.recurrence, { freq: 'uteis' });
  r = p('postar no instagram toda segunda e quarta');
  assert.deepEqual(r.recurrence, { freq: 'semanal', days: [1, 3] });
  assert.equal(r.title, 'Postar no instagram');
  r = p('regar plantas diariamente');
  assert.deepEqual(r.recurrence, { freq: 'diaria' });
  assert.equal(r.date, '2026-10-01');
  r = p('renovar domínio todo ano');
  assert.deepEqual(r.recurrence, { freq: 'anual' });
  assert.equal(p('comprar papel').recurrence, null);
});

test('descrição curta', () => {
  assert.equal(describe({ freq: 'mensal', monthDay: 20 }), 'todo dia 20');
  assert.equal(describe({ freq: 'semanal', days: [1, 3] }), 'toda segunda, quarta');
});
