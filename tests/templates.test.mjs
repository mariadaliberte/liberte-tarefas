import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, instantiate, fromProject } from '../js/templates.js';

test('modelo gera tarefas com datas a partir do início', () => {
  const tpl = BUILTIN_TEMPLATES.find((t) => t.id === 'lancamento');
  const { tasks, endDate } = instantiate(tpl, '2026-10-05');
  assert.equal(tasks[0].title, 'Definir oferta, bônus e preço');
  assert.equal(tasks[0].startDate, '2026-10-05');
  assert.equal(tasks[0].date, '2026-10-10');
  const live = tasks.find((t) => t.kind === 'compromisso');
  assert.equal(live.date, '2026-10-26');
  assert.equal(live.time, '10:00');
  assert.equal(endDate, '2026-11-05');
});

test('projeto vira modelo com prazos relativos', () => {
  const tpl = fromProject({ name: 'Lançamento X', startDate: '2026-10-01' }, [
    { title: 'A', date: '2026-10-03', startDate: '2026-10-01', priority: 'alta', kind: 'tarefa' },
    { title: 'B', date: '2026-10-11', kind: 'compromisso', time: '19:00', priority: 'normal' },
  ], 'Meu lançamento');
  assert.equal(tpl.name, 'Meu lançamento');
  assert.deepEqual(tpl.tasks.map((t) => [t.title, t.start, t.due]), [['A', 0, 2], ['B', undefined, 10]]);
  const again = instantiate(tpl, '2026-12-01');
  assert.equal(again.tasks[1].date, '2026-12-11');
  assert.equal(again.tasks[1].time, '19:00');
});
