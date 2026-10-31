'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase/browser';
import {WarehouseStageEditor} from './WarehouseStageConfigurator';
import {loadStageEquipment} from '@/lib/CRM/Offers/warehouseStageLoader';
import {warehouseStageDefaults,validateProductConfigurator,type EquipmentCatalog,type ProductConfigurator,type WarehouseStageCatalog} from '@/lib/CRM/Offers/modularProduct';
function initial(value:ProductConfigurator|null):EquipmentCatalog{
 if(value?.profile==='led'&&value.led_tree)return structuredClone(value);
 const tree=warehouseStageDefaults();
 if(value?.profile==='led'){
  for(const c of value.components){
   const id=c.source_equipment_id||(c.role==='display'?value.led_equipment_id:undefined);
   if(!id||tree.roots.some(r=>r.equipment_id===id))continue;
   tree.roots.push({id,equipment_id:id,basis:c.role==='display'?'decks':c.basis==='parent'?'manual':c.basis,quantity:c.role==='display'?1:Math.max(1,c.quantity),required:c.role==='display'||c.required});
  }
 }
 const cable=value?.profile==='led'?value.components.find(c=>c.id===value.led_cable_component_id)?.source_equipment_id:undefined;
 return {version:1,profile:'led',components:[],multiplier:1,led_layout:'sections',led_tree:tree,...(cable?{led_cable_root_id:cable}:{})};
}
export default function LedProductConfigurationSection({value,onSave,canEdit,disabled=false,onEditingChange}:{value:ProductConfigurator|null;onSave:(v:ProductConfigurator)=>Promise<void>;canEdit:boolean;disabled?:boolean;onEditingChange:(editing:boolean)=>void}){
 const base=useMemo(()=>initial(value),[value]);
 const [draft,setDraft]=useState<EquipmentCatalog|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const lock=useRef(false),editing=useRef(onEditingChange);editing.current=onEditingChange;
 useEffect(()=>{editing.current(draft!==null||busy);},[draft,busy]);
 useEffect(()=>()=>editing.current(false),[]);
 useEffect(()=>{if(!draft)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[draft]);
 const current=draft||base,tree=current.led_tree!;
 const [names,setNames]=useState<Record<string,string>>({});
 const rootKey=JSON.stringify(tree.roots.map(r=>r.equipment_id));
 useEffect(()=>{let active=true;const ids=tree.roots.map(r=>r.equipment_id);if(!ids.length){setNames({});return;}supabase.from('equipment_items').select('id,name').in('id',ids).then(({data,error})=>{if(active&&!error)setNames(Object.fromEntries((data||[]).map(item=>[item.id,item.name])));});return()=>{active=false;};},[rootKey]);
 const edit=(next:EquipmentCatalog)=>{setDraft(next);setSaved(false);setError('');};
 const changeTree=(next:WarehouseStageCatalog)=>edit({...current,led_tree:next,led_cable_root_id:next.roots.some(r=>r.id===current.led_cable_root_id&&r.required&&r.basis!=='decks')?current.led_cable_root_id:undefined});
 const save=async()=>{
  if(lock.current)return;
  const problem=validateProductConfigurator(current);if(problem){setError(problem);return;}
  lock.current=true;setBusy(true);setError('');
  try{await loadStageEquipment(tree,'led');await onSave(current);setDraft(null);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Nie udało się zapisać drzewa LED.');}finally{lock.current=false;setBusy(false);}
 };
 return <section className="min-w-0 rounded-xl bg-white/[0.035] p-5 sm:p-6">
 <h2 className="text-lg font-medium">Powiązania i konfiguracja LED</h2>
 <p className="my-3 text-sm opacity-70">Wybierz kafelek LED z magazynu. W menu trzech kropek dodawaj zagnieżdżenia, grupy i warianty, tak jak w podeście. Procesor, skrętki i konstrukcję możesz dodać jako komponenty całego zestawu.</p>
 {value?.profile==='led'&&!value.led_tree&&<p className="mb-3 text-xs text-[#d3bb73]">To nowa konfiguracja drzewa. Przed zapisem uzupełnij powiązania; istniejące pozycje ofert zachowają dotychczasowy skład i ceny.</p>}
 <WarehouseStageEditor value={tree} onChange={changeTree} moduleKind="led" readOnly={!canEdit} disabled={disabled||busy}/>
 <fieldset disabled={!canEdit||disabled||busy} className="mt-4 space-y-3">
 <label className="block text-sm">Automatyczna liczba skrętek<select className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2" value={current.led_cable_root_id||''} onChange={e=>edit({...current,led_cable_root_id:e.target.value||undefined})}><option value="">Wybierz wymagany komponent dodatkowy</option>{tree.roots.filter(r=>r.required&&r.basis!=='decks').map(r=><option key={r.id} value={r.id}>{names[r.equipment_id]||'Pobieranie nazwy sprzętu…'}</option>)}</select></label>
 <p className="text-xs opacity-65">Dla wskazanego komponentu: jedna skrętka na rozpoczęte 16 modułów w każdej sekcji + jedna zapasowa na zestaw. Bez wskazania komponentu licznik pozostaje informacją do przygotowania sprzętu.</p>
 <div className="flex gap-3"><button type="button" className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#211018]" onClick={()=>void save()}>{busy?'Zapisywanie…':'Zapisz powiązania LED'}</button>{draft&&<button type="button" onClick={()=>{setDraft(null);setError('');}}>Anuluj zmiany</button>}</div>
 </fieldset>{error&&<p role="alert" className="mt-3 text-red-200">{error}</p>}{saved&&<p role="status" className="mt-3 text-sm">Zapisano drzewo powiązań LED.</p>}
 </section>;
}
