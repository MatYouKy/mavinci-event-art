'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase/browser';
import type {WarehouseEquipmentRow} from '@/lib/CRM/Offers/warehouseStageLoader';
const field='mt-1 w-full min-w-0 rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
export function EquipmentSearch({onPick,exclude=[]}:{onPick:(row:WarehouseEquipmentRow)=>void;exclude?:string[]}){
 const [search,setSearch]=useState(''),[items,setItems]=useState<WarehouseEquipmentRow[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  setItems([]);setError('');
  const terms=search.trim().replace(/[%_*]/g,'').split(/\s+/).filter(Boolean);
  if(terms.join(' ').length<2){setLoading(false);return;}
  setLoading(true);
  const timer=setTimeout(async()=>{
   try{
    let query=supabase.from('equipment_items').select('id,name,brand,model,rental_price_per_day,thumbnail_url').is('deleted_at',null);
    for(const term of terms){
     const pattern=JSON.stringify(`%${term}%`);
     query=query.or(`name.ilike.${pattern},model.ilike.${pattern},brand.ilike.${pattern}`);
    }
    const {data,error}=await query.order('name').limit(30);
    if(!active)return;
    if(error)setError('Nie udało się wyszukać sprzętu.');else setItems(data||[]);
   }catch{if(active)setError('Nie udało się wyszukać sprzętu.');}
   finally{if(active)setLoading(false);}
  },250);
  return()=>{active=false;clearTimeout(timer);};
 },[search]);
 return <div><label className="text-sm">Wyszukaj sprzęt z magazynu<input className={field} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nazwa, model lub producent — minimum 2 znaki"/></label>{loading&&<p className="text-xs">Wyszukiwanie…</p>}{error&&<p role="alert" className="text-red-200">{error}</p>}<div className="max-h-52 overflow-y-auto">{items.filter(i=>!exclude.includes(i.id)).map(i=><button type="button" className="block w-full rounded-lg p-2 text-left text-sm hover:bg-white/5" key={i.id} onClick={()=>{onPick(i);setSearch('');setItems([]);}}><span className="flex items-center gap-2">{i.thumbnail_url&&<img src={i.thumbnail_url} alt="" loading="lazy" className="h-10 w-10 rounded object-cover"/>}<span>{i.name}{(i.brand||i.model)&&<span className="block text-xs opacity-60">{[i.brand,i.model].filter(Boolean).join(' · ')}</span>} · {i.rental_price_per_day===null?'brak ceny rentalnej':`${Number(i.rental_price_per_day).toFixed(2)} zł netto / dzień`}</span></span></button>)}</div></div>;
}
export function WarehouseItemCard({item,id,compact=false,summary}:{item?:WarehouseEquipmentRow;id:string;compact?:boolean;summary?:ReactNode}){
 const [imageError,setImageError]=useState(false);
 useEffect(()=>setImageError(false),[item?.thumbnail_url]);
 if(compact)return <div className="flex min-w-0 items-center gap-2 py-1">
  {item?.thumbnail_url&&!imageError?<img src={item.thumbnail_url} alt="" loading="lazy" decoding="async" className="h-10 w-10 shrink-0 rounded object-cover" onError={()=>setImageError(true)}/>:<div className="h-10 w-10 shrink-0 rounded bg-white/5"/>}
  <div className="min-w-0"><a className="text-sm font-medium hover:text-[#d3bb73]" href={`/crm/equipment/${id}`} target="_blank" rel="noreferrer" title="Otwórz pozycję magazynową">{item?.name||'Pobieranie nazwy sprzętu…'}</a>
   {summary&&<div className="text-xs opacity-75">{summary}</div>}
   {item?.rental_price_per_day===null&&<p className="text-xs text-amber-200">Brak ceny rentalnej</p>}
  </div>
 </div>;
 return <div className="flex items-center gap-3 rounded-lg bg-black/10 p-3">
  {item?.thumbnail_url&&!imageError?<img src={item.thumbnail_url} alt={item.name} loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-lg object-cover" onError={()=>setImageError(true)}/>:<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xs opacity-50">Sprzęt</div>}
  <div className="min-w-0"><p className="text-sm font-medium">{item?.name||'Pobieranie nazwy wybranego sprzętu…'}</p>
   <p className="mt-1 text-xs opacity-70">{item?item.rental_price_per_day===null?'Brak ceny rentalnej w magazynie':`${Number(item.rental_price_per_day).toFixed(2)} zł netto / jednostkę / dzień`:'Cena zostanie pobrana z magazynu.'}</p>
   <a className="mt-1 inline-block text-xs text-[#d3bb73]" href={`/crm/equipment/${id}`} target="_blank" rel="noreferrer">Otwórz tę pozycję magazynową</a>
  </div>
 </div>;
}
