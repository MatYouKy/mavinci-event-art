'use client';
import {missingSellerConfigurationRate} from '@/lib/seller/productSelection';
import {useEffect,useRef,useState} from 'react';
import LedSectionsConfigurator from './LedSectionsConfigurator';
import {SelectionTree} from './WarehouseStageConfigurator';
import {loadStageEquipment} from '@/lib/CRM/Offers/warehouseStageLoader';
import {ledProcessorNotices,calculateModular,ledTreeSnapshot,ledSectionTotals,ledRootQuantity,type EquipmentSnapshot,type WarehouseStageSnapshot} from '@/lib/CRM/Offers/modularProduct';
export default function LedWarehouseConfigurator({value,onChange,disabled=false,quantity=1,seller=false}:{value:EquipmentSnapshot;onChange:(v:EquipmentSnapshot)=>void;disabled?:boolean;quantity?:number;seller?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const current=useRef(value),callback=useRef(onChange);current.current=value;callback.current=onChange;
 const signature=JSON.stringify(value.catalog.led_tree),needsLoad=!seller&&!value.selection.led_equipment;
 useEffect(()=>{if(!needsLoad)return;let active=true;setBusy(true);setError('');
 loadStageEquipment(current.current.catalog.led_tree!,'led').then(equipment=>{if(active&&signature===JSON.stringify(current.current.catalog.led_tree))callback.current({...current.current,selection:{...current.current.selection,led_equipment:equipment,led_loaded_at:new Date().toISOString()}});}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[signature,needsLoad,retry]);
 const graph=ledTreeSnapshot(value),p=value.selection,result=calculateModular(value);if(seller)result.error ||= missingSellerConfigurationRate({version:1,base_unit_price:0,addons:[],modular:value},[]);
 let totals=null;try{totals=ledSectionTotals(p.led_sections||[]);}catch{}
 const updateTree=(next:WarehouseStageSnapshot)=>onChange({...value,selection:{...p,quantities:next.selection.quantities,led_choices:next.selection.choices,led_enabled:next.selection.enabled}});
 return <fieldset disabled={disabled||busy} className="min-w-0 space-y-4 rounded-xl bg-white/[0.035] p-4">
 <LedSectionsConfigurator value={value} onChange={onChange} quantity={quantity} seller={seller}/>
 {totals&&ledProcessorNotices(graph,totals.signalCables).map(notice=><div key={notice.key} role={notice.warning?'alert':'status'} className={`rounded-lg p-3 text-sm ${notice.warning?'bg-amber-500/10 text-amber-200':'bg-white/5'}`}><p className="font-medium">{notice.group}</p><p>{notice.message}</p>{notice.recommendation&&<button type="button" className="mt-2 rounded-md bg-[#d3bb73]/10 px-3 py-2 text-[#d3bb73]" onClick={()=>updateTree({...graph,selection:{...graph.selection,choices:{...graph.selection.choices,[notice.key]:notice.recommendation!.id}}})}>Wybierz {notice.recommendation.name}</button>}{!seller&&notice.warning&&<p className="mt-1 text-xs opacity-70">Informacja tylko w CRM. Możesz kontynuować konfigurację i uwzględnić rental.</p>}</div>)}
 {busy&&<p role="status" className="text-sm">Pobieranie drzewa sprzętu i cen rentalnych…</p>}
 {error&&<p role="alert" className="text-sm text-red-200">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>Ponów</button></p>}
 {graph.catalog.roots.map(root=><section key={root.id} className="space-y-2">
 {!root.required&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!graph.selection.enabled['root:'+root.id]} onChange={e=>updateTree({...graph,selection:{...graph.selection,enabled:{...graph.selection.enabled,['root:'+root.id]:e.target.checked}}})}/>{graph.equipment?.[root.equipment_id]?.name||'Dodatek'} — opcjonalnie</label>}
 {(root.required||graph.selection.enabled['root:'+root.id])&&<>
 {root.basis==='manual'&&root.id!==value.catalog.led_cable_root_id&&<label className="text-sm">Ilość<input className="ml-3 w-24 rounded bg-black/15 px-3 py-2" type="number" min="1" step="1" value={Number.isFinite(p.quantities[root.id])?p.quantities[root.id]:''} onChange={e=>onChange({...value,selection:{...p,quantities:{...p.quantities,[root.id]:e.target.value===''?NaN:Number(e.target.value)}}})}/></label>}
 {totals&&<SelectionTree value={graph} id={root.equipment_id} path={root.id} q={ledRootQuantity(graph,root,totals,value.catalog.led_cable_root_id)} onChange={updateTree} seller={seller}/>}</>}
 </section>)}
 {!seller&&graph.equipment&&<button type="button" className="text-sm text-[#d3bb73]" onClick={()=>onChange({...value,selection:{...p,led_equipment:undefined,led_loaded_at:undefined}})}>Pobierz aktualny sprzęt i ceny rentalne</button>}
 {!seller&&graph.equipment&&<details><summary className="cursor-pointer text-sm text-[#d3bb73]">Nazwy angielskie komponentów</summary>{Object.values(graph.equipment).map(node=><label key={node.id} className="mt-2 block text-xs">{node.name}<input className="ml-2 rounded bg-black/15 px-3 py-2" maxLength={300} value={node.name_en} onChange={e=>onChange({...value,selection:{...p,led_equipment:{...p.led_equipment,[node.id]:{...node,name_en:e.target.value}}}})}/></label>)}</details>}
 {result.error&&<p role="alert" className="text-sm text-amber-200">{result.error}</p>}
 <div className="space-y-1 text-sm">{result.lines.map(line=><p key={line.key} className="flex justify-between gap-3"><span>{line.name} — {line.quantity} {line.unit}</span><span>{seller&&result.error?'Do wyceny':`${line.total.toFixed(2)} zł`}</span></p>)}</div>
 <p className="text-right text-[#d3bb73]">{result.error?'Uzupełnij konfigurację':`${result.total.toFixed(2)} zł netto / zestaw / dzień`}</p>
 </fieldset>;
}
