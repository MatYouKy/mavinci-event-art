'use client';
import {useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
import {supabase} from '@/lib/supabase/browser';
import {ledSectionTotals,type EquipmentSnapshot,type LedSection} from '@/lib/CRM/Offers/modularProduct';
const field='mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
export function LedInventoryNotice({equipmentId,modules}:{equipmentId?:string;modules:number}){
 const [stock,setStock]=useState<number|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setStock(null);setError('');if(!equipmentId)return;
 Promise.all([supabase.from('equipment_items').select('total_quantity').eq('id',equipmentId).is('deleted_at',null).single(),supabase.from('equipment_units').select('id,status').eq('equipment_id',equipmentId)]).then(([item,units])=>{
  if(!active)return;if(item.error||units.error){setError('Nie udało się pobrać stanu modułów.');return;}
  setStock(units.data?.length?units.data.filter(u=>['available','reserved','in_use'].includes(u.status)).length:Math.max(0,Number(item.data?.total_quantity||0)));
 }).catch(()=>{if(active)setError('Nie udało się pobrać stanu modułów.');});return()=>{active=false;};},[equipmentId,revision]);
 if(!equipmentId)return <p className="text-sm text-amber-200">W karcie produktu wskaż moduł magazynowy, aby porównać zapotrzebowanie ze stanem własnego ekranu.</p>;
 const missing=stock===null?0:Math.max(0,modules-stock);
 return <div className={`rounded-lg p-3 text-sm ${missing?'bg-amber-500/10 text-amber-200':'bg-white/5'}`} role="status">{error||stock===null?(error||'Pobieranie stanu modułów…'):`Potrzeba ${modules} modułów · własny magazyn: ${stock}${missing?` · do uzupełnienia rentalem: ${missing} szt.`:' · wystarczająca liczba własnych modułów.'}`}<button type="button" className="ml-3 text-xs underline" onClick={()=>setRevision(n=>n+1)}>Odśwież stan</button><p className="mt-1 text-xs opacity-65">Stan własnego sprzętu, bez odjęcia rezerwacji na termin wydarzenia. Braki nie blokują konfiguracji. Informacja tylko w CRM.</p></div>;
}
function LedSectionGrid({section,onChange}:{section:LedSection;onChange:(v:Partial<LedSection>)=>void}){
 const [extent,setExtent]=useState({columns:12,rows:8});
 const [hover,setHover]=useState<{columns:number;rows:number}|null>(null);
 const bounded=(n:number)=>Number.isFinite(n)?Math.min(200,Math.max(0,Math.ceil(n/2)*2)):0;
 const columns=Math.max(extent.columns,bounded(section.columns)),rows=Math.max(extent.rows,bounded(section.rows));
 const preview=hover||section;
 const expand=(axis:'columns'|'rows')=>{setHover(null);setExtent({columns,rows,[axis]:Math.min(200,(axis==='columns'?columns:rows)+2)});};
 const plusClass='flex h-7 w-7 items-center justify-center rounded-md text-[#d3bb73]/80 hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20';
 return <div className="max-w-full overflow-auto pb-1">
 <div className="relative mx-auto grid w-max gap-1 pr-1" style={{gridTemplateColumns:`2rem repeat(${columns}, 2rem) 2rem`,gridTemplateRows:`1.25rem repeat(${rows}, 2rem) 2rem`}} onMouseLeave={()=>setHover(null)} aria-label={`Siatka: ${section.name}`}>
 <span className="text-right text-[10px] text-white/40" style={{gridColumn:1,gridRow:1}}>0 m</span>
 {Array.from({length:columns/2},(_,i)=><span key={`x-${i}`} className="self-end border-r border-white/10 pr-1 text-right text-[10px] text-white/40" style={{gridColumn:`${i*2+2} / span 2`,gridRow:1}}>{i+1} m</span>)}
 {Array.from({length:rows/2},(_,i)=><span key={`y-${i}`} className="flex items-end justify-end border-b border-white/10 pr-1 text-[10px] text-white/40" style={{gridColumn:1,gridRow:`${i*2+2} / span 2`}}>{i+1} m</span>)}
 {Array.from({length:columns*rows},(_,i)=>{const c=i%columns+1,row=Math.floor(i/columns)+1;return <button type="button" key={`${c}-${row}`} style={{gridColumn:c+1,gridRow:row+1}} className={`rounded-sm ${c<=preview.columns&&row<=preview.rows?'bg-[#d3bb73]/65':'bg-white/[0.07]'} hover:bg-[#d3bb73]/40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/30`} aria-pressed={c<=section.columns&&row<=section.rows} aria-label={`${c} kolumn × ${row} wierszy, ${c/2} × ${row/2} m`} onMouseEnter={()=>setHover({columns:c,rows:row})} onFocus={()=>setHover({columns:c,rows:row})} onBlur={()=>setHover(null)} onClick={()=>{onChange({columns:c,rows:row});setHover(null);}}/>;})}
 {section.columns>=columns&&columns<200&&<button type="button" className={plusClass} style={{gridColumn:columns+2,gridRow:Math.floor(rows/2)+2}} aria-label="Rozszerz siatkę w prawo o 1 metr" title="Rozszerz siatkę w prawo o 1 m" onMouseEnter={()=>setHover(null)} onClick={()=>expand('columns')}><Plus size={16}/></button>}
 {section.rows>=rows&&rows<200&&<button type="button" className={plusClass} style={{gridColumn:Math.floor(columns/2)+2,gridRow:rows+2}} aria-label="Rozszerz siatkę w dół o 1 metr" title="Rozszerz siatkę w dół o 1 m" onMouseEnter={()=>setHover(null)} onClick={()=>expand('rows')}><Plus size={16}/></button>}
 </div></div>;
}
export default function LedSectionsConfigurator({value,onChange,quantity=1,seller=false}:{value:EquipmentSnapshot;onChange:(v:EquipmentSnapshot)=>void;quantity?:number;seller?:boolean}){
 const sections=value.selection.led_sections;
 const commit=(next:LedSection[])=>{let totals;try{totals=ledSectionTotals(next);}catch{onChange({...value,selection:{...value.selection,led_sections:next}});return;}
  const cableId=value.catalog.led_cable_component_id;
  onChange({...value,selection:{...value.selection,led_sections:next,area:totals.area,quantities:{...value.selection.quantities,...(cableId?{[cableId]:totals.cables}:{})}}});
 };
 if(!sections)return <div className="rounded-lg bg-white/5 p-3"><p className="text-sm">Ta konfiguracja ma powierzchnię bez podziału na sekcje.</p><button type="button" className="mt-2 text-sm text-[#d3bb73]" onClick={()=>commit([{id:crypto.randomUUID(),name:'Sekcja 1',columns:2,rows:2}])}>Utwórz układ z sekcji 50 × 50 cm</button><p className="text-xs opacity-65">Rozpocznie od sekcji 1 × 1 m i przeliczy cenę według nowej powierzchni.</p></div>;
 let totals=null;try{totals=ledSectionTotals(sections);}catch{}
 return <div className="space-y-4">
 {sections.map((section,index)=>{const patch=(v:Partial<LedSection>)=>commit(sections.map(s=>s.id===section.id?{...s,...v}:s));return <section key={section.id} className="space-y-3 rounded-xl bg-black/10 p-3">
 <div className="flex items-end gap-3"><label className="flex-1 text-sm">Nazwa sekcji<input className={field} maxLength={100} value={section.name} onChange={e=>patch({name:e.target.value})}/></label><button type="button" disabled={sections.length===1} className="pb-2 text-xs text-red-200 disabled:opacity-30" onClick={()=>commit(sections.filter(s=>s.id!==section.id))}>Usuń</button></div>
 <div className="grid grid-cols-2 gap-3">{(['columns','rows'] as const).map(key=><label key={key} className="text-sm">{key==='columns'?'Szerokość — kolumny':'Wysokość — wiersze'}<input className={field} type="number" min="1" max="200" step="1" value={Number.isFinite(section[key])?section[key]:''} onChange={e=>patch({[key]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}</div>
 <p className="text-xs text-[#d3bb73]">{section.columns/2} × {section.rows/2} m · {section.columns*section.rows} kafelków · {section.columns*section.rows/4} m²</p>
 <LedSectionGrid section={section} onChange={patch}/>
 <p className="text-xs opacity-60">2 kafelki = 1 m. Po wypełnieniu szerokości lub wysokości użyj +, aby rozszerzyć siatkę o kolejny metr. Następnie wybierz większy układ.</p>
 </section>;})}
 <button type="button" disabled={sections.length>=30} className="text-sm text-[#d3bb73]" onClick={()=>commit([...sections,{id:crypto.randomUUID(),name:`Sekcja ${sections.length+1}`,columns:2,rows:2}])}>+ Dodaj sekcję</button>
 {totals&&<><p className="text-sm">Razem: {totals.modules} modułów · {totals.area} m². Skrętki: {totals.signalCables} + 1 zapasowa = {totals.cables} szt. / zestaw.</p>{!seller&&<LedInventoryNotice equipmentId={value.catalog.led_tree?.roots.find(r=>r.basis==='decks')?.equipment_id||value.catalog.led_equipment_id} modules={totals.modules*Math.max(1,quantity)}/>}</>}
 </div>;
}
