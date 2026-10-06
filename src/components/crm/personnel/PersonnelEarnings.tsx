 'use client';
import { useCallback,useEffect,useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { type PersonnelWork,type PersonnelSettlement,localMonth,nextMonth,workAmounts,personnelDate as date,personnelMoney as money,personnelInput as input,personnelButton as button } from '@/lib/personnel/workspace';
type ContractOption={id:string;contract_number:string;start_date:string|null;end_date:string|null};
async function employeeContracts(employeeId:string):Promise<ContractOption[]> {
 const person=await supabase.from('personnel_people').select('id').eq('employee_id',employeeId).maybeSingle();if(person.error)throw person.error;
 let query=supabase.from('personnel_contracts').select('id,contract_number,start_date,end_date').neq('status','draft').order('start_date',{ascending:false});
 query=person.data?query.or(`employee_id.eq.${employeeId},person_id.eq.${person.data.id}`):query.eq('employee_id',employeeId);
 const {data,error}=await query;if(error)throw error;return data||[];
}
export function PersonnelTimeContractPicker({employeeId,value,onChange}:{employeeId:string;value:string;onChange:(id:string)=>void}) {
 const [options,setOptions]=useState<ContractOption[]>([]),[error,setError]=useState('');
 useEffect(()=>{let live=true;employeeContracts(employeeId).then(rows=>{if(live)setOptions(rows);}).catch(()=>{if(live)setError('Nie udało się pobrać umów.');});return()=>{live=false;};},[employeeId]);
 return <label className="block text-sm">Umowa do rozliczenia<select className={input} value={value} onChange={e=>onChange(e.target.value)}><option value="">Dobierz automatycznie według daty pracy</option>{options.map(c=><option key={c.id} value={c.id}>{c.contract_number} · {date(c.start_date)} – {c.end_date?date(c.end_date):'bezterminowo'}</option>)}</select>{error&&<span className="text-xs text-amber-200">{error}</span>}</label>;
}
export function PersonnelEarnings({employeeId,refreshKey=0}:{employeeId:string;refreshKey?:number}) {
 const [month,setMonth]=useState(localMonth),[contracts,setContracts]=useState<ContractOption[]>([]),[items,setItems]=useState<PersonnelWork[]>([]),[settlements,setSettlements]=useState<PersonnelSettlement[]>([]);
 const [unlinked,setUnlinked]=useState<{id:string;title:string|null;start_time:string;duration_minutes:number}[]>([]),[selected,setSelected]=useState<Record<string,string>>({}),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');try{
  const options=await employeeContracts(employeeId);setContracts(options);
  if(options.length){const ids=options.map(c=>c.id);const all:PersonnelWork[]=[];for(let from=0;;from+=500){const{data,error}=await supabase.from('personnel_work_items').select('*').in('contract_id',ids).gte('work_date',month+'-01').lt('work_date',nextMonth(month)).order('source').order('id').range(from,from+499);if(error)throw error;all.push(...data as PersonnelWork[]);if(data.length<500)break;}setItems(all);
   const{data,error}=await supabase.from('personnel_settlement_balances').select('*').in('contract_id',ids).eq('period',month+'-01');if(error)throw error;setSettlements(data||[]);
  }else{setItems([]);setSettlements([]);}
  const start=new Date(month+'-01T00:00:00').toISOString(),end=new Date(nextMonth(month)+'T00:00:00').toISOString();
  const{data,error}=await supabase.from('time_entries').select('id,title,start_time,duration_minutes').eq('employee_id',employeeId).is('personnel_contract_id',null).not('end_time','is',null).gte('start_time',start).lt('start_time',end).order('start_time',{ascending:false}).limit(100);if(error)throw error;setUnlinked(data||[]);
 }catch(e:any){setError(e.message||'Nie udało się pobrać wynagrodzenia.');}finally{setLoading(false);}},[employeeId,month]);
 useEffect(()=>{setItems([]);setSettlements([]);setSelected({});void load();},[load,refreshKey]);
 const assign=async(id:string)=>{if(busy||!selected[id])return;setBusy(id);setError('');try{const{error}=await supabase.rpc('assign_personnel_time',{p_entry:id,p_contract:selected[id]});if(error)throw error;await load();}catch(e:any){setError(e.message);}finally{setBusy('');}};
 const totals=workAmounts(items);
 return <section className="space-y-4 rounded-xl bg-white/[0.035] p-5 text-[var(--brand-platinum)]">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg">Wynagrodzenie z umów</h2><p className="mt-1 text-xs opacity-60">Naliczenia za wykonaną pracę oraz zatwierdzone wypłaty.</p></div><input aria-label="Miesiąc wynagrodzenia" type="month" className={`${input} !w-auto`} value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></div>
  {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
  {loading?<p className="text-sm opacity-60">Ładowanie…</p>:<>
   <div className="flex flex-wrap gap-5">{Object.entries(totals).map(([key,value])=>{const[currency,basis]=key.split(':');return <div key={key}><p className="text-xs opacity-60">Naliczone z godzin i akordu ({basis==='net'?'netto':'brutto'})</p><p className="mt-1 text-xl text-[#d3bb73]">{money(value,currency)}</p></div>;})}{!Object.keys(totals).length&&<p className="text-sm opacity-60">Brak naliczeń z godzin i akordu w tym miesiącu. Stałe wynagrodzenie pojawi się po zatwierdzeniu rozliczenia.</p>}</div>
   {settlements.map(s=><div key={s.id} className="flex flex-wrap justify-between gap-3 rounded-lg bg-white/[0.035] p-3 text-sm"><span>{contracts.find(c=>c.id===s.contract_id)?.contract_number}</span><span>Netto: {money(s.net_amount,s.currency)}</span><span>Wypłacono: {money(s.paid_amount,s.currency)}</span><span>Pozostało: {money(s.remaining_amount,s.currency)}</span></div>)}
   {!!unlinked.length&&<details><summary className="cursor-pointer text-sm text-amber-200">Wpisy bez przypisanej umowy ({unlinked.length}{unlinked.length===100?'+':''})</summary><p className="my-3 text-xs opacity-60">Poniższe godziny nie są ujęte w naliczeniu z umów. Przypisanie dobierze stawkę z dnia pracy.</p><div className="max-h-80 space-y-3 overflow-auto">{unlinked.map(e=><div key={e.id} className="rounded-lg bg-white/[0.025] p-3 text-sm"><p>{new Date(e.start_time).toLocaleDateString('pl-PL')} · {e.title||'Wpis czasu'} · {(e.duration_minutes/60).toFixed(2)} godz.</p><div className="mt-2 flex flex-wrap gap-2"><select aria-label="Przypisz umowę" className={`${input} flex-1`} value={selected[e.id]||''} onChange={v=>setSelected({...selected,[e.id]:v.target.value})}><option value="">Wybierz umowę</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.contract_number}</option>)}</select><button type="button" className={button} disabled={!!busy||!selected[e.id]} onClick={()=>void assign(e.id)}>Przypisz</button></div></div>)}</div></details>}
   <Link className="inline-block text-sm text-[#d3bb73]" href={`/crm/employees/${employeeId}`}>Profil pracownika i umowy →</Link>
  </>}
 </section>;
}
