'use client';
import {useEffect,useRef,useState} from 'react';
import {Save,RefreshCw} from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import {WarehouseStageEditor} from './WarehouseStageConfigurator';
import {warehouseStageDefaults,validateProductConfigurator,type ProductConfigurator,type WarehouseStageCatalog} from '@/lib/CRM/Offers/modularProduct';

function stageTree(productId:string):WarehouseStageCatalog {
 const tree=warehouseStageDefaults();
 if(productId==='be81ab60-9ca7-4429-af94-b7068f8e9530')tree.roots=[
  {id:'470b908a-272b-447f-9f63-26809efef07b',equipment_id:'470b908a-272b-447f-9f63-26809efef07b',basis:'decks',quantity:1,required:true},
  {id:'498f691c-0a38-5399-8b4f-66198caa1c5c',equipment_id:'498f691c-0a38-5399-8b4f-66198caa1c5c',basis:'area',quantity:1,required:false},
  {id:'decaa66a-7f2b-4b7a-9b66-926688631067',equipment_id:'decaa66a-7f2b-4b7a-9b66-926688631067',basis:'fixed',quantity:1,required:false},
  {id:'5c45621a-a41d-44ab-8916-fe8aa6e890bf',equipment_id:'5c45621a-a41d-44ab-8916-fe8aa6e890bf',basis:'fixed',quantity:1,required:false},
  {id:'31e1c948-c620-4a1d-ab2b-2eaba230a582',equipment_id:'31e1c948-c620-4a1d-ab2b-2eaba230a582',basis:'fixed',quantity:3,required:false},
 ];
 if(productId==='be81ab60-9ca7-4429-af94-b7068f8e9530')tree.component_groups={
  '470b908a-272b-447f-9f63-26809efef07b':[{id:'c41167ee-6c96-43dd-bd5b-423f77fcb339',name:'Nogi',requirement:'required',items:[
   {id:'5389f2aa-5494-45a4-9cae-02726bb31641',equipment_id:'01ee4e92-e7f6-405b-8641-694ce9213cb9',quantity:4,mode:'per_item',min_height:30,max_height:30},
   {id:'051e104a-1b87-43b1-904d-172e99175227',equipment_id:'ebf3b83f-1458-45fc-bfe4-bcebf6782865',quantity:4,mode:'per_item',min_height:40,max_height:60},
  ]}],
 };
 return tree;
}
export default function ProductEquipmentTreeSection({productId,value,canEdit,disabled=false,onSave,onEditingChange}:{
 productId:string;value:ProductConfigurator|null;canEdit:boolean;disabled?:boolean;
 onSave:(value:ProductConfigurator)=>Promise<void>;onEditingChange:(editing:boolean)=>void;
}){
 const [draft,setDraft]=useState<WarehouseStageCatalog|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const inFlight=useRef(false),mounted=useRef(true);
 const editing=useRef(onEditingChange);editing.current=onEditingChange;
 const persist=useRef(onSave);persist.current=onSave;
 useEffect(()=>{editing.current(draft!==null||saving);},[draft!==null,saving]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;editing.current(false);};},[]);
 useEffect(()=>{if(!draft&&!saving)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[draft,saving]);
 const initialStage=value?.profile==='stage'?stageTree(productId):null;
 const current=draft??(value?.profile==='warehouse_stage'?{...value,multiplier:1}:initialStage);
 const legacy=value&&value.profile!=='warehouse_stage';
 const invalid=draft?validateProductConfigurator(draft):null;
 const edit=(next:WarehouseStageCatalog)=>{if(!canEdit||disabled||inFlight.current)return;setDraft({...next,multiplier:1});setError('');setSaved(false);};
 const save=async(snapshot:WarehouseStageCatalog|null)=>{
  if(!snapshot||!canEdit||disabled||inFlight.current)return;
  const problem=validateProductConfigurator(snapshot);if(problem){setError(problem);return;}
  inFlight.current=true;setSaving(true);setError('');
  try{
   await persist.current({...snapshot,multiplier:1});
   if(mounted.current){setDraft(latest=>latest===snapshot?null:latest);setSaved(true);}
  }catch(e){if(mounted.current){setDraft(latest=>latest??snapshot);setError(e instanceof Error?e.message:'Nie udało się zapisać drzewa powiązań.');setSaved(false);}}
  finally{inFlight.current=false;if(mounted.current)setSaving(false);}
 };
 useEffect(()=>{
  if(!draft||!canEdit||disabled||saving||error||validateProductConfigurator(draft))return;
  // Coalesce rapid field changes; persist only complete catalogs and serialize requests.
  const timer=window.setTimeout(()=>void save(draft),400);
  return()=>window.clearTimeout(timer);
 },[draft,canEdit,disabled,saving,error]);
 return <section className="min-w-0 rounded-xl bg-[#1c1f33] p-5 sm:p-6" aria-busy={saving}>
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
   <div><h2 className="text-lg font-medium text-[#e5e4e2]">Powiązania i opcje w ofercie</h2><p className="mt-2 max-w-3xl text-sm text-[#e5e4e2]/65">Wybierz komponenty z magazynu i ich zagnieżdżenia. Kompletne zmiany zapisują się automatycznie.</p></div>
   {canEdit&&<ResponsiveActionBar disabledBackground compact actions={[
    {label:'Włącz powiązania',show:!!initialStage&&!draft&&!saved,icon:<Save className="h-4 w-4"/>,variant:'primary',pin:true,onClick:()=>void save(initialStage),disabled:disabled||saving},
    {label:'Ponów zapis',show:!!error&&!!draft&&!invalid,icon:<RefreshCw className="h-4 w-4"/>,variant:'primary',pin:true,onClick:()=>void save(draft),disabled:disabled||saving},
   ]}/>}
  </div>
  {initialStage&&!draft&&!saved&&<p className="mb-3 text-sm text-[#d3bb73]">To propozycja powiązań podestu. Włączenie lub pierwsza kompletna zmiana zapisze ją jako konfigurację produktu.</p>}
  <div role="status" aria-live="polite" className="mb-3 text-xs text-[#d3bb73]">{saving?'Zapisywanie…':error?'Zmiany nie zostały zapisane.':invalid?`Niezapisane zmiany: ${invalid}`:draft?'Oczekiwanie na automatyczny zapis…':saved?'Zapisano':value?.profile==='warehouse_stage'?'Wszystkie zmiany zapisują się automatycznie.':''}</div>
  {error&&<p role="alert" className="mb-4 text-sm text-red-200">{error} Zmiany pozostają w formularzu — ponów zapis przed odświeżeniem.</p>}
  {current?<WarehouseStageEditor value={current} onChange={edit} readOnly={!canEdit} disabled={disabled||saving}/>:legacy?<p className="text-sm text-[#e5e4e2]/70">Ten produkt korzysta z wcześniejszego cennika konfiguracji. Drzewo powiązań jest obecnie dostępne dla podestów.</p>:canEdit?<WarehouseStageEditor value={warehouseStageDefaults()} onChange={edit} disabled={disabled||saving}/>:<p className="text-sm text-[#e5e4e2]/65">Nie zdefiniowano drzewa powiązań dla tego produktu.</p>}
 </section>;
}
