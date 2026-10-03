import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const { toTaskData, worthAI } = await import('../js/smart.js');

const ctx = { people: ['Ana Paula', 'Marcos'], projects: ['Lançamento Fluir'], today: '2026-10-03' };
const base = { detalhes: '', tipo: 'tarefa', data: null, hora: null, prazo: false, prioridade: 'normal', responsavel: null, projeto: null, repeticao: null, checklist: [] };

test('pedido entendido vira tarefa preenchida, com nomes da equipe e do projeto', () => {
  const t = toTaskData({ ...base, titulo: 'revisar contrato do cliente X.', data: '2026-10-09', prazo: true, prioridade: 'urgente', responsavel: 'ana', projeto: 'lancamento fluir', checklist: ['Ler cláusulas', ' '] }, ctx);
  assert.equal(t.title, 'Revisar contrato do cliente X');
  assert.equal(t.assignee, 'Ana Paula');
  assert.equal(t.projectName, 'Lançamento Fluir');
  assert.equal(t.date, '2026-10-09');
  assert.equal(t.deadline, true);
  assert.equal(t.priority, 'urgente');
  assert.deepEqual(t.checklist.map((c) => c.text), ['Ler cláusulas']);
});

test('valores inválidos são descartados; repetição sem data ganha a primeira ocorrência', () => {
  const t = toTaskData({ ...base, titulo: 'pagar DAS', data: 'sexta', hora: '9h', prioridade: 'altíssima', repeticao: { freq: 'mensal', dias: [], diaDoMes: 20 } }, ctx);
  assert.equal(t.priority, 'normal');
  assert.equal(t.time, null);
  assert.deepEqual(t.recurrence, { freq: 'mensal', monthDay: 20 });
  assert.equal(t.date, '2026-10-20');
  assert.equal(toTaskData({ ...base, titulo: 'x', hora: '10:00' }, ctx).time, null); // hora sem data
});

test('IA só é chamada quando vale a pena e há chave', () => {
  assert.equal(worthAI('cria uma tarefa pra Ana revisar o contrato até sexta urgente', 'voz'), false); // sem chave
  localStorage.setItem('lt.ai.key', 'k');
  assert.equal(worthAI('comprar papel amanhã', 'texto'), false);
  assert.equal(worthAI('comprar papel', 'voz'), true);
  assert.equal(worthAI('preciso que a Ana revise o contrato do cliente X até sexta porque é urgente demais', 'texto'), true);
  localStorage.setItem('lt.smart.off', '1');
  assert.equal(worthAI('comprar papel', 'voz'), false);
});
