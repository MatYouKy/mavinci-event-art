'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { type Recipient, type RecipientContext, validRecipientEmail } from './delivery';
const field='w-full rounded-lg border border-white/5 bg-black/15 px-3 py-2 text-sm text-white focus:outline-none focus:bg-white/5';
type SearchRow={id:string;name:string;email:string;organizations?:{id:string;name:string}[]};
export default function BrochureRecipients({value,onChange,context,disabled}:{value:Recipient[];onChange:(v:Recipient[])=>void;context?:RecipientContext;disabled:boolean}) {
 const [mode,setMode]=useState<'organization'|'contact'|'email'>(context?.type||'organization');
 const [query,setQuery]=useState(''),[results,setResults]=useState<SearchRow[]>([]),[members,setMembers]=useState<Recipient[]>([]),[organization,setOrganization]=useState<SearchRow|null>(null),[manual,setManual]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const request=useRef(0);
 const add=(recipient:Recipient)=>{const normalized={...recipient,email:recipient.email.trim().toLowerCase()};if(!validRecipientEmail(normalized.email)){setError('Wpisz prawidłowy adres e-mail.');return;}if(value.some(r=>r.email===normalized.email))return;if(value.length>=20){setError('Jednorazowo wybierz maksymalnie 20 odbiorców.');return;}setError('');onChange([...value,normalized]);};
 const chooseOrganization=async(row:SearchRow)=>{
  const ticket=++request.current;setOrganization(row);setMembers([]);setResults([]);setQuery('');setLoading(true);setError('');
  try{
   const {data,error}=await supabase.from('contact_organizations').select('contact:contacts(id,full_name,email)').eq('organization_id',row.id).eq('is_current',true).limit(500);if(error)throw error;if(ticket!==request.current)return;
   const contacts=(data||[]).map((link:any)=>Array.isArray(link.contact)?link.contact[0]:link.contact).filter(Boolean);
   const unique=new Map<string,Recipient>();for(const c of contacts)unique.set(c.id,{name:c.full_name||'Kontakt',email:(c.email||'').trim().toLowerCase(),contactId:c.id,organizationId:row.id});
   setMembers([...(row.email?[{name:`${row.name} — adres organizacji`,email:row.email.trim().toLowerCase(),organizationId:row.id}]:[]),...unique.values()]);
   if((data||[]).length===500)setError('Pokazano pierwszych 500 powiązań. Pozostałe osoby znajdziesz w wyszukiwarce Kontakt.');
  }catch{if(ticket===request.current)setError('Nie udało się pobrać kontaktów organizacji.');}finally{if(ticket===request.current)setLoading(false);}
 };
 useEffect(()=>{
  if(!context)return;let active=true;
  void (async()=>{
   const {data,error}=await supabase.from(context.type==='organization'?'organizations':'contacts').select(context.type==='organization'?'id,name,email':'id,full_name,email').eq('id',context.id).maybeSingle();
   if(!active)return;if(error||!data){setError('Nie udało się wczytać odbiorcy.');return;}const row:any=data;
   if(context.type==='organization')await chooseOrganization({id:row.id,name:row.name,email:row.email||''});
   else {
    const {data:links}=await supabase.from('contact_organizations').select('organization_id').eq('contact_id',row.id).eq('is_current',true).limit(2);
    if(!active)return;
    if(row.email&&validRecipientEmail(row.email.trim()))onChange([{email:row.email.trim().toLowerCase(),name:row.full_name,contactId:row.id,...(links?.length===1?{organizationId:links[0].organization_id}:{})}]);
    else{setMode('email');setError('Kontakt nie ma prawidłowego e-maila. Możesz wpisać adres ręcznie.');}
   }
  })();return()=>{active=false;request.current+=1;};
 // Context is fixed for this modal; edits must not reset the recipient list.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[context?.id]);
 useEffect(()=>{
  if(mode==='email'||query.trim().length<2){setResults([]);return;}
  let active=true;const timeout=setTimeout(()=>{void(async()=>{
   setLoading(true);setError('');const term=query.trim().replace(/[,%()"\\]/g,' ').slice(0,100);
   const {data,error}=mode==='organization'
    ?await supabase.from('organizations').select('id,name,email').or(`name.ilike.%${term}%,email.ilike.%${term}%`).order('name').limit(15)
    :await supabase.from('contacts').select('id,full_name,email,links:contact_organizations(is_current,organization:organizations(id,name))').or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).order('full_name').limit(15);
   if(!active)return;setLoading(false);if(error){setError('Nie udało się wyszukać odbiorców.');return;}
   setResults((data||[]).map((r:any)=>({id:r.id,name:r.name||r.full_name,email:r.email||'',organizations:(r.links||[]).filter((l:any)=>l.is_current).map((l:any)=>Array.isArray(l.organization)?l.organization[0]:l.organization).filter(Boolean)})));
  })();},300);return()=>{active=false;clearTimeout(timeout);};
 },[query,mode]);
 return <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
  <legend className="mb-2 text-sm text-white/70">Wyślij do</legend>
  <div className="flex flex-wrap gap-2">{([{key:'organization',label:'Organizacja'},{key:'contact',label:'Kontakt'},{key:'email',label:'Adres e-mail'}] as const).map(m=><button type="button" key={m.key} aria-pressed={mode===m.key} onClick={()=>{request.current+=1;setMode(m.key);setQuery('');setResults([]);setLoading(false);setError('');}} className={`rounded-lg px-3 py-2 text-sm ${mode===m.key?'bg-[#d3bb73]/15 text-[#d3bb73]':'bg-white/5 text-white/60'}`}>{m.label}</button>)}</div>
  {mode==='email'?<div className="flex gap-2"><input aria-label="Adres e-mail odbiorcy" type="email" maxLength={200} value={manual} onChange={e=>setManual(e.target.value)} placeholder="adres@hotel.pl" className={field}/><button type="button" onClick={()=>{if(validRecipientEmail(manual.trim())){add({email:manual,name:manual.trim(),manualAddress:true,...(context?.type==='contact'?{contactId:context.id}:organization?{organizationId:organization.id}:context?.type==='organization'?{organizationId:context.id}:{})});setManual('');}else setError('Wpisz prawidłowy adres e-mail.');}} className="rounded-lg bg-white/5 px-4 text-sm">Dodaj</button></div>:<>
   <input type="search" aria-label={mode==='organization'?'Wyszukaj organizację':'Wyszukaj kontakt'} value={query} onChange={e=>setQuery(e.target.value)} placeholder={mode==='organization'?'Nazwa organizacji lub e-mail (min. 2 znaki)':'Imię, nazwisko lub e-mail (min. 2 znaki)'} className={field}/>
   {results.length>0&&<div className="max-h-56 overflow-auto rounded-lg bg-black/15">{results.map(row=><button key={row.id} type="button" disabled={mode==='contact'&&!validRecipientEmail(row.email.trim())} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-40" onClick={()=>{if(mode==='organization')void chooseOrganization(row);else add({email:row.email,name:row.name,contactId:row.id,...(row.organizations?.length===1?{organizationId:row.organizations[0].id}:{})});}}>{row.name}<span className="block text-xs text-white/45">{row.email||'Brak e-maila'}{row.organizations?.length?` · ${row.organizations.map(o=>o.name).join(', ')}`:''}</span></button>)}</div>}
   {mode==='organization'&&organization&&<div className="space-y-2 rounded-lg bg-white/[.03] p-3"><p className="text-sm text-[#d3bb73]">{organization.name}</p>{!loading&&!members.length&&<p className="text-xs text-white/50">Brak adresu organizacji i powiązanych osób. Wpisz adres ręcznie.</p>}{members.map((r,i)=><label key={r.contactId||`org-${i}`} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!validRecipientEmail(r.email)} checked={value.some(v=>v.email===r.email)} onChange={e=>e.target.checked?add(r):onChange(value.filter(v=>v.email!==r.email))}/><span>{r.name}<span className="block text-xs text-white/45">{r.email||'Brak e-maila — użyj opcji Adres e-mail'}</span></span></label>)}</div>}
  </>}
  {loading&&<p role="status" className="text-xs text-white/50">Wczytywanie odbiorców…</p>}{error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
  {mode==='email'&&(context||organization)&&<p className="text-xs text-white/45">Ręcznie wpisany adres będzie powiązany w historii z: {context?.type==='contact'?context.name:organization?.name||context?.name}.</p>}
  <div className="space-y-2">{value.map(r=><div key={r.email} className="flex items-center justify-between gap-3 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-xs"><span>{r.name!==r.email?r.name+' · ':''}{r.email}</span><button type="button" aria-label={`Usuń odbiorcę ${r.email}`} onClick={()=>onChange(value.filter(v=>v.email!==r.email))}>Usuń</button></div>)}</div>
  <p className="text-xs leading-5 text-white/45">Każdy adres otrzyma osobną wiadomość i własny PDF. Jeśli broszura zawiera demo, jego link będzie przypisany do odbiorcy. Powtórzone adresy pomijamy.</p>
 </fieldset>;
}
