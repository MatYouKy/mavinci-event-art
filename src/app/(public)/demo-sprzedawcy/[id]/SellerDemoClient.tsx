'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Music, Monitor, Mic2, Check, ArrowRight, LockKeyhole } from 'lucide-react';
import { DEFAULT_DEMO, DEMO_PRODUCTS, DEMO_PORTRAIT_MAX_FILE_BYTES, DEMO_PORTRAIT_MAX_DATA_LENGTH, DEMO_PORTRAIT_MAX_EDGE, demoInputError, type SellerDemoInput } from '@/lib/seller/demo';
import DemoGenerationLoader from './DemoGenerationLoader';
import DemoCoverPreview from './DemoCoverPreview';
import { ImageDropzone } from '@/components/UI/ImageDropzone';
import { OfferBrandColorFields } from '@/components/seller/OfferIdentityFields';
const field = 'mt-2 w-full rounded-xl border border-white/10 bg-[var(--brand-burgundy-950)] px-4 py-3 text-sm text-[var(--brand-platinum)] outline-none placeholder:text-white/40 transition-colors focus:bg-[var(--brand-burgundy-900)]';
export default function SellerDemoClient({ brochureId, defaultCoverUrl, source = '' }: { brochureId: string; defaultCoverUrl: string; source?: string }) {
  const [input,setInput]=useState<SellerDemoInput>(DEFAULT_DEMO);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[uploading,setUploading]=useState<'logo'|'cover'|'portrait'|null>(null);
  const [error,setError]=useState(''),[success,setSuccess]=useState(''),[saveError,setSaveError]=useState('');
  const content=useRef<HTMLElement>(null), generating=useRef(false);
  useEffect(()=>{
    const element=content.current;
    if(!element)return;
    element.inert=busy;
    return()=>{element.inert=false;};
  },[busy]);
  const started=useRef(false), visit=useRef(''), dirty=useRef(false);
  const latest=useRef(input); latest.current=input;
  const endpoint=`/bridge/seller-demo/${brochureId}${source ? '?source='+encodeURIComponent(source) : ''}`;
  const post=async(data:unknown)=>{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(175000)});
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'Nie udało się wykonać operacji. Spróbuj ponownie.');}
    return response;
  };
  const start=async()=>{
    setError(''); visit.current ||= crypto.randomUUID();
    try{await post({action:'visit',visitId:visit.current});setReady(true);}catch(e){setError(e instanceof Error?e.message:'Nie udało się otworzyć demo.');}
  };
  useEffect(()=>{if(started.current)return;started.current=true;void start();},[]);
  const change=(patch:Partial<SellerDemoInput>)=>{dirty.current=true;setSuccess('');setInput(v=>({...v,...patch}));};
  // Capture an optional form attempt, not every keystroke. No client/customer data is requested.
  useEffect(()=>{
    if(!ready||!dirty.current||busy)return;
    let active=true;
    const timer=setTimeout(()=>{void post({action:'lead',input}).then(()=>{if(active)setSaveError('');}).catch(()=>{if(active)setSaveError('Nie udało się zapisać próby. Przy pobraniu spróbujemy ponownie.');});},1200);
    return()=>{active=false;clearTimeout(timer);};
  },[input,ready,busy]);
  const uploadImage=async(file:File,kind:'logo'|'cover'|'portrait')=>{
    setError('');setUploading(kind);
    try{
      const maxFileSize=kind==='portrait'?DEMO_PORTRAIT_MAX_FILE_BYTES:10*1024*1024;
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>maxFileSize)throw new Error(`Wybierz PNG, JPG lub WEBP, do ${kind==='portrait'?5:10} MB.`);
      const bitmap=await createImageBitmap(file);
      try{
        if(!bitmap.width||!bitmap.height)throw new Error('Nie udało się odczytać grafiki.');
        if(kind==='portrait'){
          const canvas=document.createElement('canvas');
          const context=canvas.getContext('2d');if(!context)throw new Error('Nie udało się odczytać zdjęcia.');
          let maxEdge=DEMO_PORTRAIT_MAX_EDGE,quality=0.78,data='';
          do{
            const scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
            canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
            context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
            context.drawImage(bitmap,0,0,canvas.width,canvas.height);
            data=canvas.toDataURL('image/jpeg',quality);
            if(data.length<=DEMO_PORTRAIT_MAX_DATA_LENGTH)break;
            if(quality>0.5)quality-=0.1;else maxEdge=Math.floor(maxEdge*.8);
          }while(maxEdge>=120);
          if(!data.startsWith('data:image/jpeg;base64,')||data.length>DEMO_PORTRAIT_MAX_DATA_LENGTH)throw new Error('Nie udało się wystarczająco zmniejszyć zdjęcia. Wybierz inny plik.');
          change({portrait:data});return;
        }
        let maxEdge=kind==='logo'?600:1200;
        const limit=kind==='logo'?750000:1500000;
        const canvas=document.createElement('canvas');
        const context=canvas.getContext('2d');if(!context)throw new Error('Nie udało się odczytać grafiki.');
        let data='';
        do{
          const scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height));
          canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
          context.drawImage(bitmap,0,0,canvas.width,canvas.height);
          data=canvas.toDataURL('image/png');maxEdge=Math.floor(maxEdge*.8);
        }while(data.length>limit&&maxEdge>=160);
        if(data.length>limit)throw new Error('Grafika jest zbyt złożona. Wybierz mniejszy plik.');
        change({[kind]:data});
      }finally{bitmap.close();}
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się wczytać grafiki.');}finally{setUploading(null);}
  };
  const coverUrl=input.cover||defaultCoverUrl;
  const generate=async()=>{
    if(generating.current||!ready||uploading!==null)return;
    const message=demoInputError(input);if(message){setError(message);return;}
    generating.current=true;setBusy(true);setError('');setSuccess('');
    try{
      const generationId=crypto.randomUUID();
      const response=await post({action:'pdf',input:latest.current,generationId});
      const blob=await response.blob();
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='oferta-demonstracyjna.pdf';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      setSuccess('Przykładowa oferta jest gotowa. Pobieranie PDF zostało uruchomione.');
      void post({action:'download',generationId}).catch(()=>{});
    }catch(e){setError(e instanceof Error?e.message:'Nie udało się wygenerować PDF.');}finally{generating.current=false;setBusy(false);}
  };
  return <><DemoGenerationLoader show={busy}/><main ref={content} aria-busy={busy} style={{backgroundImage:'linear-gradient(155deg, var(--brand-burgundy-850) 0%, var(--brand-burgundy-900) 38%, var(--brand-burgundy-950) 78%)'}} className="min-h-screen bg-[var(--brand-burgundy-950)] pb-20 pt-28 text-[var(--brand-platinum)]">
    <div className="mx-auto max-w-7xl px-5 md:px-8">
      <header className="mb-10 max-w-3xl"><p className="text-xs uppercase tracking-[.25em] text-[var(--brand-gold)]">Mavinci · strefa sprzedawcy</p><h1 className="mt-5 text-4xl font-light leading-tight md:text-6xl">Wasza marka.<br/><span className="text-[var(--brand-gold)]">Gotowa oferta wydarzenia.</span></h1><p className="mt-5 max-w-2xl text-base leading-7 text-white/65">Zobacz, jak usługi Mavinci mogą stać się częścią oferty Twojego hotelu lub agencji. Dodaj logo, wybierz zdjęcie i zobacz swoją okładkę. Kliknij „Sprawdź ofertę”, aby pobrać cały PDF ze stronami usług i kalkulacją.</p>
      <div className="mt-6 flex flex-wrap gap-3 text-xs text-white/70">{['Bez logowania','Wszystkie pola opcjonalne','Bez zobowiązań'].map(t=><span key={t} className="rounded-full bg-[var(--brand-burgundy-900)] px-4 py-2"><Check className="mr-2 inline h-3 w-3 text-[var(--brand-gold)]"/>{t}</span>)}</div></header>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="space-y-5">
          <div className="rounded-2xl bg-[var(--brand-burgundy-850)] p-6"><p className="text-xs uppercase tracking-widest text-[var(--brand-gold)]">01 / Twoja wizytówka</p><h2 className="mt-3 text-xl">Przedstaw się po swojemu</h2><p className="mt-2 text-sm leading-6 text-white/50">Możesz zostawić wszystkie pola puste. Dane, które wpiszesz, próba użycia i wygenerowany PDF będą widoczne dla zespołu Mavinci. Jeśli korzystasz z indywidualnego linku, próba zostanie również przypisana do odbiorcy wskazanego przez nadawcę broszury. Nie podawaj danych swoich klientów. <a className="underline" href="/polityka-prywatnosci" target="_blank" rel="noreferrer">Polityka prywatności</a>.</p>
          <fieldset disabled={busy} className="mt-5 grid gap-4 sm:grid-cols-2">{([{key:'fullName',label:'Imię i nazwisko',placeholder:'np. Anna Kowalska',max:120},{key:'organization',label:'Hotel lub agencja',placeholder:'Nazwa Twojej organizacji',max:160},{key:'email',label:'E-mail służbowy',placeholder:'Opcjonalnie',max:200},{key:'phone',label:'Telefon',placeholder:'Opcjonalnie',max:40},{key:'website',label:'Strona internetowa',placeholder:'np. https://hotel.pl',max:200}] as const).map(f=><label key={f.key} className="text-xs text-white/60">{f.label}<input type={f.key==='email'?'email':f.key==='phone'?'tel':'text'} maxLength={f.max} autoComplete={f.key==='fullName'?'name':f.key==='organization'?'organization':f.key==='phone'?'tel':f.key==='website'?'url':f.key} value={input[f.key]} onChange={e=>change({[f.key]:e.target.value})} placeholder={f.placeholder} className={field}/></label>)}</fieldset></div>
          <div className="rounded-2xl bg-[var(--brand-burgundy-850)] p-6"><p className="text-xs uppercase tracking-widest text-[var(--brand-gold)]">02 / Twoja marka</p><h2 className="mt-3 text-xl">Tytuł, zdjęcia i kolory oferty</h2>
            <label className="mt-5 block text-xs text-white/60">Przykładowy tytuł oferty<input type="text" maxLength={100} disabled={busy} value={input.title} onChange={e=>change({title:e.target.value})} placeholder="np. Konferencja i wieczór integracyjny" className={field}/></label><p className="mt-2 text-xs text-white/45">Tytuł zobaczysz na okładce. PDF zachowa oznaczenie dokumentu testowego.</p>
            <div className="mt-5 space-y-5">
              <div><p className="mb-2 text-xs text-white/60">Twoje logo</p><ImageDropzone label="Przeciągnij logo tutaj" hint="lub kliknij, aby wybrać · PNG, JPG, WEBP · do 10 MB" className="min-h-44" disabled={busy||uploading!==null} busy={uploading==='logo'} onFiles={files=>uploadImage(files[0],'logo')} preview={input.logo?<img src={input.logo} alt="Twoje logo" className="h-full w-full object-contain p-5 pb-12"/>:undefined}/>
              {input.logo&&<button type="button" disabled={busy||uploading!==null} onClick={()=>change({logo:''})} className="mt-2 text-xs text-white/50">Usuń logo</button>}</div>
              <div><p className="mb-2 text-xs text-white/60">Zdjęcie główne oferty</p><ImageDropzone label="Przeciągnij własne zdjęcie okładki" hint="lub kliknij, aby wybrać · PNG, JPG, WEBP · do 10 MB" className="min-h-52" disabled={busy||uploading!==null} busy={uploading==='cover'} onFiles={files=>uploadImage(files[0],'cover')} preview={coverUrl?<img src={coverUrl} alt={input.cover?'Twoja okładka':'Domyślna okładka Mavinci'} className="h-full w-full object-cover"/>:undefined}/>
              <p className="mt-2 text-xs leading-5 text-white/45">Domyślnie używamy zdjęcia głównego z szablonu oferty Mavinci. Przeciągnij własne zdjęcie, aby zobaczyć ofertę z Twoim obiektem.</p>
              {input.cover&&<button type="button" disabled={busy||uploading!==null} onClick={()=>change({cover:''})} className="mt-2 text-xs text-[var(--brand-gold)]">Przywróć zdjęcie Mavinci</button>}</div>
            </div>
            <div className="mt-5"><p className="mb-2 text-xs text-white/60">Zdjęcie do stopki — opcjonalnie</p><ImageDropzone label="Przeciągnij zdjęcie opiekuna" hint="lub kliknij, aby wybrać · PNG, JPG, WEBP · do 5 MB" className="min-h-44" disabled={busy||uploading!==null} busy={uploading==='portrait'} onFiles={files=>uploadImage(files[0],'portrait')} preview={input.portrait?<img src={input.portrait} alt="Zdjęcie opiekuna do stopki" className="h-full w-full object-contain p-4 pb-12"/>:undefined}/><p className="mt-2 text-xs leading-5 text-white/45">Automatycznie zmniejszamy zdjęcie do maksymalnie 480 px i kompresujemy do około 90 KB. Zdjęcie i adres strony zobaczysz na stronie kontaktowej w pobranym PDF. Pusty adres ukrywa ikonę strony.</p>{input.portrait&&<button type="button" disabled={busy||uploading!==null} onClick={()=>change({portrait:''})} className="mt-2 text-xs text-white/50">Usuń zdjęcie stopki</button>}</div>
            <div className="mt-5"><OfferBrandColorFields value={{brand_primary_color:input.primary,brand_secondary_color:input.accent,brand_surface_color:input.surface}} onChange={p=>change({...('brand_primary_color' in p?{primary:p.brand_primary_color||DEFAULT_DEMO.primary}:{}),...('brand_secondary_color' in p?{accent:p.brand_secondary_color||DEFAULT_DEMO.accent}:{}),...('brand_surface_color' in p?{surface:p.brand_surface_color||DEFAULT_DEMO.surface}:{})})} disabled={busy}/></div>
          </div>
          <div className="rounded-2xl bg-[var(--brand-burgundy-850)] p-6"><p className="text-xs uppercase tracking-widest text-[var(--brand-gold)]">03 / Próbna kalkulacja</p><h2 className="mt-3 text-xl">Sprawdź ofertę z własnymi cenami</h2><p className="mt-2 text-sm leading-6 text-white/50">Wpisz dowolne przykładowe ceny netto za 1 usługę. PDF pokaże kalkulację z VAT 23%. Wszystkie kwoty są opcjonalne.</p>
            <div className="mt-5 space-y-5">{DEMO_PRODUCTS.map((p,i)=>{const Icon=[Music,Mic2,Monitor][i];return <div key={p.id} className="rounded-xl bg-[var(--brand-burgundy-900)] p-4"><div className="flex gap-3"><Icon className="mt-1 h-5 w-5 shrink-0 text-[var(--brand-gold)]"/><div><p className="text-sm">{p.name}</p><p className="mt-1 text-xs leading-5 text-white/45">{p.description}</p></div></div><label className="mt-4 block text-xs text-white/60">{p.name} — cena netto (zł)<input type="text" inputMode="decimal" maxLength={12} disabled={busy} value={input.prices[i]} placeholder="Opcjonalnie, np. 1500,00" onChange={e=>change({prices:input.prices.map((v,j)=>i===j?e.target.value:v)})} className={field}/></label></div>;})}</div>
            <p className="mt-5 rounded-lg bg-[var(--brand-burgundy-900)] p-3 text-xs leading-5 text-white/60">To Twoje testowe kwoty, nie cennik Mavinci. Puste ceny pozostają nieuzupełnione. Szerszy katalog i warunki współpracy udostępnimy po jej rozpoczęciu.</p>
          </div>
          {error&&<p role="alert" className="rounded-xl bg-red-400/10 p-4 text-sm text-red-200">{error}{!ready&&<button type="button" onClick={()=>void start()} className="ml-2 underline">Ponów otwarcie</button>}</p>}
          {saveError&&<p role="status" className="text-xs text-amber-200">{saveError}</p>}
          {success&&<p role="status" className="rounded-xl bg-green-400/10 p-4 text-sm text-green-200">{success}</p>}
          <button type="button" disabled={!ready||busy||uploading!==null} onClick={()=>void generate()} className="flex w-full items-center justify-center gap-3 rounded-xl bg-[var(--brand-gold)] px-6 py-4 text-sm font-semibold text-[#260d17] disabled:opacity-50">{busy?<Loader2 className="h-5 w-5 animate-spin"/>:<Download className="h-5 w-5"/>}{busy?'Przygotowywanie PDF…':'Sprawdź ofertę — pobierz PDF'}</button><p className="text-center text-xs text-white/40">Plik zostanie pobrany bez przechodzenia do innej strony.</p>
        </section>
        <aside className="lg:sticky lg:top-24">
          <DemoCoverPreview endpoint={endpoint} ready={ready} title={input.title} organization={input.organization} primary={input.primary} accent={input.accent} logo={input.logo} cover={input.cover}/>
          <div className="mt-5 rounded-xl bg-[var(--brand-burgundy-850)] p-5">
            <p className="flex items-center gap-2 text-sm text-[var(--brand-gold)]"><LockKeyhole className="h-4 w-4"/>Poznaj całą ofertę</p>
            <p className="mt-2 text-xs leading-6 text-white/65">Strony usług, kalkulację i dane opiekuna zobaczysz w PDF po kliknięciu przycisku na końcu formularza.</p>
          </div>
          <div className="mt-6 rounded-xl bg-[var(--brand-burgundy-900)] p-5 text-sm leading-6 text-white/65"><p className="text-white">Tak może wyglądać Twoja codzienna praca.</p><p className="mt-2">Po rozpoczęciu współpracy otrzymasz dostęp do katalogu i ustalonych warunków. Oferty przedstawisz pod własną marką, a zakres realizacji omówisz z opiekunem Mavinci.</p><a href="mailto:mateusz@mavinci.pl?subject=Strefa%20sprzedawcy%20%E2%80%94%20wsp%C3%B3%C5%82praca" className="mt-4 inline-flex items-center gap-2 text-[var(--brand-gold)]">Porozmawiajmy o współpracy <ArrowRight className="h-4 w-4"/></a></div>
        </aside>
      </div>
    </div>
  </main></>;
}
