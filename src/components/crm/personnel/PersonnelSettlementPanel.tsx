 'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { ContractDateField, isContractDate } from '@/components/crm/invoices/ContractTermFields';
import { type PersonnelRate,type PersonnelWork,type PersonnelSettlement,localMonth,nextMonth,workAmounts,personnelDate as date,personnelMoney as money,personnelInput as input,personnelButton as button,personnelSecondary as secondary } from '@/lib/personnel/workspace';
import { PersonnelPayrollFields,newPayroll,payrollTotals } from './PersonnelPayrollFields';
import { assessQuestionnaire } from '@/lib/personnel/questionnaire';
import { normalizeNetCostSettings } from '@/lib/personnel/netCostEstimate';
import { normalizePayrollProfile } from '@/lib/personnel/legal';
import { statutoryRates,roundMoney } from '@/lib/personnel/legal';
export function PersonnelSettlementPanel({ contractId,contract,rates,readOnly,onChanged,refreshKey=0 }: {contractId:string;contract:any;rates:PersonnelRate[];readOnly:boolean;onChanged?:()=>void;refreshKey?:number}) {
 const [month,setMonth]=useState(localMonth),[items,setItems]=useState<PersonnelWork[]>([]),[settlements,setSettlements]=useState<PersonnelSettlement[]>([]),[events,setEvents]=useState<{id:string;name:string}[]>([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[work,setWork]=useState({date:'',hours:'',quantity:'',description:'',event:''}),[form,setForm]=useState({nominal:'',notes:'',confirmed:false});
 const [payroll,setPayroll]=useState(newPayroll);
 const load=useCallback(async()=>{
  if(!/^\d{4}-\d{2}$/.test(month))return;setLoading(true);
  try{
   const collected:PersonnelWork[]=[];
   for(let from=0;;from+=500){const result=await supabase.from('personnel_work_items').select('*').eq('contract_id',contractId).gte('work_date',month+'-01').lt('work_date',nextMonth(month)).order('source').order('id').range(from,from+499);if(result.error)throw result.error;collected.push(...result.data as PersonnelWork[]);if(result.data.length<500)break;}
   const {data,error}=await supabase.from('personnel_settlement_balances').select('*').eq('contract_id',contractId).order('period',{ascending:false});if(error)throw error;
   setItems(collected);setSettlements(data||[]);
  }finally{setLoading(false);}
 },[contractId,month]);
 useEffect(()=>{setItems([]);setSettlements([]);setForm({nominal:'',notes:'',confirmed:false});setPayroll(newPayroll());setError('');void load().catch(e=>setError(e.message));},[load,refreshKey]);
 useEffect(()=>{if(!readOnly)void supabase.from('events').select('id,name').order('event_date',{ascending:false}).limit(200).then(({data})=>setEvents(data||[]));},[readOnly]);
 const settlement=settlements.find(s=>s.period===month+'-01');
 const periodRates=rates.filter(r=>r.valid_from<nextMonth(month)&&(!r.valid_to||r.valid_to>=month+'-01'));
 const bases=Array.from(new Set(periodRates.map(r=>r.rate_basis))),payBases=Array.from(new Set(periodRates.map(r=>r.pay_basis)));
 const hourly=payBases.length===1&&payBases[0]==='hourly';
 const piecework=payBases.length===1&&payBases[0]==='piecework',automatic=hourly||piecework;
 const minimum=statutoryRates[month.slice(0,4)]?roundMoney(items.reduce((n,w)=>n+Number(w.minutes)/60,0)*statutoryRates[month.slice(0,4)].hourly):null;
 const amounts=workAmounts(items), amount=Object.values(amounts).reduce((a,b)=>a+b,0);
 const act=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();await load();onChanged?.();}catch(e:any){setError(e.message||'Nie udało się zapisać.');}finally{setBusy(false);}};
 const addWork=()=>act(async()=>{
  if(!isContractDate(work.date)||!work.description.trim()||!Number.isFinite(Number(work.hours))||Number(work.hours)<0||Number(work.hours)>24||(!Number(work.hours)&&!(piecework&&Number(work.quantity)>0)))throw new Error('Podaj datę, opis, godziny lub dodatnią liczbę jednostek akordu.');
  const {error}=await supabase.from('personnel_work_entries').insert({contract_id:contractId,event_id:contract.event_id||work.event||null,quantity:piecework&&work.quantity!==''?Number(work.quantity):null,work_date:work.date,minutes:Math.round(Number(work.hours)*60),description:work.description.trim(),rate_snapshot:{}});if(error)throw error;
  setWork({...work,hours:'',quantity:'',description:''});
 });
 const approve=()=>act(async()=>{
  const settings=normalizeNetCostSettings(contract.net_cost_settings);
  const assessment=assessQuestionnaire({kind:contract.contract_kind,profile:normalizePayrollProfile(contract.payroll_profile),settings,partyKind:contract.party_kind,currency:contract.currency});
  if(!contract.payroll_profile?.questionnaire?.confirmed||assessment.issues.length)throw new Error(assessment.issues[0]?.message||'Potwierdź aktualne oświadczenie w kreatorze umowy.');
  if(settings.work_from.slice(0,7)!==month||settings.work_to.slice(0,7)!==month||settings.payment_date!==payroll.payment_date)throw new Error('Zaktualizuj w kreatorze okres pracy, datę wypłaty i oświadczenie dla tego rozliczenia. Nie stosuj założeń z innego miesiąca.');

  if(!form.confirmed||!form.notes.trim()||!payroll.tax_scheme||!isContractDate(payroll.payment_date)||(!automatic&&form.nominal==='')||[payroll.gross,payroll.pit,payroll.social,payroll.health,payroll.other,payroll.employer].some(v=>v===''||!Number.isFinite(Number(v))||Number(v)<0))throw new Error('Uzupełnij datę przychodu, kwoty, sposób opodatkowania i źródło rozliczenia.');
  const totals=payrollTotals(payroll);
  const {error}=await supabase.rpc('approve_personnel_settlement',{p_contract:contractId,p_period:month+'-01',p_nominal:automatic?null:Number(form.nominal),p_net:totals.net,p_cost:totals.cost,p_notes:form.notes,p_expected_work:items,p_payroll:{...payroll,profile:contract.payroll_profile,confirmed:form.confirmed}});if(error)throw error;
 });
 return <section className="space-y-4 rounded-xl bg-white/[0.035] p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-medium">Czas pracy i rozliczenie</h4><label className="text-xs">Miesiąc<input type="month" className={input} value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}}/></label></div>
  {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
  {loading?<p className="text-sm opacity-60">Ładowanie rozliczenia…</p>:<>
   <div className="flex flex-wrap gap-5 rounded-lg bg-white/[0.025] p-3 text-sm"><span>{(items.reduce((s,w)=>s+Number(w.minutes),0)/60).toLocaleString('pl-PL',{maximumFractionDigits:2})} godz.</span>{Object.entries(amounts).map(([key,value])=>{const[currency,basis]=key.split(':');return <span key={key}>Naliczone: {money(value,currency)} {basis==='gross'?'brutto':'netto'}</span>;})}</div>
   <p className="text-xs leading-5 opacity-60">Godziny CRM pobieramy z wpisów powiązanych z tą umową. Godziny współpracowników wpisuje koordynator. Wynagrodzenie nie zależy od oznaczenia „płatne dla klienta”.</p>
   <div className="max-h-64 space-y-2 overflow-auto">{items.map(w=><div key={`${w.source}:${w.id}`} className="flex items-start justify-between gap-2 rounded-lg bg-white/[0.025] p-3 text-xs"><div><p>{date(w.work_date)} · {(Number(w.minutes)/60).toLocaleString('pl-PL',{maximumFractionDigits:2})} godz. · {w.source==='crm'?'Czas CRM':'Wpis koordynatora'}{w.quantity?` · ${w.quantity} ${w.rate_snapshot.unit_label||'jednostek'}`:''}</p><p className="mt-1 opacity-60">{w.description}</p></div>{!readOnly&&!settlement&&w.source==='external'&&<button type="button" className="text-red-200" disabled={busy} onClick={()=>void act(async()=>{const{error}=await supabase.from('personnel_work_entries').delete().eq('id',w.id);if(error)throw error;})}>Usuń</button>}</div>)}</div>
   {!readOnly&&!settlement&&<details><summary className="cursor-pointer text-sm text-[#d3bb73]">Dodaj godziny / jednostki akordu</summary><fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2"><ContractDateField label="Data pracy" value={work.date} onChange={v=>setWork({...work,date:v})}/><label className="text-xs">Liczba godzin<input className={input} type="number" min={piecework?"0":"0.02"} max="24" step="0.01" value={work.hours} onChange={e=>setWork({...work,hours:e.target.value})}/></label>{piecework&&<><label className="text-xs">Liczba jednostek akordu<input className={input} type="number" min="0.001" step="0.001" value={work.quantity} onChange={e=>setWork({...work,quantity:e.target.value})}/></label><p className="text-xs leading-5 opacity-60 sm:col-span-2">Jeśli godziny są już w CRM, dodaj same jednostki z 0 godzin. Jeśli rejestrujesz całą pracę tutaj, podaj jednostki i czas. Nie wpisuj tych samych godzin ponownie.</p></>}<label className="text-xs sm:col-span-2">Wykonana praca<input className={input} value={work.description} onChange={e=>setWork({...work,description:e.target.value})}/></label><label className="text-xs sm:col-span-2">Wydarzenie<select className={input} disabled={!!contract.event_id} value={contract.event_id||work.event} onChange={e=>setWork({...work,event:e.target.value})}><option value="">Koszt ogólny działalności</option>{events.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><button type="button" className={button} onClick={()=>void addWork()}>Zapisz czas</button></fieldset></details>}
   {settlement?<div className="space-y-2 rounded-lg bg-emerald-400/5 p-4 text-sm"><p className="font-medium text-emerald-200">Rozliczenie zatwierdzone</p><p>Netto do wypłaty: {money(settlement.net_amount,settlement.currency)}</p><p>Wypłacono: {money(settlement.paid_amount,settlement.currency)}</p><p>Pozostało: {money(settlement.remaining_amount,settlement.currency)}</p>{settlement.payroll_snapshot&&<details className="text-xs leading-6"><summary className="cursor-pointer">Dane zatwierdzonego rozliczenia</summary><p>Data przychodu: {date(settlement.payroll_snapshot.payment_date)}</p><p>Brutto: {money(settlement.gross_amount||0,settlement.currency)} · PIT: {money(settlement.payroll_snapshot.pit,settlement.currency)}</p><p>Składki społeczne: {money(settlement.payroll_snapshot.social,settlement.currency)} · Zdrowotna: {money(settlement.payroll_snapshot.health,settlement.currency)}</p><p>Inne potrącenia: {money(settlement.payroll_snapshot.other,settlement.currency)} · Obciążenia firmy ponad brutto: {money(settlement.payroll_snapshot.employer,settlement.currency)}</p><p>Ulga dla młodych: {money(settlement.payroll_snapshot.youth_relief||0,settlement.currency)} · Zwolnienie studenta z ZUS: {settlement.payroll_snapshot.student_exempt?'zastosowane':'nie oznaczono'}</p><p>Źródło: {settlement.payroll_snapshot.source}</p></details>}{!readOnly&&<p>Koszt firmy: {money(settlement.company_cost,settlement.currency)}</p>}<p className="text-xs opacity-60">Wypłatę przypisz do tego miesiąca w sekcji „Wypłaty i inne obciążenia”.</p></div>:!readOnly&&<details><summary className="cursor-pointer text-sm text-[#d3bb73]">Zatwierdź rozliczenie miesiąca</summary><p className="mt-3 text-xs leading-5 opacity-65">Przed zatwierdzeniem zaktualizuj kroki kreatora dla tego miesiąca i daty wypłaty. System sprawdzi ważność oświadczenia oraz zgodność zastosowanych zwolnień.</p><fieldset disabled={busy||bases.length!==1||payBases.length!==1} className="mt-3 grid gap-3 sm:grid-cols-2">
    {!automatic&&<label className="text-xs sm:col-span-2">Należność za okres / zlecenie ({bases[0]==='net'?'netto':'brutto'})<input className={input} type="number" min="0" step="0.01" value={form.nominal} onChange={e=>setForm({...form,nominal:e.target.value,confirmed:false})}/><span className="mt-1 block opacity-60">Kwota potwierdzona dla tego okresu, z uwzględnieniem ewentualnego niepełnego miesiąca.</span></label>}
    {automatic&&<p className="text-sm sm:col-span-2">Naliczenie z {piecework?'akordu':'godzin'}: {money(amount,contract.currency)} {bases[0]==='net'?'netto':'brutto'}</p>}
    <PersonnelPayrollFields value={payroll} onChange={v=>{setPayroll(v);setForm({...form,confirmed:false});}} contract={contract} minimum={minimum}/>
    <label className="text-xs sm:col-span-2">Źródło rozliczenia i ustalenia księgowe (wymagane)<textarea className={input} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value,confirmed:false})}/></label><label className="flex items-start gap-2 text-xs leading-5 sm:col-span-2"><input type="checkbox" className="mt-1" checked={form.confirmed} onChange={e=>setForm({...form,confirmed:e.target.checked})}/>Potwierdzam godziny, jednostki, kwoty oraz zastosowane zasady PIT i ZUS na podstawie wskazanego rozliczenia księgowego. Zatwierdzenie zamknie te wpisy i nie utworzy przelewu.</label><button type="button" disabled={!form.confirmed} className={button} onClick={()=>void approve()}>Zatwierdź rozliczenie</button>
   </fieldset>{(bases.length!==1||payBases.length!==1)&&<p className="mt-3 text-xs text-amber-200">Uzupełnij jednoznaczne warunki wynagrodzenia dla tego miesiąca.</p>}</details>}
  </>}
 </section>;
}
