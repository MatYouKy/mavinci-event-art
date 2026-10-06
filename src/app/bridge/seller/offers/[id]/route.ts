import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { renderSellerOfferPdf } from '@/lib/seller/renderOfferPdf.server';
import { sellerArrangementReviewNote, type SellerArrangements } from '@/lib/seller/arrangements';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
const uuid=(value: unknown): value is string => typeof value==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail=(error: any) => NextResponse.json({error:error?.message || 'Nie udało się wykonać operacji'},{status:error?.status || 400});
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
        if(state.can_configure && manager.data?.source==='seller'){
          const employees=await admin.from('employees').select('id,name,surname').eq('is_active',true).order('surname');
          check(employees.error);state.managers=employees.data;
        }
      }
    }
    const owner=await admin.from('offers').select('sales_partner_id,my_company_id,status,event_id').eq('id',params.id).eq('sales_channel','seller_portal').single();
    check(owner.error);
    let linkedEvent:{id:string;status:string}|null=null;
    let canViewEvent=false;
    if(owner.data.event_id){
      const event=await admin.from('events').select('id,status').eq('id',owner.data.event_id).eq('my_company_id',owner.data.my_company_id).maybeSingle();
      check(event.error);linkedEvent=event.data;
      if(state.can_manage && linkedEvent){
        const view=await user.rpc('get_seller_offer_arrangements',{p_offer:params.id});
        // CRM links must not imply access when the event is outside the reader's scope.
        canViewEvent=!view.error && view.data?.event?.can_view_crm===true;
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
      crm_review_ready:Number(version.data)>=3};
    // Mailbox credentials and delivery configuration are not part of this flow.
    state.config={manager_id:state.manager?.manager_id || null};
    delete state.delivery;
    if(!state.can_manage){
      const [arrangements,progress]=await Promise.all([
        user.rpc('get_seller_offer_arrangements',{p_offer:params.id}),
        user.rpc('get_seller_delivery_progress',{p_offer:params.id}),
      ]);
      if(arrangements.error) state.seller_arrangements_error='Nie udało się wczytać ustaleń i kontaktów. Odśwież widok.';
      else state.seller_arrangements=arrangements.data;
      if(progress.error) state.seller_progress_error=['PGRST202','42883'].includes(progress.error.code)
        ? 'Nowy proces sprzedawcy wymaga migracji 20260917230000_seller_delivery_workspace.sql. Dotychczasowa rozmowa i dokumenty pozostają dostępne.'
        : 'Nie udało się wczytać przygotowań i historii akceptacji klienta. Odśwież widok.';
      else state.seller_progress=progress.data;
    }
    // Identity is read only after the caller's access to this exact offer was checked.
    if (state.can_manage) {
      const source=await admin.from('offers').select('sales_partner_id,portal_client_name,portal_client_company,portal_client_email,portal_client_phone,event_date,event_location,description,partner_branding_snapshot').eq('id',params.id).single();
      check(source.error);
      const partner=await admin.from('sales_partner_profiles').select('id,contact_id,contact:contacts!contact_id(full_name),employee:employees!employee_id(name,surname),organization:organizations!organization_id(name,alias)').eq('id',source.data.sales_partner_id).single();
      check(partner.error);
      const one=(value:any)=>Array.isArray(value) ? value[0] : value;
      const contact=one(partner.data.contact),employee=one(partner.data.employee),organization=one(partner.data.organization);
      state.source={
        ...source.data,
        seller_contact_id:partner.data.contact_id || null,
        seller_name:source.data.partner_branding_snapshot?.display_name || contact?.full_name || [employee?.name,employee?.surname].filter(Boolean).join(' ') || 'Sprzedawca',
        seller_organization:organization?.alias || organization?.name || '',
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
    if(body.action==='submit_preparation'){
      if(!uuid(body.messageId)) throw new Error('Brak identyfikatora wiadomości.');
      const result=await user.rpc('submit_seller_realization_information',{
        p_offer:offerId,p_task_key:body.taskKey,p_revision:body.revision,p_message_id:body.messageId,p_body:body.text,
      });
      if(result.error && ['PGRST202','42883'].includes(result.error.code)) throw new Error('Przygotowania wymagają migracji 20260917230000_seller_delivery_workspace.sql.');
      check(result.error);return NextResponse.json(result.data);
    }
    if(['accept_offer','confirm_realization','event_draft','create_event','review','configure','review_in_crm'].includes(body.action)){
      const version=await user.rpc('seller_offer_handoff_version');checkHandoff(version.error);
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
            : await user.rpc(body.values?.location_id ? 'create_event_from_seller_offer_at_location' : 'create_event_from_seller_offer',{p_offer_id:offerId,p_source_key:body.sourceKey,p_revision:body.revision,p_values:body.values});
      if(body.action==='create_event' && body.values?.location_id && result.error && ['PGRST202','42883'].includes(result.error.code)){
        throw new Error('Powiązanie wydarzenia z bazą lokalizacji wymaga migracji 20260917190000. Dane formularza pozostają zachowane.');
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
      const arrangements=await user.rpc('get_seller_offer_arrangements',{p_offer:offerId});
      check(arrangements.error);
      if(!arrangements.data) throw new Error('Wczytaj zapisane ustalenia przed przekazaniem oferty do potwierdzenia.');
      const result=await user.rpc('confirm_client_and_request_seller_review',{
        p_offer_id:offerId,p_document_id:body.documentId,p_request_id:body.requestId,p_confirmed:true,
        p_note:sellerArrangementReviewNote(arrangements.data as SellerArrangements),
      });
      if(result.error && ['PGRST202','42883'].includes(result.error.code)) throw new Error('Potwierdzenie klienta wymaga migracji 20260917230000_seller_delivery_workspace.sql. Nic nie zostało przekazane.');
      check(result.error);
      const notifiedRecipients=Number(result.data?.notified_recipients);
      if(!Number.isInteger(notifiedRecipients) || notifiedRecipients<1) throw new Error('Nie otrzymano potwierdzenia zapisu powiadomienia CRM. Odśwież status przed ponowieniem.');
      return NextResponse.json({success:true,notifiedRecipients});
    }
    if(body.action==='review' || body.action==='review_in_crm'){
      if(!state.can_manage) throw Object.assign(new Error('Brak uprawnień'),{status:403});
      const result=await user.rpc(body.action==='review_in_crm' ? 'review_seller_offer_in_crm' : 'review_seller_offer_and_accept',{
        p_offer_id:offerId,p_document_id:body.documentId,p_decision:body.decision,p_checks:body.checks || {},
        p_response:String(body.response || '').slice(0,5000),p_discount:Number(body.discount || 0),
        p_special_request:body.specialRequest===true,p_reason:String(body.reason || '').slice(0,5000),
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
