const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/services/employeeTasks.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const service = { exports: {} };
new Function('exports', code)(service.exports);
const assignees = [{ employee_id: 'me' }, { employee_id: 'colleague' }];
const tasks = Array.from({ length: 1205 }, (_, i) => ({ id: String(i), task_assignees: assignees }));
let fail = false;
const urls = [];
const client = createClient('https://example.supabase.co', 'test-key', {
  auth: { persistSession: false },
  global: { fetch: async (input) => {
    const url = new URL(input);
    urls.push(url);
    assert.equal(url.searchParams.get('event_id'), null);
    assert.equal(url.searchParams.get('order'), 'id.asc');
    assert.ok(!url.search.includes('in.('), 'Never send a growing list of task IDs');
    const assigned = url.searchParams.has('assigned_filter.employee_id');
    assert.equal(url.searchParams.get('is_private'), assigned ? 'eq.false' : 'eq.true');
    assert.equal(url.searchParams.get(assigned ? 'assigned_filter.employee_id' : 'owner_id'), assigned ? 'eq.me' : 'eq.auth-me');
    if (fail && assigned) return new Response(JSON.stringify({ message: 'denied' }), { status: 403 });
    const data = assigned ? tasks : [tasks[0], { id: 'created-only', task_assignees: [] }];
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return new Response(JSON.stringify(data.slice(offset, offset + limit)), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } },
});
(async () => {
  const result = await service.exports.fetchEmployeeTasks(client, 'me', 'auth-me');
  assert.equal(result.length, 1206, 'All pages and created-only tasks are included, without duplicates');
  assert.deepEqual(result.find(t => t.id === '0').task_assignees, assignees, 'Keep every assignee');
  assert.ok(urls.every(url => url.href.length < 1000), 'URLs stay bounded with 1205 assignments');
  fail = true;
  await assert.rejects(service.exports.fetchEmployeeTasks(client, 'me', 'auth-me'), e => e.message === 'denied');
  const writes = [];
  const writer = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-me' } }, error: null }) },
    from(table) {
      assert.equal(table, 'tasks', 'Self-assignment belongs to the database trigger');
      return { insert(row) {
        writes.push(row);
        return { select: () => ({ single: async () => ({ data: { id: 'new' }, error: null }) }) };
      } };
    },
  };
  for (const column of ['todo', 'in_progress', 'review', 'completed']) {
    await service.exports.createPrivateEmployeeTask(writer, 'me', {
      title: 'Private task', description: null, priority: 'medium', column,
    });
    assert.equal(writes.at(-1).is_private, true);
    assert.equal(writes.at(-1).owner_id, 'auth-me');
    assert.equal(writes.at(-1).created_by, 'me');
    assert.equal(writes.at(-1).board_column, column);
    assert.equal(writes.at(-1).status, column);
  }
  const count = writes.length;
  writer.auth.getUser = async () => ({ data: { user: null }, error: null });
  await assert.rejects(service.exports.createPrivateEmployeeTask(writer, 'me', {}));
  assert.equal(writes.length, count, 'No task may be created without a session');
  console.log('Employee tasks: pagination, deduplication, assignees, bounded URLs and errors passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
