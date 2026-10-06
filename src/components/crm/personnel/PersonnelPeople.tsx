 'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {MoreVertical} from 'lucide-react';
import {useDialog} from '@/contexts/DialogContext';
import {usePortalDropdown} from '@/hooks/usePortalDropdown';
import {PortalDropdownMenu} from '@/components/UI/PortalDropdownMenu/PortalDropdownMenu';
import PersonnelServices from './PersonnelServices';
import { supabase } from '@/lib/supabase/browser';
import { usePersonnelAccess } from './usePersonnelAccess';
import { PersonnelPersonForm } from './PersonnelPersonForm';
import { PersonnelContractsPanel } from './PersonnelContractsPanel';
import { type PersonnelPerson, personName, personnelInput as input, personnelButton as button, personnelSecondary as secondary } from '@/lib/personnel/workspace';
export default function PersonnelPeople({ personId }: { personId?: string }) {
  const access = usePersonnelAccess();
  const router=useRouter();const {showConfirm}=useDialog();const menu=usePortalDropdown({menuWidth:210,closeOnScroll:true});const deleteLock=useRef(false);
  async function removePerson(p:PersonnelPerson){
    if(!access.manage||deleteLock.current)return;deleteLock.current=true;menu.close();
    try{if(!await showConfirm({title:'Usuń współpracownika',message:`Usunąć kartotekę ${personName(p)} i katalog usług? Tej operacji nie można cofnąć.`,confirmText:'Usuń',cancelText:'Anuluj'}))return;
    setBusy(true);setError('');const {error}=await supabase.rpc('delete_personnel_collaborator',{p_id:p.id});if(error)throw error;
    if(personId)router.push('/crm/employees/collaborators');else setPeople(current=>current.filter(row=>row.id!==p.id));
    }catch(e:any){setError(e.message);}finally{deleteLock.current=false;setBusy(false);}
  }
  function actions(p:PersonnelPerson){return <><button type="button" disabled={busy} aria-label={`Akcje: ${personName(p)}`} aria-expanded={menu.openId===p.id} onClick={e=>menu.toggle(p.id,e)} className="rounded-lg p-2 hover:bg-white/5"><MoreVertical className="h-5 w-5"/></button><PortalDropdownMenu open={menu.openId===p.id} position={menu.position} className="!bg-[#381020] !border-white/5" content={<><Link className="block px-4 py-3 text-sm" href={`/crm/employees/collaborators/${p.id}`} onClick={()=>menu.close()}>Szczegóły i usługi</Link>{access.manage&&<button className="w-full px-4 py-3 text-left text-sm text-red-300 hover:bg-red-500/10" disabled={busy} onClick={()=>void removePerson(p)}>Usuń współpracownika</button>}</>}/></>;}

  const [people,setPeople] = useState<PersonnelPerson[]>([]), [error,setError] = useState(''), [loading,setLoading] = useState(true);
  const [search,setSearch] = useState(''), [editing,setEditing] = useState(false), [includeArchived,setIncludeArchived] = useState(false);
  const [employeeId,setEmployeeId] = useState(''), [candidates,setCandidates] = useState<PersonnelPerson[]>([]), [busy,setBusy] = useState(false);
  async function load() {
    setLoading(true);setError('');
    let query=supabase.from('personnel_people').select('*').order('surname').order('name');
    if(personId) query=query.eq('id',personId); else query=query.is('employee_id',null).is('subcontractor_id',null);
    const {data,error}=await query;
    if(error) setError(error.message); else setPeople(data || []);
    setLoading(false);
  }
  useEffect(()=>{if(access.view) void load();},[access.view,personId]);
  useEffect(()=>{if(access.manage && personId) void supabase.from('personnel_people').select('*').not('employee_id','is',null).order('surname').then(({data})=>setCandidates(data || []));},[access.manage,personId]);
  const person=personId?people[0]:undefined;
  const connect=async()=>{
    if(!person || !employeeId || busy) return;
    setBusy(true);setError('');
    const {error}=await supabase.rpc('link_personnel_employee',{p_person:person.id,p_employee:employeeId});
    if(error) setError(error.message);else await load();setBusy(false);
  };
  if(access.loading) return <p className="p-6">Ładowanie…</p>;
  if(!access.view) return <p className="p-6">{access.error || 'Brak dostępu do kartoteki współpracowników.'}</p>;
  return <main className="mx-auto max-w-7xl space-y-6 p-4 text-[var(--brand-platinum)] sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div>{personId && <Link className="text-sm text-[#d3bb73]" href="/crm/employees/collaborators">← Współpracownicy</Link>}<h1 className="mt-2 text-2xl">{person ? personName(person) : 'Współpracownicy'}</h1><p className="mt-2 text-sm opacity-60">Kartoteka osób, umowy i historia rozliczeń.</p></div>{access.manage && <button className={button} onClick={()=>setEditing(true)}>{personId?'Edytuj dane':'Dodaj współpracownika'}</button>}{person && actions(person)}</header>
    {error && <p role="alert" className="rounded-lg bg-red-400/5 p-3 text-red-300">{error}</p>}
    {editing && <PersonnelPersonForm person={person} onCancel={()=>setEditing(false)} onSaved={()=>{setEditing(false);void load();}} />}
    {loading?<p>Ładowanie kartoteki…</p>:personId ? person ? <>
      <div className="grid gap-4 rounded-xl bg-white/[0.035] p-5 sm:grid-cols-3">{[['E-mail',person.email],['Telefon',person.phone],['Adres',person.address],['Identyfikator',person.identifier],['Rachunek',person.bank_account],['Status',person.is_active?'Aktywny':'Archiwalny']].map(([label,value])=><div key={label}><p className="text-xs opacity-50">{label}</p><p className="mt-1 break-words">{value || '—'}</p></div>)}</div>
      {person.employee_id ? <Link href={`/crm/employees/${person.employee_id}`} className="inline-block text-[#d3bb73]">Otwórz profil pracownika CRM →</Link> : access.manage && <details className="rounded-xl bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm">Powiąż z istniejącym kontem CRM</summary><p className="my-3 text-xs opacity-60">Wybierz konto tej samej osoby. Historia umów pozostanie w tej kartotece.</p><select className={input} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">Wybierz pracownika</option>{candidates.map(p=><option key={p.id} value={p.employee_id!}>{personName(p)}</option>)}</select><button disabled={!employeeId || busy} onClick={()=>void connect()} className={`${button} mt-3`}>Powiąż konto</button></details>}
      <PersonnelServices personId={person.id} canManage={access.manage} />
      <PersonnelContractsPanel personId={person.id} />
    </>:<p>Nie znaleziono osoby.</p> : <>
      <div className="flex flex-wrap items-center gap-4"><input aria-label="Szukaj współpracownika" className={`${input} max-w-md`} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Szukaj po nazwisku, telefonie lub e-mailu…"/><label className="flex gap-2 text-sm"><input type="checkbox" checked={includeArchived} onChange={e=>setIncludeArchived(e.target.checked)} />Pokaż archiwalnych</label></div>
      <div className="overflow-x-auto rounded-xl bg-white/[0.035]"><table className="w-full text-left text-sm"><thead className="text-xs opacity-60"><tr>{['Osoba','Kontakt','Status',''].map((s,i)=><th key={i} className="p-4">{s}</th>)}</tr></thead><tbody>{people.filter(p=>(includeArchived || p.is_active) && `${personName(p)} ${p.email} ${p.phone}`.toLocaleLowerCase('pl-PL').includes(search.toLocaleLowerCase('pl-PL'))).map(p=><tr key={p.id} className="border-t border-white/5 hover:bg-white/[0.025]"><td className="p-4 font-medium">{personName(p)}</td><td className="p-4">{p.email || p.phone || '—'}</td><td className="p-4">{p.is_active?'Aktywny':'Archiwalny'}</td><td className="p-4">{actions(p)}</td></tr>)}</tbody></table>{!people.length && <p className="p-8 text-center opacity-60">Dodaj pierwszą osobę, aby przygotować dla niej umowę.</p>}</div>
    </>}
  </main>;
}
