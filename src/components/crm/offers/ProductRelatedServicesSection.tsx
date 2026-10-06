"use client";

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Loader2, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { servicePagePath, relatedServicePagePath } from '@/lib/CRM/Offers/relatedServices';

type Service = {id:string;title:string;slug:string;is_active:boolean};
type Props = {value:string[];pageUrl?:string|null;pageLabel?:string|null;canEdit:boolean;disabled?:boolean;onSave:(ids:string[],url:string|null,label:string|null)=>Promise<void>;onEditingChange:(editing:boolean)=>void};
export default function ProductRelatedServicesSection({value,pageUrl,pageLabel,canEdit,disabled,onSave,onEditingChange}:Props) {
  const [services,setServices]=useState<Service[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const [draft,setDraft]=useState<string[]|null>(null);
  const [search,setSearch]=useState('');
  const [draftUrl,setDraftUrl]=useState('');
  const [draftLabel,setDraftLabel]=useState('');
  const publicPageUrl=relatedServicePagePath(pageUrl);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setLoadError('');
    void (async()=>{
      try {
        const {data,error}=await supabase.from('services_catalog').select('id,title,slug,is_active').order('order_index');
        if(error)throw error;
        if(!cancelled)setServices((data||[]).filter(service=>servicePagePath(service.slug)));
      } catch {if(!cancelled)setLoadError('Nie udało się wczytać katalogu usług.');}
      finally {if(!cancelled)setLoading(false);}
    })();return()=>{cancelled=true;};
  },[revision]);
  const selected=draft??value;
  const busy=Boolean(disabled||saving);
  const close=()=>{setDraft(null);setError('');setSearch('');onEditingChange(false);};
  const save=async()=>{
    if(!draft||busy||!canEdit)return;
    const url=relatedServicePagePath(draftUrl);
    if(draftUrl.trim()&&!url){setError('Podaj adres strony Mavinci z działu /oferta/ lub /uslugi/, np. /oferta/kasyno.');return;}
    setSaving(true);setError('');
    try {await onSave([...new Set(draft)],url,url ? draftLabel.trim() || null : null);close();}
    catch(e){setError(e instanceof Error?e.message:'Nie udało się zapisać powiązań.');}
    finally {setSaving(false);}
  };
  const query=search.trim().toLocaleLowerCase('pl-PL');
  const matches=services.filter(service=>service.is_active && `${service.title} ${service.slug}`.toLocaleLowerCase('pl-PL').includes(query));
  return <section className="rounded-xl bg-[#1c1f33] p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg text-[#e5e4e2]">Powiązane usługi na stronie</h2><p className="mt-1 max-w-xl text-sm text-[#e5e4e2]/55">Klient z oferty trafia na publiczną kartę produktu. Tutaj możesz dodać przejście do pełnej strony usługi — własnym adresem lub z katalogu.</p></div>
      {canEdit&&<div className="flex gap-2">{draft?<><button type="button" disabled={busy} onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] disabled:opacity-40">Anuluj</button><button type="button" disabled={busy} onClick={()=>void save()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">{saving&&<Loader2 className="h-4 w-4 animate-spin"/>}Zapisz powiązania</button></>:<button type="button" disabled={busy} onClick={()=>{setDraft([...value]);setDraftUrl(pageUrl||'');setDraftLabel(pageLabel||'');onEditingChange(true);}} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40">Edytuj powiązania</button>}</div>}
    </div>
    {draft ? <div className="mt-5 space-y-3 rounded-xl bg-black/15 p-4">
      <label className="block text-sm text-[#e5e4e2]">Adres strony usługi (opcjonalny)
        <input type="text" inputMode="url" maxLength={2048} value={draftUrl} disabled={busy} onChange={event=>setDraftUrl(event.target.value)} placeholder="/uslugi/ekrany-led-do-konferencji-i-gal" className="mt-2 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 text-sm"/>
      </label>
      <p className="text-xs leading-5 text-[#e5e4e2]/50">Wklej pełny adres https://mavinci.pl/oferta/… lub https://mavinci.pl/uslugi/…, albo samą ścieżkę. Docelowa strona musi już istnieć.</p>
      <label className="block text-sm text-[#e5e4e2]">Tekst przycisku (opcjonalny)
        <input type="text" maxLength={120} value={draftLabel} disabled={busy} onChange={event=>setDraftLabel(event.target.value)} placeholder="Poznaj pełną usługę" className="mt-2 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 text-sm"/>
      </label>
      <p className="text-xs text-[#e5e4e2]/50">Pusty adres oznacza brak dodatkowego przycisku. Powiązania z katalogu poniżej działają niezależnie.</p>
    </div> : publicPageUrl ? <div className="mt-5 rounded-xl bg-black/15 p-4">
      <p className="text-xs text-[#e5e4e2]/50">Własna strona usługi</p>
      <a href={publicPageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-2 font-medium text-[#d3bb73]">{pageLabel||'Poznaj pełną usługę'}<ArrowUpRight className="h-4 w-4"/></a>
      <p className="mt-1 break-all text-xs text-[#e5e4e2]/50">{publicPageUrl}</p>
    </div> : <p className="mt-4 text-sm text-[#e5e4e2]/50">Nie ustawiono własnego adresu strony usługi.</p>}
    {loading&&<p className="mt-4 flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin"/>Wczytuję usługi…</p>}
    {loadError&&<p role="alert" className="mt-4 text-sm text-red-200">{loadError} <button type="button" onClick={()=>setRevision(v=>v+1)} className="underline">Spróbuj ponownie</button></p>}
    {!loading&&!loadError&&<div className="mt-4 space-y-2">{selected.map(id=>{
      const service=services.find(service=>service.id===id);const href=servicePagePath(service?.slug);
      return <div key={id} className="flex items-center justify-between gap-3 rounded-lg bg-black/15 px-4 py-3"><div><p className="text-sm text-[#e5e4e2]">{service?.title||'Usługa niedostępna w katalogu'}</p>{href&&<a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-[#d3bb73]">{href}<ArrowUpRight className="h-3 w-3"/></a>}{(!service||!service.is_active)&&<p className="mt-1 text-xs text-[#e5e4e2]/45">To powiązanie nie będzie pokazywane publicznie.</p>}</div>{draft?<button type="button" disabled={busy} onClick={()=>setDraft(draft.filter(selectedId=>selectedId!==id))} aria-label={`Usuń powiązanie: ${service?.title||'usługa'}`} className="rounded-lg p-2 text-white/50 hover:bg-white/5"><X className="h-4 w-4"/></button>:<Check className="h-4 w-4 text-[#d3bb73]"/>}</div>;
    })}{!selected.length&&<p className="text-sm text-[#e5e4e2]/50">Brak powiązanych usług.</p>}</div>}
    {draft&&!loading&&!loadError&&<div className="mt-4"><p className="mb-3 text-sm text-[#e5e4e2]/60">Dodatkowe powiązania z katalogu usług</p><label className="relative block"><span className="sr-only">Wyszukaj usługę</span><Search className="absolute left-3 top-3 h-4 w-4 text-white/40"/><input value={search} disabled={busy} onChange={event=>setSearch(event.target.value)} placeholder="Wyszukaj usługę, np. kasyno, streaming…" className="w-full rounded-lg border border-white/10 bg-black/15 py-2.5 pl-9 pr-3 text-sm text-[#e5e4e2]"/></label><div className="mt-3 max-h-64 space-y-1 overflow-y-auto">{matches.map(service=><label key={service.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/5"><input type="checkbox" disabled={busy} checked={draft.includes(service.id)} onChange={event=>setDraft(current=>current?(event.target.checked?[...current,service.id]:current.filter(id=>id!==service.id)):current)} className="accent-[#d3bb73]"/><span>{service.title}<span className="ml-2 text-xs text-[#e5e4e2]/40">{servicePagePath(service.slug)}</span></span></label>)}{!loading&&!matches.length&&<p className="py-3 text-sm text-white/45">Brak pasujących usług.</p>}</div></div>}
    {error&&<p role="alert" className="mt-3 text-sm text-red-200">{error}</p>}
  </section>;
}
