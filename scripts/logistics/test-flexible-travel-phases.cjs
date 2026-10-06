const fs=require('fs'), assert=require('node:assert/strict'), ts=require(process.cwd()+'/node_modules/typescript');
function load(path, mocks={}) { const m={exports:{}}; new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText)(id=>id in mocks?mocks[id]:id.startsWith('.')?load(require('path').resolve(require('path').dirname(path),id)+'.ts',mocks):id.startsWith('@/')?load('src/'+id.slice(2)+'.ts',mocks):require(require.resolve(id,{paths:[process.cwd()]})),m,m.exports); return m.exports; }
const {flexibleTravelInterval:project}=load('src/lib/CRM/events/flexibleTravelPhases.ts');
const booking={id:'car',vehicle_available_from:'2026-09-23T01:00:00Z',vehicle_available_until:'2026-09-23T05:00:00Z',loading_time_minutes:30,logistics_schedule:{pickup:{id:'local:loading'},return:{id:'local:unloading'},unloading_minutes:60},travel_plan:{outbound:{plannedMinutes:39},inbound:{plannedMinutes:39}}};
assert.deepEqual(project('outbound',booking,[]),{start:'2026-09-23T01:30:00.000Z',end:'2026-09-23T02:15:00.000Z'});
assert.deepEqual(project('inbound',booking,[]),{start:'2026-09-23T03:15:00.000Z',end:'2026-09-23T04:00:00.000Z'});
assert.ok(project('inbound',{...booking,travel_plan:null},[]).reason);
assert.ok(project('inbound',{...booking,logistics_schedule:{...booking.logistics_schedule,unloading_minutes:undefined}},[]).reason);
assert.ok(project('outbound',{...booking,vehicle_available_until:'2026-09-23T01:10:00Z'},[]).reason);
const other={...booking,vehicle_available_from:'2026-09-25T01:00:00Z',vehicle_available_until:'2026-09-25T05:00:00Z'};
assert.match(project('outbound',other,[]).start,/2026-09-25/);
assert.equal(project('outbound',booking,[]).start,'2026-09-23T01:30:00.000Z');

(async()=>{
for(const [name,rank,key,estimate] of [['Dojazd',2,'outbound'],['Powrót',6,'inbound'],['Montaż',3,null],['Dojazd',2,'outbound',135],['Powrót',6,'inbound',120]]) {
 const React=require(require.resolve('react',{paths:[process.cwd()]}));
 let i=0, saved=[], fixed=0, payload=null, errors=[], closed=false;
 const states=[true,'type',name,'',estimate?'2026-09-21T15:00':'',estimate?'2026-09-21T17:00':'','automatic',''];
 const {AddPhaseModal}=load('src/app/(crm)/crm/events/[id]/components/Modals/AddPhaseModal.tsx',{
  react:{...React,useState:()=>{const index=i++;return [states[index], value=>{if(index===7) errors.push(value);}];}},
  '@/store/api/eventPhasesApi':{useGetPhaseTypesQuery:()=>({data:[{id:'type',name,sequence_priority:rank,default_duration_hours:1}]}),useCreatePhaseMutation:()=>[args=>{payload=args;fixed++;return {unwrap:async()=>{}};},{isLoading:false}],useSaveFlexibleTravelPhaseMutation:()=>[args=>({unwrap:async()=>saved.push(args)}),{isLoading:false}]},
  '@/contexts/SnackbarContext':{useSnackbar:()=>({showSnackbar:()=>{}})},
 });
 const tree=AddPhaseModal({open:true,eventId:'event',eventStartDate:'',eventEndDate:'',existingPhases:[],travelEstimates:estimate?{outbound:estimate,inbound:estimate}:undefined,onClose:()=>closed=true});
 function nodes(node){if(!node||typeof node!=='object')return [];return [node,...React.Children.toArray(node.props?.children).flatMap(nodes)];}
 const all=nodes(tree);const button=all.find(n=>n.type==='button' && n.props.children==='Utwórz Fazę');assert.ok(button);
 await button.props.onClick({preventDefault(){}});
 if(estimate){ assert.equal(fixed,1); assert.equal(saved.length,1); assert.equal(saved[0].name,null); assert.equal(closed,true); assert.equal((Date.parse(payload.end_time)-Date.parse(payload.start_time))/60000,estimate); assert.equal(all.filter(n=>n.type==='input'&&n.props.type==='datetime-local').length,2); continue; }
 if(key){assert.equal(saved[0].key,key);assert.equal(closed,true);assert.equal(all.some(n=>n.type==='input'&&n.props.type==='datetime-local'),false);}
 else {assert.equal(saved.length,0);assert.ok(errors.includes('Podaj czas rozpoczęcia i zakończenia'));}
 assert.equal(fixed,0);
}
console.log('PASS: auto phase creation without dates in both directions; normal phases still require dates; rounding, per-car dates, missing route/unloading and invalid booking.');
})().catch(e=>{console.error(e);process.exitCode=1;});

const { flexibleTravelInterval: timelineInterval } = load('src/lib/CRM/events/flexibleTravelPhases.ts');
const timelineCar = { id: 'timeline', logistics_schedule: { mode: 'timeline', outbound_start: '2026-09-21T13:00:00Z' }, travel_plan: { outbound: { plannedMinutes: 135 } } };
assert.equal(timelineInterval('outbound', timelineCar, []).end, '2026-09-21T15:15:00.000Z');
assert.ok(timelineInterval('inbound', timelineCar, []).reason);
console.log('PASS: timeline start + 120 min driving + 15 min break; missing start remains unscheduled');

const { eventTravelMinutes } = load('src/lib/CRM/events/travelPlan.ts');
assert.deepEqual(eventTravelMinutes([
 {logistics_schedule:{mode:'timeline'},travel_plan:{outbound:{plannedMinutes:135},inbound:{plannedMinutes:120}}},
 {status:'cancelled',travel_plan:{outbound:{plannedMinutes:500}}},
]),{outbound:135,inbound:120});
console.log('PASS: new logistics schedules included; cancelled vehicles excluded');
