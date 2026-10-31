'use client';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,ChevronUp,Plus,Trash2,Pencil,X} from 'lucide-react';
import ResponsiveActionBar,{type Action} from '@/components/crm/ResponsiveActionBar';
import {supabase} from '@/lib/supabase/browser';
import {EquipmentSearch,WarehouseItemCard} from './WarehouseEquipmentPicker';
import type {WarehouseEquipmentRow} from '@/lib/CRM/Offers/warehouseStageLoader';
import {componentOptionInputError,defaultLedProcessorOutputs} from '@/lib/CRM/Offers/modularProduct';
import type {ComponentGroup,ComponentGroups,ComponentOption} from '@/lib/CRM/Offers/modularProduct';
const field='mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
const action='rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40';
const groupAction='inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-xs leading-4 hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20 disabled:opacity-40';
const requirements={required:'Wymagane',recommended:'Rekomendowane',optional:'Opcjonalne'};
type Suggestion=ComponentOption&{name:string;group:string|null;requirement:ComponentGroup['requirement']};
export default function ComponentDependencyEditor({equipmentId,groups,onChange,readOnly=false,disabled=false,ancestors=[],rootIds=[],header,actions=[],children,editor,defaultExpanded=true,moduleKind='stage'}:{equipmentId:string;groups:ComponentGroups;onChange:(groups:ComponentGroups)=>void;readOnly?:boolean;disabled?:boolean;ancestors?:string[];rootIds?:string[];header?:ReactNode;actions?:Action[];children?:ReactNode;editor?:ReactNode;defaultExpanded?:boolean;moduleKind?:'stage'|'led'}){
 const [expanded,setExpanded]=useState(defaultExpanded);
 const [editing,setEditing]=useState(false),[editingGroup,setEditingGroup]=useState<string|null>(null);
 const contentId=useId();
 const locked=readOnly||disabled;
 const [suggestions,setSuggestions]=useState<Suggestion[]>([]),[items,setItems]=useState<Record<string,WarehouseEquipmentRow>>({}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[picker,setPicker]=useState<string|null>(null);
 const latest=useRef(groups);latest.current=groups;
 useEffect(()=>{let active=true;setLoading(true);setError('');setSuggestions([]);
  (async()=>{const {data,error}=await supabase.from('equipment_compatible_items').select('*').eq('equipment_id',equipmentId).order('display_order');if(error)throw error;
   const rows=(data||[]).filter(r=>r.compatible_equipment_id&&!rootIds.includes(r.compatible_equipment_id));
   const ids=[...new Set(rows.map(r=>r.compatible_equipment_id))] as string[];
   let found:WarehouseEquipmentRow[]=[];if(ids.length){const result=await supabase.from('equipment_items').select('id,name,model,thumbnail_url,rental_price_per_day').in('id',ids).is('deleted_at',null);if(result.error)throw result.error;found=result.data||[];}
   if(!active)return;setItems(old=>({...old,...Object.fromEntries(found.map(i=>[i.id,i]))}));
   setSuggestions(rows.map(r=>({id:r.id,equipment_id:r.compatible_equipment_id,name:found.find(i=>i.id===r.compatible_equipment_id)?.name||'Niedostępny sprzęt',group:r.compatibility_group?.trim()||null,requirement:r.compatibility_type,quantity:Number(r.quantity||1),mode:r.quantity_mode||'per_item',min_height:r.min_height_cm==null?null:Number(r.min_height_cm),max_height:r.max_height_cm==null?null:Number(r.max_height_cm)})));
  })().catch(()=>{if(active)setError('Nie udało się pobrać propozycji z magazynu. Możesz ponowić pobieranie albo dodać własne zagnieżdżenie.');}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[equipmentId,JSON.stringify(rootIds),revision]);
 const inherited:ComponentGroup[]=[];
 for(const s of suggestions){const name=s.group||s.name;let g=inherited.find(x=>x.name===name);if(!g){g={id:s.id,name,requirement:s.requirement,items:[]};inherited.push(g);}if(s.requirement==='required')g.requirement='required';g.items.push({id:s.id,equipment_id:s.equipment_id,quantity:s.quantity,mode:s.mode,min_height:s.min_height,max_height:s.max_height});}
 const local=groups[equipmentId];const current=local??inherited;
 const currentKey=JSON.stringify(current.flatMap(g=>g.items.map(i=>i.equipment_id)));
 useEffect(()=>{let active=true;const ids=current.flatMap(g=>g.items.map(i=>i.equipment_id));if(!ids.length)return;supabase.from('equipment_items').select('id,name,model,thumbnail_url,rental_price_per_day').in('id',ids).is('deleted_at',null).then(({data,error})=>{if(!active)return;if(error)setError('Nie udało się pobrać danych wybranych komponentów.');else setItems(old=>({...old,...Object.fromEntries((data||[]).map(i=>[i.id,i]))}));});return()=>{active=false;};},[currentKey]);
 const commit=(next:ComponentGroup[])=>onChange({...latest.current,[equipmentId]:next});
 const editGroup=(id:string,patch:Partial<ComponentGroup>)=>commit(current.map(g=>g.id===id?{...g,...patch}:g));
 const editItem=(group:ComponentGroup,id:string,patch:Partial<ComponentOption>)=>editGroup(group.id,{items:group.items.map(i=>i.id===id?{...i,...patch}:i)});
 const used=current.flatMap(g=>g.items.map(i=>i.equipment_id));
 const blocked=[...ancestors,equipmentId,...rootIds];
 if(ancestors.includes(equipmentId)||ancestors.length>=8)return <p role="alert" className="text-sm text-red-200">Nie można zagnieździć komponentu w nim samym lub przekroczyć 8 poziomów.</p>;
 const addItem=(group:ComponentGroup,item:WarehouseEquipmentRow,suggestion?:Suggestion)=>{
  setItems(old=>({...old,[item.id]:item}));commit(current.map(g=>g.id===group.id?{...g,items:[...g.items,{id:crypto.randomUUID(),equipment_id:item.id,quantity:suggestion?.quantity??1,mode:suggestion?.mode??'per_item',min_height:suggestion?.min_height??null,max_height:suggestion?.max_height??null}]}:{...g,items:g.items.filter(i=>i.equipment_id!==item.id)}).filter(g=>g.id===group.id||g.items.length>0));setPicker(null);
 };
 const addGroup=()=>{let name='Nowe zagnieżdżenie',n=2;while(current.some(g=>g.name===name))name=`Nowe zagnieżdżenie ${n++}`;const id=crypto.randomUUID();commit([...current,{id,name,requirement:'optional',items:[]}]);setExpanded(true);setEditingGroup(id);};
 return <div className="min-w-0 space-y-3">
  <div className="flex items-start gap-2">
   <div className="min-w-0 flex-1">{header||<p className="text-sm font-medium">Zagnieżdżone komponenty</p>}</div>
   {(loading||current.length>0||children)&&<button type="button" disabled={disabled} aria-expanded={expanded} aria-controls={contentId} aria-label={expanded?'Ukryj zagnieżdżone komponenty':'Pokaż wszystkie zagnieżdżone komponenty'} title={expanded?'Zwiń komponenty':'Rozwiń komponenty'} className="shrink-0 rounded-lg p-2 text-[#d3bb73] hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20" onClick={()=>setExpanded(v=>!v)}>{expanded?<ChevronUp size={20}/>:<ChevronDown size={20}/>}</button>}
   {!readOnly&&<div className="shrink-0"><ResponsiveActionBar alwaysDropdown compact disabledBackground actions={[{label:'Edytuj parametry',icon:<Pencil size={16}/>,show:!!editor,disabled:locked,onClick:()=>setEditing(true)},{label:'Dodaj zagnieżdżenie',icon:<Plus size={16}/>,onClick:addGroup,disabled:locked||loading||current.length>=25||ancestors.length>=7},...actions.map(a=>({...a,disabled:locked||a.disabled}))]}/></div>}
  </div>
  {editing&&editor&&!readOnly&&<fieldset disabled={locked} className="rounded-lg bg-white/[0.025] px-2 py-1">{editor}<button type="button" className={action} onClick={()=>setEditing(false)}>Gotowe</button></fieldset>}
  <div id={contentId} hidden={!expanded}><div className="space-y-3">
  {children}
  {loading&&<p role="status" className="text-xs opacity-65">Pobieranie powiązań i propozycji z magazynu…</p>}
  {error&&<p role="alert" className="text-sm text-red-200">{error} <button type="button" onClick={()=>setRevision(n=>n+1)}>Ponów</button></p>}
  {current.map(g=><section key={g.id} className="ml-2 space-y-2 rounded-lg bg-black/10 p-2 sm:ml-3">
   <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2"><div className="min-w-0 flex-1">{editingGroup===g.id&&!readOnly?<div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Nazwa zagnieżdżenia<input disabled={locked} className={field} maxLength={100} placeholder="Np. Nogi" value={g.name} onChange={e=>editGroup(g.id,{name:e.target.value})}/></label><label className="text-sm">Wymaganie<select disabled={locked} className={field} value={g.requirement} onChange={e=>editGroup(g.id,{requirement:e.target.value as ComponentGroup['requirement']})}>{Object.entries(requirements).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label></div>:<p className="py-1 text-sm"><span className="font-medium">{g.name||'Bez nazwy'}</span><span className="ml-2 text-xs text-[#d3bb73]">{requirements[g.requirement]}</span></p>}</div>
    {!readOnly&&<div className="flex shrink-0 flex-wrap items-center gap-1" role="group" aria-label={`Akcje zagnieżdżenia: ${g.name}`}>
     <button type="button" className={`${groupAction} text-[#d3bb73]`} disabled={locked} title="Edytuj zagnieżdżenie" onClick={()=>setEditingGroup(g.id)}><Pencil size={13} aria-hidden="true"/>Edytuj</button>
     <button type="button" className={`${groupAction.replace('hover:bg-white/5','hover:bg-[#dfca8b]')} bg-[#d3bb73] text-[#211018]`} disabled={locked} title="Dodaj komponent do grupy" onClick={()=>setPicker(g.id)}><Plus size={13} aria-hidden="true"/>Dodaj</button>
     <button type="button" className={`${groupAction} text-red-200`} disabled={locked} title="Usuń zagnieżdżenie" onClick={()=>commit(current.filter(x=>x.id!==g.id))}><Trash2 size={13} aria-hidden="true"/>Usuń</button>
    </div>}
   </div>
   {editingGroup===g.id&&!readOnly&&<><p className="text-xs text-[#d3bb73]">{g.requirement==='required'?'W ofercie trzeba wybrać dokładnie jeden element z tej grupy.':g.requirement==='recommended'?'Grupa zostanie wyróżniona jako rekomendowana; wybór jednego elementu jest dobrowolny.':'W ofercie można pominąć grupę albo wybrać jeden element.'}</p><button type="button" disabled={locked} className={action} onClick={()=>setEditingGroup(null)}>Gotowe</button></>}
   {g.items.map(i=><div key={i.id} className="space-y-3 rounded-lg bg-white/[0.025] p-3">
    <ComponentDependencyEditor moduleKind={moduleKind} equipmentId={i.equipment_id} groups={groups} onChange={onChange} readOnly={readOnly} disabled={disabled} ancestors={[...ancestors,equipmentId]} rootIds={rootIds}
     header={<WarehouseItemCard compact item={items[i.equipment_id]} id={i.equipment_id} summary={<>{Number.isFinite(i.quantity)?i.quantity.toLocaleString('pl-PL'):'Uzupełnij ilość'} szt. {i.mode==='per_item'?'na sztukę komponentu nadrzędnego':i.mode==='per_batch'?`na każde rozpoczęte ${i.per_quantity??'—'} szt. komponentu nadrzędnego`:'na cały produkt'}{(i.min_height!==null||i.max_height!==null)&&` · wysokość ${i.min_height??'—'}–${i.max_height??'—'} cm`}</>}/>}
     actions={[{label:'Usuń komponent z grupy',icon:<Trash2 size={16}/>,variant:'danger',onClick:()=>editGroup(g.id,{items:g.items.filter(x=>x.id!==i.id)})}]}
    editor={<>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Liczba elementów<input disabled={locked} type="number" min="0.01" max="1000" step="0.01" className={field} value={Number.isFinite(i.quantity)?i.quantity:''} onChange={e=>editItem(g,i.id,{quantity:e.target.value===''?NaN:Number(e.target.value)})}/></label><label className="text-sm">Naliczanie<select disabled={locked} className={field} value={i.mode} onChange={e=>editItem(g,i.id,{mode:e.target.value as ComponentOption['mode'],per_quantity:e.target.value==='per_batch'?(i.per_quantity||12):undefined})}><option value="per_item">Na sztukę komponentu nadrzędnego</option><option value="fixed">Na cały produkt</option><option value="per_batch">Na każde N sztuk komponentu nadrzędnego</option></select></label></div>
    {i.mode==='per_batch'&&<label className="mt-3 block text-sm">Na każde ile sztuk komponentu nadrzędnego?<input disabled={locked} type="number" min="1" max="100000" step="1" className={field} value={Number.isFinite(i.per_quantity)?i.per_quantity:''} onChange={e=>editItem(g,i.id,{per_quantity:e.target.value===''?NaN:Number(e.target.value)})}/><span className="text-xs opacity-65">Zaokrąglamy w górę. Np. 1 podstawa na 12 modułów: 13 modułów wymaga 2 podstaw.</span></label>}
    {moduleKind==='led'&&<label className="mt-3 block text-sm">Limit aktywnych skrętek — tylko dla procesora<input disabled={locked} type="number" min="1" max="1000" step="1" className={field} value={i.led_signal_outputs??''} placeholder={String(defaultLedProcessorOutputs(items[i.equipment_id]?.name,items[i.equipment_id]?.model)??'Nie dotyczy')} onChange={e=>editItem(g,i.id,{led_signal_outputs:e.target.value===''?undefined:Number(e.target.value)})}/><span className="text-xs opacity-65">TB50: 4, VX1000 / TBX1000: 10 według przyjętych limitów. Własna wartość zastępuje domyślną. Skrętka zapasowa nie zajmuje wyjścia.</span></label>}
    <details open={moduleKind==='stage'}><summary className="text-xs text-[#d3bb73]">Wysokość podestu — automatyczny dobór komponentu</summary><p className="mt-2 text-xs opacity-65">Dla nóg wpisz zakres każdego wariantu w wymaganej grupie: stałe 30 cm → od 30 do 30; teleskopowe → np. od 40 do 60. Pracownik i sprzedawca wpisują wysokość podestu, a system dobiera pasujący wariant. Puste pola oznaczają element niezależny od wysokości.</p><div className="grid grid-cols-2 gap-3">{(['min_height','max_height'] as const).map(key=><label key={key} className="text-xs">{key==='min_height'?'Od':'Do'} wysokości (cm)<input disabled={locked} type="number" min="1" max="200" step="1" className={field} value={i[key]??''} onChange={e=>editItem(g,i.id,{[key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}</div></details>
    </>}/>
    {componentOptionInputError(i)&&<p role="alert" className="text-xs text-amber-200">{componentOptionInputError(i)}</p>}
   </div>)}
   {!g.items.length&&<p className="text-sm text-amber-200">Dodaj przynajmniej jeden pasujący element do tej grupy.</p>}
   {!readOnly&&picker===g.id&&<fieldset disabled={locked} className="space-y-2"><div className="flex justify-end"><button type="button" className={groupAction} aria-label="Anuluj wybór komponentu" onClick={()=>setPicker(null)}><X size={14} aria-hidden="true"/>Anuluj</button></div><p className="text-xs opacity-65">Propozycje przypisane do komponentu w magazynie:</p><div className="flex flex-wrap gap-2">{suggestions.filter(s=>!g.items.some(i=>i.equipment_id===s.equipment_id)&&!blocked.includes(s.equipment_id)).map(s=><button type="button" key={s.id} className={action} onClick={()=>{const item=items[s.equipment_id];if(item)addItem(g,item,s);}} disabled={locked||!items[s.equipment_id]}>{used.includes(s.equipment_id)?'Przenieś:':'+ '} {s.name} · {requirements[s.requirement]}</button>)}</div><EquipmentSearch exclude={[...blocked,...used]} onPick={item=>addItem(g,item)}/></fieldset>}
  </section>)}

  </div></div>
 </div>;
}
