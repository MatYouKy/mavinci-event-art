const fs = require('fs');
const ts = require('typescript');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const filename = path.resolve('src/components/crm/subcontractors/profileValidation.ts');
const mod = new Module(filename, module);
mod.filename = filename; mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, filename);
const {subcontractorProfileSchema: schema,validNip} = mod.exports;
(async()=>{
 const basic={company_name:'Technik',phone:'500600700',email:'',specialization:'Nagłośnienie',nip:''};
 for(const type of ['cash','civil_contract']) await schema.validate({...basic,default_settlement_type:type});
 for(const type of ['invoice_vat','invoice_no_vat']){
  await assert.rejects(schema.validate({...basic,default_settlement_type:type}));
  await schema.validate({...basic,default_settlement_type:type,nip:'526-025-02-74'});
 }
 assert.equal(validNip('0000000000'),false);
 await assert.rejects(schema.validate({...basic,default_settlement_type:'cash',phone:''}),e=>e.path==='phone');
 await schema.validate({...basic,default_settlement_type:'cash',specialization:''});
 await schema.validate({...basic,default_settlement_type:'civil_contract',personnel_identifier:'44051401458',personnel_address:'Testowa 1/2, 00-001 Warszawa, Polska',personnel_bank_account:'PL61 1090 1014 0000 0712 1981 2874'});
 await assert.rejects(schema.validate({...basic,default_settlement_type:'civil_contract',personnel_identifier:'44051401459'}),e=>e.path==='personnel_identifier');
 await assert.rejects(schema.validate({...basic,default_settlement_type:'civil_contract',personnel_bank_account:'123'}),e=>e.path==='personnel_bank_account');
 await schema.validate({...basic,default_settlement_type:'civil_contract',personnel_address_parts:{country:'Polska',postal_code:'10-001'}});
 await assert.rejects(schema.validate({...basic,default_settlement_type:'civil_contract',personnel_address_parts:{country:'Polska',postal_code:'10001'}}),e=>e.path==='personnel_address_parts.postal_code');
 const addressFile=path.resolve('src/components/crm/subcontractors/profileAddress.ts');
 const addressModule=new Module(addressFile,module);addressModule.paths=module.paths;
 addressModule._compile(ts.transpileModule(fs.readFileSync(addressFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,addressFile);
 const {emptyAddress,formatProfileAddress}=addressModule.exports;
 assert.equal(formatProfileAddress(emptyAddress),'');
 assert.equal(formatProfileAddress({...emptyAddress,type:'street',name:'Testowa',house:'15',apartment:'66',postal_code:'10-001',city:'Olsztyn'}),'ul. Testowa 15/66, 10-001 Olsztyn, Polska');
 assert.equal(formatProfileAddress({...emptyAddress,type:'village',name:'Testowo',house:'2A',postal_code:'10-001',city:'Testowo'}),'wieś Testowo 2A, 10-001 Testowo, Polska');
 console.log('PASS: settlement branches, NIP, contact and optional legacy scope');
})();
