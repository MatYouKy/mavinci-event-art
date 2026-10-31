'use client';
import {missingSellerConfigurationRate} from '@/lib/seller/productSelection';
import {useEffect,useMemo,useRef,useState} from 'react';
import StageModuleGrid from './StageModuleGrid';
import {Plus,Trash2,RefreshCw,X,Loader2} from 'lucide-react';
import {isHeightChoice,selectStageHeight,stageHeightOptions} from '@/lib/CRM/Offers/stageHeightSelection';
import {supabase} from '@/lib/supabase/browser';
import ComponentDependencyEditor from './ComponentDependencyEditor';
import {EquipmentSearch,WarehouseItemCard} from './WarehouseEquipmentPicker';
import {componentQuantity,calculateWarehouseStage,warehouseStageTitle,stageRootQuantity,stageLinkGroups,stageLinksFor,type WarehouseStageCatalog,type WarehouseStageSnapshot,type StageLink,type StageEquipment,type StageRoot} from '@/lib/CRM/Offers/modularProduct';
import {loadStageEquipment,type WarehouseEquipmentRow} from '@/lib/CRM/Offers/warehouseStageLoader';
const field='mt-1 w-full min-w-0 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
const action='rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40';
const basisLabels={decks:'Blaty 1 × 2 m — z wymiarów podestu',manual:'Ilość wybierana w ofercie',fixed:'Stała ilość na cały zestaw',area:'Powierzchnia podestu (m²)',edge:'Długość wysłony (m)',sides:'Liczba wysłanianych boków'};
export function WarehouseStageEditor({value,onChange,readOnly=false,disabled=false,moduleKind='stage'}:{value:WarehouseStageCatalog;moduleKind?:'stage'|'led';onChange:(v:WarehouseStageCatalog)=>void;readOnly?:boolean;disabled?:boolean;seller?:boolean}){
 const [rootItems,setRootItems]=useState<Record<string,WarehouseEquipmentRow>>({}),[rootError,setRootError]=useState(''),[revision,setRevision]=useState(0);
 const [picker,setPicker]=useState<string|null>(null);
 const key=JSON.stringify(value.roots.map(r=>r.equipment_id));
 // Resolve root identity independently: a broken dependency must not hide the chosen product.
 useEffect(()=>{let active=true;setRootError('');const ids=value.roots.map(r=>r.equipment_id);if(!ids.length){setRootItems({});return;}supabase.from('equipment_items').select('id,name,rental_price_per_day,thumbnail_url').in('id',ids).is('deleted_at',null).then(({data,error})=>{if(!active)return;if(error)setRootError('Nie udało się pobrać nazw wybranego sprzętu.');else setRootItems(Object.fromEntries((data||[]).map(r=>[r.id,r])));});return()=>{active=false;};},[key,revision]);
 const patch=(id:string,v:Partial<StageRoot>)=>onChange({...value,roots:value.roots.map(r=>r.id===id?{...r,...v}:r)});
 const main=value.roots.find(r=>r.basis==='decks');
 const pick=(item:WarehouseEquipmentRow)=>{
  setRootItems(old=>({...old,[item.id]:item}));
  if(picker==='main'){if(main)patch(main.id,{equipment_id:item.id});else onChange({...value,roots:[{id:crypto.randomUUID(),equipment_id:item.id,basis:'decks',quantity:1,required:true},...value.roots]});}
  else if(picker==='extra')onChange({...value,roots:[...value.roots,{id:crypto.randomUUID(),equipment_id:item.id,basis:'fixed',quantity:1,required:false}]});
  else if(picker)patch(picker,{equipment_id:item.id});
  setPicker(null);
 };
 const showPicker=(id:string)=><div className="space-y-2"><div className="flex justify-end"><button type="button" className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-xs leading-4 hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20" aria-label="Anuluj wybór komponentu" onClick={()=>setPicker(null)}><X size={14} aria-hidden="true"/>Anuluj</button></div><EquipmentSearch exclude={value.roots.filter(r=>id==='main'?r.id!==main?.id:r.id!==id).map(r=>r.equipment_id)} onPick={pick}/></div>;
 return <fieldset disabled={disabled} className="min-w-0 space-y-4">
  <p className="text-sm opacity-75">Wybierz komponent główny i dodatkowe komponenty z magazynu. W menu trzech kropek dodasz zagnieżdżenia lub usuniesz elementy. Strzałka rozwija i zwija ich szczegóły.</p>
  {rootError&&<p role="alert" className="text-red-200">{rootError}</p>}
  <section className="space-y-3 rounded-xl bg-white/[0.025] p-3"><h3 className="text-sm font-medium">Komponent główny</h3>
   {main?<ComponentDependencyEditor moduleKind={moduleKind} key={main.equipment_id} equipmentId={main.equipment_id} groups={value.component_groups||{}} onChange={component_groups=>onChange({...value,component_groups})} readOnly={readOnly} disabled={disabled} rootIds={value.roots.map(r=>r.equipment_id)} defaultExpanded={false}
    header={<WarehouseItemCard compact item={rootItems[main.equipment_id]} id={main.equipment_id} summary={moduleKind==='led'?"Kafelek 50 × 50 cm · ilość z sekcji ekranu":"Moduł 1 × 2 m · ilość z wymiarów podestu"}/>}
    actions={[
     {label:'Zmień komponent główny',icon:<RefreshCw size={16}/>,onClick:()=>setPicker('main')},
     {label:'Dodaj komponent dodatkowy',icon:<Plus size={16}/>,disabled:value.roots.length>=30,onClick:()=>setPicker('extra')},
     {label:'Usuń komponent główny',icon:<Trash2 size={16}/>,variant:'danger',onClick:()=>{onChange({...value,roots:value.roots.filter(r=>r.id!==main.id)});setPicker(null);}},
    ]}>
   </ComponentDependencyEditor>:!readOnly?<button type="button" className={action} onClick={()=>setPicker('main')}>Wybierz komponent główny</button>:<p className="text-sm">Nie wybrano komponentu głównego.</p>}
   {!readOnly&&picker==='main'&&showPicker('main')}
  </section>
  <section className="space-y-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Komponenty dodatkowe</h3>{!readOnly&&<button type="button" className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs leading-4 bg-[#d3bb73] text-[#211018] hover:bg-[#dfca8b] focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20 disabled:opacity-40" disabled={disabled||value.roots.length>=30} aria-label="Dodaj komponent dodatkowy" onClick={()=>setPicker('extra')}><Plus size={13} aria-hidden="true"/>Dodaj</button>}</div><p className="text-xs opacity-65">Każdy komponent wskazuje sprzęt z magazynu. Ustal jego przelicznik i dodaj własne zagnieżdżenia, jeśli potrzebuje innych elementów.</p>
   {value.roots.filter(r=>r.basis!=='decks').map(r=><div key={r.id} className="space-y-3 rounded-xl bg-white/[0.025] p-3">
    <ComponentDependencyEditor moduleKind={moduleKind} key={r.equipment_id} equipmentId={r.equipment_id} groups={value.component_groups||{}} onChange={component_groups=>onChange({...value,component_groups})} readOnly={readOnly} disabled={disabled} rootIds={value.roots.map(r=>r.equipment_id)}
     header={<WarehouseItemCard compact item={rootItems[r.equipment_id]} id={r.equipment_id} summary={<>{Number.isFinite(r.quantity)?r.quantity.toLocaleString('pl-PL'):'Uzupełnij ilość'} × {r.basis==='area'?'na m²':r.basis==='fixed'?'na cały produkt':basisLabels[r.basis]} · {r.required?'Wymagane':'Opcjonalne'}</>}/>}
     actions={[
      {label:'Zmień wybrany sprzęt',icon:<RefreshCw size={16}/>,onClick:()=>setPicker(r.id)},
      {label:'Usuń komponent',icon:<Trash2 size={16}/>,variant:'danger',onClick:()=>{onChange({...value,roots:value.roots.filter(x=>x.id!==r.id)});setPicker(null);}},
     ]}
     editor={<>
     <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Jak naliczać wybrany element<select disabled={readOnly} className={field} value={r.basis} onChange={e=>patch(r.id,{basis:e.target.value as StageRoot['basis']})}><option value="fixed">Na cały zestaw</option><option value="area">Na m² powierzchni</option>{moduleKind==='led'&&<option value="manual">Ilość wybierana w ofercie</option>}{!(moduleKind==='led'?['fixed','area','manual']:['fixed','area']).includes(r.basis)&&<option value={r.basis}>{basisLabels[r.basis]} — zapisane wcześniej</option>}</select></label><label className="text-sm">{r.basis==='area'?'Ilość jednostek magazynowych na 1 m²':'Ilość elementów na cały zestaw'}<input disabled={readOnly} className={field} type="number" min="0.01" max="1000" step="0.01" value={Number.isFinite(r.quantity)?r.quantity:''} onChange={e=>patch(r.id,{quantity:e.target.value===''?NaN:Number(e.target.value)})}/></label><label className="flex items-center gap-2 text-sm"><input disabled={readOnly} type="checkbox" checked={r.required} onChange={e=>patch(r.id,{required:e.target.checked})}/>Zawsze uwzględniaj ten element</label></div>
     <p className="text-xs text-[#d3bb73]">{r.basis==='area'?'Cena = powierzchnia podestu × przelicznik × cena rentalna wybranego sprzętu.':'Cena = liczba wybranych elementów × ich cena rentalna.'}</p>
     {r.basis==='area'&&<p className="text-xs opacity-65">Wybierz pozycję magazynową wycenianą za m², np. „Pokrycie podestu dywanem — m²”.</p>}
    </>}/>
    {!readOnly&&picker===r.id&&showPicker(r.id)}
   </div>)}
   {!readOnly&&picker==='extra'&&showPicker('extra')}
  </section>

  <p className="text-xs opacity-65">{moduleKind==='led'?'Po zmianie drzewa wybierz „Zapisz powiązania LED”.':'Kompletne zmiany komponentów i przeliczników zapisują się automatycznie. Przed odświeżeniem poczekaj na komunikat „Zapisano”.'}</p>
 </fieldset>;
}

export function SelectionTree({value,id,path,q,ancestors=[],onChange,seller=false,heightDriven=false}:{value:WarehouseStageSnapshot;id:string;path:string;q:number;ancestors?:string[];seller?:boolean;heightDriven?:boolean;onChange:(v:WarehouseStageSnapshot)=>void}){
 const n=value.equipment?.[id];if(!n||ancestors.includes(id)||ancestors.length>=8)return null;const p=value.selection;
 return <div className="space-y-3 rounded-lg bg-black/10 p-3">
  <p className="text-sm">{n.name} · {q} · {n.rate==null?'Do wyceny':`${n.rate.toFixed(2)} zł netto`} {!seller&&<a href={`/crm/equipment/${id}`} target="_blank" rel="noreferrer" className="ml-2 text-xs text-[#d3bb73]">Karta sprzętu / cena</a>}</p>
  {stageLinkGroups(stageLinksFor(value,n)).map(g=>{
   const key=path+'/'+g.key,automatic=heightDriven&&isHeightChoice(g)&&g.required;
   const selected=g.choice?g.links.filter(l=>l.id===p.choices[key]):g.required||p.enabled[key]?g.links:[];
   return <div key={key} className="ml-3 space-y-2 border-l border-white/5 pl-3">
    {automatic?<p className="text-sm text-[#d3bb73]">{g.label}: {selected.length?`${value.equipment?.[selected[0].equipment_id]?.name||'Wybrany komponent'} — dobrano do ${p.height} cm`:'Brak pasującego wariantu. Wybierz dostępną wysokość powyżej.'}</p>
    :g.choice?<label className="block text-sm">{g.label} — {g.required?'wybierz jeden wariant (wymagane)':'opcjonalnie'}<select className={field} value={p.choices[key]||''} onChange={e=>onChange({...value,selection:{...p,choices:{...p.choices,[key]:e.target.value}}})}><option value="">{g.required?'Wybierz…':'Bez dodatku'}</option>{g.links.map(l=><option key={l.id} value={l.id}>{value.equipment?.[l.equipment_id]?.name||'Niedostępny sprzęt'} · {l.quantity} {l.mode==='per_item'?'na sztukę':l.mode==='per_batch'?`na każde ${l.per_quantity} szt.`:'na cały zestaw'}{l.min_height!=null||l.max_height!=null?` · ${l.min_height??'—'}–${l.max_height??'—'} cm`:''}</option>)}</select></label>
    :!g.required?<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.enabled[key]} onChange={e=>onChange({...value,selection:{...p,enabled:{...p.enabled,[key]:e.target.checked}}})}/>{value.equipment?.[g.links[0].equipment_id]?.name} — opcjonalnie</label>:<p className="text-xs opacity-65">Wymagana zależność</p>}
    {selected.map(l=><SelectionTree key={l.id} value={value} id={l.equipment_id} path={path+'/'+l.id} q={componentQuantity(l,q)} ancestors={[...ancestors,id]} onChange={onChange} seller={seller} heightDriven={heightDriven}/>)}
   </div>;
  })}
 </div>;
}
export default function WarehouseStageConfigurator({value,onChange,disabled=false,seller=false}:{value:WarehouseStageSnapshot;onChange:(v:WarehouseStageSnapshot)=>void;disabled?:boolean;seller?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const current=useRef(value),callback=useRef(onChange);current.current=value;callback.current=onChange;const [retry,setRetry]=useState(0);
 const catalogKey=JSON.stringify(value.catalog);const shouldLoad=!seller&&!value.equipment;
 useEffect(()=>{if(!shouldLoad)return;let active=true;setBusy(true);setError('');const snapshot=current.current;loadStageEquipment(snapshot.catalog).then(equipment=>{if(active&&JSON.stringify(current.current.catalog)===catalogKey)callback.current({...current.current,equipment,loaded_at:new Date().toISOString()});}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[shouldLoad,catalogKey,retry]);
 const refresh=async()=>{if(busy)return;setBusy(true);setError('');const before=current.current;try{const equipment=await loadStageEquipment(before.catalog);for(const n of Object.values(equipment))n.name_en=before.equipment?.[n.id]?.name_en||'';if(JSON.stringify(current.current.catalog)!==JSON.stringify(before.catalog))return;onChange({...current.current,equipment,loaded_at:new Date().toISOString()});}catch(e){setError(e instanceof Error?e.message:'Nie udało się pobrać sprzętu.');}finally{setBusy(false);}};
 const change=(next:WarehouseStageSnapshot)=>onChange(selectStageHeight(next));
 const p=value.selection,result=calculateWarehouseStage(value);if(seller)result.error ||= missingSellerConfigurationRate({version:1,base_unit_price:0,addons:[],modular:value},[]);const patch=(v:Partial<typeof p>)=>change({...value,selection:{...p,...v}});
 const heightOptions=useMemo(()=>stageHeightOptions(value),[value.equipment,value.catalog,value.selection.choices,value.selection.enabled]);
 useEffect(()=>{
  if(disabled)return;
  const next=selectStageHeight(value);
  if(next!==value)callback.current(next);
 },[value,disabled]);
 const heightControl=<div className="space-y-1">
  <label className="block max-w-xs text-sm">Wysokość podestu (cm)
   <input type="number" min={1} max={200} step="1" className={field} value={Number.isFinite(p.height)?p.height:''}
    placeholder="Np. 60" onChange={e=>patch({height:e.target.value===''?NaN:Number(e.target.value)})}/>
  </label>
  <p className="text-xs opacity-70">Najpierw wpisz wysokość. Nogi z uzupełnionymi zakresami dobierzemy automatycznie; liczbę sztuk i cenę wyliczymy z rozmiaru podestu.</p>
  {value.equipment&&<div aria-live="polite" className="space-y-2 pt-2">
   <p className="text-sm text-[#d3bb73]">{heightOptions.length?(heightOptions.some(r=>p.height>=r.min&&p.height<=r.max)?'Dostępne wysokości dla tego wyposażenia:':'Ta wysokość nie pasuje do wyposażenia. Wybierz jedną z dostępnych:'):'Brak pełnych danych do automatycznego doboru. Opiekun musi sprawdzić zakresy wysokości komponentów.'}</p>
   <div className="flex flex-wrap gap-2">{heightOptions.map(r=><button type="button" key={r.min} className={action} onClick={()=>patch({height:Number.isFinite(p.height)?Math.min(r.max,Math.max(r.min,Math.round(p.height))):r.min})}>{r.min===r.max?`${r.min} cm`:`${r.min}–${r.max} cm`}</button>)}</div>
  </div>}
 </div>;
 return <fieldset disabled={disabled||busy} className="min-w-0 space-y-4 rounded-xl bg-white/[0.035] p-4">
  <h3 className="font-medium">{warehouseStageTitle(value)}</h3>
  {heightControl}
  <div className="flex flex-wrap gap-2">{[[2,1],[4,2],[6,3],[8,4]].map(([width,depth])=><button type="button" className={action} key={width} onClick={()=>patch({width,depth})}>{width} × {depth} m</button>)}</div>
  <StageModuleGrid width={p.width} depth={p.depth} onChange={size=>patch(size)}/>
  {busy&&<p role="status" className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true"/>Pobieranie sprzętu, zależności i cen rentalnych…</p>}
  {error&&<div role="alert" className="text-sm text-red-200">{error} <button type="button" className={action} onClick={()=>value.equipment?void refresh():setRetry(n=>n+1)}>Spróbuj ponownie</button></div>}
  {value.catalog.roots.some(r=>r.basis==='edge'||r.basis==='sides')&&<label className="block text-sm">Zakres wysłony<select className={field} value={p.skirt} onChange={e=>patch({skirt:e.target.value as typeof p.skirt})}><option value="front_sides">Front i dwa boki</option><option value="all">Wszystkie cztery boki</option></select></label>}
  {value.catalog.roots.map(r=><section key={r.id} className="space-y-2">
   <p className="text-sm font-medium">{r.basis==='decks'?'Blaty i dobrane wyposażenie':value.equipment?.[r.equipment_id]?.name||'Pobieranie wybranego sprzętu…'}</p>
   {!r.required&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.enabled['root:'+r.id]} onChange={e=>patch({enabled:{...p.enabled,['root:'+r.id]:e.target.checked}})}/>{value.equipment?.[r.equipment_id]?.name||'Dodatek'} — opcjonalnie</label>}
   {(r.required||p.enabled['root:'+r.id])&&<>
    {r.basis==='manual'&&<label className="block text-sm">Ilość na cały zestaw<input type="number" className={field} min="0.01" step="0.01" value={Number.isFinite(p.quantities[r.id])?p.quantities[r.id]:''} onChange={e=>patch({quantities:{...p.quantities,[r.id]:e.target.value===''?NaN:Number(e.target.value)}})}/></label>}
    <SelectionTree value={value} id={r.equipment_id} path={r.id} q={stageRootQuantity(value,r)} onChange={change} seller={seller} heightDriven/>
   </>}
  </section>)}
  {!seller&&value.equipment&&<>
   <button type="button" className={action} onClick={()=>void refresh()}>Pobierz aktualny sprzęt i ceny rentalne</button>
   <p className="text-xs opacity-65">Pobrano: {value.loaded_at?new Date(value.loaded_at).toLocaleString('pl-PL'):'—'}. Ponowne pobranie zmieni stawki i dostępne warianty w tej edycji. Zapisane oferty zachowują własną kopię.</p>
   <details><summary className="cursor-pointer text-sm text-[#d3bb73]">Nazwy angielskie do PDF</summary><div className="space-y-2 pt-3">{Object.values(value.equipment).map(n=><label className="block text-sm" key={n.id}>{n.name}<input className={field} value={n.name_en} maxLength={300} placeholder="Angielska nazwa wyposażenia" onChange={e=>onChange({...value,equipment:{...value.equipment,[n.id]:{...n,name_en:e.target.value}}})}/></label>)}</div></details>
  </>}
  {result.error&&<p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{result.error}</p>}
  <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th>Składniki</th><th>Ilość</th><th>{seller?'Twoja stawka netto':'Stawka rentalna netto'}</th><th>Razem netto</th></tr></thead><tbody>{result.lines.map(l=><tr key={l.key}><td className="py-2 pr-2">{l.name}</td><td>{l.quantity} {l.unit}</td><td>{seller&&result.error?'Do wyceny':l.rate==null?'Do wyceny':l.rate.toFixed(2)}</td><td>{seller&&result.error?'—':l.total.toFixed(2)}</td></tr>)}</tbody></table></div>
  <p className="text-right font-medium text-[#d3bb73]">{result.error?'Uzupełnij konfigurację':`${result.total.toFixed(2)} zł netto / podest / dzień`}</p>
  <p className="text-xs opacity-65">Ilość podestów i dni w ofercie mnoży cenę całego zestawu. PDF pokazuje rozmiar, wyposażenie i cenę podestu; stawki części pozostają wewnętrzne.</p>
 </fieldset>;
}
