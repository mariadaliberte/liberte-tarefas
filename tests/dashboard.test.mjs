import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, ruleInsights } from '../js/dashboard.js';

const today = '2026-10-07'; // quarta-feira
const iso = (d, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).toISOString();
const t = (o) => ({ id: Math.random().toString(36), title: 'x', status: 'aberta', priority: 'normal', createdAt: iso('2026-10-06'), ...o });

test('números do painel', () => {
  const tasks = [
    t({ title: 'Atrasada antiga', date: '2026-10-01', assignee: 'Ana' }),
    t({ title: 'Atrasada', date: '2026-10-05', assignee: 'Ana' }),
    t({ title: 'Hoje', date: today }),
    t({ title: 'Semana', date: '2026-10-10' }),
    t({ title: 'Sem data velha', createdAt: iso('2026-09-20') }),
    t({ title: 'Feita', status: 'feita', doneAt: iso('2026-10-06'), date: '2026-10-06' }),
    t({ title: 'Feita antes', status: 'feita', doneAt: iso('2026-09-30') }),
    t({ title: 'Excluída', deleted: true, date: today }),
  ];
  const st = computeStats(tasks, [], today);
  assert.equal(st.late.length, 2);
  assert.equal(st.late[0].title, 'Atrasada antiga');
  assert.equal(st.todayOpen.length, 1);
  assert.equal(st.next7.length, 1);
  assert.equal(st.noDate.length, 1);
  assert.equal(st.stale.length, 1);
  assert.equal(st.doneWeek.length, 1); // semana começa no domingo 04/10
  assert.equal(st.rhythm.length, 14);
  assert.equal(st.rhythm.at(-1).day, today);
  assert.equal(st.load[0].day, today);
  assert.equal(st.byPerson.find((p) => p.name === 'Ana').atrasadas, 2);
});

test('análise automática aponta atrasos, concentração e projetos em risco', () => {
  const tasks = [
    ...Array.from({ length: 5 }, (_, i) => t({ title: `Ana ${i}`, assignee: 'Ana', date: '2026-10-09' })),
    t({ title: 'Velha', date: '2026-10-02' }),
    t({ title: 'Urgente solta', priority: 'urgente' }),
    t({ title: 'P1', projectId: 'p1', date: '2026-10-08' }),
  ];
  const projects = [{ id: 'p1', name: 'Lançamento', endDate: '2026-10-10' }];
  const msgs = ruleInsights(computeStats(tasks, projects, today)).map((i) => i.text).join(' | ');
  assert.match(msgs, /1 tarefa atrasada.*“Velha” \(venceu há 5 dias\)/);
  assert.match(msgs, /urgente sem data/);
  assert.match(msgs, /Ana concentra 5 de 8/);
  assert.match(msgs, /Projeto “Lançamento” entrega em 3 dias com 0% concluído/);
});

test('sem pendências: mensagem positiva', () => {
  const ins = ruleInsights(computeStats([], [], today));
  assert.equal(ins.length, 1);
  assert.equal(ins[0].level, 'bom');
});
