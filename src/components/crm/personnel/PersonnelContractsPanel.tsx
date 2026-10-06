 'use client';
import { useState } from 'react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { usePersonnelAccess } from './usePersonnelAccess';
import { PersonnelContractsRegistry } from '@/components/crm/invoices/tabs/PersonnelContractsRegistry';
import PersonnelTemplates from './PersonnelTemplates';
import { personnelInput as input,personnelSecondary as secondary } from '@/lib/personnel/workspace';
export function PersonnelContractsPanel({personId,employeeId,subcontractorId,showTemplates=false,startNew=false,onChanged}:{personId?:string;employeeId?:string;subcontractorId?:string;showTemplates?:boolean;startNew?:boolean;onChanged?:()=>void}) {
 const access=usePersonnelAccess();const {employee}=useCurrentEmployee();
 const [tab,setTab]=useState('registry'),[year,setYear]=useState(''),[month,setMonth]=useState(''),[mode,setMode]=useState<'signed'|'active'>('signed'),[status,setStatus]=useState(''),[kind,setKind]=useState('');
 const own=!!employeeId&&employeeId===employee?.id;
 if(access.loading)return <p className="p-4 text-sm">Ładowanie umów…</p>;
 if(!access.view&&!own)return <p className="p-4 text-sm opacity-60">{access.error||'Nie masz uprawnień do umów i wynagrodzeń tej osoby.'}</p>;
 return <section className="space-y-4">
  {showTemplates&&access.view&&<div className="flex gap-2">{[['registry','Rejestr'],['templates','Szablony']].map(([k,label])=><button data-crm-tab-active={tab===k} key={k} onClick={()=>setTab(k)} className={`${secondary} ${tab===k?'text-[#d3bb73]':''}`}>{label}</button>)}</div>}
  {tab==='templates'?<PersonnelTemplates readOnly={!access.manage}/>:<>
   <div className="grid gap-3 rounded-xl bg-white/[0.025] p-4 sm:grid-cols-2 lg:grid-cols-5"><label className="text-xs">Rok<input className={input} type="number" min="1900" max="9998" placeholder="Wszystkie lata" value={year} onChange={e=>setYear(e.target.value)}/></label><label className="text-xs">Miesiąc<select className={input} value={month} disabled={!year} onChange={e=>setMonth(e.target.value)}><option value="">Cały rok</option>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Date(2026,i,1).toLocaleString('pl-PL',{month:'long'})}</option>)}</select></label><label className="text-xs">Data<select className={input} value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="signed">Zawarte w okresie</option><option value="active">Obowiązujące w okresie</option></select></label><label className="text-xs">Status<select className={input} value={status} onChange={e=>setStatus(e.target.value)}><option value="">Wszystkie</option><option value="draft">Szkic</option><option value="active">Aktywna</option><option value="completed">Zakończona</option><option value="terminated">Rozwiązana</option></select></label><label className="text-xs">Rodzaj<select className={input} value={kind} onChange={e=>setKind(e.target.value)}><option value="">Wszystkie</option><option value="mandate">Umowa zlecenie</option><option value="employment">Umowa o pracę</option><option value="specific_work">Umowa o dzieło</option><option value="oral">Umowa ustna — dżentelmeńska</option></select></label></div>
   <PersonnelContractsRegistry onChanged={onChanged} startNew={startNew} filterPersonId={personId} filterEmployeeId={employeeId} filterSubcontractorId={subcontractorId} year={Number(year)>=1900&&Number(year)<=9998?Number(year):undefined} month={Number(month)||undefined} periodMode={mode} statusFilter={status} kindFilter={kind} readOnly={!access.manage}/>
  </>}
 </section>;
}
