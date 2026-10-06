'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NewInquiryModal from '@/components/crm/NewInquiryModal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { BookOpen, CalendarPlus, FileText, History, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { Modal } from '@/components/UI/Modal';
import InvoiceDocumentActionsMenu, { type InvoiceDocumentAction } from '@/components/crm/invoices/InvoiceDocumentActionsMenu';
import EventWizard from '@/components/crm/EventWizard';
import SendOfferEmailModal from '@/components/crm/SendOfferEmailModal';
import SendBrochureEmailModal from '@/components/crm/brochures/SendBrochureEmailModal';
import BrochureDeliveryHistory from '@/components/crm/brochures/BrochureDeliveryHistory';
import type { RecipientContext } from '@/components/crm/brochures/delivery';
type Offer={id:string;offer_number:string;event_id:string|null;generated_pdf_url:string|null;modified_after_generation:boolean};
export default function ContactQuickActions({context}:{context:RecipientContext}) {
 const {isAdmin,hasScope,canCreateInModule}=useCurrentEmployee();
 const router=useRouter();
 const {showSnackbar}=useSnackbar();
 const [inquiryClient,setInquiryClient]=useState<{contactId?:string;organizationId?:string;name:string;email?:string|null;phone?:string|null}|null>(null);
 const canCreateInquiry=isAdmin||hasScope('inquiries_manage')||hasScope('inquiries_manage_all')||hasScope('tasks_create');
 const createInquiry=async()=>{
  if(working)return;setWorking(true);setError('');
  try{
   if(context.type==='organization'){
    const {data,error:e}=await supabase.from('organizations').select('name,email,phone').eq('id',context.id).single();if(e)throw e;
    setInquiryClient({organizationId:context.id,name:context.name||data.name,email:data.email,phone:data.phone});
   }else{
    const [{data:contact,error:ce},{data:links,error:le}]=await Promise.all([
     supabase.from('contacts').select('full_name,email,phone').eq('id',context.id).single(),
     supabase.from('contact_organizations').select('organization_id').eq('contact_id',context.id).eq('is_current',true),
    ]);if(ce)throw ce;if(le)throw le;
    const ids=[...new Set((links||[]).map(link=>link.organization_id).filter(Boolean))];
    setInquiryClient({contactId:context.id,organizationId:ids.length===1?ids[0]:undefined,name:contact.full_name||context.name,email:contact.email,phone:contact.phone});
   }
  }catch{setError('Nie udało się pobrać danych klienta do zapytania. Spróbuj ponownie.');}finally{setWorking(false);}
 };
 const canManageOffers=isAdmin||hasScope('offers_manage');
 const canViewBrochures=isAdmin||hasScope('offers_brochures_view_own')||hasScope('offers_brochures_view_all');
 const canAll=isAdmin||hasScope('offers_brochures_view_all');
 const [brochure,setBrochure]=useState(false),[offerPicker,setOfferPicker]=useState(false),[offers,setOffers]=useState<Offer[]>([]),[offer,setOffer]=useState<Offer|null>(null),[history,setHistory]=useState(false),[all,setAll]=useState(false),[eventPicker,setEventPicker]=useState(false),[event,setEvent]=useState<{organizationId:string}|null>(null),[organizations,setOrganizations]=useState<{id:string;name:string}[]>([]),[organizationId,setOrganizationId]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState('');
 const loadOffers=async()=>{if(working)return;setOfferPicker(true);setOffers([]);setError('');setWorking(true);try{
  let q=supabase.from('offers').select('id,offer_number,event_id,generated_pdf_url,modified_after_generation').order('created_at',{ascending:false}).limit(100);
  if(context.type==='organization')q=q.eq('organization_id',context.id);
  else{
   const {data:events,error:e}=await supabase.from('events').select('id').eq('contact_person_id',context.id).limit(500);if(e)throw e;
   q=events?.length?q.or(`contact_id.eq.${context.id},event_id.in.(${events.map(e=>e.id).join(',')})`):q.eq('contact_id',context.id);
  }
  const {data,error:e}=await q;if(e)throw e;setOffers((data||[]) as Offer[]);
 }catch{setError('Nie udało się pobrać ofert powiązanych z tym odbiorcą.');}finally{setWorking(false);}};
 const createEvent=async()=>{if(working)return;setError('');if(context.type==='organization'){setEvent({organizationId:context.id});return;}setEventPicker(true);setWorking(true);try{
  const {data,error:e}=await supabase.from('contact_organizations').select('organization:organizations(id,name)').eq('contact_id',context.id).eq('is_current',true);if(e)throw e;
  const found=Array.from(new Map((data||[]).map((r:any)=>Array.isArray(r.organization)?r.organization[0]:r.organization).filter(Boolean).map((o:any)=>[o.id,o])).values()) as {id:string;name:string}[];
  setOrganizations(found);setOrganizationId(found.length===1?found[0].id:'');
  if(found.length<=1){setEventPicker(false);setEvent({organizationId:found[0]?.id||''});}
 }catch{setError('Nie udało się pobrać organizacji kontaktu.');}finally{setWorking(false);}};
 const actions:InvoiceDocumentAction[]=[];
 if(canCreateInquiry)actions.push({label:'Dodaj zapytanie',description:'Utwórz zapytanie w lejku sprzedażowym z danymi klienta.',icon:<Plus className="h-4 w-4"/>,onClick:()=>void createInquiry()});
 if(canManageOffers&&canViewBrochures)actions.push({label:'Wyślij broszurę',description:'Wybierz broszurę i przygotuj wiadomość z załącznikiem.',icon:<BookOpen className="h-4 w-4"/>,onClick:()=>setBrochure(true)});
 if(canManageOffers)actions.push({label:'Wyślij ofertę',description:'Wybierz powiązaną ofertę i otwórz wiadomość do odbiorcy.',icon:<FileText className="h-4 w-4"/>,onClick:()=>void loadOffers()});
 if(canCreateInModule('events'))actions.push({label:'Utwórz wydarzenie',description:'Otwórz kreator z danymi kontaktu i organizacji.',icon:<CalendarPlus className="h-4 w-4"/>,onClick:()=>void createEvent()});
 if(canViewBrochures)actions.push({label:'Historia wysyłek broszur',description:'Sprawdź wiadomości, załączniki i stan wysyłki.',icon:<History className="h-4 w-4"/>,onClick:()=>{setAll(false);setHistory(true);}});
 return <>
  <InvoiceDocumentActionsMenu label="Szybkie akcje" actions={actions}/>
  {error&&!offerPicker&&!eventPicker&&<p role="alert" className="mt-2 text-sm text-amber-200">{error}</p>}
  {inquiryClient&&<NewInquiryModal isOpen initialClient={inquiryClient} onClose={()=>setInquiryClient(null)} onSaved={()=>{showSnackbar('Zapytanie dodane do lejka sprzedażowego','success');router.push('/crm/inquiries');}}/>}
  {brochure&&<SendBrochureEmailModal context={context} onClose={()=>setBrochure(false)}/>}
  <Modal open={offerPicker} onClose={()=>setOfferPicker(false)} title="Wybierz ofertę do wysłania"><div className="space-y-3 text-sm">{error&&<p role="alert" className="text-amber-200">{error}</p>}{working?<p>Wczytywanie ofert…</p>:!offers.length?<p className="text-white/55">Brak dostępnych ofert powiązanych z tym odbiorcą.</p>:offers.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/5 p-3"><div>{o.offer_number||'Oferta'}{(!o.generated_pdf_url||o.modified_after_generation)&&<p className="mt-1 text-xs text-white/50">Najpierw wygeneruj aktualny PDF.</p>}</div><div className="flex gap-3"><a href={`/crm/offers/${o.id}`} className="text-[#d3bb73]">Otwórz ofertę</a><button type="button" disabled={!o.generated_pdf_url||o.modified_after_generation} className="text-[#d3bb73] disabled:opacity-30" onClick={()=>{setOfferPicker(false);setOffer(o);}}>Przygotuj e-mail</button></div></div>)}<p className="text-xs text-white/40">Lista obejmuje maksymalnie 100 najnowszych dostępnych ofert. Odbiorcę możesz uzupełnić w wiadomości.</p></div></Modal>
  {offer&&<SendOfferEmailModal offerId={offer.id} offerNumber={offer.offer_number||'Oferta'} eventId={offer.event_id||undefined} clientEmail={context.email||''} clientName={context.name} onClose={()=>setOffer(null)}/>}
  <Modal open={eventPicker} onClose={()=>setEventPicker(false)} title="Organizacja wydarzenia"><div className="space-y-4 text-sm">{error&&<p role="alert" className="text-amber-200">{error}</p>}{working?<p>Wczytywanie powiązań…</p>:<><p>Wskaż organizację, dla której przygotowujesz wydarzenie z tym kontaktem.</p><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="w-full rounded-lg bg-black/20 p-3"><option value="">Bez organizacji — klient indywidualny</option>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select><button type="button" disabled={Boolean(error)} onClick={()=>{setEventPicker(false);setEvent({organizationId});}} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]">Otwórz kreator</button></>}</div></Modal>
  {event&&<EventWizard isOpen initialClientType={event.organizationId?'business':'individual'} initialOrganizationId={event.organizationId} initialContactId={context.type==='contact'?context.id:undefined} onClose={()=>setEvent(null)} onSuccess={()=>setEvent(null)}/>}
  <Modal open={history} onClose={()=>setHistory(false)} title="Historia wysyłek broszur">{canAll&&<div className="mb-4 flex gap-2">{[false,true].map(v=><button type="button" key={String(v)} aria-pressed={all===v} onClick={()=>setAll(v)} className={`rounded-lg px-3 py-2 text-sm ${all===v?'bg-[#d3bb73]/15 text-[#d3bb73]':'bg-white/5'}`}>{v?'Wszystkie':'Moje'}</button>)}</div>}<BrochureDeliveryHistory contactId={context.type==='contact'?context.id:undefined} organizationId={context.type==='organization'?context.id:undefined} all={all}/></Modal>
 </>;
}
