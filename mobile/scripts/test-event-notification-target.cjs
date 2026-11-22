const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
// Moduły z src/lib (TypeScript → CommonJS), z importami względnymi (eventNotificationTarget → eventAccess).
const load = (name) => {
  const out = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', `${name}.ts`), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(out.exports, (request) => load(request.replace(/^\.\//, '')));
  return out.exports;
};
const resolve = load('eventNotificationTarget').getEventNotificationTab;
for (const tab of ['details','steps','warehouse','fleet','team','agenda','files','checklist','wedding','summary']) {
 assert.equal(resolve({initial_tab:tab}),tab);
 assert.equal(resolve({metadata:{initial_tab:tab}}),tab);
}
assert.equal(resolve({metadata:{warehouse_key:'warehouse-request:id'}}),'warehouse');
assert.equal(resolve({metadata:{kind:'vehicle_pickup'}}),'fleet');
assert.equal(resolve({metadata:{initial_tab:'details',warehouse_key:'ready:id'}}),'details');
assert.equal(resolve({initial_tab:'overview'}),'steps');
assert.equal(resolve({action_url:'/crm/events/x?tab=overview',metadata:{initial_tab:'overview'}}),'steps');
assert.equal(resolve({initial_tab:'unknown'}),undefined);
assert.equal(resolve({}),undefined);
console.log('Event notifications: push/list parity, legacy warehouse/fleet and explicit tab priority passed.');
