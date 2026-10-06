const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const moduleOut = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/eventNotificationTarget.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(moduleOut.exports);
const resolve = moduleOut.exports.getEventNotificationTab;
for (const tab of ['details','warehouse','fleet','team','agenda','files','checklist','wedding']) {
 assert.equal(resolve({initial_tab:tab}),tab);
 assert.equal(resolve({metadata:{initial_tab:tab}}),tab);
}
assert.equal(resolve({metadata:{warehouse_key:'warehouse-request:id'}}),'warehouse');
assert.equal(resolve({metadata:{kind:'vehicle_pickup'}}),'fleet');
assert.equal(resolve({metadata:{initial_tab:'details',warehouse_key:'ready:id'}}),'details');
assert.equal(resolve({initial_tab:'unknown'}),undefined);
assert.equal(resolve({}),undefined);
console.log('Event notifications: push/list parity, legacy warehouse/fleet and explicit tab priority passed.');
