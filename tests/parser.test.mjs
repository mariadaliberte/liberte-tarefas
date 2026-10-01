import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTask } from '../js/parser.js';

// Quinta-feira, 01/10/2026, 10h
const now = new Date(2026, 9, 1, 10, 0);
const p = (text, opts = {}) => parseTask(text, { now, ...opts });

test('texto simples sem data vira tarefa sem prazo', () => {
  const r = p('comprar papel para impressora');
  assert.equal(r.title, 'Comprar papel para impressora');
  assert.equal(r.date, null);
  assert.equal(r.time, null);
  assert.equal(r.kind, 'tarefa');
  assert.equal(r.priority, null);
});

test('compromisso com dia da semana, hora, prioridade e responsável', () => {
  const r = p('Reunião com fornecedor sexta às 15h urgente @Ana');
  assert.equal(r.title, 'Reunião com fornecedor');
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.time, '15:00');
  assert.equal(r.priority, 'urgente');
  assert.equal(r.assignee, 'Ana');
  assert.equal(r.kind, 'compromisso');
});

test('amanhã e depois de amanhã', () => {
  assert.equal(p('ligar para contador amanhã').date, '2026-10-02');
  assert.equal(p('ligar para contador amanhã').title, 'Ligar para contador');
  assert.equal(p('enviar proposta depois de amanhã').date, '2026-10-03');
  assert.equal(p('enviar proposta depois de amanhã').title, 'Enviar proposta');
});

test('prazo com "até" marca deadline e mantém tarefa', () => {
  const r = p('entregar relatório até sexta prioridade alta');
  assert.equal(r.title, 'Entregar relatório');
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.deadline, true);
  assert.equal(r.kind, 'tarefa');
  assert.equal(r.priority, 'alta');
});

test('ontem (para registrar algo atrasado)', () => {
  assert.equal(p('entregar relatório até ontem').date, '2026-09-30');
  assert.equal(p('entregar relatório até ontem').title, 'Entregar relatório');
});

test('datas numéricas e por extenso', () => {
  assert.equal(p('pagar DAS dia 20').date, '2026-10-20');
  assert.equal(p('pagar DAS 20/10').date, '2026-10-20');
  assert.equal(p('renovar contrato 15/03').date, '2027-03-15');
  assert.equal(p('renovar contrato 15/03/2027').title, 'Renovar contrato');
  assert.equal(p('aniversário da Joana 5 de novembro').date, '2026-11-05');
  assert.equal(p('aniversário da Joana 5 de novembro').title, 'Aniversário da Joana');
  // dia já passado no mês -> próximo mês
  assert.equal(p('pagar aluguel dia 1').date, '2026-10-01');
  assert.equal(p('pagar fatura no dia 30').date, '2026-10-30');
});

test('horários em vários formatos', () => {
  assert.equal(p('call com cliente amanhã 14:30').time, '14:30');
  assert.equal(p('dentista amanhã às 9').time, '09:00');
  assert.equal(p('mentoria hoje às 3 da tarde').time, '15:00');
  assert.equal(p('almoço com Carla amanhã meio-dia').time, '12:00');
  assert.equal(p('live hoje 19h30').time, '19:30');
  assert.equal(p('live hoje 19h30').title, 'Live');
});

test('hora sem data: hoje se ainda não passou, senão amanhã', () => {
  assert.equal(p('ligar para Bia às 16h').date, '2026-10-01');
  assert.equal(p('ligar para Bia às 8h').date, '2026-10-02');
});

test('intervalos relativos', () => {
  assert.equal(p('revisar site em 3 dias').date, '2026-10-04');
  assert.equal(p('revisar site daqui a duas semanas').date, '2026-10-15');
  assert.equal(p('planejar campanha semana que vem').date, '2026-10-05');
  assert.equal(p('fechar caixa fim do mês').date, '2026-10-31');
});

test('próxima semana com dia específico', () => {
  assert.equal(p('reunião sexta da semana que vem').date, '2026-10-09');
  assert.equal(p('reunião na próxima quinta').date, '2026-10-08');
  assert.equal(p('reunião segunda-feira').date, '2026-10-05');
});

test('prefixo "me lembra de" é removido', () => {
  const r = p('me lembra de pagar o boleto amanhã');
  assert.equal(r.title, 'Pagar o boleto');
  assert.equal(r.date, '2026-10-02');
});

test('responsável por palavra-chave e lista de pessoas conhecidas', () => {
  assert.equal(p('emitir notas responsável Marcos').assignee, 'Marcos');
  assert.equal(p('emitir notas responsável Marcos').title, 'Emitir notas');
  const r = p('emitir notas delegar para Ana Paula amanhã', { knownPeople: ['Ana Paula'] });
  assert.equal(r.assignee, 'Ana Paula');
  assert.equal(r.date, '2026-10-02');
  assert.equal(r.title, 'Emitir notas');
});

test('sem pressa = prioridade baixa', () => {
  const r = p('organizar arquivos do drive sem pressa');
  assert.equal(r.priority, 'baixa');
  assert.equal(r.title, 'Organizar arquivos do drive');
});

test('palavras de compromisso sem hora viram compromisso', () => {
  assert.equal(p('consulta médica dia 10').kind, 'compromisso');
});

test('números comuns no título não viram hora', () => {
  const r = p('comprar 2 cadeiras');
  assert.equal(r.time, null);
  assert.equal(r.title, 'Comprar 2 cadeiras');
});
