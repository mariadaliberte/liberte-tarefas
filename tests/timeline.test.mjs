import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../js/timeline.js';

const task = (o) => ({ id: Math.random().toString(36), status: 'aberta', date: null, startDate: null, ...o });

test('barra quando há início, marco quando há só a data', () => {
  const tl = buildTimeline([
    task({ title: 'A', startDate: '2026-10-05', date: '2026-10-09' }),
    task({ title: 'B', date: '2026-10-07' }),
    task({ title: 'Sem data' }),
  ], {}, '2026-10-03');
  assert.equal(tl.rows.length, 2);
  const [a, b] = tl.rows;
  assert.equal(a.kind, 'bar');
  assert.equal(a.endIdx - a.startIdx, 4);
  assert.equal(b.kind, 'milestone');
  assert.equal(tl.undated, 1);
  assert.equal(tl.days[tl.todayIdx].date, '2026-10-03');
});

test('régua cobre hoje, tarefas e datas do projeto, com folga', () => {
  const tl = buildTimeline([task({ date: '2026-11-20' })], { startDate: '2026-10-10', endDate: '2026-11-30' }, '2026-10-03');
  assert.equal(tl.from, '2026-09-30');
  assert.equal(tl.to, '2026-12-07');
  assert.equal(tl.days[tl.projectEndIdx].date, '2026-11-30');
  assert.equal(tl.days[tl.projectStartIdx].date, '2026-10-10');
});

test('mínimo de 3 semanas e atraso marcado', () => {
  const tl = buildTimeline([task({ date: '2026-10-01' }), task({ date: '2026-10-01', status: 'feita' })], {}, '2026-10-03');
  assert.equal(tl.days.length, 22);
  assert.equal(tl.rows[0].late, true);
  assert.equal(tl.rows[1].late, false);
});

test('início depois do prazo é ignorado (vira marco)', () => {
  const tl = buildTimeline([task({ startDate: '2026-10-20', date: '2026-10-10' })], {}, '2026-10-03');
  assert.equal(tl.rows[0].kind, 'milestone');
});
