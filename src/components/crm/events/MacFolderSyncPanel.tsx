'use client';
import { useEffect, useRef, useState } from 'react';
import { FolderSync, KeyRound, Download, Eye, Upload, Loader, RefreshCw } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';

type SyncedFile={id:string;relative_path:string;revision:number;file_size:number;sha256:string};
type Binding={id:string;created_at:string;expires_at:string;revoked_at:string|null};
export default function MacFolderSyncPanel({eventId}:{eventId:string}) {
  const {isAdmin,employee,loading}=useCurrentEmployee();
  const {showSnackbar}=useSnackbar();
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [files,setFiles]=useState<SyncedFile[]>([]),[bindings,setBindings]=useState<Binding[]>([]);
  const [token,setToken]=useState(''),[refresh,setRefresh]=useState(0);
  const [rootScope,setRootScope]=useState(true),[category,setCategory]=useState('Prywatne');
  const input=useRef<HTMLInputElement>(null),target=useRef<SyncedFile|null>(null),locked=useRef(false);
  const query='?eventId='+encodeURIComponent(eventId);
  const bindingQuery=query+(rootScope?'&scope=root':'');
  useEffect(()=>{
    setToken('');
    setFiles([]);setBindings([]);
    if(!open || loading || !employee)return;
    const controller=new AbortController();
    setError('');
    void (async()=>{
      try {
        const [a,b]=await Promise.all([
          isAdmin?fetch('/bridge/mac-sync/bindings'+bindingQuery,{signal:controller.signal,cache:'no-store'}):Promise.resolve(null),
          fetch('/bridge/mac-sync/files'+query,{signal:controller.signal,cache:'no-store'}),
        ]);
        const [connections,documents]=await Promise.all([a?a.json():Promise.resolve({bindings:[]}),b.json()]);
        if((a && !a.ok) || !b.ok)throw new Error(connections.error || documents.error || 'Nie udało się pobrać konfiguracji.');
        setBindings(connections.bindings || []);setFiles(documents.files || []);
      } catch(err){if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Błąd połączenia.');}
    })();
    return ()=>controller.abort();
  },[open,isAdmin,employee?.id,loading,eventId,refresh,query,bindingQuery]);
  const action=async(operation:()=>Promise<void>)=>{
    if(locked.current)return;
    locked.current=true;setBusy(true);setError('');
    try{await operation();}catch(err){const message=err instanceof Error?err.message:'Nie udało się wykonać operacji.';setError(message);showSnackbar(message,'error');}
    finally{locked.current=false;setBusy(false);}
  };
  const createKey=()=>action(async()=>{
    const res=await fetch('/bridge/mac-sync/bindings'+bindingQuery,{method:'POST'});
    const data=await res.json();if(!res.ok)throw new Error(data.error);
    setToken(data.token);
    setBindings(previous=>[{id:data.id,created_at:new Date().toISOString(),expires_at:data.expires_at,revoked_at:null},...previous]);
  });
  const disconnect=(id:string)=>action(async()=>{
    const res=await fetch('/bridge/mac-sync/bindings'+bindingQuery+'&id='+encodeURIComponent(id),{method:'DELETE'});
    if(!res.ok)throw new Error((await res.json()).error);
    setBindings(previous=>previous.map(b=>b.id===id?{...b,revoked_at:new Date().toISOString()}:b));
    showSnackbar('Klucz został odłączony. Pliki pozostają w CRM i na Macu.','success');
  });
  const upload=(file:File|null)=>action(async()=>{
    if(!file)return;
    if(!file.size || file.size>50*1024*1024)throw new Error('Plik może mieć od 1 bajta do 50 MB.');
    const selected=target.current;
    const path=selected?.relative_path || category+'/'+file.name.normalize('NFC');
    const existing=selected || files.find(f=>f.relative_path.toLowerCase()===path.toLowerCase());
    if(existing && !selected)throw new Error('Taki plik już istnieje. Użyj „Nowa wersja” przy właściwym dokumencie.');
    const buffer=await file.arrayBuffer();
    const digest=await crypto.subtle.digest('SHA-256',buffer);
    const sha=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const res=await fetch('/bridge/mac-sync/files'+query,{method:'POST',headers:{
      'Content-Type':'application/octet-stream','X-File-Path':encodeURIComponent(path),
      'X-Expected-Revision':String(existing?.revision || 0),'X-Content-SHA256':sha,
    },body:buffer});
    const data=await res.json();if(!res.ok)throw new Error(data.error);
    setFiles(previous=>[data,...previous.filter(f=>f.id!==data.id)]);
    showSnackbar('Plik zapisany. Mac pobierze go podczas następnej synchronizacji.','success');
  });
  if(loading || !employee)return null;
  return <section className="rounded-xl bg-[#210811]/70 p-4">
    <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open} className="flex items-center gap-2 border-0 bg-transparent text-sm font-medium text-[#d3bb73]">
      <FolderSync className="h-4 w-4"/>Folder Mac / iCloud
    </button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-white/60">Pliki synchronizują się w obie strony, bez propagowania usunięć. Zespół z zaakceptowanym przypisaniem i dostępem do wydarzenia widzi katalog „Pliki”. „Umowy” wymagają dodatkowo uprawnienia zarządzania umowami, a „Oferty” — tworzenia ofert. „Prywatne” i pozostałe katalogi widzi tylko administrator.</p>
      {isAdmin && <div className="space-y-3">
        <p className="text-sm text-white/60">Połącz raz główny folder CRM na Macu. Wydarzenia pojawią się automatycznie w events/RRRR-MM-DD/Nazwa wydarzenia. Klucz całego katalogu obejmuje również przyszłe wydarzenia i jest przeznaczony wyłącznie dla Twojego Maca.</p>
        <label className="flex items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={rootScope} disabled={busy} onChange={e=>setRootScope(e.target.checked)}/>Cały katalog CRM (odznacz, aby zarządzać starszym połączeniem tylko tego wydarzenia)</label>
        <p className="text-xs text-white/45">Cofnięcie klucza zatrzymuje dostęp, ale nie usuwa pobranych kopii. Udostępnianie folderu w iCloud działa niezależnie od uprawnień CRM.</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        {isAdmin && <>
          <button disabled={busy} onClick={createKey} className="inline-flex min-h-11 items-center gap-2 rounded-lg border-0 bg-white/5 px-3 text-sm text-[#d3bb73]"><KeyRound className="h-4 w-4"/>{rootScope?'Wygeneruj klucz całego katalogu':'Wygeneruj klucz wydarzenia'}</button>
          <select aria-label="Folder i widoczność nowego pliku" value={category} onChange={e=>setCategory(e.target.value)} disabled={busy} className="h-11 rounded-lg border border-white/10 bg-[#351020] px-3 text-sm text-white">
            <option value="Prywatne">Prywatne — administrator</option><option value="Umowy">Umowy — uprawnieni</option><option value="Oferty">Oferty — uprawnieni</option><option value="Pliki">Pliki — zespół wydarzenia</option>
          </select>
          <button disabled={busy} onClick={()=>{target.current=null;if(input.current){input.current.value='';input.current.click();}}} className="inline-flex min-h-11 items-center gap-2 rounded-lg border-0 bg-white/5 px-3 text-sm text-[#d3bb73]"><Upload className="h-4 w-4"/>Dodaj plik do synchronizacji</button>
        </>}
        <button disabled={busy} onClick={()=>setRefresh(v=>v+1)} aria-label="Odśwież listę" className="rounded-lg border-0 bg-white/5 p-3 text-[#d3bb73]"><RefreshCw className="h-4 w-4"/></button>
        {busy && <Loader className="h-5 w-5 animate-spin text-[#d3bb73]"/>}
      </div>
      <input hidden ref={input} type="file" onChange={e=>void upload(e.target.files?.[0] || null)}/>
      {token && <div className="space-y-2 rounded-lg bg-white/5 p-3">
        <p className="text-xs text-white/60">Klucz pokazujemy tylko teraz. Wklej go w aplikacji Mac → Ustawienia → Pliki. Klucz jest ważny rok; nie udostępniaj go innym osobom.</p>
        <input type="password" readOnly value={token} aria-label="Klucz synchronizacji folderu" className="min-h-11 w-full rounded-lg border border-white/10 bg-[#351020] px-3 text-white"/>
        <button onClick={()=>void navigator.clipboard.writeText(token).then(()=>showSnackbar('Skopiowano klucz.','success')).catch(()=>setError('Nie udało się skopiować klucza.'))} className="rounded-lg border-0 bg-white/5 px-3 py-2 text-sm text-[#d3bb73]">Kopiuj klucz</button>
      </div>}
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
      {bindings.filter(b=>!b.revoked_at).map(b=><div key={b.id} className="flex flex-wrap items-center gap-3 text-xs text-white/55">
        <span>Połączenie {new Date(b.created_at).toLocaleDateString('pl-PL')} · ważne do {new Date(b.expires_at).toLocaleDateString('pl-PL')}</span>
        <button disabled={busy} onClick={()=>void disconnect(b.id)} className="rounded-lg border-0 bg-red-400/5 px-3 py-2 text-red-200">Odłącz klucz</button>
      </div>)}
      <ul className="space-y-2">{files.map(file=><li key={file.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white/[0.025] p-3">
        <div className="min-w-0 flex-1"><p className="break-words text-sm text-white/85">{file.relative_path}</p><p className="text-xs text-white/45">Wersja {file.revision} · {(file.file_size/1024/1024).toFixed(2)} MB</p></div>
        <a href={'/bridge/mac-sync/files'+query+'&fileId='+encodeURIComponent(file.id)+'&redirect=1&preview=1'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]"><Eye className="h-4 w-4"/>Podgląd</a>
        <a href={'/bridge/mac-sync/files'+query+'&fileId='+encodeURIComponent(file.id)+'&redirect=1'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]"><Download className="h-4 w-4"/>Pobierz</a>
        {isAdmin && <button disabled={busy} onClick={()=>{target.current=file;if(input.current){input.current.value='';input.current.click();}}} className="rounded-lg border-0 bg-white/5 px-3 py-2 text-sm text-[#d3bb73]">Nowa wersja</button>}
      </li>)}</ul>
      <p className="text-xs text-white/45">Pozostałe pliki i podpisane umowy z wydarzenia pobierane są na Macu do „Z CRM”. Ich lokalne kopie nie nadpisują automatycznie oryginałów.</p>
    </div>}
  </section>;
}
