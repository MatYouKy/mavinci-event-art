const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file) {
 const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const module={exports:{}};new Function('exports','module',code)(module.exports,module);return module.exports;
}
const {canViewEventFinances,isManagerOrAdmin}=load('permissions.ts');
const user=permissions=>({role:'employee',access_level:'employee',permissions});
assert.equal(canViewEventFinances(user(['fleet_manage'])),false);
assert.equal(isManagerOrAdmin(user(['fleet_manage'])),false);
assert.equal(canViewEventFinances(user(['equipment_manage'])),false);
assert.equal(canViewEventFinances(user(['invoices_view'])),true);
assert.equal(canViewEventFinances({...user([]),role:'admin'}),true);
const {mergeEventTeam}=load('eventTeam.ts');
const merged=mergeEventTeam([
 {employee_id:'1',status:'accepted',role:'Technik',employee:{id:'1',name:'Jan',surname:'Nowak',phone_number:null}},
 {employee_id:'2',status:'rejected',employee:{id:'2'}},
], [
 {employee:{id:'1',name:'Jan',surname:'Nowak',phone_number:'123'},status:'accepted',responsibility_roles:['Kierownik realizacji','Kierowca']},
 {employee:{id:'3',name:'Anna',surname:'Kowalska'},status:'accepted',responsibility_roles:['Przygotowanie magazynu']},
]);
assert.equal(merged.length,2);
assert.equal(merged[0].role,'Technik');
assert.deepEqual(merged[0].responsibility_roles,['Kierownik realizacji','Kierowca']);
assert.equal(merged[0].phone_number,'123');
assert.equal(merged[1].id,'3');
const safe=mergeEventTeam([{id:'assignment-id',employee_id:'person-id',name:'Jan Nowak',phone:'123',status:'accepted'}],[]);
assert.equal(safe[0].id,'person-id');
assert.equal(safe[0].phone_number,'123');
console.log('12 mobile financial access and responsibility roster checks passed.');
