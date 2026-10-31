import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import type { SellerArrangements } from '@/lib/seller/arrangements';
import { sellerReviewDate, sellerReviewFacts } from '@/lib/seller/review';
import { checkSellerEquipment } from '@/lib/seller/equipmentReview.server';
import { loadReviewHistory } from '@/lib/seller/reviewThread.server';
import { canConfirmEquipment } from '@/lib/seller/equipmentReview';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { renderSellerOfferPdf } from '@/lib/seller/renderOfferPdf.server';
import { deliveryTimestamp, sellerReviewIdentity, type SellerOfferSummaryData } from '@/lib/seller/delivery';
import { validSellerDay } from '@/lib/seller/eventSchedule';
import { onsiteContactMessage } from '@/lib/seller/onsiteContact';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const uuid=(value: unknown): value is string => typeof value==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail=(error: any) => NextResponse.json({
  error:error?.message || 'Nie udało się wykonać operacji',
  ...(error?.code === 'SELLER_EVENT_DATE_REQUIRED' ? {code:error.code} : {}),
},{status:error?.status || 400});
const check=(error: any) => { if(error) throw error; };
const checkHandoff=(error:any)=>{
  if(error && ['PGRST202','42883'].includes(error.code)) throw new Error('Akceptacja oferty i osobne potwierdzenie realizacji wymagają migracji 20260917150000 (po 20260911234500 i 20260911235000).');
  check(error);
};
const checkCrmReview=(error:any)=>{
  if(error && ['PGRST202','42883'].includes(error.code)) throw new Error('Ta funkcja wymaga migracji 20260917170000 (opiekun kontaktu i decyzja CRM).');
  check(error);
};

async function authorize(request: NextRequest,id: string){
  if(!uuid(id)) throw new Error('Nieprawidłowy identyfikator oferty');
  const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
  if(!token) throw Object.assign(new Error('Zaloguj się ponownie'),{status:401});
  const admin=createSupabaseAdminClient();
  const {data,error}=await admin.auth.getUser(token);
  if(error || !data.user) throw Object.assign(new Error('Sesja wygasła'),{status:401});
  const user=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false},
  });
  const state=await user.rpc('seller_offer_workflow_state',{p_offer_id:id});
  check(state.error);
  if(!state.data) throw new Error('To nie jest oferta sprzedawcy');
  return {admin,user,actor:data.user.id,state:state.data};
}

// Called only after authorize() has checked access to this exact offer.
async function loadOfferSummary(admin: ReturnType<typeof createSupabaseAdminClient>, offerId: string): Promise<SellerOfferSummaryData> {
  const result = await admin.from('offers')
    .select('sales_partner_id,partner_organization_id,partner_branding_snapshot,portal_client_name,portal_client_company,event_date,event_location,offer_items(id,name,quantity,unit,days,display_order)')
    .eq('id', offerId).eq('sales_channel', 'seller_portal').single();
  check(result.error);
  const offer = result.data!;
  const branding = offer.partner_branding_snapshot || {};
  let sellerName = String(branding.display_name || '');
  let organizationName = String(branding.organization_name || '');
  if (!sellerName) {
    const partner = await admin.from('sales_partner_profiles')
      .select('contact:contacts!contact_id(full_name),employee:employees!employee_id(name,surname)')
      .eq('id', offer.sales_partner_id).single();
    check(partner.error);
    const one = (value: any) => Array.isArray(value) ? value[0] : value;
    const contact = one(partner.data?.contact), employee = one(partner.data?.employee);
    sellerName = contact?.full_name || [employee?.name, employee?.surname].filter(Boolean).join(' ');
  }
  // Prefer the offer's saved organization, never a new default of the seller.
  if (!organizationName && offer.partner_organization_id) {
    const organization = await admin.from('organizations').select('name,alias').eq('id', offer.partner_organization_id).maybeSingle();
    check(organization.error);
    organizationName = organization.data?.alias || organization.data?.name || '';
  }
  return {
    seller_name: sellerName || 'Sprzedawca', seller_organization: organizationName,
    client_name: offer.portal_client_name || '', client_company: offer.portal_client_company || '',
    event_date: offer.event_date || null, event_location: offer.event_location || '',
    // No internal prices, margins, notes, credentials or raw branding payload.
    items: [...(offer.offer_items || [])].sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
      .map(item => ({ id: item.id, name: item.name, quantity: Number(item.quantity), unit: item.unit || 'szt.', days: Number(item.days || 1) })),
  };
}

function reviewContext(sourceKey: string, arrangements: SellerArrangements) {
  return {
    key: createHash('sha256').update(JSON.stringify(sellerReviewFacts(sourceKey, arrangements))).digest('hex'),
    ...sellerReviewDate(arrangements),
  };
}

// Analysis is not a reservation or a transactional lock. Refuse a result when
// its offer/term changed during the warehouse reads; acceptance checks again.
async function ensureEquipmentContext(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  user: ReturnType<typeof createClient>, offerId: string,
  contextKey: string, arrangements: SellerArrangements,
) {
  const [source, latest] = await Promise.all([
    admin.rpc('seller_offer_source_key', { p_offer_id: offerId }),
    user.rpc('get_seller_offer_arrangements', { p_offer: offerId }),
  ]);
  check(source.error); check(latest.error);
  if (!latest.data || reviewContext(source.data, latest.data).key !== contextKey
    || (latest.data.values.setup_at || null) !== (arrangements.values.setup_at || null)
    || (latest.data.values.teardown_at || null) !== (arrangements.values.teardown_at || null)) {
    throw new Error('Termin lub zakres oferty zmienił się podczas analizy. Odśwież status i sprawdź sprzęt ponownie.');
  }
}

export async function GET(request: NextRequest,{params}:{params:{id:string}}){
  try{
    const {admin,user,state}=await authorize(request,params.id);
    const configure=await user.rpc('seller_offer_can_configure',{p_offer_id:params.id});
    check(configure.error);
    state.can_configure=configure.data===true;
    if(state.can_manage){
      const manager=await user.rpc('get_seller_offer_manager',{p_offer_id:params.id});
      if(manager.error){
        state.manager_error=['PGRST202','42883'].includes(manager.error.code)
          ? 'Opiekun kontaktu wymaga migracji 20260917170000. Ustawienia zmienisz w Odpowiedzialności za klienta.'
          : 'Nie udało się odczytać opiekuna kontaktu. Odśwież status.';
      }else{
        state.manager=manager.data;
      }
    }
    const owner=await admin.from('offers').select('sales_partner_id,my_company_id,status,event_id').eq('id',params.id).eq('sales_channel','seller_portal').single();
    check(owner.error);
    let linkedEvent:{id:string;status:string}|null=null;
    let canViewEvent=false;
    if(owner.data.event_id){
      const event=await admin.from('events').select('id,status').eq('id',owner.data.event_id).eq('my_company_id',owner.data.my_company_id).maybeSingle();
      check(event.error);linkedEvent=event.data;
      if(linkedEvent){
        const view=await user.rpc('get_seller_offer_arrangements',{p_offer:params.id});
        // CRM links must not imply access when the event is outside the reader's scope.
        check(view.error);
        if(!view.data?.event) throw new Error('Nie udało się ustalić etapu powiązanego wydarzenia. Odśwież status.');
        linkedEvent.status=view.data.event.status;
        canViewEvent=state.can_manage && view.data.event.can_view_crm===true;
      }
    }
    const createPermission=state.can_manage ? await user.rpc('seller_offer_can_create_event',{p_offer_id:params.id}) : null;
    if(createPermission?.error && !['PGRST202','42883'].includes(createPermission.error.code)) check(createPermission.error);
    const version=await user.rpc('seller_offer_handoff_version');
    if(version.error && !['PGRST202','42883'].includes(version.error.code)) check(version.error);
    const eventConfirmed=Boolean(linkedEvent && ['offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'].includes(linkedEvent.status));
    state.realization={offer_status:owner.data.status,event_id:linkedEvent?.id || null,event_status:linkedEvent?.status || null,
      stage:linkedEvent?.status==='cancelled' ? 'cancelled' : eventConfirmed ? 'confirmed' : owner.data.status==='accepted' ? 'awaiting_crm_confirmation' : 'offer',
      can_view_event:canViewEvent,can_create_event:createPermission?.data===true,migration_ready:Number(version.data)>=2 && !createPermission?.error,
      crm_review_ready:Number(version.data)>=3,auto_event_ready:Number(version.data)>=4};
    // Mailbox credentials and delivery configuration are not part of this flow.
    state.config={manager_id:state.manager?.manager_id || null};
    delete state.delivery;
    try { state.offer_summary=await loadOfferSummary(admin,params.id); }
    catch { state.offer_summary_error='Nie udało się wczytać podsumowania. Odśwież status; PDF i rozmowa pozostają dostępne.'; }
    {
      // Read-only context is needed by the caretaker as well as the seller.
      // Both RPCs independently enforce access to this offer.
      const [arrangements,progress]=await Promise.all([
        user.rpc('get_seller_offer_arrangements',{p_offer:params.id}),
        user.rpc('get_seller_delivery_progress',{p_offer:params.id}),
      ]);
      if(arrangements.error) state.seller_arrangements_error='Nie udało się wczytać ustaleń i kontaktów. Odśwież widok.';
      else {
        state.seller_arrangements=arrangements.data;
        if(state.can_manage && arrangements.data) state.review_context=reviewContext(state.source_key,arrangements.data);
      }
      if(progress.error) state.seller_progress_error=['PGRST202','42883'].includes(progress.error.code)
        ? 'Nowy proces sprzedawcy wymaga migracji 20260917230000_seller_delivery_workspace.sql. Dotychczasowa rozmowa i dokumenty pozostają dostępne.'
        : 'Nie udało się wczytać przygotowań i historii akceptacji klienta. Odśwież widok.';
      else state.seller_progress=progress.data;
    }
    // Identity is read only after the caller's access to this exact offer was checked.
    if (state.can_manage) {
      const source=await admin.from('offers').select('sales_partner_id,portal_client_name,portal_client_company,portal_client_email,portal_client_phone,event_date,event_location,description,partner_branding_snapshot').eq('id',params.id).single();
      check(source.error);
      const partner=await admin.from('sales_partner_profiles').select('id,contact_id,contact:contacts!contact_id(full_name),employee:employees!employee_id(name,surname)').eq('id',source.data.sales_partner_id).single();
      check(partner.error);
      const one=(value:any)=>Array.isArray(value) ? value[0] : value;
      const contact=one(partner.data.contact),employee=one(partner.data.employee);
      state.source={
        ...source.data,
        seller_contact_id:partner.data.contact_id || null,
        seller_name:source.data.partner_branding_snapshot?.display_name || contact?.full_name || [employee?.name,employee?.surname].filter(Boolean).join(' ') || 'Sprzedawca',
        seller_organization:state.offer_summary?.seller_organization || source.data.partner_branding_snapshot?.organization_name || '',
      };
      state.review_notification_count=0;
      if(state.review?.document_id){
        let noticeQuery=admin.from('notifications').select('id,notification_recipients(id)').eq('related_entity_id',params.id).eq('title','Zapytanie sprzedawcy: termin i zasoby').contains('metadata',{document_id:state.review.document_id});
        if(state.review.requested_at) noticeQuery=noticeQuery.gte('created_at',state.review.requested_at);
        const notices=await noticeQuery;
        check(notices.error);
        state.review_notification_count=(notices.data || []).reduce((sum:number,item:any)=>sum+(item.notification_recipients?.length || 0),0);
      }
    }
    // Enrich only this already-authorized offer. Chat has its own existing
    // brand-scoped read/write permissions, independent of approval rights.
    try {
      const scope={p_partner:owner.data.sales_partner_id,p_company:owner.data.my_company_id};
      const [read,write]=await Promise.all([
        user.rpc('seller_workspace_brand_access',{...scope,p_write:false}),
        user.rpc('seller_workspace_brand_access',{...scope,p_write:true}),
      ]);
      check(read.error);check(write.error);
      if(read.data===true) state.chat={sales_partner_id:owner.data.sales_partner_id,my_company_id:owner.data.my_company_id,can_start:write.data===true};
      else state.chat_error='Nie masz uprawnień do rozmowy ze sprzedawcą w tej marce.';
    } catch {
      // A missing chat migration or temporary outage must not hide the inquiry.
      state.chat_error='Rozmowa jest chwilowo niedostępna. Odśwież status; jeśli problem się powtarza, sprawdź konfigurację rozmów sprzedawców.';
    }
    return NextResponse.json(state,{headers:{'Cache-Control':'no-store'}});
  }catch(error){return fail(error);}
}

export async function POST(request: NextRequest,{params}:{params:{id:string}}){
  try{
    const {admin,user,actor,state}=await authorize(request,params.id);
    const body=await request.json();
    const offerId=params.id;
    if(body.action==='wizard_state' || body.action==='wizard_update'){
      let result;
      if(body.action==='wizard_state'){
        result=await user.rpc('get_seller_realization_wizard',{p_offer:offerId});
      }else{
        if(!uuid(body.requestId) || !Number.isSafeInteger(body.revision) || body.revision<0
          || typeof body.contextKey!=='string' || !/^[0-9a-f]{32}$/.test(body.contextKey)
          || !['contact','organization','materials','plan','finish'].includes(body.step)
          || !['save','submit','approve','changes_requested','complete'].includes(body.operation)
          || !body.payload || typeof body.payload!=='object' || Array.isArray(body.payload)
          || typeof body.note!=='string' || body.note.length>3000){
          throw new Error('Nieprawidłowe dane kroku przygotowania. Odśwież formularz.');
        }
        // Use the signed-in actor: the RPC checks the exact offer, role,
        // current revision, prerequisites and event context in one transaction.
        result=await user.rpc('update_seller_realization_wizard',{
          p_offer:offerId,p_step:body.step,p_action:body.operation,p_revision:body.revision,
          p_context_key:body.contextKey,p_request:body.requestId,p_payload:body.payload,p_note:body.note,
        });
      }
      if(result.error && ['PGRST202','42883','42P01'].includes(result.error.code)){
        throw new Error('Kroki przygotowania wymagają migracji 20261028190000_seller_realization_wizard.sql. Dane formularza pozostają zachowane.');
      }
      check(result.error);
      if(!result.data) throw new Error('Nie udało się wczytać stanu przygotowań.');
      return NextResponse.json(result.data,{headers:{'Cache-Control':'no-store'}});
    }
    if(body.action==='review_history'){
      if(!state.can_manage) throw Object.assign(new Error('Brak uprawnień do historii oceny tej oferty.'),{status:403});
      const portal=await user.rpc('current_session_is_seller_portal');check(portal.error);
      if(portal.data!==false) throw Object.assign(new Error('Historia oceny jest dostępna dla opiekuna w CRM.'),{status:403});
      return NextResponse.json(await loadReviewHistory(admin,offerId,body.before),{headers:{'Cache-Control':'no-store'}});
    }
    if(body.action==='check_equipment'){
      if(!state.can_manage) throw Object.assign(new Error('Brak uprawnień do kontroli sprzętu tej oferty.'),{status:403});
      const arrangements=await user.rpc('get_seller_offer_arrangements',{p_offer:offerId});
      check(arrangements.error);
      if(!arrangements.data) throw new Error('Nie udało się wczytać terminu i zakresu oferty.');
      const context=reviewContext(state.source_key,arrangements.data);
      if(body.expectedContextKey!==context.key) throw new Error('Dane oferty zmieniły się. Odśwież status przed analizą sprzętu.');
      const analysis=await checkSellerEquipment(admin,offerId,arrangements.data,context.key);
      await ensureEquipmentContext(admin,user,offerId,context.key,arrangements.data);
      return NextResponse.json(analysis,{headers:{'Cache-Control':'no-store'}});
    }
    if(body.action==='submit_preparation'){
      if(!uuid(body.messageId)) throw new Error('Brak identyfikatora wiadomości.');
      // Validate structured contacts on the server too; do not trust the
      // browser's formatted text. Older open forms may still send plain notes.
      let information=body.text;
      if(body.onsiteContact!==undefined){
        if(body.taskKey!=='contact') throw new Error('Dane osoby na miejscu przekaż w sekcji kontaktu.');
        information=onsiteContactMessage(body.onsiteContact);
      }
      const result=await user.rpc('submit_seller_realization_information',{
        p_offer:offerId,p_task_key:body.taskKey,p_revision:body.revision,p_message_id:body.messageId,p_body:information,
      });
      if(result.error && ['PGRST202','42883'].includes(result.error.code)) throw new Error('Przygotowania wymagają migracji 20260917230000_seller_delivery_workspace.sql.');
      check(result.error);return NextResponse.json(result.data);
    }
    if(['accept_offer','confirm_realization','event_draft','create_event','review','configure','review_in_crm'].includes(body.action)){
      const version=await user.rpc('seller_offer_handoff_version');checkHandoff(version.error);
      if((['event_draft','create_event'].includes(body.action) || body.action==='accept_offer'
        || (['review','review_in_crm'].includes(body.action) && body.decision==='approved')) && Number(version.data)<4) {
        throw new Error('Automatyczne wydarzenie po akceptacji wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql. Nie zapisano nowej akceptacji.');
      }
      if(Number(version.data)<2) throw new Error('Uruchom migrację 20260917150000, aby włączyć dwustopniową akceptację.');
      if(['configure','review_in_crm'].includes(body.action) && Number(version.data)<3) throw new Error('Uruchom migrację 20260917170000, aby korzystać z opiekuna kontaktu i rozpatrywać wcześniejsze oferty w CRM.');
    }
    if(['accept_offer','confirm_realization','event_draft','create_event'].includes(body.action)){
      if(!state.can_manage) throw Object.assign(new Error('Brak uprawnień'),{status:403});
      if(['confirm_realization','create_event'].includes(body.action) && body.confirm!==true) throw new Error('Potwierdź osobno realizację wydarzenia.');
      const result=body.action==='accept_offer'
        ? await user.rpc('accept_seller_offer_review',{p_offer_id:offerId,p_document_id:body.documentId})
        : body.action==='confirm_realization'
          ? await user.rpc('confirm_seller_offer_realization',{p_offer_id:offerId,p_document_id:body.documentId})
          : body.action==='event_draft'
            ? await user.rpc('get_seller_event_draft',{p_offer_id:offerId})
            : await user.rpc('complete_seller_event_handoff',{p_offer_id:offerId,p_source_key:body.sourceKey,p_revision:body.revision,p_values:body.values});
      if(body.action==='create_event' && result.error && ['PGRST202','42883'].includes(result.error.code)){
        throw new Error('Potwierdzenie wydarzenia wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql. Dane formularza pozostają zachowane.');
      }
      checkHandoff(result.error);
      return NextResponse.json(result.data);
    }
    if(body.action==='document'){
      if(!uuid(body.documentId)) throw new Error('Wybierz wersję PDF');
      const {data:document,error}=await admin.from('seller_offer_documents').select('*').eq('offer_id',offerId).eq('id',body.documentId).single();
      check(error);
      const file=await admin.storage.from('seller-offer-documents').download(document.storage_path);
      check(file.error);
      return new NextResponse(await file.data!.arrayBuffer(),{headers:{
        'Content-Type':'application/pdf','Content-Disposition':`${body.download ? 'attachment' : 'inline'}; filename="${document.filename}"`,
        'Cache-Control':'no-store',
      }});
    }
    if(body.action==='generate'){
      if(!state.can_manage){
        const partner=await user.rpc('current_sales_partner_id');check(partner.error);
        const owner=await admin.from('offers').select('sales_partner_id,my_company_id,status,event_id').eq('id',offerId).single();check(owner.error);
        if(!partner.data || owner.data.sales_partner_id!==partner.data) throw new Error('Brak uprawnień do generowania tej oferty');
        let realization=owner.data.status==='accepted';
        if(owner.data.event_id){
          const event=await admin.from('events').select('status').eq('id',owner.data.event_id).eq('my_company_id',owner.data.my_company_id).maybeSingle();check(event.error);
          realization=realization || Boolean(event.data && ['offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled','cancelled'].includes(event.data.status));
        }
        if(realization) throw new Error('Oferta jest już realizacją. Pobierz zapisany dokument; zmianę zakresu lub ceny uzgodnij z opiekunem.');
        const term=await admin.from('sales_partner_brand_terms').select('id').eq('sales_partner_id',partner.data).eq('my_company_id',owner.data.my_company_id).eq('is_active',true).maybeSingle();check(term.error);
        if(!term.data) throw new Error('Dostęp do tej marki nie jest aktywny');
      }
      if(!uuid(body.requestId)) throw new Error('Brak identyfikatora generowania');
      const existing=await admin.from('seller_offer_documents').select('id,offer_id').eq('id',body.requestId).maybeSingle();
      check(existing.error);
      if(existing.data){
        if(existing.data.offer_id!==offerId) throw new Error('Nieprawidłowy identyfikator generowania');
        return NextResponse.json({documentId:existing.data.id});
      }
      // Refresh only for a new PDF request, after the idempotent version lookup.
      // The authorized RPC resolves organization branding and personal identity.
      const identity=await user.rpc('refresh_seller_offer_identity',{p_offer:offerId});check(identity.error);
      const before=await admin.rpc('seller_offer_source_key',{p_offer_id:offerId});check(before.error);
      const loaded=await admin.from('offers').select('*,offer_items(*)').eq('id',offerId).eq('sales_channel','seller_portal').single();check(loaded.error);
      if(!validSellerDay(String(loaded.data.event_date || '').slice(0,10))) {
        throw Object.assign(new Error('Uzupełnij datę wydarzenia i zapisz ofertę przed wygenerowaniem PDF.'), {code:'SELLER_EVENT_DATE_REQUIRED',status:422});
      }
      if(!loaded.data.offer_items?.length) throw new Error('Oferta nie zawiera produktów');
      const after=await admin.rpc('seller_offer_source_key',{p_offer_id:offerId});check(after.error);
      if(before.data!==after.data) throw new Error('Oferta została zmieniona. Ponów generowanie.');
      const pdf=await renderSellerOfferPdf(admin,loaded.data,before.data);
      const filename='Oferta_'+String(loaded.data.offer_number || offerId).replace(/[^a-zA-Z0-9._-]/g,'_')+'.pdf';
      const path=`${loaded.data.sales_partner_id}/${offerId}/${body.requestId}.pdf`;
      const uploaded=await admin.storage.from('seller-offer-documents').upload(path,pdf,{contentType:'application/pdf',upsert:false});check(uploaded.error);
      const recorded=await admin.rpc('record_seller_offer_document',{
        p_id:body.requestId,p_offer_id:offerId,p_source_key:before.data,p_storage_path:path,p_filename:filename,p_actor:actor,
      });
      // Do not remove the immutable PDF after an uncertain database response:
      // the registration transaction may already have committed.
      check(recorded.error);
      return NextResponse.json({documentId:recorded.data});
    }
    if(body.action==='request_review'){
      if(body.clientConfirmed!==true || !uuid(body.requestId) || !uuid(body.documentId)) throw new Error('Potwierdź akceptację klienta dla wybranej wersji PDF.');
      // Resolve retries before checking the now-changed decision. The existing
      // authenticated RPC still verifies seller access and exact request/PDF.
      const previous=await admin.from('seller_offer_client_acceptances').select('id')
        .eq('id',body.requestId).eq('offer_id',offerId).eq('confirmed_by',actor).maybeSingle();
      if(previous.error) throw new Error('Nie udało się sprawdzić historii przekazań. Ten krok nie wysłał nowego zapytania; odśwież status przed ponowieniem.');
      let reviewNote='';
      if(!previous.data){
        const correctionRequired=['changes_requested','rejected'].includes(state.review?.status || '');
        const correctionNote=typeof body.correctionNote==='string' ? body.correctionNote.trim() : '';
        const hasExpectedReview=Object.prototype.hasOwnProperty.call(body,'expectedReview');
        if(correctionRequired && (!hasExpectedReview || !body.expectedSourceKey)) throw new Error('Odśwież status, odpowiedz na uwagi opiekuna i przekaż poprawki ponownie.');
        if((hasExpectedReview && JSON.stringify(sellerReviewIdentity(body.expectedReview))!==JSON.stringify(sellerReviewIdentity(state.review)))
          || (body.expectedSourceKey && body.expectedSourceKey!==state.source_key)){
          throw new Error('Oferta lub decyzja opiekuna zmieniła się. Odśwież status i sprawdź aktualne uwagi przed przekazaniem.');
        }
        if(correctionRequired && (body.correctionsConfirmed!==true || correctionNote.length<5 || correctionNote.length>2000)){
          throw new Error('Napisz odpowiedź na uwagi (5–2000 znaków) i potwierdź ich uwzględnienie lub wyjaśnienie oraz zgodę klienta na aktualny PDF.');
        }
        if(!correctionRequired && (body.correctionsConfirmed===true || correctionNote)){
          throw new Error('Uwagi zostały już obsłużone lub zmienił się etap oferty. Odśwież status przed kolejnym przekazaniem.');
        }
        const summary=await loadOfferSummary(admin,offerId);
        const previousReason=String(state.review?.response_note || '').trim();
        const correctionSummary=correctionRequired ? [
          'Ponowna weryfikacja — odpowiedź na uwagi opiekuna.',
          state.review?.reviewed_at && 'Decyzja opiekuna z: '+deliveryTimestamp(state.review.reviewed_at),
          'Odpowiedź sprzedawcy:',
          correctionNote,
          'Sprzedawca potwierdził, że uwagi zostały uwzględnione lub wyjaśnione.',
          previousReason && 'Wcześniejsze uwagi opiekuna: '+previousReason.slice(0,1000)+(previousReason.length>1000 ? '… (skrócono; pełna decyzja pozostaje w historii)' : ''),
          '',
        ].filter(value=>value!==false && value!=null).join('\n') : '';
        // Keep the full correction reply first, so a long product list cannot
        // truncate it. Public reply only: no internal equipment/financial notes.
        reviewNote=[
          correctionSummary,
          'Oferta: '+state.title,
          'Sprzedawca: '+[summary.seller_name,summary.seller_organization].filter(Boolean).join(' · '),
          'Klient: '+[summary.client_company,summary.client_name].filter(Boolean).join(' · '),
          summary.event_date && 'Termin: '+new Date(summary.event_date).toLocaleDateString('pl-PL',{timeZone:'Europe/Warsaw'}),
          summary.event_location && 'Miejsce: '+summary.event_location,
          'Zakres oferty:',
          ...summary.items.map(item=>`• ${item.name} — ${item.quantity} ${item.unit}${item.days>1 ? ' × '+item.days+' dni' : ''}`),
          'Montaż, demontaż i szczegóły organizacyjne ustalimy na etapie przygotowania realizacji.',
        ].filter(Boolean).join('\n').slice(0,4800);
      }
      const result=await user.rpc('confirm_client_and_request_seller_review',{
        p_offer_id:offerId,p_document_id:body.documentId,p_request_id:body.requestId,p_confirmed:true,
        p_note:reviewNote,
      });
      if(result.error && ['PGRST202','42883'].includes(result.error.code)) throw new Error('Potwierdzenie klienta wymaga migracji 20260917230000_seller_delivery_workspace.sql. Nic nie zostało przekazane.');
      check(result.error);
      const notifiedRecipients=Number(result.data?.notified_recipients);
      if(!Number.isInteger(notifiedRecipients) || notifiedRecipients<1) throw new Error('Nie otrzymano potwierdzenia zapisu powiadomienia CRM. Odśwież status przed ponowieniem.');
      return NextResponse.json({success:true,notifiedRecipients,alreadySubmitted:result.data?.already_submitted===true});
    }
    if(body.action==='review' || body.action==='review_in_crm'){
      if(!state.can_manage) throw Object.assign(new Error('Brak uprawnień'),{status:403});
      if(!uuid(body.documentId) || !['approved','changes_requested','rejected'].includes(body.decision)) throw new Error('Wybierz właściwy PDF i decyzję.');
      const response=typeof body.response==='string' ? body.response.trim() : '';
      if(response.length>5000) throw new Error('Wiadomość dla sprzedawcy może mieć do 5000 znaków.');
      if(body.decision!=='approved' && !response) throw new Error('Napisz sprzedawcy, co wymaga zmiany lub dlaczego odrzucasz ofertę.');
      // This is a review of an immutable proposal, not a price editor.
      if(Number(body.discount || 0)!==0 || body.specialRequest===true) throw new Error('W ocenie nie zmieniamy ceny klienta. Uzgodnij zmianę ze sprzedawcą i poproś o nową wersję oferty.');
      const arrangements=await user.rpc('get_seller_offer_arrangements',{p_offer:offerId});
      check(arrangements.error);
      if(!arrangements.data) throw new Error('Nie udało się wczytać terminu i zakresu. Odśwież status przed decyzją.');
      const context=reviewContext(state.source_key,arrangements.data);
      if(body.expectedContextKey!==context.key) throw new Error('Termin, miejsce lub zakres zmieniły się od otwarcia oceny. Odśwież status, sprawdź dane i zaznacz potwierdzenia ponownie.');
      // The browser cannot confirm resources with a checkbox. Only the fresh
      // server analysis (or an explicit, recorded exception) supplies that flag.
      const decisionChecks={date:body.checks?.date===true,capacity:body.checks?.capacity===true,resources:false};
      if(body.decision==='approved'){
        if(context.date_error) throw new Error(context.date_error);
        if(context.past_date && body.confirmPastDate!==true) throw new Error('Termin jest w przeszłości. Poproś o poprawkę albo wyraźnie potwierdź, że oceniasz wydarzenie historyczne.');
        if(!decisionChecks.date || !decisionChecks.capacity) throw new Error('Potwierdź sprawdzenie terminu i dostępności zespołu.');
        const summary=await loadOfferSummary(admin,offerId);
        if(!summary.items.length) throw new Error('Oferta nie ma pozycji. Poproś sprzedawcę o uzupełnienie zakresu.');
        const analysis=await checkSellerEquipment(admin,offerId,arrangements.data,context.key);
        if(body.equipmentKey!==analysis.key) throw new Error('Wynik analizy sprzętu zmienił się lub nie został jeszcze sprawdzony. Zapoznaj się z aktualnym wynikiem i ponów decyzję.');
        const exceptionReason=typeof body.equipmentException?.reason==='string' ? body.equipmentException.reason.trim() : '';
        const exceptionConfirmed=body.equipmentException?.confirmed===true;
        if(!canConfirmEquipment(analysis,exceptionConfirmed,exceptionReason)) throw new Error('System nie potwierdził pełnej dostępności. Uzupełnij zakres lub potwierdź osobną weryfikację z wewnętrznym uzasadnieniem (10–2000 znaków).');
        await ensureEquipmentContext(admin,user,offerId,context.key,arrangements.data);
        // Internal only; never append warehouse details or exception notes to
        // p_response, partner activities or the seller conversation.
        // This records a preflight, NOT a successful approval. The existing
        // review trigger independently records the actual decision.
        const audit=await admin.from('seller_offer_review_audit').insert({
          offer_id:offerId,
          details:{kind:'equipment_preflight',actor_id:actor,document_id:body.documentId,context_key:context.key,
            analysis,exception:analysis.status==='clear' ? null : {confirmed:true,reason:exceptionReason}},
        });
        if(audit.error) throw new Error('Nie udało się zapisać historii kontroli sprzętu. Decyzja nie została wysłana; ponów po odświeżeniu.');
        decisionChecks.resources=true;
      }
      const result=await user.rpc(body.action==='review_in_crm' ? 'review_seller_offer_in_crm' : 'review_seller_offer_and_accept',{
        p_offer_id:offerId,p_document_id:body.documentId,p_decision:body.decision,p_checks:decisionChecks,
        p_response:response,p_discount:0,
        p_special_request:false,p_reason:'',
        ...(body.action==='review_in_crm' ? {p_expected_review:body.expectedReview ?? null} : {}),
      });
      if(body.action==='review_in_crm')checkCrmReview(result.error);else checkHandoff(result.error);
      return NextResponse.json({success:true,...result.data});
    }
    if(body.action==='configure'){
      const result=await user.rpc('configure_seller_offer_manager',{
        p_offer_id:offerId,p_manager_id:body.managerId || null,
      });checkCrmReview(result.error);
      return NextResponse.json({success:true});
    }
    if(body.action==='email'){
      throw new Error('Wysyłka przez CRM jest wyłączona. Pobierz PDF i wyślij go ze swojej skrzynki.');
    }
    throw new Error('Nieznana operacja');
  }catch(error:any){
    return fail(error);
  }
}
