import { test } from 'node:test';
import assert from 'node:assert/strict';

// store.js usa localStorage/IndexedDB do navegador: simulamos o mínimo para testar a lógica.
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const store = await import('../js/store.js');

test('pessoas de dois aparelhos são somadas, sem duplicar', () => {
  const a = [{ name: 'Ana', email: '' }, { name: 'Marcos', email: 'm@x.com' }];
  const b = [{ name: 'ana', email: 'ana@x.com' }, { name: 'Bruna', email: 'b@x.com' }];
  const out = store.mergePeople(a, b);
  assert.deepEqual(out.map((p) => p.name), ['Ana', 'Marcos', 'Bruna']);
  assert.equal(out[0].email, 'ana@x.com'); // completa e-mail que faltava
});

test('ajustes vindos de outro aparelho não apagam pessoas cadastradas aqui', () => {
  store.saveSettings({ people: [{ name: 'Joana', email: '' }] });
  store.mergeRemote({ tasks: [], settings: { updatedAt: '2999-01-01T00:00:00Z', values: { people: [{ name: 'Carla', email: '' }], calendarId: 'primary' } } });
  assert.deepEqual(store.getSettings().people.map((p) => p.name).sort(), ['Carla', 'Joana']);
});

test('registros de exclusão antigos são limpos; recentes e ativos ficam', () => {
  const old = '2020-01-01T00:00:00.000Z';
  store.mergeRemote({ tasks: [
    { id: 'velha', title: 'x', deleted: true, createdAt: old, updatedAt: old, attachments: [{ id: 'f1' }] },
    { id: 'recente', title: 'y', deleted: true, createdAt: old, updatedAt: new Date().toISOString(), attachments: [] },
    { id: 'ativa', title: 'z', deleted: false, createdAt: old, updatedAt: old, attachments: [] },
  ] });
  const files = store.purgeTombstones();
  const ids = store.allTasks({ includeDeleted: true }).map((t) => t.id);
  assert.deepEqual(files, ['f1']);
  assert.ok(!ids.includes('velha'));
  assert.ok(ids.includes('recente') && ids.includes('ativa'));
});

test('excluir e desfazer', () => {
  const t = store.createTask({ title: 'Teste' });
  store.deleteTask(t.id);
  assert.ok(!store.allTasks().some((x) => x.id === t.id));
  store.restoreTask(t.id);
  assert.ok(store.allTasks().some((x) => x.id === t.id));
});
