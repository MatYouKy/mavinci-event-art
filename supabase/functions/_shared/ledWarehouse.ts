import {validateWarehouseStage,stageLinkGroups,stageLinksFor,type WarehouseStageSnapshot,type StageRoot,type StageLink} from './warehouseStage.ts';
import {componentQuantity,componentGroupLinks} from './equipmentGroups.ts';
import {ledSectionTotals,type LedSection} from './ledSections.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number=(v:unknown,max=9999999):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max&&Math.abs(v*100-Math.round(v*100))<.0001;
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function ledRootQuantity(s:WarehouseStageSnapshot,r:StageRoot,totals:ReturnType<typeof ledSectionTotals>,cableRootId?:string){
 if(!r.required&&!s.selection.enabled['root:'+r.id])return 0;
 if(r.id===cableRootId)return totals.cables;
 return r.basis==='decks'?totals.modules:r.basis==='area'?totals.area*r.quantity:r.basis==='manual'?s.selection.quantities[r.id]:r.quantity;
}
export function calculateLedWarehouse(s:WarehouseStageSnapshot,sections:LedSection[],cableRootId?:string,english=false){
 const lines:{key:string;name:string;quantity:number;unit:string;rate:number|null;total:number}[]=[];
 const fail=(error:string)=>({error,lines,total:0});
 if(!s||s.version!==2||s.profile!=='warehouse_stage')return fail('Nieprawidłowa konfiguracja podestu.');
 const catalogError=validateWarehouseStage(s.catalog);if(catalogError)return fail(catalogError);
 for(const [id,groups] of Object.entries(s.catalog.component_groups||{})){const node=s.equipment?.[id];if(!node)continue;const fields=(l:StageLink)=>[l.id,l.equipment_id,l.type,l.group,l.quantity,l.mode,l.per_quantity??null,l.led_signal_outputs??null,l.min_height,l.max_height];if(JSON.stringify(node.links.map(fields))!==JSON.stringify(componentGroupLinks(groups).map(fields)))return fail('Zmieniono zagnieżdżenia. Pobierz sprzęt ponownie przed zapisem.');}
 const p=s.selection;
 let totals;try{totals=ledSectionTotals(sections);}catch(e){return fail(e instanceof Error?e.message:'Nieprawidłowe sekcje LED.');}
 if(!Number.isInteger(p.height)||p.height<1||p.height>200||!['front_sides','all'].includes(p.skirt)||!p.quantities||!p.choices||!p.enabled)return fail('Uzupełnij wysokość 1–200 cm i ustawienia podestu.');
 if(!s.equipment||!s.loaded_at)return fail('Pobierz sprzęt, zależności i aktualne ceny rentalne.');
 if(Object.keys(s.equipment).length>200)return fail('Konfiguracja zawiera zbyt wiele elementów magazynowych.');
 for(const [id,n] of Object.entries(s.equipment)){
  if(!n||id!==n.id||!uuid.test(id)||typeof n.name!=='string'||!n.name.trim()||n.name.length>300||typeof n.name_en!=='string'||n.name_en.length>300||(n.rate!==null&&!number(n.rate))||!Array.isArray(n.links)||n.links.length>50)return fail('Nieprawidłowe dane sprzętu. Pobierz je ponownie.');
  const ids=new Set<string>();
  for(const l of n.links){if(!l||!uuid.test(l.id)||ids.has(l.id)||!uuid.test(l.equipment_id)||!['required','recommended','optional'].includes(l.type)||!['fixed','per_item','per_batch'].includes(l.mode)||(l.mode==='per_batch'&&(!Number.isInteger(l.per_quantity)||!l.per_quantity||l.per_quantity<1||l.per_quantity>100000))||!number(l.quantity,1000)||l.quantity<=0||(l.group!==null&&(typeof l.group!=='string'||!l.group.trim()||l.group.length>100))||(l.min_height!==null&&(!number(l.min_height,200)||l.min_height<1))||(l.max_height!==null&&(!number(l.max_height,200)||l.max_height<1))||(l.min_height!==null&&l.max_height!==null&&l.min_height>l.max_height))return fail(`Popraw zależności sprzętu: ${n.name}.`);ids.add(l.id);}
 }
 let visits=0;const fixed=new Map<string,number>();let firstError:string|null=null;
 function visit(id:string,q:number,path:string,ancestors:string[],unit:string){
  if(++visits>300){firstError||='Zbyt rozbudowane zagnieżdżenie sprzętu.';return;}
  if(ancestors.length>=8||ancestors.includes(id)){firstError||='Wykryto pętlę lub więcej niż 8 poziomów zależności sprzętu.';return;}
  const n=s.equipment![id];if(!n){firstError||='Brakuje sprzętu w zapisanej konfiguracji. Pobierz dane ponownie.';return;}
  if(!number(q,100000)||q<=0){firstError||=`Podaj dodatnią ilość: ${n.name}.`;return;}
  const rate=n.rate??0;
  lines.push({key:path,name:english?n.name_en||n.name:n.name,quantity:q,unit,rate,total:money(q*rate)});
  for(const group of stageLinkGroups(stageLinksFor(s,n))){
   const key=path+'/'+group.key;let chosen:StageLink[]=[];
   if(group.choice){const selected=p.choices[key];const link=group.links.find(l=>l.id===selected);if(selected&&!link){firstError||=`Wybierz aktualny wariant w grupie „${group.label}”.`;continue;}if(link)chosen=[link];else if(group.required)firstError||=`Wybierz jeden wariant: ${group.label} (${n.name}).`;}
   else if(group.required||p.enabled[key])chosen=group.links;
   for(const l of chosen){
    if(l.mode==='fixed'){const previous=fixed.get(l.id);if(previous!==undefined){if(previous!==l.quantity)firstError||='Niespójna stała ilość zależności.';continue;}fixed.set(l.id,l.quantity);}
    visit(l.equipment_id,componentQuantity(l,q),path+'/'+l.id,[...ancestors,id],english?'pcs':'szt.');
   }
  }
 }
 for(const r of s.catalog.roots){const q=ledRootQuantity(s,r,totals,cableRootId);if(r.required||p.enabled['root:'+r.id])visit(r.equipment_id,q,r.id,[],r.basis==='area'?'m²':r.basis==='edge'?'m':english?'pcs':'szt.');}
 // Respect historical offer snapshots; newly created snapshots always carry multiplier 1.
 const total=money(lines.reduce((sum,l)=>sum+l.total,0)*s.catalog.multiplier);
 return {error:firstError||(total>999999999?'Wartość konfiguracji jest zbyt wysoka.':null),lines,total};
}
