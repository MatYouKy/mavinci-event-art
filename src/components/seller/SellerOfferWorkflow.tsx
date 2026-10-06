'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Download, Eye, MessageSquare, Printer, RefreshCw, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { readSellerNotice, useSellerInbox } from '@/lib/seller/inbox';
import { useSellerSidebarBadge } from '@/lib/seller/sidebarBadge';
import SellerOfferConversation from './SellerOfferConversation';
import SellerOfferArrangements from './SellerOfferArrangements';
import SellerOwnerProfitPanel from './SellerOwnerProfitPanel';
import CreateSellerEventModal from './CreateSellerEventModal';
import { useOfferRefresh } from '@/lib/seller/useOfferRefresh';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { deliveryTimestamp, type DeliveryProgress } from '@/lib/seller/delivery';

type DocumentVersion={id:string;filename:string;created_at:string;source_key:string;current:boolean};
type Workflow={source?:{sales_partner_id:string;seller_contact_id?:string|null;seller_name:string;seller_organization:string;portal_client_company?:string;portal_client_name?:string;portal_client_email?:string;portal_client_phone?:string;event_date?:string;event_location?:string};review_notification_count?:number;can_manage:boolean;can_configure:boolean;source_key:string;recipient:string;title:string;offer_number:string;
 seller_progress?:DeliveryProgress;seller_progress_error?:string;
 realization?:{offer_status:string;stage:'offer'|'awaiting_crm_confirmation'|'confirmed'|'cancelled';event_id:string|null;event_status:string|null;can_view_event:boolean;can_create_event:boolean;migration_ready:boolean;crm_review_ready:boolean};
 documents:DocumentVersion[];config?:{manager_id?:string};
 manager?:{source:'contact'|'seller';contact_id:string|null;manager_id:string|null;manager_name:string|null;available_for_brand:boolean};manager_error?:string;
 review?:{document_id:string;source_key:string;status:string;request_note:string;response_note:string;requested_at?:string;reviewed_at?:string|null};
 chat?:{sales_partner_id:string;my_company_id:string;can_start:boolean};chat_error?:string;
 managers?:{id:string;name:string;surname:string}[]};
const field='min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30';
const button='inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';

export default function SellerOfferWorkflow({offerId,crm=false,onChanged,onRealizationChange,children,sidebarContent}:{offerId:string;crm?:boolean;onChanged?:()=>void;onRealizationChange?:(confirmed:boolean)=>void;children?:ReactNode;sidebarContent?:ReactNode}){
 const router=useRouter();
 const searchParams=useSearchParams();
 const requestedDocument=searchParams.get('document') || '';
 const requestedPreview=searchParams.get('preview')==='1';
 const requestedGeneration=searchParams.get('generate')==='1';
 const [state,setState]=useState<Workflow|null>(null);
 const [eventModalOpen,setEventModalOpen]=useState(false);
 const externalRefresh=useOfferRefresh(`id=eq.${offerId}`);
 const portalInbox=useSellerInbox(!crm);
 const crmInbox=useSellerSidebarBadge(crm);
 const inbox=crm ? crmInbox : portalInbox;
 useEffect(()=>{
   if(state && document.visibilityState==='visible') inbox.items
     .filter((item)=>item.offer_id===offerId && item.kind==='notification')
     .forEach((item)=>void readSellerNotice(item));
 },[state,offerId,inbox.items]);
 const [busy,setBusy]=useState('Wczytywanie oferty');
 const [message,setMessage]=useState('');
 const {showSnackbar}=useSnackbar();
 const notify=useCallback((text:string,type:'success'|'error'|'info'|'warning'='success')=>{
   setMessage(type==='error' || type==='warning' ? text : '');
   showSnackbar(text,type,type==='error' || type==='warning' ? 8000 : 5000);
 },[showSnackbar]);
 const [selectedId,setSelectedId]=useState('');
 const [pdfUrl,setPdfUrl]=useState('');
 const [pdfReady,setPdfReady]=useState(false);
 const [arrangementsReady,setArrangementsReady]=useState(false);
 const [arrangementsDirty,setArrangementsDirty]=useState(false);
 const [arrangementsRefresh,setArrangementsRefresh]=useState(0);
 const [finalConfirmation,setFinalConfirmation]=useState(false);
 const [checks,setChecks]=useState({date:false,resources:false,capacity:false});
 const [response,setResponse]=useState('');
 const [specialRequest,setSpecialRequest]=useState(false);
 const [discount,setDiscount]=useState(0);
 const [reason,setReason]=useState('');
 const [managerId,setManagerId]=useState('');
 const managerDirtyRef=useRef(false);
 const frameRef=useRef<HTMLIFrameElement>(null);
 const urlRef=useRef('');
 const lockRef=useRef(false);
 const autoRef=useRef(false);
 const handledPreviewRef=useRef('');
 const handledAnchorRef=useRef('');
 const mounted=useRef(true);
 const clientRequest=useRef<{key:string;id:string}|null>(null);
 const [submittedKey,setSubmittedKey]=useState('');
 const onChangedRef=useRef(onChanged);onChangedRef.current=onChanged;
 const stageCallbackRef=useRef(onRealizationChange);stageCallbackRef.current=onRealizationChange;

 useEffect(()=>{
   if(!crm || busy || !state?.review || state.review.status!=='pending')return;
   const item=inbox.items.find((entry)=>entry.kind==='review' && entry.offer_id===offerId
     && entry.document_id===state.review?.document_id && entry.created_at===state.review?.requested_at);
   const section=document.getElementById('seller-offer-review');
   if(!item?.read_token || !section)return;
   let visible=false,inFlight=false,finished=false;
   const acknowledge=()=>{
     if(!visible || inFlight || finished || document.visibilityState!=='visible')return;
     inFlight=true;
     void readSellerNotice(item,false).then((read)=>{finished=read;}).finally(()=>{inFlight=false;});
   };
   const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;acknowledge();});
   observer.observe(section);
   document.addEventListener('visibilitychange',acknowledge);
   return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',acknowledge);};
 },[crm,busy,state,offerId,inbox.items]);

 const api=useCallback(async(payload?:Record<string,unknown>)=>{
   const {data}=await supabase.auth.getSession();
   if(!data.session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
   const res=await fetch('/bridge/seller/offers/'+offerId,{
     method:payload ? 'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(payload?.action==='generate' || payload?.action==='document' ? 210000 : 45000),
     headers:{Authorization:'Bearer '+data.session.access_token,...(payload ? {'Content-Type':'application/json'}:{})},
     ...(payload ? {body:JSON.stringify(payload)} : {}),
   });
   if(!res.ok){
     const data=await res.json().catch(()=>({}));
     throw new Error(data.error || 'Serwer nie wykonał operacji ('+res.status+').');
   }
   return payload?.action==='document' ? res.blob() : res.json();
 },[offerId]);
 const reload=useCallback(async()=>{
   const data=await api() as Workflow;
   if(mounted.current){
     setState((current)=>JSON.stringify(current)===JSON.stringify(data) ? current : data);
     if(!managerDirtyRef.current)setManagerId(data.manager?.manager_id || '');
     setSelectedId((current)=>data.documents.some((doc)=>doc.id===current) ? current
       : data.documents.find((doc)=>doc.id===new URLSearchParams(window.location.search).get('document'))?.id || data.documents[0]?.id || '');
   }
   return data;
 },[api]);
 useEffect(()=>{
   mounted.current=true;
   void reload().catch((error)=>{if(mounted.current){notify(error.message,'error');setBusy('');}});
   return ()=>{mounted.current=false;if(urlRef.current)URL.revokeObjectURL(urlRef.current);};
 },[reload,notify]);
 useEffect(()=>{
   if(!externalRefresh || lockRef.current || arrangementsDirty || managerDirtyRef.current || eventModalOpen)return;
   void reload().then(()=>{setArrangementsRefresh((value)=>value+1);}).catch(()=>{});
   // Never replace an unsaved form; the next refresh catches up after editing.
 },[externalRefresh,reload]);
 useEffect(()=>{
   if(!state?.realization)return;
   onChangedRef.current?.();
   stageCallbackRef.current?.(state.realization.offer_status==='accepted' || state.realization.stage==='confirmed');
 },[state?.realization?.offer_status,state?.realization?.event_id,state?.realization?.event_status,state?.realization?.stage]);
 useEffect(()=>{
   setChecks({date:false,resources:false,capacity:false});setSpecialRequest(false);setDiscount(0);setReason('');setFinalConfirmation(false);
 },[state?.review?.document_id,selectedId]);
 useEffect(()=>{
   if(!state || busy)return;
   let frame=0;
   const scrollToSection=()=>{
     const target=window.location.hash.slice(1);
     if(target!=='seller-offer-review' && target!=='seller-offer-conversation')return;
     const key=`${offerId}:${requestedDocument}:${target}`;
     if(handledAnchorRef.current===key)return;
     window.cancelAnimationFrame(frame);
     frame=window.requestAnimationFrame(()=>{document.getElementById(target)?.scrollIntoView({block:'start'});handledAnchorRef.current=key;});
   };
   scrollToSection();
   window.addEventListener('hashchange',scrollToSection);
   return ()=>{window.cancelAnimationFrame(frame);window.removeEventListener('hashchange',scrollToSection);};
 },[Boolean(state),busy,offerId,requestedDocument,requestedPreview]);
 const run=async(title:string,action:()=>Promise<void>)=>{
   if(lockRef.current)return;
   lockRef.current=true;setBusy(title);setMessage('');
   try{await action();window.dispatchEvent(new Event('seller-workspace-changed'));}
   catch(error:any){if(mounted.current)notify(error?.name==='TimeoutError' ? 'Operacja trwała zbyt długo. Odśwież status przed ponowieniem; oferta mogła zostać zapisana.' : error?.message || 'Nie udało się wykonać operacji.','error');}
   finally{lockRef.current=false;if(mounted.current)setBusy('');}
 };
 const showPdf=async(id:string)=>{
   setPdfReady(false);
   const blob=await api({action:'document',documentId:id}) as Blob;
   if(!mounted.current)return;
   const url=URL.createObjectURL(blob);
   if(urlRef.current)URL.revokeObjectURL(urlRef.current);
   urlRef.current=url;setPdfUrl(url);setSelectedId(id);
 };
 const generate=async()=>{
   // Do not leave a historical PDF visible when a new generation fails.
   // Its saved version remains available through the version selector.
   setPdfReady(false);setPdfUrl('');
   if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current='';}
   const result=await api({action:'generate',requestId:crypto.randomUUID()});
   await reload();await showPdf(result.documentId);onChanged?.();
   notify('PDF został wygenerowany. Administratorzy otrzymali powiadomienie z dostępem do tej wersji.');
 };
 useEffect(()=>{
   if(!state)return;
   // A notification may select a different saved PDF while this component
   // remains mounted. Handle its document, not only the initial page load.
   if(requestedPreview && requestedDocument){
     if(handledPreviewRef.current===requestedDocument || lockRef.current)return;
     handledPreviewRef.current=requestedDocument;autoRef.current=true;
     void run('Otwieranie gotowej oferty',async()=>{
       setPdfReady(false);setPdfUrl('');setSelectedId(requestedDocument);
       if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current='';}
       const latest=await reload();
       const ready=latest.documents.find((doc)=>doc.id===requestedDocument);
       if(!ready)throw new Error('Wersja PDF wskazana w powiadomieniu jest niedostępna. Wybierz dostępną wersję lub odśwież status.');
       await showPdf(ready.id);
     });
     return;
   }
   handledPreviewRef.current='';
   if(autoRef.current)return;
   autoRef.current=true;
   if(!crm && requestedGeneration){
     if(state.realization?.offer_status==='accepted' || ['confirmed','cancelled'].includes(state.realization?.stage || '')){setBusy('');return;}
     const current=state.documents.find((doc)=>doc.current);
     void run(current ? 'Otwieranie oferty' : 'Generowanie PDF',async()=>{
       if(current)await showPdf(current.id);else await generate();
     });
   } else {setBusy('');}
 },[state,crm,requestedDocument,requestedPreview,requestedGeneration,busy]);
 const selected=state?.documents.find((doc)=>doc.id===selectedId);
 const currentReview=state?.review?.source_key===state?.source_key ? state?.review : undefined;
 const hasChatPanel=Boolean(state?.chat || state?.chat_error);
 const hasSidebar=hasChatPanel || Boolean(sidebarContent);
 const realization=state?.realization;
 const accepted=realization?.offer_status==='accepted';
 const confirmed=realization?.stage==='confirmed';
 const cancelled=realization?.stage==='cancelled';
 useEffect(()=>{
   if(!crm && (accepted || confirmed || cancelled)){
     router.replace(`/seller/realizations/${offerId}${window.location.search}${window.location.hash}`);
   }
 },[crm,accepted,confirmed,cancelled,offerId,router]);
 const pendingReview=currentReview?.status==='pending';
 const directReview=crm && state?.can_manage && !confirmed && !cancelled
   && ['draft','sent','viewed','accepted'].includes(realization?.offer_status || '')
   && (!currentReview || ['changes_requested','rejected'].includes(currentReview.status));
 const reviewDocumentId=pendingReview ? currentReview!.document_id : selected?.current ? selected.id : '';
 const managerContactId=state?.manager?.contact_id || state?.source?.seller_contact_id;
 const refreshDecision=async(notice:string)=>{
   // The write has already succeeded. Failure to refresh must not be presented
   // as a failed decision, nor invite applying a discount a second time.
   try{await reload();notify(notice);}
   catch{notify(notice+' Nie udało się odświeżyć widoku. Kliknij „Odśwież status”, nie zapisuj decyzji ponownie.','warning');}
   onChanged?.();setArrangementsRefresh((value)=>value+1);
 };
 const finishConfirmation=()=>void run('Potwierdzanie realizacji',async()=>{
   if(!currentReview || !finalConfirmation)throw new Error('Zaznacz osobne potwierdzenie realizacji.');
   await api({action:'confirm_realization',documentId:currentReview.document_id,confirm:true});
   await refreshDecision('Realizacja została potwierdzona w CRM. Sprzedawca otrzymał powiadomienie z linkiem do realizacji.');
   setFinalConfirmation(false);
 });
 const statuses:Record<string,string>={pending:'Oczekuje na ocenę opiekuna',approved:'Oferta zaakceptowana przez opiekuna',changes_requested:'Opiekun prosi o zmiany',rejected:'Brak akceptacji'};
 return <>
   {typeof document!=='undefined' && createPortal(<FullScreenLoader show={Boolean(busy)} title={busy} description="Proszę zaczekać. Nie klikaj ponownie ani nie zamykaj tego okna." />,document.body)}
   {crm && eventModalOpen && <CreateSellerEventModal offerId={offerId} api={api} onClose={()=>setEventModalOpen(false)} onCreated={(eventId)=>{
     setEventModalOpen(false);onChanged?.();window.dispatchEvent(new Event('seller-workspace-changed'));
     router.push(`/crm/events/${eventId}`);
   }}/>}
   <div className={`grid min-w-0 grid-cols-1 items-start gap-6 text-[#e5e4e2] ${hasSidebar ? 'lg:grid-cols-3' : ''}`}>
   <div className={`min-w-0 space-y-6 ${hasSidebar ? 'lg:col-span-2' : ''}`}>
   <section className="min-w-0 space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg uppercase">{accepted || confirmed ? 'Realizacja — dokumenty i ustalenia' : 'Oferta sprzedawcy — PDF i akceptacja'}</h2><p className="mt-1 text-xs text-white/45">{crm ? '1. Akceptacja oferty · 2. Osobne potwierdzenie wydarzenia przez CRM' : '1. Oferta dla klienta · 2. Akceptacja klienta i potwierdzenie MAVINCI · 3. Realizacja'}</p></div>
     <button type="button" className={button} onClick={()=>void run('Odświeżanie',async()=>{await reload();setArrangementsRefresh((value)=>value+1);})}><RefreshCw className="h-4 w-4"/> Odśwież status</button>
   </div>
   {message && <p role="alert" className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#e5e4e2]">{message}</p>}
   {!state && <p className="text-sm text-white/50">Wczytywanie danych. Jeśli widzisz błąd brakującej funkcji, potrzebna jest migracja 20260908233000.</p>}
   {state && <div className="min-w-0 space-y-4">
     {(accepted || confirmed) && <div role="status" className={`space-y-3 rounded-lg p-4 text-sm ${cancelled ? 'bg-rose-300/10 text-rose-200' : confirmed ? 'bg-emerald-300/10 text-emerald-200' : 'bg-amber-300/10 text-amber-100'}`}>
       <p className="font-medium">{cancelled ? 'Powiązane wydarzenie zostało anulowane.' : confirmed ? 'Realizacja potwierdzona przez CRM — wydarzenie jest zapisane.' : 'Oferta zaakceptowana — realizacja oczekuje na osobne potwierdzenie CRM.'}</p>
       {!confirmed && !cancelled && <p className="text-xs">Oferta jest już w Realizacjach sprzedawcy, ale nie stanowi jeszcze potwierdzenia wydarzenia.{crm ? ' Następny krok: uzupełnij wydarzenie i zatwierdź realizację poniżej.' : ' O ostatecznym potwierdzeniu poinformujemy Cię osobno.'}</p>}
       {crm && realization?.event_id && realization.can_view_event && <Link href={`/crm/events/${realization.event_id}`} className={button}>Przejdź do wydarzenia</Link>}
       {crm && realization?.event_id && realization.can_view_event && <Link href={`/crm/events/${realization.event_id}?tab=seller-arrangements&offer=${offerId}`} className={button}><MessageSquare className="h-4 w-4"/>Kontynuuj rozmowę i ustalenia w realizacji</Link>}
       {crm && !confirmed && !cancelled && <a href="#seller-offer-review" className={button}>Przejdź do potwierdzenia wydarzenia</a>}
       {!crm && <Link href={`/seller/realizations/${offerId}#seller-offer-conversation`} className={button}><MessageSquare className="h-4 w-4"/>Kontynuuj rozmowę w realizacji</Link>}
       {!crm && <Link href="/seller/realizations" className={button}>Przejdź do moich realizacji</Link>}
     </div>}
     {crm && state.source && <div className="grid gap-3 rounded-lg bg-[#d3bb73]/10 p-4 text-sm sm:grid-cols-2">
       <div className="sm:col-span-2"><p className="text-xs text-white/50">Odpowiedzialny za sprzedaż i realizację</p><p className="text-[#d3bb73]">{state.manager?.manager_name || 'Uzupełnij opiekuna w kontakcie sprzedawcy'}</p><p className="mt-1 text-xs text-white/55">Opiekun prowadzi temat od wyceny do rozliczenia. Sprzedawca zewnętrzny pozostaje źródłem sprzedaży i uczestnikiem ustaleń.</p></div>
       <div><p className="text-xs text-white/50">Sprzedawca</p><Link
         href={state.source.seller_contact_id ? `/crm/contacts/${state.source.seller_contact_id}?tab=seller` : `/crm/salespeople?seller=${state.source.sales_partner_id}`}
         title="Otwórz profil sprzedawcy" className="inline-block rounded-sm text-[#d3bb73] underline decoration-[#d3bb73]/30 underline-offset-4 transition-colors hover:decoration-[#d3bb73] focus-visible:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20"
       >{state.source.seller_name}</Link><p className="text-white/65">{state.source.seller_organization}</p></div>
       <div><p className="text-xs text-white/50">Klient podany przez sprzedawcę</p><p>{state.source.portal_client_company}</p><p>{state.source.portal_client_name}</p><p className="text-white/65">{state.source.portal_client_email} {state.source.portal_client_phone}</p></div>
       <div><p className="text-xs text-white/50">Termin i miejsce</p><p>{state.source.event_date ? new Date(state.source.event_date).toLocaleDateString('pl-PL') : 'Sprzedawca nie podał terminu'}</p><p>{state.source.event_location}</p></div>
       <a href="#seller-offer-review" className="self-center text-[#d3bb73] underline underline-offset-4">Przejdź do ustaleń i potwierdzenia</a>
       <a href={state.chat ? '#seller-offer-conversation' : `/crm/salespeople?seller=${state.source.sales_partner_id}&section=chat&offer=${offerId}`} className="self-center text-[#d3bb73] underline underline-offset-4">{accepted || confirmed ? 'Rozmowa ze sprzedawcą o realizacji' : 'Rozmowa ze sprzedawcą o tej ofercie'}</a>
     </div>}
     <div className="flex flex-wrap gap-2">
       <button type="button" className={button} onClick={()=>void run('Generowanie PDF',generate)}><RefreshCw className="h-4 w-4"/>{state.documents.length ? 'Regeneruj PDF' : 'Wygeneruj PDF'}</button>
       <button type="button" disabled={!selected} className={button} onClick={()=>void run('Otwieranie PDF',()=>showPdf(selectedId))}><Eye className="h-4 w-4"/>Pokaż ofertę</button>
       <button type="button" disabled={!selected} className={button} onClick={()=>void run('Pobieranie PDF',async()=>{
         const blob=await api({action:'document',documentId:selectedId,download:true}) as Blob;
         const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=selected!.filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
       })}><Download className="h-4 w-4"/>Pobierz</button>
       <button type="button" disabled={!pdfUrl || !pdfReady} className={button} onClick={()=>{
         try{frameRef.current?.contentWindow?.focus();frameRef.current?.contentWindow?.print();}
         catch{setMessage('Otwórz PDF w nowej karcie i użyj przycisku drukowania w przeglądarce.');}
       }}><Printer className="h-4 w-4"/>Drukuj ofertę</button>
       {!crm && state.chat && <a href="#seller-offer-conversation" className={button}><MessageSquare className="h-4 w-4"/>Napisz do opiekuna</a>}
     </div>
     {state.documents.length>0 && <label className="block text-xs text-white/50">Zapisane wersje PDF<select value={selectedId} onChange={(event)=>{setSelectedId(event.target.value);setPdfUrl('');if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current='';}}} className={field+' mt-1.5 !h-11'}>
       {state.documents.map((doc,index)=><option key={doc.id} value={doc.id}>Wersja {state.documents.length-index} · {new Date(doc.created_at).toLocaleString('pl-PL')} · {doc.current ? 'aktualna' : 'historyczna'}</option>)}
     </select></label>}
     {selected && !selected.current && <p className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">To historyczny PDF. Wygeneruj aktualny dokument, aby uwzględnić najnowsze dane i decyzję opiekuna. Zapisana akceptacja jest widoczna osobno poniżej.</p>}
     <p className="text-xs text-white/50">PDF możesz pobrać, wydrukować lub wysłać samodzielnie ze swojej skrzynki. Drukowanie jest dostępne po otwarciu podglądu przyciskiem „Pokaż ofertę”.</p>
     {pdfUrl && <div><a href={pdfUrl} target="_blank" rel="noreferrer" className="mb-2 inline-block text-xs text-[#d3bb73]">Otwórz PDF w nowej karcie / drukuj</a><iframe ref={frameRef} onLoad={()=>setPdfReady(true)} src={pdfUrl} title="Wygenerowana oferta PDF" className="h-[75vh] w-full rounded-lg bg-white"/></div>}
     <div id="seller-offer-review" className="scroll-mt-6 rounded-lg bg-[#0f1119]/70 p-4">
       <SellerOfferArrangements key={offerId} offerId={offerId} crm={crm} refreshKey={arrangementsRefresh}
         reviewedAt={state.review?.reviewed_at} onReadyChange={setArrangementsReady} onDirtyChange={setArrangementsDirty}
         onSaved={async()=>{await reload();onChanged?.();}}/>
       {crm && <div className="mt-5"><SellerOwnerProfitPanel key={offerId} offerId={offerId} refreshKey={externalRefresh + arrangementsRefresh}/></div>}
       <h3 className="mt-6 text-sm uppercase">Akceptacja oferty i potwierdzenie wydarzenia</h3>
       <p className="mt-2 text-xs text-white/50">To dwie osobne decyzje: zaakceptowana oferta trafia do Realizacji jako oczekująca. Dopiero pracownik CRM potwierdza wydarzenie. Sam zapis ustaleń nie cofa wcześniejszej akceptacji.</p>
       {realization?.migration_ready===false && <p role="alert" className="mt-3 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">{crm ? 'Akceptacja jest wyłączona do uruchomienia migracji 20260917150000 (po migracjach 20260911234500 i 20260911235000). Nic nie zostało zapisane przez ten przycisk.' : 'Administrator aktualizuje obsługę akceptacji. PDF i rozmowa pozostają dostępne.'}</p>}
       {crm && state.can_manage && currentReview?.status==='approved' && !accepted && !cancelled && <div className="mt-3 space-y-2 rounded-lg bg-amber-300/10 p-3 text-sm">
         <p>Wcześniejsza zgoda jest zapisana, ale oferta nie została jeszcze przeniesiona do Realizacji.</p>
         <button type="button" className={button} disabled={arrangementsDirty || !realization?.migration_ready} onClick={()=>void run('Zapisywanie akceptacji oferty',async()=>{
           await api({action:'accept_offer',documentId:currentReview.document_id});
           await refreshDecision('Oferta zaakceptowana. U sprzedawcy jest teraz realizacją oczekującą na osobne potwierdzenie CRM.');
         })}>Zapisz akceptację i przenieś do Realizacji</button>
       </div>}
       {accepted && <div className={`mt-4 space-y-3 rounded-lg p-4 text-sm ${cancelled ? 'bg-rose-300/10' : confirmed ? 'bg-emerald-300/10' : 'bg-amber-300/10'}`}>
         <h4 className="text-sm uppercase">{cancelled ? 'Wydarzenie anulowane' : confirmed ? '2. Realizacja potwierdzona przez CRM' : '2. Oczekuje na potwierdzenie realizacji przez CRM'}</h4>
         {!confirmed && !cancelled && <>
           <p>Akceptacja oferty jest zapisana. Wydarzenie nie jest jeszcze potwierdzone.</p>
           {crm && !realization?.can_create_event && <p className="text-xs text-white/60">Ten krok wykonuje pracownik z uprawnieniami do ofert i wydarzeń tej marki.</p>}
           {crm && realization?.can_create_event && realization.event_id && !realization.can_view_event && <p className="text-xs text-amber-200">Nie masz dostępu do powiązanego wydarzenia. Jego potwierdzenie wymaga pracownika z dostępem do tej realizacji.</p>}
           {crm && realization?.can_create_event && currentReview?.status==='approved' && (!realization.event_id || realization.can_view_event) && <>
             {realization.event_id ? <>
               <label className="flex items-start gap-2"><input type="checkbox" checked={finalConfirmation} onChange={(event)=>setFinalConfirmation(event.target.checked)} className="mt-1"/>Potwierdzam realizację wydarzenia po sprawdzeniu terminu, zasobów i ustaleń.</label>
               <button type="button" className={button} disabled={arrangementsDirty || !realization.migration_ready || !finalConfirmation} onClick={finishConfirmation}>Potwierdź realizację w CRM</button>
             </> : <button type="button" className={button} disabled={arrangementsDirty || !realization.migration_ready} onClick={()=>setEventModalOpen(true)}>Uzupełnij wydarzenie i potwierdź realizację</button>}
           </>}
           {!crm && <p className="text-xs text-white/60">Po decyzji CRM otrzymasz kolejne powiadomienie. Ustalenia możesz omówić z opiekunem na czacie.</p>}
         </>}
         {crm && realization?.event_id && realization.can_view_event && <Link href={`/crm/events/${realization.event_id}`} className={button}>Otwórz wydarzenie w CRM</Link>}
       </div>}
       {arrangementsDirty && <p className="mt-2 text-xs text-amber-200">Najpierw zapisz ustalenia albo wczytaj poprzednią wersję. Następnie możesz zapisać decyzję.</p>}
       {crm && state.review?.status==='pending' && state.review_notification_count===0 && <p className="mt-2 text-sm text-amber-200">Zapytanie jest zapisane, ale nie ma odbiorców powiadomienia. Administrator powinien uzupełnić konfigurację powiadomień. Zapytanie nadal można rozpatrzyć tutaj.</p>}
       {state.review && !currentReview && <div className="mt-2 text-sm text-amber-200"><p>Poprzednia decyzja dotyczy starszej wersji oferty. Do potwierdzenia należy przekazać aktualną wersję PDF.</p><button type="button" className={button+' mt-2'} onClick={()=>void run('Otwieranie poprzedniej wersji',()=>showPdf(state.review!.document_id))}>Pokaż poprzedni PDF</button></div>}
       <p className="mt-2 text-sm text-[#d3bb73]">{currentReview ? statuses[currentReview.status] : state.review ? 'Aktualna wersja wymaga nowej decyzji opiekuna.' : 'Brak zapisanej decyzji akceptacji. Przypisanie opiekuna nie oznacza zaakceptowania oferty.'}</p>
       {state.review && (state.review.request_note || state.review.response_note) && <details className="mt-3 rounded-lg bg-white/[0.035] p-3 text-sm"><summary className="cursor-pointer text-white/60">Ostatnie przekazanie i uzasadnienie decyzji</summary>
         {state.review.request_note && <p className="mt-3 whitespace-pre-wrap text-white/55">{state.review.request_note}</p>}
         {state.review.response_note && <p className="mt-3 whitespace-pre-wrap text-white/70">Odpowiedź opiekuna: {state.review.response_note}</p>}
       </details>}
       {!crm && <>
         {state.seller_progress_error && <p role="alert" className="mt-3 text-sm text-amber-200">{state.seller_progress_error}</p>}
         {state.seller_progress?.acceptances[0] && <p className="mt-3 text-xs leading-5 text-white/60">Akceptacja klienta potwierdzona przez sprzedawcę: {state.seller_progress.acceptances[0].seller_name} · {deliveryTimestamp(state.seller_progress.acceptances[0].confirmed_at)}.{state.seller_progress.acceptances[0].source_key!==state.source_key && ' Dotyczy wcześniejszej wersji — nie potwierdza zmian w aktualnej ofercie.'}</p>}
         {currentReview?.status==='pending' ? <p role="status" className="mt-3 rounded-lg bg-[#d3bb73]/10 p-3 text-sm">{state.seller_progress?.acceptances.some((item)=>item.source_key===currentReview.source_key) ? 'Klient zaakceptował · czekamy na decyzję opiekuna MAVINCI.' : 'Oferta przekazana · czekamy na decyzję opiekuna MAVINCI. To wcześniejsze zapytanie nie zawiera zapisu akceptacji klienta.'} Nie musisz wysyłać jej ponownie.</p> : !accepted && !confirmed && !cancelled && currentReview?.status!=='approved' && <div className="mt-4 space-y-3 rounded-lg bg-[#d3bb73]/10 p-4">
           <h4 className="text-sm uppercase">Następny krok: potwierdzenie klienta</h4>
           <p className="text-xs leading-5 text-white/65">Klikając poniżej, potwierdzasz zgodę klienta na wybraną, aktualną wersję PDF. Przekażemy ją opiekunowi. Nie jest to jeszcze potwierdzenie realizacji wydarzenia przez MAVINCI.</p>
           <button type="button" disabled={!state.seller_progress || !arrangementsReady || arrangementsDirty || !selected?.current || submittedKey===`${selectedId}:${state.source_key}` || !['draft','sent','viewed'].includes(realization?.offer_status || '')} className={button} onClick={()=>void run('Potwierdzanie akceptacji klienta i przekazywanie oferty',async()=>{
             const key=`${selectedId}:${state.source_key}`;
             if(clientRequest.current?.key!==key)clientRequest.current={key,id:crypto.randomUUID()};
             await api({action:'request_review',documentId:selectedId,requestId:clientRequest.current.id,clientConfirmed:true});
             setSubmittedKey(key);
             try{await reload();notify('Akceptacja klienta zapisana. Oferta czeka na decyzję opiekuna MAVINCI.');}
             catch{notify('Akceptacja i przekazanie zostały zapisane. Odśwież status — nie wysyłaj ponownie.','warning');}
           })}><Send className="h-4 w-4"/>{submittedKey===`${selectedId}:${state.source_key}` ? 'Przekazano — odśwież status' : 'Klient zaakceptował — przekaż do potwierdzenia'}</button>
           {!selected?.current && <p className="text-xs text-amber-200">Najpierw wygeneruj lub wybierz aktualny PDF i przedstaw tę wersję klientowi.</p>}
           <p className="text-xs text-white/45">Na etapie rozmów korzystaj z czatu. Nie przekazuj oferty jako zaakceptowanej, jeśli klient jeszcze nie podjął decyzji.</p>
         </div>}
       </>}
       {crm && state.can_manage && (pendingReview || directReview) && <>
         {directReview && <div className="mt-3 space-y-2 rounded-lg bg-white/[0.035] p-3 text-sm">
           <p>Możesz rozpatrzyć tę ofertę bezpośrednio w CRM — sprzedawca nie musi ponownie jej zgłaszać. Zapiszesz nową decyzję dla aktualnego PDF, bez usuwania wcześniejszej historii.</p>
           {!realization?.crm_review_ready && <p className="text-amber-200">Ta akcja wymaga migracji 20260917170000.</p>}
           {!reviewDocumentId && <p className="text-amber-200">Wybierz aktualną wersję PDF z listy powyżej albo użyj „Regeneruj PDF”. Historyczna wersja nie może zastąpić bieżącej oferty.</p>}
         </div>}
         <button type="button" disabled={!reviewDocumentId} className={button+' mt-3'} onClick={()=>void run('Otwieranie PDF do akceptacji',()=>showPdf(reviewDocumentId))}>{pendingReview ? 'Pokaż PDF z zapytania' : 'Pokaż PDF do akceptacji'}</button>
         {pendingReview && selectedId!==reviewDocumentId && <p className="mt-2 text-sm text-amber-200">Wybrano inny PDF niż przekazany do akceptacji. Kliknij „Pokaż PDF z zapytania”, aby odblokować decyzję dotyczącą właściwej wersji.</p>}
         <p className="mt-3 text-xs text-white/60">Przed akceptacją zaznacz trzy poniższe potwierdzenia. Ostateczne potwierdzenie wydarzenia pozostaje osobnym krokiem.</p>
         <div className="mt-4 flex flex-wrap gap-4">{([['date','Termin'],['resources','Sprzęt i zasoby'],['capacity','Zespół i moce przerobowe']] as const).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checks[key]} onChange={(event)=>setChecks({...checks,[key]:event.target.checked})}/>{label}</label>)}</div>
         <textarea aria-label="Uzasadnienie decyzji widoczne dla sprzedawcy" className={field+' mt-3'} rows={2} value={response} onChange={(event)=>setResponse(event.target.value)} placeholder="Uzasadnienie decyzji (opcjonalnie). Dyskusję prowadź na czacie — bez wewnętrznych ustaleń finansowych."/>
         <div className="mt-3 rounded-lg bg-white/[0.03] p-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={specialRequest} onChange={(event)=>{setSpecialRequest(event.target.checked);if(!event.target.checked)setDiscount(0);}}/>Rabat na specjalne życzenie — wyłącznie CRM</label>
           {specialRequest && <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]"><label className="text-xs">Rabat (%)<input type="number" min="0" max="100" step="0.01" value={discount} onChange={(event)=>setDiscount(Number(event.target.value))} className={field}/></label><label className="text-xs">Wewnętrzne uzasadnienie<input value={reason} onChange={(event)=>setReason(event.target.value)} className={field} placeholder="Kto poprosił i dlaczego?"/></label></div>}
         </div>
         <div className="mt-3 flex flex-wrap gap-2">{([['approved','Zaakceptuj ofertę i przygotuj realizację'],['changes_requested','Poproś o zmiany'],['rejected','Odrzuć']] as const).map(([decision,label])=><button key={decision} type="button" disabled={arrangementsDirty || !reviewDocumentId || selectedId!==reviewDocumentId || !realization?.migration_ready || Boolean(directReview && !realization?.crm_review_ready)} className={button} onClick={()=>void run('Zapisywanie decyzji',async()=>{
           if(decision==='approved' && (!checks.date || !checks.resources || !checks.capacity))throw new Error('Zaznacz: Termin, Sprzęt i zasoby oraz Zespół i moce przerobowe. Decyzja nie została jeszcze zapisana.');
           await api({action:realization?.crm_review_ready ? 'review_in_crm' : 'review',documentId:reviewDocumentId,decision,checks,response,
             expectedReview:state.review ?? null,discount:decision==='approved' ? discount : 0,specialRequest,reason});
           await refreshDecision(decision==='approved' ? 'Oferta zaakceptowana. Realizacja oczekuje na osobne potwierdzenie CRM.' : 'Decyzja została zapisana.');
         })}>{label}</button>)}</div>
       </>}
     </div>
     {crm && state.can_manage && <section className="space-y-3 rounded-lg bg-white/[0.03] p-4">
       <h3 className="text-sm uppercase">Opiekun sprzedawcy</h3>
       {state.manager_error ? <p className="text-sm text-amber-200">{state.manager_error}</p> : <>
         <p className="text-sm text-[#d3bb73]">{state.manager?.manager_name || 'Brak przypisanego opiekuna'}</p>
         {state.manager?.source==='contact' && <p className="text-xs text-white/55">Dziedziczony z „Odpowiedzialności za klienta” w kontakcie sprzedawcy. Nie trzeba zapisywać go ponownie dla każdej oferty ani po odświeżeniu.</p>}
         {state.manager?.manager_id && !state.manager.available_for_brand && <p className="text-xs text-amber-200">Przypisana osoba jest nieaktywna lub nie ma uprawnień do ofert tej marki. Powiadomienie o akceptacji musi odebrać uprawniony administrator.</p>}
       </>}
       {managerContactId && <Link href={`/crm/contacts/${managerContactId}?tab=customer360#contact-responsibility`} className={button}>Odpowiedzialność za klienta — zmień opiekuna</Link>}
       {state.manager?.source==='seller' && state.can_configure && <>
         <p className="text-xs text-white/45">Ten profil nie ma powiązanego kontaktu. Opiekun jest zapisany dla sprzedawcy i marki.</p>
         <label className="block text-xs">Opiekun<select value={managerId} onChange={(event)=>{setManagerId(event.target.value);managerDirtyRef.current=event.target.value!==(state.manager?.manager_id || '');}} className={field+' !h-11'}><option value="">Brak — administratorzy</option>{state.managers?.map((e)=><option key={e.id} value={e.id}>{e.name} {e.surname}</option>)}</select></label>
         <button type="button" disabled={!realization?.crm_review_ready || managerId===(state.manager.manager_id || '')} className={button} onClick={()=>void run('Zapisywanie opiekuna',async()=>{await api({action:'configure',managerId});managerDirtyRef.current=false;await reload();setArrangementsRefresh((value)=>value+1);notify('Opiekun został zapisany.');})}>{managerId===(state.manager.manager_id || '') ? 'Brak zmian do zapisania' : 'Zapisz zmianę opiekuna'}</button>
       </>}
     </section>}
   </div>}
   </section>
   {children}
   </div>
   {hasSidebar && <aside aria-label={crm ? 'Rozmowa ze sprzedawcą i informacje o ofercie' : 'Rozmowa z opiekunem'} className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]">
     {state?.chat && <SellerOfferConversation key={`${offerId}:${state.chat.sales_partner_id}:${state.chat.my_company_id}`} offerId={offerId} partnerId={state.chat.sales_partner_id} companyId={state.chat.my_company_id} canStart={state.chat.can_start} crm={crm} compact standalone realization={accepted || confirmed}/>}
     {state?.chat_error && <p className="shrink-0 rounded-xl bg-[#1c1f33] p-4 text-sm text-amber-200 sm:p-5">{state.chat_error}</p>}
     {sidebarContent && (hasChatPanel ? <details className="shrink-0 rounded-xl bg-[#1c1f33] lg:max-h-[30dvh] lg:overflow-y-auto lg:overscroll-contain">
       <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-[#e5e4e2]/75 transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/30">Informacje o ofercie</summary>
       <div className="space-y-4 p-3 pt-0">{sidebarContent}</div>
     </details> : <div className="min-h-0 space-y-6 lg:overflow-y-auto lg:overscroll-contain">{sidebarContent}</div>)}
   </aside>}
   </div>
 </>;
}
