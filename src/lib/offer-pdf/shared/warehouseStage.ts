import {componentQuantity,componentGroupLinks,validateComponentGroups,type ComponentGroups} from './equipmentGroups';
export * from './equipmentGroups';
/** Stage-specific quantities, with recursive warehouse compatibility snapshots. */
export type StageRoot = { id:string; equipment_id:string; basis:'decks'|'manual'|'fixed'|'area'|'edge'|'sides'; quantity:number; required:boolean };
export type WarehouseStageCatalog = { version:2; profile:'warehouse_stage'; multiplier:number; roots:StageRoot[]; component_groups?:ComponentGroups };
export type StageLink = { id:string; equipment_id:string; type:'required'|'recommended'|'optional'; group:string|null; quantity:number; mode:'per_item'|'fixed'|'per_batch';per_quantity?:number;led_signal_outputs?:number; min_height:number|null; max_height:number|null };
export type StageEquipment = { id:string; name:string; name_en:string; model?:string|null; thumbnail_url?:string|null; rate:number|null; links:StageLink[] };
export type WarehouseStageSnapshot = { version:2; profile:'warehouse_stage'; catalog:WarehouseStageCatalog; equipment:Record<string,StageEquipment>|null; loaded_at:string|null; selection:{width:number;depth:number;height:number;skirt:'front_sides'|'all';quantities:Record<string,number>;choices:Record<string,string>;enabled:Record<string,boolean>} };
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number=(v:unknown,max=9999999):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max&&Math.abs(v*100-Math.round(v*100))<.0001;
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const warehouseStageDefaults=():WarehouseStageCatalog=>({version:2,profile:'warehouse_stage',multiplier:1,roots:[]});
export function validateWarehouseStage(c:WarehouseStageCatalog):string|null{
 if(!c||c.version!==2||c.profile!=='warehouse_stage'||!number(c.multiplier,100)||c.multiplier<=0)return 'Nieprawidłowe dane konfiguracji podestu. Otwórz ponownie konfigurator.';
 if(!Array.isArray(c.roots)||c.roots.length<1||c.roots.length>30)return 'Wybierz blat i maksymalnie 29 dodatków do całego podestu.';
 if(c.roots.some(r=>!r||!uuid.test(r.id)||!uuid.test(r.equipment_id)||!['decks','manual','fixed','area','edge','sides'].includes(r.basis)||!number(r.quantity,1000)||r.quantity<=0||typeof r.required!=='boolean')||new Set(c.roots.map(r=>r.id)).size!==c.roots.length||new Set(c.roots.map(r=>r.equipment_id)).size!==c.roots.length)return 'Sprawdź sprzęt i dodatnie przeliczniki; każdy sprzęt może wystąpić raz na poziomie produktu.';
 const groupError=validateComponentGroups(c.component_groups);if(groupError)return groupError;
 if(Object.values(c.component_groups||{}).some(groups=>groups.some(g=>g.items.some(i=>c.roots.some(r=>r.equipment_id===i.equipment_id)))))return 'Sprzęt na poziomie całego produktu nie może być jednocześnie jego zagnieżdżonym składnikiem.';
 const main=c.roots.filter(r=>r.basis==='decks');
 if(main.length!==1||!main[0].required||main[0].quantity!==1)return 'Wybierz dokładnie jeden wymagany blat 1 × 2 m.';
 return null;
}
export function warehouseStageSnapshot(catalog:WarehouseStageCatalog):WarehouseStageSnapshot{
 // Keep the v2 field for stored-offer compatibility; new configurations use rental totals only.
 return {version:2,profile:'warehouse_stage',catalog:{...structuredClone(catalog),multiplier:1},equipment:null,loaded_at:null,selection:{width:1,depth:2,height:30,skirt:'front_sides',quantities:Object.fromEntries(catalog.roots.map(r=>[r.id,r.quantity])),choices:{},enabled:{}}};
}
export function stageLinkGroups(links:StageLink[]):{key:string;label:string;required:boolean;links:StageLink[];choice:boolean}[]{
 const groups=new Map<string,{key:string;label:string;required:boolean;links:StageLink[];choice:boolean}>();
 for(const link of links){const key=link.group?'group:'+link.group:'item:'+link.id;let group=groups.get(key);if(!group){group={key,label:link.group||'',required:false,links:[],choice:!!link.group};groups.set(key,group);}group.links.push(link);group.required||=link.type==='required';}
 return [...groups.values()];
}
export function stageRootQuantity(s:WarehouseStageSnapshot,r:StageRoot):number{
 if(!r.required&&!s.selection.enabled['root:'+r.id])return 0;
 const p=s.selection;
 return r.basis==='decks'?p.width*p.depth/2:r.basis==='manual'?p.quantities[r.id]:r.quantity*(r.basis==='area'?p.width*p.depth:r.basis==='edge'?(p.skirt==='all'?2*(p.width+p.depth):p.width+2*p.depth):r.basis==='sides'?(p.skirt==='all'?4:3):1);
}
export function stageLinksFor(s:WarehouseStageSnapshot,node:StageEquipment):StageLink[]{
 // Equipment promoted to a whole-stage extra must never also multiply under each deck.
 const roots=new Set(s.catalog.roots.map(r=>r.equipment_id));return node.links.filter(l=>!roots.has(l.equipment_id));
}
export function calculateWarehouseStage(s:WarehouseStageSnapshot,english=false){
 const lines:{key:string;name:string;quantity:number;unit:string;rate:number|null;total:number}[]=[];
 const fail=(error:string)=>({error,lines,total:0});
 if(!s||s.version!==2||s.profile!=='warehouse_stage')return fail('Nieprawidłowa konfiguracja podestu.');
 const catalogError=validateWarehouseStage(s.catalog);if(catalogError)return fail(catalogError);
 for(const [id,groups] of Object.entries(s.catalog.component_groups||{})){const node=s.equipment?.[id];if(!node)continue;const fields=(l:StageLink)=>[l.id,l.equipment_id,l.type,l.group,l.quantity,l.mode,l.per_quantity??null,l.led_signal_outputs??null,l.min_height,l.max_height];if(JSON.stringify(node.links.map(fields))!==JSON.stringify(componentGroupLinks(groups).map(fields)))return fail('Zmieniono zagnieżdżenia. Pobierz sprzęt ponownie przed zapisem.');}
 const p=s.selection;
 if(!p||!Number.isInteger(p.width)||!Number.isInteger(p.depth)||p.width<1||p.depth<1||p.width>100||p.depth>100||(p.width%2!==0&&p.depth%2!==0))return fail('Podaj pełne metry (1–100); jeden bok musi być parzysty, aby ułożyć blaty 1 × 2 m.');
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
    if((l.min_height!==null&&p.height<l.min_height)||(l.max_height!==null&&p.height>l.max_height))firstError||=`${s.equipment![l.equipment_id]?.name||'Wybrany element'} nie pasuje do wysokości ${p.height} cm.`;
    if(l.mode==='fixed'){const previous=fixed.get(l.id);if(previous!==undefined){if(previous!==l.quantity)firstError||='Niespójna stała ilość zależności.';continue;}fixed.set(l.id,l.quantity);}
    visit(l.equipment_id,componentQuantity(l,q),path+'/'+l.id,[...ancestors,id],english?'pcs':'szt.');
   }
  }
 }
 for(const r of s.catalog.roots){const q=stageRootQuantity(s,r);if(r.required||p.enabled['root:'+r.id])visit(r.equipment_id,q,r.id,[],r.basis==='area'?'m²':r.basis==='edge'?'m':english?'pcs':'szt.');}
 // Respect historical offer snapshots; newly created snapshots always carry multiplier 1.
 const total=money(lines.reduce((sum,l)=>sum+l.total,0)*s.catalog.multiplier);
 return {error:firstError||(total>999999999?'Wartość konfiguracji jest zbyt wysoka.':null),lines,total};
}
export function warehouseStageTitle(s:WarehouseStageSnapshot,english=false){return `${english?'Stage platform':'Podest sceniczny'} ${s.selection.width} × ${s.selection.depth} m — ${s.selection.height} cm`;}
export function warehouseStageScope(s:WarehouseStageSnapshot,english=false){return calculateWarehouseStage(s,english).lines.map(l=>`${l.name} — ${l.quantity} ${l.unit}`);}
export function missingWarehouseEnglish(s:WarehouseStageSnapshot){const selected=new Set(calculateWarehouseStage(s).lines.map(l=>l.key));return Object.values(s.equipment||{}).some(n=>!n.name_en.trim()&&[...selected].some(path=>{const root=s.catalog.roots.find(r=>r.id===path);if(root)return root.equipment_id===n.id;const linkId=path.split('/').pop();return Object.values(s.equipment||{}).some(parent=>parent.links.some(l=>l.id===linkId&&l.equipment_id===n.id));}));}
