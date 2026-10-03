import { test } from 'node:test';
import assert from 'node:assert/strict';
import { understand, understandOne } from '../js/understand.js';

const now = new Date(2026, 9, 3, 10, 0); // sábado, 03/10/2026
const opts = { now, knownPeople: ['Ana', 'Marcos Silva', 'Bruna'], knownProjects: ['Lançamento Fluir'] };
const one = (t) => understandOne(t, opts);
const all = (t) => understand(t, opts);

test('pedido falado completo: responsável, prazo e "a tarefa é"', () => {
  const r = one('Crie uma tarefa para a Ana com prazo até sexta e a tarefa é revisar o contrato da cliente Joana');
  assert.equal(r.title, 'Revisar o contrato da cliente Joana');
  assert.equal(r.assignee, 'Ana');
  assert.equal(r.date, '2026-10-09');
  assert.equal(r.deadline, true);
});

test('responsável no começo e urgência no fim', () => {
  const r = one('cria uma tarefa pra Ana revisar o contrato do cliente X até sexta, é urgente');
  assert.equal(r.title, 'Revisar o contrato do cliente X');
  assert.equal(r.assignee, 'Ana');
  assert.equal(r.priority, 'urgente');
  assert.equal(r.deadline, true);
});

test('"o prazo é", "responsável é" e nomes da equipe sem maiúscula', () => {
  const r = one('Coloca aí uma tarefa: mandar a proposta para o cliente Pedro, o prazo é dia 10, responsável é o marcos');
  assert.equal(r.title, 'Mandar a proposta para o cliente Pedro');
  assert.equal(r.assignee, 'Marcos Silva');
  assert.equal(r.date, '2026-10-10');
  assert.equal(r.deadline, true);
});

test('"pede para" e "a Bruna precisa"', () => {
  assert.equal(one('pede pra Bruna ligar para o contador amanhã').assignee, 'Bruna');
  assert.equal(one('pede pra Bruna ligar para o contador amanhã').title, 'Ligar para o contador');
  const r = one('A Bruna precisa organizar os arquivos do drive semana que vem');
  assert.equal(r.assignee, 'Bruna');
  assert.equal(r.title, 'Organizar os arquivos do drive');
});

test('lembretes e "eu preciso"', () => {
  assert.equal(one('me lembra de pagar o boleto da internet amanhã às 9h').title, 'Pagar o boleto da internet');
  assert.equal(one('Eu preciso enviar o relatório financeiro até quarta-feira').title, 'Enviar o relatório financeiro');
  assert.equal(one('não posso esquecer de comprar o presente da Joana').title, 'Comprar o presente da Joana');
});

test('compromisso: agenda reunião mantém a palavra reunião', () => {
  const r = one('agenda uma reunião com a equipe na terça às 14h');
  assert.equal(r.title, 'Reunião com a equipe');
  assert.equal(r.kind, 'compromisso');
  assert.equal(r.time, '14:00');
});

test('vários pedidos na mesma fala viram várias tarefas', () => {
  const r = all('Cria uma tarefa para a Ana revisar o contrato até sexta, é urgente. E também me lembra de pagar o DAS todo dia 20. Outra tarefa: o Marcos tem que atualizar a planilha de vendas amanhã');
  assert.deepEqual(r.map((x) => x.title), ['Revisar o contrato', 'Pagar o DAS', 'Atualizar a planilha de vendas']);
  assert.equal(r[0].assignee, 'Ana');
  assert.deepEqual(r[1].recurrence, { freq: 'mensal', monthDay: 20 });
  assert.equal(r[2].assignee, 'Marcos Silva');
  assert.equal(r[2].date, '2026-10-04');
});

test('"e" comum dentro da tarefa não separa', () => {
  const r = all('cria uma tarefa pra Ana revisar o contrato e mandar para o cliente até segunda');
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Revisar o contrato e mandar para o cliente');
});

test('fala longa: título curto, resto nos detalhes', () => {
  const r = one('preciso ligar para a fornecedora de embalagens porque o pedido atrasou de novo e o lançamento depende disso, então vê isso amanhã');
  assert.equal(r.title, 'Ligar para a fornecedora de embalagens');
  assert.match(r.notes, /porque o pedido atrasou/);
  assert.equal(r.date, '2026-10-04');
});

test('passos viram checklist', () => {
  const r = one('preparar o onboarding da cliente Carla: enviar contrato, criar pasta no drive, agendar reunião de boas-vindas');
  assert.equal(r.title, 'Preparar o onboarding da cliente Carla');
  assert.deepEqual(r.checklist, ['Enviar contrato', 'Criar pasta no drive', 'Agendar reunião de boas-vindas']);
});

test('frases simples continuam iguais', () => {
  const r = one('Reunião com fornecedor sexta às 15h urgente @Ana');
  assert.equal(r.title, 'Reunião com fornecedor');
  assert.equal(r.assignee, 'Ana');
  assert.equal(one('comprar papel').title, 'Comprar papel');
  assert.equal(all('comprar papel').length, 1);
});

test('vícios de fala são removidos', () => {
  assert.equal(one('Ok, então, cria aí uma tarefa pra mim de responder os e-mails dos clientes, tá? Obrigada').title, 'Responder os e-mails dos clientes');
});

test('outras formas de falar', () => {
  let r = one('tarefa para o Marcos: atualizar o site com os novos depoimentos até dia 15');
  assert.equal(r.title, 'Atualizar o site com os novos depoimentos');
  assert.equal(r.assignee, 'Marcos Silva');
  r = one('quero que a Ana ligue para a cliente Fernanda amanhã para confirmar a reunião');
  assert.equal(r.title, 'Ligar para a cliente Fernanda para confirmar a reunião');
  assert.equal(r.assignee, 'Ana');
  assert.equal(r.kind, 'tarefa');
  r = one('Marcos, organizar as notas fiscais de setembro até sexta');
  assert.equal(r.title, 'Organizar as notas fiscais de setembro');
  assert.equal(r.assignee, 'Marcos Silva');
  r = one('cria uma tarefa urgente para a Bruna responder o cliente que reclamou no Instagram');
  assert.equal(r.priority, 'urgente');
  assert.equal(r.assignee, 'Bruna');
  assert.equal(one('anota aí: comprar café, papel A4 e caneta').title, 'Comprar café, papel A4 e caneta');
  assert.equal(one('preciso fazer a proposta até quarta, é prioridade alta').priority, 'alta');
  const v = all('Ana tem que enviar o contrato da Joana até amanhã. Marcos precisa cobrar o pagamento da Luiza na segunda.');
  assert.deepEqual(v.map((x) => [x.title, x.assignee]), [['Enviar o contrato da Joana', 'Ana'], ['Cobrar o pagamento da Luiza', 'Marcos Silva']]);
  r = one('cria uma tarefa recorrente toda segunda às 9h reunião de alinhamento com a equipe');
  assert.equal(r.title, 'Reunião de alinhamento com a equipe');
  assert.deepEqual(r.recurrence, { freq: 'semanal', days: [1] });
});
