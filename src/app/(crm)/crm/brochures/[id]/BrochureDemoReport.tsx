'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, RefreshCw, X, FileText, Trash2, Loader2, Copy } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { Modal } from '@/components/UI/Modal';
import BrochureDeliveryHistory from '@/components/crm/brochures/BrochureDeliveryHistory';
import { DEMO_PRODUCTS } from '@/lib/seller/demo';
import { supabase } from '@/lib/supabase/browser';
type Person = {employee_name:string;id:string;full_name:string;organization:string;email:string;phone:string;logo_added:boolean;brand_config:{primary?:string;accent?:string;surface?:string};updated_at:string;visits:number;pdfs:number;downloads:number};
type Document = {employee_name:string;id:string;status:'generating'|'ready'|'failed';pdf_path:string|null;snapshot:{title?:string;website?:string;portraitAdded?:boolean;fullName?:string;organization?:string;email?:string;phone?:string;primary?:string;accent?:string;surface?:string;prices?:string[];logoAdded?:boolean;coverAdded?:boolean;attribution?:{recipientEmail?:string;employeeId?:string;version?:number;campaignId?:string;campaignName?:string}};created_at:string;download_started_at:string|null};
type Source = {id:string;version:number;pdf_path:string;employee_name:string;created_at:string;demo_url:string|null;attribution:{recipientEmail?:string;campaignId?:string}|null};
type Report = {sent:number;canViewAll:boolean;employees:{id:string;name:string}[];sources:Source[];visits:number;sessions:number;leads:number;pdfs:number;downloads:number;people:Person[];documents:Document[]};
const statusLabels = {generating:'Przygotowywanie',ready:'Gotowy',failed:'Nieudana próba'};
const date=(value:string)=>new Date(value).toLocaleString('pl-PL');
export default function BrochureDemoReport({brochureId,enabled,onToggle,disabled,revision}:{brochureId:string;enabled:boolean;onToggle:(value:boolean)=>void;disabled:boolean;revision:number}) {
  const request = useRef(0);
  const [all,setAll]=useState(false),[employeeFilter,setEmployeeFilter]=useState(''),[canViewAll,setCanViewAll]=useState(false),[employees,setEmployees]=useState<{id:string;name:string}[]>([]),[notice,setNotice]=useState('');
  const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[offset,setOffset]=useState(0),[preview,setPreview]=useState(''),[opening,setOpening]=useState('');
  const [details,setDetails]=useState<Document|null>(null),[toDelete,setToDelete]=useState<Document|null>(null),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
  const load=useCallback(async()=>{
    const ticket=++request.current;setLoading(true);setError('');setOpening('');
    try{
      const {data,error}=await supabase.rpc('get_seller_demo_report_scoped',{p_brochure:brochureId,p_offset:offset,p_all:all,p_employee:all&&employeeFilter?employeeFilter:null});
      if(ticket!==request.current)return;if(error)throw error;
      const result=data as Report;setReport(result);setCanViewAll(result.canViewAll);setEmployees(result.employees);
    }catch{if(ticket===request.current){setReport(null);setError('Nie udało się odczytać wyników. Sprawdź uprawnienia do statystyk broszur.');}}
    finally{if(ticket===request.current)setLoading(false);}
  },[brochureId,offset,all,employeeFilter]);
  useEffect(()=>{void load();return()=>{request.current+=1;};},[load,revision]);
  const changeView=(showAll:boolean,person='')=>{
    if(showAll===all&&person===employeeFilter)return;
    request.current+=1;setReport(null);setError('');setNotice('');setPreview('');setOpening('');setDetails(null);setToDelete(null);setOffset(0);setAll(showAll);setEmployeeFilter(person);
  };
  const openPdf=async(id:string,path:string|null,bucket:string)=>{
    if(!path)return;const ticket=request.current;setOpening(id);setError('');
    try{const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,300);if(error||!data?.signedUrl)throw error;if(ticket===request.current)setPreview(data.signedUrl);}
    catch{if(ticket===request.current)setError('Nie udało się otworzyć PDF. Odśwież wyniki i spróbuj ponownie.');}
    finally{if(ticket===request.current)setOpening('');}
  };
  const open=(doc:Document)=>openPdf(doc.id,doc.pdf_path,'seller-demo-pdfs');
  const demoUrl=(value:string|null)=>{
    if(!value)return null;
    try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='mavinci.pl'&&url.pathname===`/demo-sprzedawcy/${brochureId}`&&url.searchParams.has('source')?url.toString():null;}catch{return null;}
  };
  const copyLink=async(value:string)=>{try{await navigator.clipboard.writeText(value);setNotice('Skopiowano link przypisany do tej wersji broszury i jej autora.');}catch{setError('Nie udało się skopiować linku. Otwórz demo i skopiuj adres z przeglądarki.');}};
  const remove=async()=>{
    if(!toDelete||deleting)return;
    setDeleting(true);setDeleteError('');
    try{
      const response=await fetch(`/bridge/brochures/${brochureId}/demo-documents/${toDelete.id}`,{method:'DELETE'});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'Nie udało się usunąć dokumentu.');
      setDetails(current=>current?.id===toDelete.id?null:current);
      setToDelete(null);await load();
    }catch(e){setDeleteError(e instanceof Error?e.message:'Nie udało się usunąć dokumentu.');}finally{setDeleting(false);}
  };
  return <section id="seller-demo-report" className="space-y-5 rounded-xl bg-[#1c1f33] p-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-light">Demo strefy sprzedawcy · statystyki i PDF-y</h2><p className="mt-1 text-xs text-white/45">Dane formularza oraz przypisanie indywidualnego linku do odbiorcy. PDF-y dostępne wyłącznie dla uprawnionych pracowników CRM.</p></div><button type="button" disabled={loading} onClick={()=>void load()} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/65"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Odśwież statystyki</button></div>
    <div className="flex flex-wrap items-center gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={enabled} disabled={disabled} onChange={e=>onToggle(e.target.checked)}/>Udostępnij demo z tej broszury</label><span className="text-xs text-white/35">Zmianę dostępności zatwierdź przyciskiem „Zapisz”.</span></div>
    {canViewAll&&<div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Zakres wyników" className="flex gap-1 rounded-lg bg-black/15 p-1">
        <button type="button" aria-pressed={!all} disabled={deleting} onClick={()=>changeView(false)} className={`rounded-md px-4 py-2 text-sm ${!all?'bg-[#d3bb73]/15 text-[#d3bb73]':'text-white/55'}`}>Moje</button>
        {canViewAll&&<button type="button" aria-pressed={all} disabled={deleting} onClick={()=>changeView(true)} className={`rounded-md px-4 py-2 text-sm ${all?'bg-[#d3bb73]/15 text-[#d3bb73]':'text-white/55'}`}>Wszystkie</button>}
      </div>
      {all&&<label className="flex items-center gap-2 text-xs text-white/55">Pracownik<select aria-label="Filtruj wyniki po pracowniku" value={employeeFilter} disabled={deleting} onChange={e=>changeView(true,e.target.value)} className="rounded-lg bg-black/20 px-3 py-2 text-white"><option value="">Wszyscy, także nieprzypisane</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
      <p className="text-xs text-white/45">{all?'Wyniki wybranego pracownika lub całego zespołu.':'Tylko Twoje wersje broszury, linki i wyniki demo.'}</p>
    </div>}
    <p className="rounded-lg bg-black/15 p-3 text-xs leading-5 text-white/55">Aby zbierać statystyki, wygeneruj PDF i udostępnij jego link z poniższej historii.{canViewAll&&<> Autor wersji jest właścicielem jej wyników, niezależnie od opiekuna na okładce. Starsze wejścia bez przypisania są dostępne w widoku „Wszystkie”.</>}</p>
    {notice&&<p role="status" className="text-xs text-[#d3bb73]">{notice}</p>}
    {loading&&!report&&<p role="status" className="flex items-center gap-2 text-xs text-white/55"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie wyników…</p>}
    {error&&<p role="alert" className="text-sm text-amber-200">{error}</p>}
    {report&&<><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{([{key:'sent',label:'Wysłane wiadomości'},{key:'visits',label:'Wejścia w demo'},{key:'sessions',label:'Sesje demo'},{key:'leads',label:'Próby z danymi'},{key:'pdfs',label:'Gotowe PDF-y'},{key:'downloads',label:'Uruchomione pobrania'}] as const).map(m=><div key={m.key} className="rounded-xl bg-black/15 p-4"><p className="text-2xl text-[#d3bb73]">{report[m.key]}</p><p className="mt-1 text-xs text-white/50">{m.label}</p></div>)}</div><p className="text-xs leading-5 text-white/35">Wejścia obejmują ponowne otwarcia strony; sesje nie oznaczają unikalnych osób. Uruchomienie pobrania nie potwierdza zapisu na dysku. Podgląd pracownika również może naliczyć wejście. Odbiorca linku nie musi być osobą korzystającą z demo: link mógł zostać przekazany dalej. Dane formularza nie stanowią zgody marketingowej.</p>
    <BrochureDeliveryHistory brochureId={brochureId} all={all} employeeFilter={employeeFilter} revision={revision}/>
    <div><h3 className="mb-3 text-sm">{canViewAll?(all?'Wersje broszury i linki pracowników':'Moje wersje broszury i linki'):'Wersje broszury i linki'}</h3>
      {!report.sources.length?<p className="text-xs text-white/40">Brak wersji PDF w tym widoku. Wygeneruj broszurę, aby otrzymać własny link.</p>:<div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="text-white/40"><tr>{['Wersja / data','Pracownik','Odbiorca / kampania','Akcje'].map(h=><th key={h} className="p-3 font-normal">{h}</th>)}</tr></thead><tbody>{report.sources.map(source=>{
        const link=demoUrl(source.demo_url);
        return <tr key={source.id} className="odd:bg-white/[.025]"><td className="p-3">Broszura v{source.version}<p className="mt-1 whitespace-nowrap text-white/40">{date(source.created_at)}</p></td><td className="p-3">{source.employee_name}</td><td className="p-3">{source.attribution?.campaignId?<a className="text-[#d3bb73]" href={`/crm/campaigns?campaign=${source.attribution.campaignId}`}>Zobacz kampanię</a>:source.attribution?.recipientEmail||'Bez wskazanego odbiorcy'}{!link&&<p className="mt-1 text-white/40">Bez linku śledzącego — wygeneruj nową wersję z włączonym demo.</p>}</td><td className="p-3"><ResponsiveActionBar alwaysDropdown compact disabledBackground actions={[
          {label:'Zobacz PDF',icon:<Eye className="h-4 w-4"/>,onClick:()=>void openPdf(source.id,source.pdf_path,'generated-brochures'),disabled:Boolean(opening)||deleting},
          {label:'Kopiuj przypisany link',icon:<Copy className="h-4 w-4"/>,onClick:()=>{if(link)void copyLink(link);},disabled:!link},
          {label:'Otwórz przypisane demo',icon:<ExternalLink className="h-4 w-4"/>,onClick:()=>{if(link)window.open(link,'_blank','noopener,noreferrer');},disabled:!link},
        ]}/></td></tr>;
      })}</tbody></table></div>}
    </div>
    <div><h3 className="mb-3 text-sm">Wygenerowane dokumenty — również anonimowe</h3>{!report.documents.length?<p className="text-xs text-white/40">Nikt jeszcze nie uruchomił generowania.</p>:<div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="text-white/40"><tr>{['Data','Osoba / organizacja','Pracownik','Źródło linku','Stan','Pobranie','Akcje'].map(h=><th key={h} className="p-3 font-normal">{h}</th>)}</tr></thead><tbody>{report.documents.map(d=><tr key={d.id} className="odd:bg-white/[.025]"><td className="whitespace-nowrap p-3 text-white/55">{date(d.created_at)}</td><td className="p-3"><p>{d.snapshot.fullName||'Próba anonimowa'}</p><p className="mt-1 text-white/40">{d.snapshot.organization||d.snapshot.email||'Bez danych kontaktowych'}</p></td><td className="p-3">{d.employee_name}</td><td className="p-3">{d.snapshot.attribution ? <><p>{d.snapshot.attribution.campaignId ? <a href={`/crm/campaigns?campaign=${d.snapshot.attribution.campaignId}`} className="text-[#d3bb73]">Kampania: {d.snapshot.attribution.campaignName || 'Otwórz kampanię'}</a> : d.snapshot.attribution.recipientEmail || 'Bez wskazanego odbiorcy'}</p><p className="mt-1 text-white/40">Broszura v{d.snapshot.attribution.version}</p>{d.snapshot.attribution.employeeId&&<a href={`/crm/employees/${d.snapshot.attribution.employeeId}`} className="mt-1 inline-block text-[#d3bb73]">Pracownik, który wygenerował broszurę</a>}</> : 'Link ogólny — bez przypisania'}</td><td className="p-3">{statusLabels[d.status]}</td><td className="p-3 text-white/50">{d.download_started_at?date(d.download_started_at):'—'}</td><td className="p-3"><ResponsiveActionBar alwaysDropdown compact disabledBackground actions={[
      {label:opening===d.id?'Otwieranie PDF…':'Zobacz PDF',icon:<Eye className="h-4 w-4"/>,onClick:()=>void open(d),disabled:!d.pdf_path||Boolean(opening)||deleting},
      {label:'Zobacz szczegóły',icon:<FileText className="h-4 w-4"/>,onClick:()=>setDetails(d),disabled:deleting},
      {label:'Usuń',icon:<Trash2 className="h-4 w-4"/>,variant:'danger',onClick:()=>{setDeleteError('');setToDelete(d);},disabled:disabled||deleting||Boolean(opening)||d.status==='generating'},
    ]}/></td></tr>)}</tbody></table></div>}</div>
    <div><h3 className="mb-3 text-sm">Dobrowolnie podane dane</h3>{!report.people.length?<p className="text-xs text-white/40">Brak danych kontaktowych na tej stronie wyników.</p>:<div className="overflow-auto"><table className="w-full text-left text-xs"><thead className="text-white/40"><tr>{['Osoba / organizacja','Pracownik','Kontakt','Personalizacja','Wejścia / PDF','Ostatnia zmiana'].map(h=><th key={h} className="p-3 font-normal">{h}</th>)}</tr></thead><tbody>{report.people.map(p=><tr key={p.id} className="odd:bg-white/[.025]"><td className="p-3">{p.full_name||'Bez imienia'}<p className="mt-1 text-white/40">{p.organization}</p></td><td className="p-3">{p.employee_name}</td><td className="p-3">{p.email||'—'}<p className="mt-1 text-white/40">{p.phone}</p></td><td className="p-3"><span>{p.logo_added?'Dodano logo':'Bez logo'}</span><div className="mt-2 flex gap-2">{[p.brand_config.primary,p.brand_config.accent,p.brand_config.surface].filter(Boolean).map((c,i)=><span key={i} title={c} className="h-4 w-4 rounded-full" style={{background:c}}/>)}</div></td><td className="p-3">{p.visits} / {p.pdfs}</td><td className="whitespace-nowrap p-3 text-white/50">{date(p.updated_at)}</td></tr>)}</tbody></table></div>}</div>
    <div className="flex items-center justify-between text-xs text-white/50"><button type="button" disabled={!offset||loading} onClick={()=>setOffset(o=>Math.max(0,o-50))} className="rounded-lg bg-white/5 px-3 py-2 disabled:opacity-30">Poprzednia strona</button><span>Strona {offset/50+1} · liczniki obejmują całą historię</span><button type="button" disabled={loading||(report.documents.length<50&&report.people.length<50&&report.sources.length<50)} onClick={()=>setOffset(o=>o+50)} className="rounded-lg bg-white/5 px-3 py-2 disabled:opacity-30">Następna strona</button></div></>}
    <Modal open={Boolean(details)} onClose={()=>setDetails(null)} title="Szczegóły próbnej oferty">
      {details&&<DemoDocumentDetails document={details}/>}
    </Modal>
    <Modal open={Boolean(toDelete)} onClose={()=>{if(!deleting)setToDelete(null);}} title="Usunąć próbną ofertę?">
      {toDelete&&<div className="space-y-5 text-sm"><p>Usuniesz dokument z {date(toDelete.created_at)} ({toDelete.snapshot.fullName||toDelete.snapshot.organization||'próba anonimowa'}) oraz zapisany plik PDF.</p><p className="text-xs leading-5 text-white/55">Tej operacji nie można cofnąć. Liczniki dokumentów i pobrań zostaną zaktualizowane. Dane sesji i historia wejść pozostaną zachowane.</p>{deleteError&&<p role="alert" className="text-red-300">{deleteError}</p>}<div className="flex justify-end gap-3"><button type="button" disabled={deleting} onClick={()=>setToDelete(null)} className="rounded-lg bg-white/5 px-4 py-2">Anuluj</button><button type="button" disabled={deleting} onClick={()=>void remove()} className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-red-300 disabled:opacity-50">{deleting?<Loader2 className="h-4 w-4 animate-spin"/>:<Trash2 className="h-4 w-4"/>}{deleting?'Usuwanie…':'Usuń dokument i PDF'}</button></div></div>}
    </Modal>
    {preview&&<div className="fixed inset-0 z-[100] flex flex-col bg-black/80 p-4 backdrop-blur-sm"><div className="mb-3 flex justify-end gap-4 text-sm"><a href={preview} target="_blank" rel="noreferrer" className="text-[#d3bb73]">Otwórz plik osobno</a><button type="button" onClick={()=>setPreview('')} className="inline-flex items-center gap-2"><X className="h-5 w-5"/>Zamknij podgląd</button></div><iframe title="Próbna oferta wygenerowana przez odwiedzającego" src={preview} className="min-h-0 w-full flex-1 rounded-lg bg-white"/></div>}
  </section>;
}

function DemoDocumentDetails({document:d}:{document:Document}) {
  const s=d.snapshot,a=s.attribution;
  const money=(value:string|undefined)=>{
    if(value==null||value==='')return 'Nie podano';
    const number=Number(value.replace(',','.'));
    return Number.isFinite(number)?number.toLocaleString('pl-PL',{style:'currency',currency:'PLN'}):'Nie podano';
  };
  return <div className="space-y-6 text-sm text-white/80">
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">{[
      ['Pracownik',d.employee_name],['Utworzono',date(d.created_at)],['Stan',statusLabels[d.status]],
      ['Uruchomiono pobranie',d.download_started_at?date(d.download_started_at):'Nie odnotowano'],
      ['Tytuł oferty',s.title||'Przykładowa oferta wydarzenia'],['Strona WWW',s.website||'Nie podano'],
      ['Imię i nazwisko',s.fullName||'Nie podano'],['Organizacja',s.organization||'Nie podano'],
      ['E-mail z formularza',s.email||'Nie podano'],['Telefon',s.phone||'Nie podano'],
    ].map(([label,value])=><div key={label}><dt className="text-xs text-white/40">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
    <div className="rounded-xl bg-black/15 p-4"><h3 className="text-sm">Źródło zainteresowania</h3>{a?<div className="mt-3 space-y-2 text-xs"><p>Wersja broszury: {a.version??'—'}</p><p>Odbiorca linku: {a.recipientEmail||'Nie wskazano'}</p>{a.campaignId&&<p>Kampania: <a href={`/crm/campaigns?campaign=${a.campaignId}`} className="text-[#d3bb73]">{a.campaignName||'Otwórz kampanię'}</a></p>}{a.employeeId&&<a href={`/crm/employees/${a.employeeId}`} className="inline-block text-[#d3bb73]">Zobacz pracownika, który wygenerował broszurę</a>}<p className="leading-5 text-white/40">Odbiorca linku i osoba podana w formularzu mogą być różni. Link mógł zostać przekazany dalej.</p></div>:<p className="mt-2 text-xs text-white/50">Link ogólny — bez przypisania do odbiorcy lub kampanii.</p>}</div>
    <div><h3 className="mb-3 text-sm">Ceny wpisane w demonstracji</h3><dl className="space-y-2 text-xs">{DEMO_PRODUCTS.map((p,i)=><div key={p.id} className="flex justify-between gap-4 rounded-lg bg-white/[.03] p-3"><dt>{p.name}</dt><dd>{money(s.prices?.[i])}{s.prices?.[i]!==undefined&&s.prices[i]!==''?' netto':''}</dd></div>)}</dl></div>
    <div><h3 className="mb-3 text-sm">Personalizacja</h3><p className="text-xs text-white/55">{s.logoAdded?'Dodano własne logo':'Bez własnego logo'} · {s.coverAdded?'Dodano własne zdjęcie okładki':'Domyślne zdjęcie okładki'} · {s.portraitAdded?'Dodano zdjęcie stopki':'Bez własnego zdjęcia stopki'}</p><div className="mt-3 flex flex-wrap gap-4">{[['Kolor główny',s.primary],['Akcent',s.accent],['Tło',s.surface]].map(([label,color])=>color&&/^#[0-9a-f]{6}$/i.test(color)?<div key={label} className="flex items-center gap-2 text-xs"><span className="h-6 w-6 rounded-full shadow-sm" style={{backgroundColor:color}}/><span>{label}<span className="mt-1 block text-white/40">{color}</span></span></div>:null)}</div></div>
    <p className="text-xs leading-5 text-white/35">Dane zapisane w chwili generowania tego dokumentu. Uruchomienie pobrania nie potwierdza zapisania pliku na dysku.</p>
  </div>;
}
