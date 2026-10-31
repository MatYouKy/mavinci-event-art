const assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript'),path=require('path');
const e={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/eventInvitation.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(e);
assert.equal(e.showEventInvitation('employee','employee','auth','pending'),false);
assert.equal(e.showEventInvitation('auth','employee','auth','pending'),false);
assert.equal(e.showEventInvitation('other','employee','auth','pending'),true);
for(const status of ['accepted','rejected',null]) assert.equal(e.showEventInvitation('other','employee','auth',status),false);
assert.equal(e.isEventOrganizer(null,null,null),false);
console.log('Event invitation: organizer IDs and genuine pending invitations passed.');
