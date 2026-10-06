 'use client';
import { useEffect, useState } from 'react';
import { PersonnelPdfPreview } from './PersonnelPdfPreview';
import { documentTokens, unknownDocumentTokens } from '@/lib/personnel/documentFields';
import { supabase } from '@/lib/supabase/browser';
import { personnelInput as input, personnelButton as button, personnelSecondary as secondary } from '@/lib/personnel/workspace';
export type PersonnelTemplate = { id: string; name: string; contract_kind: string; content: string; version: number; is_active: boolean; updated_at: string };
const labels: Record<string,string>={mandate:'Umowa zlecenie',employment:'Umowa o pracę',specific_work:'Umowa o dzieło'};
export default function PersonnelTemplates({ readOnly }: { readOnly: boolean }) {
  const [rows,setRows]=useState<PersonnelTemplate[]>([]),[current,setCurrent]=useState<Partial<PersonnelTemplate>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [editing,setEditing]=useState(false);
  async function load(){const {data,error}=await supabase.from('personnel_contract_templates').select('*').order('name');if(error)setError(error.message);else {setRows(data||[]);setCurrent(previous=>previous || (data||[]).find(t=>t.is_active) || data?.[0] || null);}}
  useEffect(()=>{void load();},[]);
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(!current || busy)return;setBusy(true);setError('');try{
    const unknown=unknownDocumentTokens(current.content||'');if(unknown.length)throw new Error('Nieznane placeholdery: '+unknown.join(', '));
    const payload={name:current.name?.trim(),contract_kind:current.contract_kind,content:current.content?.trim(),is_active:current.is_active};
    const result=current.id?await supabase.from('personnel_contract_templates').update(payload).eq('id',current.id).eq('updated_at',current.updated_at).select('id').maybeSingle():await supabase.from('personnel_contract_templates').insert(payload).select('id').single();
    if(result.error)throw result.error;if(!result.data)throw new Error('Szablon zmienił się. Otwórz go ponownie.');setCurrent(null);setEditing(false);await load();
  }catch(e:any){setError(e.message);}finally{setBusy(false);}};
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-3xl text-sm opacity-65">Wybierz szablon, aby zobaczyć docelowy PDF z placeholderami. Przed wystawieniem dokumentu system pobierze zapisane dane umowy i stawki oraz sprawdzi wymagane pola.</p>{!readOnly&&<button className={button} onClick={()=>{setCurrent({name:'',contract_kind:'mandate',content:'',is_active:true});setEditing(true);}}>Dodaj szablon</button>}</div>
    {error&&<p role="alert" className="text-red-300">{error}</p>}
    <div className="grid gap-3 md:grid-cols-3">{rows.map(t=><button key={t.id} onClick={()=>{if(editing&&!window.confirm('Opuścić edycję i otworzyć inny szablon? Niezapisane zmiany zostaną utracone.'))return;setCurrent(t);setEditing(false);}} className={`rounded-xl p-4 text-left ${current?.id===t.id?'bg-[#d3bb73]/10':'bg-white/[0.035] hover:bg-white/[0.06]'}`}><strong className="text-sm">{t.name}</strong><p className="mt-2 text-xs opacity-60">{labels[t.contract_kind]} · Wersja {t.version} · {t.is_active?'Aktywny':'Archiwalny'}</p></button>)}</div>
    {current&&<div className="space-y-4"><div className="flex items-center justify-between gap-2"><h3 className="font-medium">{current.name||'Nowy szablon'}</h3>{!readOnly&&!editing&&<button type="button" className={secondary} onClick={()=>setEditing(true)}>Edytuj treść</button>}</div>
      <div className={editing?'grid gap-4 xl:grid-cols-2':'space-y-4'}>
      {editing&&<form className="space-y-4 rounded-xl bg-white/[0.035] p-4" onSubmit={save}><fieldset disabled={readOnly||busy} className="space-y-4"><label className="block text-sm">Nazwa<input className={input} required value={current.name||''} onChange={e=>setCurrent({...current,name:e.target.value})}/></label><label className="block text-sm">Rodzaj<select className={input} value={current.contract_kind} onChange={e=>setCurrent({...current,contract_kind:e.target.value})}>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">Treść<textarea rows={22} className={input} required value={current.content||''} onChange={e=>setCurrent({...current,content:e.target.value})}/></label>
      <details><summary className="cursor-pointer text-xs">Dostępne placeholdery i ich źródła</summary><dl className="mt-3 grid gap-2 text-xs">{Object.entries(documentTokens).map(([key,label])=><div key={key} className="flex flex-wrap justify-between gap-2"><dt className="font-mono">{'{{'+key+'}}'}</dt><dd className="opacity-60">{label}</dd></div>)}</dl></details>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={current.is_active} onChange={e=>setCurrent({...current,is_active:e.target.checked})}/>Szablon aktywny</label></fieldset><div className="flex gap-2"><button className={button} disabled={busy}>Zapisz szablon</button><button type="button" className={secondary} disabled={busy} onClick={()=>{setCurrent(rows.find(t=>t.id===current.id)||rows.find(t=>t.is_active)||null);setEditing(false);}}>Anuluj edycję</button></div></form>}
      <PersonnelPdfPreview content={current.content||''} title={current.name||'Szablon umowy'} template/>
      </div><p className="text-xs leading-5 opacity-60">Wzory bazowe według zasad na 21.09.2026. O zgodności decydują też rzeczywisty sposób wykonywania pracy i indywidualne ustalenia. Edycja treści może zmienić skutki prawne; utrwalone dokumenty zachowują poprzednią treść.</p>
    </div>}
  </section>;
}
