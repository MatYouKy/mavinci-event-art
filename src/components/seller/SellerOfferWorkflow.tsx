'use client';

import SellerJourney from './SellerJourney';
import SellerRealizationWizard from './SellerRealizationWizard';
import SellerOfferReviewBrief from './SellerOfferReviewBrief';
import SellerReviewSubmission from './SellerReviewSubmission';
import type { ReviewHistoryCursor, ReviewHistoryPage } from '@/lib/seller/reviewThread';
import SellerEquipmentReview, { SellerEquipmentStatus, useSellerEquipmentReview } from './SellerEquipmentReview';
import { canConfirmEquipment } from '@/lib/seller/equipmentReview';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { useDialog } from '@/contexts/DialogContext';
import type { SellerReviewContext } from '@/lib/seller/review';
import { SellerOfferSummary, SellerOfferNextStep } from './SellerOfferOverview';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Download, Eye, MessageSquare, Printer, RefreshCw } from 'lucide-react';
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
import { sellerReviewIdentity, type DeliveryProgress, type SellerDeliveryState } from '@/lib/seller/delivery';

type DocumentVersion={id:string;filename:string;created_at:string;source_key:string;current:boolean};
type Workflow={review_context?:SellerReviewContext;source?:{sales_partner_id:string;seller_contact_id?:string|null;seller_name:string;seller_organization:string;portal_client_company?:string;portal_client_name?:string;portal_client_email?:string;portal_client_phone?:string;event_date?:string;event_location?:string};review_notification_count?:number;can_manage:boolean;can_configure:boolean;source_key:string;recipient:string;title:string;offer_number:string;
 offer_summary?:SellerDeliveryState['offer_summary'];offer_summary_error?:string;seller_arrangements?:SellerDeliveryState['seller_arrangements'];seller_arrangements_error?:string;
 seller_progress?:DeliveryProgress;seller_progress_error?:string;
 realization?:{offer_status:string;stage:'offer'|'awaiting_crm_confirmation'|'confirmed'|'cancelled';event_id:string|null;event_status:string|null;can_view_event:boolean;can_create_event:boolean;migration_ready:boolean;crm_review_ready:boolean;auto_event_ready:boolean};
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
 const {showConfirm}=useDialog();
 const notify=useCallback((text:string,type:'success'|'error'|'info'|'warning'='success')=>{
   setMessage(type==='error' || type==='warning' ? text : '');
   showSnackbar(text,type,type==='error' || type==='warning' ? 8000 : 5000);
 },[showSnackbar]);
 const [selectedId,setSelectedId]=useState('');
 const [pdfUrl,setPdfUrl]=useState('');
 const [pdfReady,setPdfReady]=useState(false);
 const [arrangementsDirty,setArrangementsDirty]=useState(false);
 const [arrangementsRefresh,setArrangementsRefresh]=useState(0);
 const [checks,setChecks]=useState({date:false,capacity:false});
 const [equipmentExceptionConfirmed,setEquipmentExceptionConfirmed]=useState(false);
 const [equipmentExceptionReason,setEquipmentExceptionReason]=useState('');
 const [response,setResponse]=useState('');
 const [confirmPastDate,setConfirmPastDate]=useState(false);
 const [responseError,setResponseError]=useState('');
 const [profitMounted,setProfitMounted]=useState(false);
 const [arrangementsMounted,setArrangementsMounted]=useState(false);
 const responseRef=useRef<HTMLTextAreaElement>(null);
 const [displayedDocumentId,setDisplayedDocumentId]=useState('');
 const frameRef=useRef<HTMLIFrameElement>(null);
 const urlRef=useRef('');
 const lockRef=useRef(false);
 const autoRef=useRef(false);
 const handledPreviewRef=useRef('');
 const handledCrmPreviewRef=useRef('');
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
 const loadReviewHistory=useCallback(async(before:ReviewHistoryCursor|null):Promise<ReviewHistoryPage>=>{
   return await api({action:'review_history',before}) as ReviewHistoryPage;
 },[api]);
 const reload=useCallback(async()=>{
   const data=await api() as Workflow;
   if(mounted.current){
     setState((current)=>JSON.stringify(current)===JSON.stringify(data) ? current : data);
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
   if(!externalRefresh || lockRef.current || arrangementsDirty || eventModalOpen)return;
   void reload().then(()=>{setArrangementsRefresh((value)=>value+1);}).catch(()=>{});
   // Never replace an unsaved form; the next refresh catches up after editing.
 },[externalRefresh,reload]);
 useEffect(()=>{
   if(!state?.realization)return;
   onChangedRef.current?.();
   stageCallbackRef.current?.(state.realization.offer_status==='accepted' || state.realization.stage==='confirmed');
 },[state?.realization?.offer_status,state?.realization?.event_id,state?.realization?.event_status,state?.realization?.stage]);
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
   setPdfReady(false);setDisplayedDocumentId('');setPdfUrl('');
   if(urlRef.current){URL.revokeObjectURL(urlRef.current);urlRef.current='';}
   const blob=await api({action:'document',documentId:id}) as Blob;
   if(!mounted.current)return;
   const url=URL.createObjectURL(blob);
   if(urlRef.current)URL.revokeObjectURL(urlRef.current);
   urlRef.current=url;setPdfUrl(url);setSelectedId(id);setDisplayedDocumentId(id);
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
   if(crm){
     // A link from an older notification must not pin the review to an old PDF.
     // A pending, current submission owns the decision's immutable document.
     const pending=state.review?.status==='pending' && state.review.source_key===state.source_key;
     const linked=requestedPreview && requestedDocument ? requestedDocument : '';
     const id=pending ? state.review!.document_id
       : linked || state.review?.document_id || state.documents.find(doc=>doc.current)?.id || state.documents[0]?.id;
     const key=JSON.stringify([offerId,id,state.review?.requested_at,linked]);
     if(handledCrmPreviewRef.current===key || lockRef.current)return;
     handledCrmPreviewRef.current=key;autoRef.current=true;
     // Manual selection in document history does not change this key.
     if(id)void run('Otwieranie PDF do oceny',()=>showPdf(id));else setBusy('');
     return;
   }
   // Seller notification links retain the explicitly requested document.
   if(requestedPreview && requestedDocument && handledPreviewRef.current!==requestedDocument){
     if(lockRef.current)return;
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
   if(!requestedPreview || !requestedDocument)handledPreviewRef.current='';
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
 const reviewRound=JSON.stringify(sellerReviewIdentity(state?.review));
 const submissionContextKey=JSON.stringify([offerId,selectedId,state?.source_key,reviewRound]);
 const hasChatPanel=Boolean(state?.chat || state?.chat_error);
 const hasSidebar=hasChatPanel || Boolean(sidebarContent);
 const realization=state?.realization;
 const accepted=realization?.offer_status==='accepted';
 const confirmed=realization?.stage==='confirmed';
 const cancelled=realization?.stage==='cancelled';
 const equipmentReview=useSellerEquipmentReview(offerId,crm && Boolean(state?.can_manage) && !accepted && !confirmed && !cancelled,state?.review_context?.key);
 useEffect(()=>{
   if(!crm && (accepted || confirmed || cancelled)){
     router.replace(`/seller/realizations/${offerId}${window.location.search}${window.location.hash}`);
   }
 },[crm,accepted,confirmed,cancelled,offerId,router]);
 const pendingReview=currentReview?.status==='pending';
 const directReview=crm && state?.can_manage && !confirmed && !cancelled
   && !accepted && ['draft','sent','viewed'].includes(realization?.offer_status || '')
   && (!currentReview || ['changes_requested','rejected'].includes(currentReview.status));
 const reviewDocumentId=pendingReview ? currentReview!.document_id : selected?.current ? selected.id : '';
 // Keep the decision tied to the loaded, immutable PDF of this submission.
 const reviewPdfLoaded=Boolean(reviewDocumentId && displayedDocumentId===reviewDocumentId && pdfUrl && pdfReady);
 const decisionScope=JSON.stringify([offerId,reviewRound,state?.source_key,state?.review_context?.key,reviewDocumentId]);
 useEffect(()=>{
   setChecks({date:false,capacity:false});setConfirmPastDate(false);
   setResponseError('');setResponse('');
 },[decisionScope]);
 useEffect(()=>{
   setEquipmentExceptionConfirmed(false);setEquipmentExceptionReason('');
 },[equipmentReview.data?.key,decisionScope]);
 const canDecide=Boolean(state?.can_manage && !accepted && !confirmed && !cancelled && (pendingReview || directReview));
 const decisionBlockers:string[]=[];
 if(busy)decisionBlockers.push('Poczekaj na zakończenie bieżącej operacji.');
 if(arrangementsDirty)decisionBlockers.push('Zapisz ustalenia lub wczytaj poprzednią wersję.');
 if(!reviewPdfLoaded)decisionBlockers.push(!reviewDocumentId ? 'Potrzebny jest aktualny PDF przekazany do oceny.'
   : displayedDocumentId===reviewDocumentId && pdfUrl ? 'Poczekaj na wczytanie podglądu PDF z aktualnego zapytania.'
     : 'Wczytaj PDF z aktualnego zapytania — inna wersja nie może zostać zaakceptowana.');
 if(!state?.review_context)decisionBlockers.push('Odśwież status — nie wczytano danych do oceny.');
 if(!realization?.migration_ready)decisionBlockers.push('Obsługa akceptacji wymaga aktualizacji przez administratora.');
 if(directReview && !realization?.crm_review_ready)decisionBlockers.push('Bezpośrednia ocena wymaga aktualizacji przez administratora.');
 const approvalBlockers=[...decisionBlockers];
 if(!realization?.auto_event_ready)approvalBlockers.push('Automatyczne tworzenie wydarzenia wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql.');
 if(!realization?.can_create_event)approvalBlockers.push('Akceptacja tworzy wydarzenie — potrzebujesz uprawnień do ofert i wydarzeń tej marki.');
 if(state?.review_context?.date_error)approvalBlockers.push(state.review_context.date_error);
 if(!state?.offer_summary)approvalBlockers.push('Odśwież status — nie udało się wczytać zakresu oferty.');
 else if(!state.offer_summary.items.length)approvalBlockers.push('Sprzedawca musi uzupełnić pozycje oferty.');
 if(!checks.date)approvalBlockers.push('Zaznacz „Sprawdzono termin”.');
 if(!checks.capacity)approvalBlockers.push('Zaznacz „Sprawdzono dostępność zespołu”.');
 if(equipmentReview.busy)approvalBlockers.push('Trwa sprawdzanie dostępności sprzętu.');
 else if(!canConfirmEquipment(equipmentReview.data,equipmentExceptionConfirmed,equipmentExceptionReason)){
   approvalBlockers.push(!equipmentReview.data ? 'Ponów analizę sprzętu — nie ma aktualnego wyniku.'
     : !equipmentExceptionConfirmed ? 'Wyjaśnij braki sprzętu lub potwierdź osobną weryfikację w sekcji kontroli sprzętu.'
       : 'Uzupełnij uzasadnienie zapewnienia sprzętu (10–2000 znaków).');
 }
 if(state?.review_context?.past_date && !confirmPastDate)approvalBlockers.push('Potwierdź świadomą ocenę terminu z przeszłości albo poproś o poprawienie daty.');
 const decisionDisabled=decisionBlockers.length>0;
 const approvalDisabled=approvalBlockers.length>0;
 const refreshDecision=async(notice:string)=>{
   // The write has already succeeded. Failure to refresh must not be presented
   // as a failed decision, nor invite sending the decision a second time.
   try{await reload();notify(notice);}
   catch{notify(notice+' Nie udało się odświeżyć widoku. Kliknij „Odśwież status”, nie zapisuj decyzji ponownie.','warning');}
   onChanged?.();setArrangementsRefresh((value)=>value+1);
 };

 const submitDecision=async(decision:'approved'|'changes_requested'|'rejected')=>{
   if(!state || !canDecide || decisionDisabled || lockRef.current)return;
   if(decision!=='approved' && !response.trim()){
     setResponseError('Napisz, co sprzedawca ma poprawić lub dlaczego odrzucasz ofertę.');
     responseRef.current?.focus();return;
   }
   if(decision==='rejected' && !(await showConfirm({title:'Odrzucić ofertę?',message:'Sprzedawca otrzyma odmowę wraz z wpisanym uzasadnieniem. Dokument i historia pozostaną zapisane.',confirmText:'Odrzuć ofertę',cancelText:'Wróć do oceny'})))return;
   void run('Zapisywanie decyzji',async()=>{
     if(decision==='approved' && approvalDisabled)throw new Error(approvalBlockers.join(' '));
     try {
       await api({action:realization?.crm_review_ready ? 'review_in_crm' : 'review',documentId:reviewDocumentId,decision,checks,response:response.trim(),
         expectedReview:state.review ?? null,expectedContextKey:state.review_context?.key,confirmPastDate,
         equipmentKey:equipmentReview.data?.key,equipmentException:{confirmed:equipmentExceptionConfirmed,reason:equipmentExceptionReason}});
     } catch(error) {
       if(decision==='approved')void equipmentReview.refresh();
       throw error;
     }
     setResponse('');
     await refreshDecision(decision==='approved' ? 'Oferta zaakceptowana i powiązana z wydarzeniem w CRM. Możesz przygotować Timeline, zespół, agendę i logistykę. Realizacja nadal oczekuje na potwierdzenie.' : 'Decyzja i wiadomość dla sprzedawcy zostały zapisane.');
   });
 };
 const statuses:Record<string,string>={pending:'Oczekuje na ocenę opiekuna',approved:'Oferta zaakceptowana przez opiekuna',changes_requested:'Opiekun prosi o zmiany',rejected:'Brak akceptacji'};
 return <>
   {typeof document!=='undefined' && createPortal(<FullScreenLoader show={Boolean(busy)} title={busy} description="Proszę zaczekać. Nie klikaj ponownie ani nie zamykaj tego okna." />,document.body)}
   {crm && eventModalOpen && <CreateSellerEventModal offerId={offerId} api={api} onClose={()=>setEventModalOpen(false)} onCreated={(eventId)=>{
     setEventModalOpen(false);onChanged?.();window.dispatchEvent(new Event('seller-workspace-changed'));
     router.push(`/crm/events/${eventId}?tab=seller-arrangements&offer=${offerId}`);
   }}/>}
   <div className={`grid min-w-0 grid-cols-1 items-start gap-6 text-[#e5e4e2] ${hasSidebar ? 'lg:grid-cols-3' : ''}`}>
   <div className={`min-w-0 space-y-6 ${hasSidebar ? 'lg:col-span-2' : ''}`}>
   <section className="min-w-0 space-y-4 rounded-xl bg-[#1c1f33] p-4 sm:p-5">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg uppercase">{accepted || confirmed ? 'Realizacja — dokumenty i ustalenia' : crm ? 'Ocena oferty sprzedawcy' : state?.title || 'Twoja oferta'}</h2><p className="mt-1 text-xs text-white/45">{crm ? 'Sprawdź zakres i PDF, porozmawiaj ze sprzedawcą i zapisz decyzję. Potwierdzenie wydarzenia to następny krok.' : 'Zakres oferty, decyzja klienta i jedna rozmowa z opiekunem.'}</p></div>
     <button type="button" className={button} onClick={()=>void run('Odświeżanie',async()=>{await reload();setArrangementsRefresh((value)=>value+1);})}><RefreshCw className="h-4 w-4"/> Odśwież status</button>
   </div>
   {message && <p role="alert" className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#e5e4e2]">{message}</p>}
   {!state && <p className="text-sm text-white/50">Wczytywanie danych. Jeśli widzisz błąd brakującej funkcji, potrzebna jest migracja 20260908233000.</p>}
   {state && <div className="min-w-0 space-y-4">
     {!crm && <>
       <SellerOfferNextStep key={`${offerId}:${reviewRound}`} offerId={offerId} state={state}
         selected={selected} busy={Boolean(busy)} submitted={submittedKey===submissionContextKey}
         onPreparePdf={()=>void run('Przygotowanie aktualnego PDF',async()=>{
           const current=state.documents.find(document=>document.current);
           if(current)await showPdf(current.id);else await generate();
         })}
         onConfirm={(correction)=>void run(correction ? 'Przekazywanie poprawek do weryfikacji' : 'Przekazywanie akceptacji klienta',async()=>{
           // A new caretaker decision starts a new submission round, even for
           // the same PDF. Identical retries retain their request ID.
           const key=JSON.stringify([submissionContextKey,correction?.note || '',correction?.confirmed===true]);
           if(clientRequest.current?.key!==key)clientRequest.current={key,id:crypto.randomUUID()};
           const result=await api({action:'request_review',documentId:selectedId,requestId:clientRequest.current.id,clientConfirmed:true,
             expectedReview:sellerReviewIdentity(state.review),expectedSourceKey:state.source_key,
             ...(correction ? {correctionNote:correction.note,correctionsConfirmed:correction.confirmed} : {})});
           setSubmittedKey(submissionContextKey);
           try{
             await reload();
             notify(result.alreadySubmitted ? 'To przekazanie zostało już zapisane. Wczytano bieżący status oferty.'
               : correction ? 'Poprawki i odpowiedź przekazane do ponownej weryfikacji. Opiekun otrzymał powiadomienie.'
               : 'Akceptacja klienta zapisana. Opiekun otrzymał ofertę do potwierdzenia.');
           }
           catch{notify('Przekazanie jest zapisane. Odśwież status — nie wysyłaj ponownie.','warning');}
         })} />
       <SellerJourney state={state} submitted={submittedKey===submissionContextKey} />
       <SellerOfferSummary state={state} />
     </>}
     {(accepted || confirmed) && <div role="status" className={`space-y-3 rounded-lg p-4 text-sm ${cancelled ? 'bg-rose-300/10 text-rose-200' : confirmed ? 'bg-emerald-300/10 text-emerald-200' : 'bg-amber-300/10 text-amber-100'}`}>
       <p className="font-medium">{cancelled ? 'Powiązane wydarzenie zostało anulowane.' : confirmed ? 'Realizacja potwierdzona przez CRM — wydarzenie jest zapisane.' : 'Oferta zaakceptowana — realizacja oczekuje na osobne potwierdzenie CRM.'}</p>
       {!confirmed && !cancelled && <p className="text-xs">Oferta jest już w Realizacjach sprzedawcy, ale nie stanowi jeszcze potwierdzenia wydarzenia.{crm ? ' Następny krok: uzupełnij wydarzenie i zatwierdź realizację poniżej.' : ' O ostatecznym potwierdzeniu poinformujemy Cię osobno.'}</p>}
       {crm && realization?.event_id && realization.can_view_event && <Link href={`/crm/events/${realization.event_id}`} className={button}>Przejdź do wydarzenia</Link>}
       {crm && realization?.event_id && realization.can_view_event && <Link href={`/crm/events/${realization.event_id}?tab=seller-arrangements&offer=${offerId}`} className={button}><MessageSquare className="h-4 w-4"/>Kontynuuj rozmowę i ustalenia w realizacji</Link>}
       {crm && !confirmed && !cancelled && <a href="#seller-offer-review" className={button}>Przejdź do potwierdzenia wydarzenia</a>}
       {!crm && <Link href={`/seller/realizations/${offerId}#seller-offer-conversation`} className={button}><MessageSquare className="h-4 w-4"/>Kontynuuj rozmowę w realizacji</Link>}
       {!crm && <Link href="/seller/realizations" className={button}>Przejdź do moich realizacji</Link>}
     </div>}
     {crm && <>
       <SellerOfferReviewBrief state={state} managerName={state.manager?.manager_name}
         sellerHref={state.source?.seller_contact_id ? `/crm/contacts/${state.source.seller_contact_id}?tab=seller` : state.source ? `/crm/salespeople?seller=${state.source.sales_partner_id}` : undefined}/>
       {state.review_context?.date_error && <p role="alert" className="rounded-lg bg-rose-300/10 p-3 text-sm text-rose-200">{state.review_context.date_error}</p>}
       {state.review_context?.past_date && <p role="alert" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">Uwaga: termin wydarzenia jest w przeszłości. Sprawdź rok i poproś sprzedawcę o poprawkę, jeśli to pomyłka. Nie zmieniamy daty automatycznie.</p>}
     </>}
     <div id="seller-offer-documents" className="scroll-mt-6 space-y-3">
     <h3 className="text-sm uppercase">{crm ? 'PDF przekazany do oceny' : 'PDF dla klienta'}</h3>
     {crm && state.review && <p className="text-xs text-white/55">Zapytanie z {state.review.requested_at ? new Date(state.review.requested_at).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw'}) : 'wcześniejszego przekazania'}. Oceniasz tę zapisaną wersję — bez ponownego generowania.</p>}
     {crm && pendingReview && requestedPreview && requestedDocument && requestedDocument!==currentReview?.document_id && displayedDocumentId===currentReview?.document_id && <p className="text-xs text-[#d3bb73]">Link wskazywał starszy PDF. Wczytano dokument z najnowszego przekazania sprzedawcy. Poprzednie wersje pozostają w historii.</p>}
     <div className="flex flex-wrap gap-2">
       {!crm && <button type="button" className={button} onClick={()=>void run('Generowanie PDF',generate)}><RefreshCw className="h-4 w-4"/>{state.documents.length ? 'Regeneruj PDF' : 'Wygeneruj PDF'}</button>}
       {(!crm || !pdfUrl) && <button type="button" disabled={!selected || Boolean(busy)} className={button} onClick={()=>void run('Otwieranie PDF',()=>showPdf(selectedId))}><Eye className="h-4 w-4"/>{crm ? 'Wczytaj PDF' : 'Pokaż ofertę'}</button>}
       {crm ? <ResponsiveActionBar alwaysDropdown compact actions={[
         {label:'Pobierz zapisany PDF',icon:<Download className="h-4 w-4"/>,disabled:!selected || Boolean(busy),onClick:()=>void run('Pobieranie PDF',async()=>{
           const blob=await api({action:'document',documentId:selectedId,download:true}) as Blob;
           const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=selected!.filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
         })},
         {label:'Drukuj PDF',icon:<Printer className="h-4 w-4"/>,disabled:!pdfUrl || !pdfReady || Boolean(busy),onClick:()=>{
           try{frameRef.current?.contentWindow?.focus();frameRef.current?.contentWindow?.print();}
           catch{notify('Otwórz PDF w nowej karcie i wydrukuj go z przeglądarki.','info');}
         }},
       ]}/> : <>
       <button type="button" disabled={!selected} className={button} onClick={()=>void run('Pobieranie PDF',async()=>{
         const blob=await api({action:'document',documentId:selectedId,download:true}) as Blob;
         const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=selected!.filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),30000);
       })}><Download className="h-4 w-4"/>Pobierz</button>
       <button type="button" disabled={!pdfUrl || !pdfReady} className={button} onClick={()=>{
         try{frameRef.current?.contentWindow?.focus();frameRef.current?.contentWindow?.print();}
         catch{setMessage('Otwórz PDF w nowej karcie i użyj przycisku drukowania w przeglądarce.');}
       }}><Printer className="h-4 w-4"/>Drukuj ofertę</button>
       </>}
       {!crm && state.chat && <a href="#seller-offer-conversation" className={button}><MessageSquare className="h-4 w-4"/>Napisz do opiekuna</a>}
     </div>
     {state.documents.length>0 && <details open={!crm} className="rounded-lg bg-white/[0.025] p-3">
       <summary className="cursor-pointer text-xs text-white/60">Historia dokumentów ({state.documents.length})</summary>
       <label className="block text-xs text-white/50">Zapisane wersje PDF<select value={selectedId} disabled={Boolean(busy)} onChange={(event)=>{
       const id=event.target.value;setSelectedId(id);
       void run('Otwieranie zapisanej wersji',()=>showPdf(id));
     }} className={field+' mt-1.5 !h-11'}>
       {state.documents.map((doc,index)=><option key={doc.id} value={doc.id}>Wersja {state.documents.length-index} · {new Date(doc.created_at).toLocaleString('pl-PL')} · {doc.current ? 'aktualna' : 'historyczna'}</option>)}
     </select></label></details>}
     {selected && !selected.current && !(currentReview?.status==='approved' && selected.id===currentReview.document_id) && <p className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">{crm ? 'Ten PDF nie odpowiada bieżącym danym oferty. Nie zastępuje nowej wersji od sprzedawcy. Wcześniejsza decyzja pozostaje w historii.' : 'To historyczny PDF. Wygeneruj aktualny dokument, aby uwzględnić najnowsze dane i decyzję opiekuna. Zapisana akceptacja jest widoczna osobno poniżej.'}</p>}
     {!crm && <p className="text-xs text-white/50">PDF możesz pobrać, wydrukować lub wysłać samodzielnie ze swojej skrzynki. Drukowanie jest dostępne po otwarciu podglądu.</p>}
     {crm && !state.documents.length && <p className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">Sprzedawca nie przekazał jeszcze PDF. Poproś o wygenerowanie i przekazanie oferty.</p>}
     {pdfUrl && <div><a href={pdfUrl} target="_blank" rel="noreferrer" className="mb-2 inline-block text-xs text-[#d3bb73]">Otwórz PDF w nowej karcie / drukuj</a><iframe key={displayedDocumentId} ref={frameRef} onLoad={()=>setPdfReady(true)} src={pdfUrl} title="Wygenerowana oferta PDF" className="h-[75vh] w-full rounded-lg bg-white"/></div>}
     </div>
     {crm && <div id="seller-offer-review" className="scroll-mt-6 rounded-lg bg-[#0f1119]/70 p-4">
       <h3 className="text-sm uppercase">{accepted ? 'Oferta zaakceptowana — następny krok' : 'Decyzja opiekuna'}</h3>
       <p className="mt-2 text-xs text-white/55">Akceptujesz zakres i możliwość obsługi. Nie zmieniasz ceny klienta, treści ani brandingu. Akceptacja tworzy wydarzenie w CRM do przygotowania. Nie potwierdza jeszcze realizacji ani rezerwacji sprzętu.</p>
       {realization?.migration_ready===false && <p role="alert" className="mt-3 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">{crm ? 'Akceptacja jest wyłączona do uruchomienia migracji 20260917150000 (po migracjach 20260911234500 i 20260911235000). Nic nie zostało zapisane przez ten przycisk.' : 'Administrator aktualizuje obsługę akceptacji. PDF i rozmowa pozostają dostępne.'}</p>}
       {crm && state.can_manage && currentReview?.status==='approved' && !accepted && !cancelled && <div className="mt-3 space-y-2 rounded-lg bg-amber-300/10 p-3 text-sm">
         <p>Wcześniejsza zgoda jest zapisana, ale oferta nie została jeszcze przeniesiona do Realizacji.</p>
         <button type="button" className={button} disabled={!realization?.auto_event_ready || !realization?.can_create_event} onClick={()=>void run('Zapisywanie akceptacji oferty',async()=>{
           await api({action:'accept_offer',documentId:currentReview.document_id});
           await refreshDecision('Oferta zaakceptowana. U sprzedawcy jest teraz realizacją oczekującą na osobne potwierdzenie CRM.');
         })}>Zapisz akceptację i przenieś do Realizacji</button>
       </div>}
       {accepted && <div className={`mt-4 space-y-3 rounded-lg p-4 text-sm ${cancelled ? 'bg-rose-300/10' : confirmed ? 'bg-emerald-300/10' : 'bg-amber-300/10'}`}>
         <h4 className="text-sm uppercase">{cancelled ? 'Wydarzenie anulowane' : confirmed ? '2. Realizacja potwierdzona przez CRM' : '2. Oczekuje na potwierdzenie realizacji przez CRM'}</h4>
         {!confirmed && !cancelled && <>
           <p>{realization?.event_id ? 'Wydarzenie w CRM już istnieje. Przygotuj harmonogram, zespół i logistykę, a następnie potwierdź realizację.' : 'Ta wcześniej zaakceptowana oferta nie ma jeszcze wydarzenia w CRM.'}</p>
           {crm && !realization?.can_create_event && <p className="text-xs text-white/60">Ten krok wykonuje pracownik z uprawnieniami do ofert i wydarzeń tej marki.</p>}
           {crm && realization?.can_create_event && realization.event_id && !realization.can_view_event && <p className="text-xs text-amber-200">Nie masz dostępu do powiązanego wydarzenia. Jego potwierdzenie wymaga pracownika z dostępem do tej realizacji.</p>}
           {crm && realization?.can_create_event && currentReview?.status==='approved' && (!realization.event_id || realization.can_view_event) && <>
             {realization.event_id ? <button type="button" className={button} disabled={arrangementsDirty || !realization.auto_event_ready} onClick={()=>setEventModalOpen(true)}>Sprawdź dane i potwierdź realizację</button>
               : <button type="button" className={button} disabled={arrangementsDirty || !realization.auto_event_ready} onClick={()=>void run('Tworzenie wydarzenia do przygotowania',async()=>{
                 await api({action:'accept_offer',documentId:currentReview.document_id});
                 await refreshDecision('Wydarzenie w CRM zostało utworzone. Realizacja nadal oczekuje na potwierdzenie.');
               })}>Utwórz wydarzenie do przygotowania</button>}
           </>}
           {!crm && <p className="text-xs text-white/60">Po decyzji CRM otrzymasz kolejne powiadomienie. Ustalenia możesz omówić z opiekunem na czacie.</p>}
         </>}
         {crm && realization?.event_id && realization.can_view_event && <div className="flex flex-wrap gap-2">
           <Link href={`/crm/events/${realization.event_id}?tab=seller-arrangements&offer=${offerId}`} className={button}>Przygotuj wydarzenie w CRM</Link>
           <Link href={`/crm/events/${realization.event_id}?tab=phases`} className={button}>Timeline</Link>
           <Link href={`/crm/events/${realization.event_id}?tab=team`} className={button}>Zespół</Link>
           <Link href={`/crm/events/${realization.event_id}?tab=agenda`} className={button}>Agenda</Link>
           <Link href={`/crm/events/${realization.event_id}?tab=logistics`} className={button}>Logistyka</Link>
         </div>}
       </div>}
       {arrangementsDirty && <p className="mt-2 text-xs text-amber-200">Najpierw zapisz ustalenia albo wczytaj poprzednią wersję. Następnie możesz zapisać decyzję.</p>}
       {crm && state.review?.status==='pending' && state.review_notification_count===0 && <p className="mt-2 text-sm text-amber-200">Zapytanie jest zapisane, ale nie ma odbiorców powiadomienia. Administrator powinien uzupełnić konfigurację powiadomień. Zapytanie nadal można rozpatrzyć tutaj.</p>}
       {state.review && !currentReview && <div className="mt-2 text-sm text-amber-200"><p>Przekazanie lub decyzja dotyczy starszej wersji oferty. Poproś sprzedawcę o aktualny PDF; poprzednia decyzja nie zatwierdza zmian.</p>{displayedDocumentId!==state.review.document_id && <button type="button" className={button+' mt-2'} onClick={()=>void run('Otwieranie poprzedniej wersji',()=>showPdf(state.review!.document_id))}>Pokaż poprzedni PDF</button>}</div>}
       <p className="mt-2 text-sm text-[#d3bb73]">{currentReview ? statuses[currentReview.status] : state.review ? 'Aktualna wersja wymaga nowej decyzji opiekuna.' : 'Brak zapisanej decyzji akceptacji. Przypisanie opiekuna nie oznacza zaakceptowania oferty.'}</p>
       {canDecide && <>
         {directReview && <p className="mt-3 text-xs text-white/60">Brak aktywnego zapytania dla bieżącej wersji. Możesz ocenić aktualny PDF bezpośrednio w CRM; wcześniejsza historia pozostanie zapisana.</p>}
         {directReview && !realization?.crm_review_ready && <p role="alert" className="mt-2 text-sm text-amber-200">Bezpośrednia ocena wymaga aktualizacji obsługi akceptacji przez administratora.</p>}
         {!reviewPdfLoaded && <div className="mt-3 space-y-2 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">
           <p>{reviewDocumentId ? 'Decyzja jest dostępna po wczytaniu właściwego PDF. Podgląd innej wersji nie wystarczy.' : 'Potrzebny jest aktualny PDF od sprzedawcy. Omów poprawki w rozmowie.'}</p>
           {reviewDocumentId && <button type="button" disabled={Boolean(busy)} className={button} onClick={()=>void run('Otwieranie PDF do oceny',()=>showPdf(reviewDocumentId))}>Wróć do PDF z zapytania</button>}
         </div>}
         {!state.review_context && <p role="alert" className="mt-3 text-sm text-amber-200">Nie udało się wczytać danych do oceny. Odśwież status przed zapisaniem decyzji.</p>}
         <div className="mt-4 grid gap-3 sm:grid-cols-3">
           <div className="space-y-2 rounded-lg bg-white/[0.035] p-3">
             <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={Boolean(busy)} checked={checks.date} onChange={event=>setChecks({...checks,date:event.target.checked})} className="mt-1"/>Sprawdzono termin</label>
             <Link href="/crm/calendar" target="_blank" rel="noreferrer" className="text-xs text-[#d3bb73] hover:underline">Kalendarz ↗</Link>
           </div>
           <SellerEquipmentStatus review={equipmentReview}/>
           <div className="space-y-2 rounded-lg bg-white/[0.035] p-3">
             <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={Boolean(busy)} checked={checks.capacity} onChange={event=>setChecks({...checks,capacity:event.target.checked})} className="mt-1"/>Sprawdzono dostępność zespołu</label>
             <Link href="/crm/employees" target="_blank" rel="noreferrer" className="text-xs text-[#d3bb73] hover:underline">Zespół ↗</Link>
           </div>
         </div>
         <SellerEquipmentReview review={equipmentReview} confirmed={equipmentExceptionConfirmed} reason={equipmentExceptionReason} disabled={Boolean(busy)}
           onConfirmed={setEquipmentExceptionConfirmed} onReason={setEquipmentExceptionReason}/>
         <p className="mt-2 text-xs text-white/50">Termin i zespół potwierdza opiekun, sprzęt sprawdza system. To nie tworzy rezerwacji. Montaż, demontaż i organizację ustalicie po akceptacji.</p>
         {state.review_context?.past_date && <label className="mt-3 flex items-start gap-2 rounded-lg bg-amber-300/10 p-3 text-sm text-amber-100">
           <input type="checkbox" disabled={Boolean(busy)} checked={confirmPastDate} onChange={event=>setConfirmPastDate(event.target.checked)} className="mt-1"/>
           Sprawdziłem datę i rok. Świadomie oceniam wydarzenie z przeszłości. Jeśli to pomyłka, zamiast akceptacji poproszę o zmianę.
         </label>}
       </>}
       <section aria-labelledby="seller-review-messages-title" className="mt-5 space-y-3">
         <h4 id="seller-review-messages-title" className="text-sm uppercase">Uwagi do oferty</h4>
         <SellerReviewSubmission key={offerId} review={state.review} current={Boolean(currentReview)}
           sellerName={state.offer_summary?.seller_name || state.source?.seller_name}
           documents={state.documents} refreshKey={reviewRound}
           loadHistory={state.can_manage ? loadReviewHistory : undefined}/>
         {canDecide && <>
         <label htmlFor="seller-review-response" className="mt-4 block text-sm">Kolejne uwagi</label>
         <textarea id="seller-review-response" ref={responseRef} aria-invalid={Boolean(responseError)} aria-describedby="seller-review-response-help" disabled={Boolean(busy)}
           className={field+' mt-1.5'} rows={3} maxLength={5000} value={response} onChange={(event)=>{setResponse(event.target.value);setResponseError('');}}
           placeholder="Co jeszcze trzeba poprawić? Przy akceptacji możesz zostawić to pole puste."/>
         <p id="seller-review-response-help" className={`mt-1.5 text-xs ${responseError ? 'text-rose-200' : 'text-white/55'}`} role={responseError ? 'alert' : undefined}>
           {responseError || 'Uwagi zostaną zapisane w tej historii i przekazane sprzedawcy po kliknięciu „Poproś o dalsze zmiany”. Przy akceptacji komentarz jest opcjonalny. Bez wewnętrznych danych finansowych.'}
         </p>
         <div className="mt-4 flex flex-wrap items-center gap-2">
           <button type="button" disabled={approvalDisabled} aria-describedby={approvalDisabled ? 'seller-review-approval-blockers' : undefined} title={approvalDisabled ? approvalBlockers.join('\n') : undefined} className="inline-flex items-center justify-center rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1b0710] disabled:cursor-not-allowed disabled:opacity-40" onClick={()=>void submitDecision('approved')}>Zaakceptuj ofertę</button>
           <button type="button" disabled={decisionDisabled} className={button} onClick={()=>void submitDecision('changes_requested')}>Poproś o dalsze zmiany</button>
           <ResponsiveActionBar alwaysDropdown compact actions={[{label:'Odrzuć ofertę',variant:'danger',disabled:decisionDisabled,onClick:()=>void submitDecision('rejected')}]}/>
         </div>
         {approvalDisabled && <div id="seller-review-approval-blockers" role="status" className="mt-3 space-y-2 rounded-lg bg-amber-300/5 p-3 text-xs text-amber-100">
           <p className="font-medium">Do odblokowania akceptacji:</p>
           <ul className="list-disc space-y-1 pl-4">{approvalBlockers.map(reason=><li key={reason}>{reason}</li>)}</ul>
           {!reviewPdfLoaded && reviewDocumentId && <button type="button" disabled={Boolean(busy)} className={button} onClick={()=>void run('Otwieranie PDF do oceny',()=>showPdf(reviewDocumentId))}>Wczytaj PDF do tej oceny</button>}
         </div>}
         </>}
       </section>
       {!state.can_manage && <p className="mt-3 text-sm text-white/60">Masz podgląd oferty. Decyzję zapisuje opiekun z uprawnieniami do ofert tej marki.</p>}
     </div>}
     {crm && accepted && !cancelled && state.realization?.event_id && state.realization.can_view_event &&
       <SellerRealizationWizard key={`wizard:${offerId}`} offerId={offerId} crm refreshKey={externalRefresh + arrangementsRefresh} blocked={arrangementsDirty}/>}
     {crm && accepted && !cancelled && <details className="rounded-lg bg-white/[0.03] p-4" onToggle={event=>{if(event.currentTarget.open)setArrangementsMounted(true);}}>
       <summary className="cursor-pointer text-sm text-[#d3bb73]">Dodatkowe ustalenia CRM — terminy techniczne</summary>
       <p className="mt-3 text-xs text-white/55">Kolejny etap po akceptacji oferty. Te ustalenia nie zastępują osobnego potwierdzenia wydarzenia.</p>
       <div className="mt-4">{arrangementsMounted && <SellerOfferArrangements key={offerId} offerId={offerId} crm refreshKey={arrangementsRefresh}
         reviewedAt={state.review?.reviewed_at} onDirtyChange={setArrangementsDirty}
         onSaved={async()=>{setArrangementsRefresh(value=>value+1);await reload();onChanged?.();}}/>}</div>
     </details>}
     {crm && state.can_manage && <details className="rounded-lg bg-white/[0.03] p-4" onToggle={event=>{if(event.currentTarget.open)setProfitMounted(true);}}>
       <summary className="cursor-pointer text-sm text-white/65">Wewnętrzna kalkulacja CRM — rentowność i prowizje</summary>
       <p className="mt-3 text-xs text-white/45">Dostęp według uprawnień finansowych. Dane nie trafiają do rozmowy ani do PDF sprzedawcy.</p>
       <div className="mt-4">{profitMounted && <SellerOwnerProfitPanel key={offerId} offerId={offerId} refreshKey={externalRefresh + arrangementsRefresh}/>}</div>
     </details>}
   </div>}
   </section>
   {children}
   </div>
   {hasSidebar && <aside aria-label={crm ? 'Rozmowa ze sprzedawcą i informacje o ofercie' : 'Rozmowa z opiekunem'} className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)]">
     {state?.chat && <SellerOfferConversation key={`${offerId}:${state.chat.sales_partner_id}:${state.chat.my_company_id}`} offerId={offerId} partnerId={state.chat.sales_partner_id} companyId={state.chat.my_company_id} canStart={state.chat.can_start} crm={crm} compact standalone realization={accepted || confirmed}/>}
     {state?.chat_error && <p id="seller-offer-conversation" className="shrink-0 rounded-xl bg-[#1c1f33] p-4 text-sm text-amber-200 sm:p-5">{state.chat_error}</p>}
     {sidebarContent && (hasChatPanel ? <details className="shrink-0 rounded-xl bg-[#1c1f33] lg:max-h-[30dvh] lg:overflow-y-auto lg:overscroll-contain">
       <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-[#e5e4e2]/75 transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/30">Informacje o ofercie</summary>
       <div className="space-y-4 p-3 pt-0">{sidebarContent}</div>
     </details> : <div className="min-h-0 space-y-6 lg:overflow-y-auto lg:overscroll-contain">{sidebarContent}</div>)}
   </aside>}
   </div>
 </>;
}
