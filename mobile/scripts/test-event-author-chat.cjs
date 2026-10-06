const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/eventAuthorChat.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function service(responses) {
  const calls = [];
  const supabase = { from(table) {
    const call = { table, operations: [] }; calls.push(call);
    const query = new Proxy({}, { get(_, op) {
      if (op === 'then') return (resolve, reject) => {
        assert.ok(responses.length, 'Unexpected query');
        return Promise.resolve(responses.shift()).then(resolve, reject);
      };
      return (...args) => { call.operations.push([op, ...args]); return query; };
    } });
    return query;
  } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => ({ supabase }), module, module.exports);
  return { open: module.exports.openEventAuthorChat, calls };
}
const ok = data => ({ data, error: null });
const event = ok({ created_by: 'author' });
const author = ok({ id: 'author', is_active: true });
(async () => {
  let test = service([event, author, ok([{ conversation_id: 'direct' }]), ok([{ id: 'direct' }]), ok([
    { conversation_id: 'direct', employee_id: 'me' }, { conversation_id: 'direct', employee_id: 'author' },
  ])]);
  assert.equal(await test.open('event', 'me'), 'direct');
  assert.ok(!test.calls.some(c => c.operations.some(o => o[0] === 'insert')));
  test = service([event, ok(null), author, ok([]), ok({ id: 'new' }), ok(null)]);
  assert.equal(await test.open('event', 'me'), 'new');
  assert.ok(test.calls[2].operations.some(o => o[0] === 'eq' && o[1] === 'auth_user_id'));
  assert.deepEqual(test.calls.at(-1).operations[0][1], [
    { conversation_id: 'new', employee_id: 'me' }, { conversation_id: 'new', employee_id: 'author' },
  ]);
  assert.ok(!test.calls.some(c => c.table === 'employee_messages'));
  test = service([event, author]);
  await assert.rejects(test.open('event', 'author'), /Jesteś autorem/);
  test = service([event, ok({ id: 'author', is_active: false })]);
  await assert.rejects(test.open('event', 'me'), /aktywnego konta/);
  test = service([event, author, { error: new Error('offline') }]);
  await assert.rejects(test.open('event', 'me'), /offline/);
  assert.equal(test.calls.length, 3, 'A failed lookup must not create a duplicate conversation');
  test = service([event, author, ok([]), ok({ id: 'new' }), { error: new Error('denied') }, ok(null)]);
  await assert.rejects(test.open('event', 'me'), /uczestników/);
  assert.ok(test.calls.at(-1).operations.some(o => o[0] === 'delete'));
  console.log('6 event author chat scenarios passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
