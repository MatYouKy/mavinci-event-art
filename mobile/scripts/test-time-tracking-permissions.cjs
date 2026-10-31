const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const permissions = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/permissions.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(permissions);
for (const scope of ['time_tracking_view_own', 'time_tracking_view', 'time_tracking_manage']) {
  const employee = { role: 'employee', permissions: [scope] };
  assert.equal(permissions.canView(employee, 'time_tracking'), true);
  assert.equal(permissions.canManage(employee, 'time_tracking'), scope === 'time_tracking_manage');
}
assert.equal(permissions.canView({ role: 'employee', permissions: [] }, 'time_tracking'), false);
assert.equal(permissions.canView(null, 'time_tracking'), false);
console.log('Time tracking permission tests passed');
