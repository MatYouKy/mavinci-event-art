 'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { ContractDateField, isContractDate } from '@/components/crm/invoices/ContractTermFields';
import { type PersonnelRate, payBasisLabels, rateBasisLabels, personnelDate as date, personnelMoney as money, personnelInput as input, personnelButton as button, personnelSecondary as secondary } from '@/lib/personnel/workspace';
import { PersonnelPdfPreview } from './PersonnelPdfPreview';
import { buildPersonnelPdf, downloadPersonnelPdf } from '@/lib/personnel/contractPdf';
import type { PersonnelTemplate } from './PersonnelTemplates';
import { estimateNetCost, normalizeNetCostSettings } from '@/lib/personnel/netCostEstimate';
import { assessQuestionnaire } from '@/lib/personnel/questionnaire';
import { normalizePayrollProfile } from '@/lib/personnel/legal';
import { PersonnelSettlementPanel } from './PersonnelSettlementPanel';
type SavedDocument={id:string;version:number;content:string;created_at:string};
export function PersonnelContractDetails({ contractId, readOnly, onChanged, refreshKey=0, hasUnsavedChanges=false }: { contractId: string; readOnly: boolean; onChanged?:()=>void; refreshKey?:number; hasUnsavedChanges?:boolean }) {
  const [rates,setRates]=useState<PersonnelRate[]>([]),[documents,setDocuments]=useState<SavedDocument[]>([]),[templates,setTemplates]=useState<PersonnelTemplate[]>([]);
  const [contract,setContract]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(''),[preview,setPreview]=useState<SavedDocument|null>(null);
  const [form,setForm]=useState({from:'',to:'',basis:'hourly',rateBasis:'gross',rate:'',cost:'',unit:''});
  const load=useCallback(async()=>{
    const results=await Promise.all([
      supabase.from('personnel_contracts').select('*').eq('id',contractId).single(),
      supabase.from('personnel_contract_rates').select('*').eq('contract_id',contractId).order('valid_from'),
      supabase.from('personnel_contract_documents').select('id,version,content,created_at').eq('contract_id',contractId).order('version',{ascending:false}),
      readOnly?Promise.resolve({data:[],error:null}):supabase.from('personnel_contract_templates').select('*').eq('is_active',true).order('name'),
    ]);
    const failure=results.find(r=>r.error)?.error;if(failure)throw failure;
    const c=results[0].data;setContract(c);setRates((results[1].data||[]) as PersonnelRate[]);setDocuments((results[2].data||[]) as SavedDocument[]);setTemplates((results[3].data||[]) as PersonnelTemplate[]);
    setForm(f=>({...f,from:f.from||c.start_date||'',to:f.to||c.end_date||''}));
  },[contractId,readOnly]);
  useEffect(()=>{setForm({from:'',to:'',basis:'hourly',rateBasis:'gross',rate:'',cost:'',unit:''});setPreview(null);setError('');void load().catch(e=>setError(e.message));},[load,refreshKey]);
  const useNetPlan=()=>{
    const settings=normalizeNetCostSettings(contract.net_cost_settings);
    const amount=Number(contract.planned_net_amount);
    const estimate=estimateNetCost(amount,settings,{kind:contract.contract_kind,profile:normalizePayrollProfile(contract.payroll_profile),currency:contract.currency,partyKind:contract.party_kind});
    if(estimate.issue||!estimate.breakdown){setError(estimate.issue||'Uzupełnij kreator przed przeniesieniem planu.');return;}
    const divisor=['hourly','piecework'].includes(settings.basis)?Number(settings.quantity):1;
    setForm(f=>({...f,basis:settings.basis,rateBasis:contract.contract_kind==='employment'?'gross':'net',rate:String(contract.contract_kind==='employment'?estimate.breakdown!.gross:amount),cost:estimate.breakdown&&divisor>0?String(Math.round(estimate.breakdown.company/divisor*100)/100):''}));
    setError(estimate.issue?`Przeniesiono kwotę netto. Koszt firmy pozostawiono pusty: ${estimate.issue}`:'');
  };
  const addRate=async()=>{
    if(busy)return;setBusy(true);setError('');try{
      if(!isContractDate(form.from)||(form.to&&!isContractDate(form.to)))throw new Error('Podaj prawidłowe daty stawki.');
      if(!form.rate || !Number.isFinite(Number(form.rate)) || Number(form.rate)<=0)throw new Error('Podaj dodatnią stawkę.');
      const {error}=await supabase.rpc('add_personnel_rate',{p_contract_id:contractId,p_from:form.from,p_to:form.to||null,p_basis:form.basis,p_rate_basis:form.rateBasis,p_rate:Number(form.rate),p_company_cost:form.cost===''?null:Number(form.cost),p_unit_label:form.basis==='piecework'?form.unit:null});if(error)throw error;await load();onChanged?.();
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const generate=async()=>{if(busy)return;setBusy(true);setError('');try{
    const {data,error}=await supabase.rpc('generate_personnel_document',{p_contract:contractId,p_template:selected});if(error)throw error;await load();
    const result=await supabase.from('personnel_contract_documents').select('id,version,content,created_at').eq('id',data).single();if(result.error)throw result.error;setPreview(result.data);onChanged?.();
  }catch(e:any){setError(e.message);}finally{setBusy(false);}};
  const removeRate=async(id:string)=>{if(busy)return;setBusy(true);setError('');try{const{error}=await supabase.rpc('remove_personnel_rate',{p_rate:id});if(error)throw error;await load();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  const download=async(doc:SavedDocument)=>{setBusy(true);setError('');try{
    const blob=await buildPersonnelPdf(doc.content,{title:contract?.contract_number||'Umowa'});
    downloadPersonnelPdf(blob,`${contract?.contract_number||'umowa'}_v${doc.version}`);
  }catch(e:any){setError(e.message||'Nie udało się pobrać PDF.');}finally{setBusy(false);}};
  if(!contract)return <div className="text-sm">{error||'Ładowanie warunków…'}</div>;
  const questionnaire=assessQuestionnaire({kind:contract.contract_kind,profile:normalizePayrollProfile(contract.payroll_profile),settings:normalizeNetCostSettings(contract.net_cost_settings),partyKind:contract.party_kind,currency:contract.currency});
  const questionnaireReady=contract.payroll_profile?.questionnaire?.confirmed===true&&!questionnaire.issues.length;
  return <div className="space-y-5 text-[var(--brand-platinum)]">
    {error&&<p role="alert" className="rounded-lg bg-red-400/5 p-3 text-sm text-red-300">{error}</p>}
    <section className="space-y-3 rounded-xl bg-white/[0.035] p-4"><h4 className="font-medium">Warunki wynagrodzenia</h4>
      {rates.length?rates.map(r=><div key={r.id} className="rounded-lg bg-white/[0.035] p-3 text-sm"><p>{money(r.rate,contract.currency)} {rateBasisLabels[r.rate_basis].toLowerCase()} · {payBasisLabels[r.pay_basis]}{r.unit_label?` (${r.unit_label})`:null}</p>{!readOnly && !documents.length && <button type="button" disabled={busy} onClick={()=>void removeRate(r.id)} className="mt-1 text-xs text-[#d3bb73]">Usuń niewykorzystaną stawkę</button>}<p className="mt-1 text-xs opacity-60">{date(r.valid_from)} – {r.valid_to?date(r.valid_to):'bezterminowo'}{r.company_cost_rate!=null?` · Szacowany koszt firmy: ${money(r.company_cost_rate,contract.currency)}`:''}</p></div>):<p className="text-sm opacity-60">Dodaj stawkę obowiązującą dla tej umowy. Umowa o pracę wymaga stawki brutto; wzór dzieła wymaga jednej kwoty za całość.</p>}
      {!readOnly && !documents.length && contract.planned_net_amount!=null && <div className="space-y-2"><button type="button" disabled={busy||hasUnsavedChanges} className={secondary} onClick={useNetPlan}>Przenieś plan netto do formularza stawki</button><p className="text-xs leading-5 opacity-60">Sprawdź okres i zapisz stawkę poniżej. Koszt firmy to szacunek przed efektem CIT; dla godzin i akordu zależy od planowanej miesięcznej liczby jednostek. Ta stawka będzie używana w ewidencji pracy i planowanej rentowności.</p></div>}
      {!readOnly && !documents.length && <details open={!rates.length}><summary className="cursor-pointer text-sm text-[#d3bb73]">Dodaj okres stawki</summary><fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
        <ContractDateField label="Stawka od" value={form.from} onChange={from=>setForm({...form,from})}/><ContractDateField label="Stawka do (puste = bezterminowo)" value={form.to} onChange={to=>setForm({...form,to})}/>
        <label className="text-xs">Sposób naliczania<select className={input} value={form.basis} onChange={e=>setForm({...form,basis:e.target.value})}>{Object.entries(payBasisLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs">Podstawa<select className={input} value={form.rateBasis} onChange={e=>setForm({...form,rateBasis:e.target.value})}>{Object.entries(rateBasisLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        {form.basis==='piecework'&&<label className="text-xs sm:col-span-2">Jednostka akordu<input className={input} value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} placeholder="Np. sztuka, montaż, stanowisko"/></label>}
        <label className="text-xs">Kwota ({contract.currency})<input type="number" min="0.01" step="0.01" className={input} value={form.rate} onChange={e=>setForm({...form,rate:e.target.value})}/></label>
        <label className="text-xs">Szacowany koszt firmy za tę samą jednostkę<input type="number" min="0" step="0.01" className={input} value={form.cost} onChange={e=>setForm({...form,cost:e.target.value})}/></label>
        <button type="button" className={button} onClick={()=>void addRate()}>Zapisz stawkę</button>
      </fieldset></details>}
    </section>
    <section className="space-y-3 rounded-xl bg-white/[0.035] p-4"><h4 className="font-medium">Dokument umowy</h4>
      {!readOnly && <><p className="text-xs leading-5 opacity-60">Zapisz dane umowy przed generowaniem. Utrwalenie wersji zachowa treść, dane stron i stawki. Zmianę warunków przygotuj jako nową umowę lub aneks.</p><select aria-label="Szablon dokumentu" className={input} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Wybierz szablon</option>{templates.filter(t=>t.contract_kind===contract.contract_kind).map(t=><option key={t.id} value={t.id}>{t.name} · wersja {t.version}</option>)}</select><button type="button" className={button} disabled={busy||!selected||!rates.length||hasUnsavedChanges||!questionnaireReady} onClick={()=>void generate()}>Utrwal dokument i pokaż podgląd</button></>}
      {!questionnaireReady&&!readOnly&&<p className="text-xs leading-5 text-amber-200">Przed utrwaleniem nowego dokumentu uzupełnij i zapisz kroki kreatora. {questionnaire.issues[0]?.message}</p>}
      {hasUnsavedChanges && !readOnly && <p className="text-xs text-amber-200">Zapisz zmiany formularza przed utrwaleniem dokumentu.</p>}
      {documents.map(d=><div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.025] p-3 text-sm"><span>Wersja {d.version} · {date(d.created_at)}</span><div className="flex gap-2"><button type="button" className={secondary} onClick={()=>setPreview(d)}>Podgląd</button><button type="button" disabled={busy} className={secondary} onClick={()=>void download(d)}>Pobierz PDF</button></div></div>)}
      {preview&&<div className="space-y-3"><div className="flex justify-between text-xs"><span>Podgląd wersji {preview.version}</span><button type="button" onClick={()=>setPreview(null)}>Zamknij podgląd</button></div><PersonnelPdfPreview content={preview.content} title={`${contract.contract_number}_v${preview.version}`}/></div>}
    </section>
    <PersonnelSettlementPanel contractId={contractId} contract={contract} rates={rates} readOnly={readOnly||hasUnsavedChanges} refreshKey={refreshKey} onChanged={onChanged}/>
  </div>;
}
