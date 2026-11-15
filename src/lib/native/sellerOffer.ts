import 'server-only';
import { NextRequest } from 'next/server';
import type { NativeContext } from './auth';
import { GET as sellerOfferWorkflow } from '@/app/bridge/seller/offers/[id]/route';
import { SELLER_JOURNEY_ACTOR_LABELS, sellerJourney } from '@/lib/seller/offerJourney';

/**
 * Ocena oferty z portalu sprzedawcy na Macu (`/bridge/native/v1/sellers?op=offer`). Stan oferty to dokładnie ten sam odczyt
 * co w CRM (`GET /bridge/seller/offers/[id]` — wywołany tutaj bezpośrednio, z tokenem pracownika), do tego zgoda na cenę
 * (`get_seller_offer_price_approval`) i oś w 5 etapach w widoku opiekuna (`offerJourney.ts`). Decyzje aplikacja wysyła na te
 * same adresy co CRM: ocena, PDF i analiza sprzętu — `/bridge/seller/offers/[id]`, zgoda na cenę — `op=priceDecide`.
 * Warunki decyzji zależne od serwera liczymy tu (jak `SellerOfferWorkflow.tsx`); pozostałe (PDF obejrzany, potwierdzenia,
 * analiza sprzętu) sprawdza aplikacja, a serwer CRM i baza sprawdzają wszystko ponownie przy zapisie.
 */

type Review = { document_id: string; source_key: string; status: string; request_note: string; response_note: string; requested_at?: string; reviewed_at?: string | null };
type Workflow = {
  can_manage: boolean; source_key: string; title: string; offer_number: string;
  review?: Review; documents: { id: string; filename: string; created_at: string; source_key: string; current: boolean }[];
  review_context?: { key: string; date_error: string | null; past_date: boolean };
  realization?: { offer_status: string; stage: string; event_id: string | null; event_status: string | null; can_view_event: boolean;
    can_create_event: boolean; migration_ready: boolean; crm_review_ready: boolean; auto_event_ready: boolean };
  offer_summary?: { seller_name: string; seller_organization: string; client_name: string; client_company: string; event_date: string | null;
    event_location: string; price_approval_required?: boolean; items: { id: string; name: string; quantity: number; unit: string; days: number }[] };
  offer_summary_error?: string;
  source?: { seller_name?: string; seller_organization?: string; portal_client_email?: string | null; portal_client_phone?: string | null };
  manager?: { manager_name: string | null } | null;
};
type PriceApproval = {
  status: string; price_key: string | null; can_decide: boolean;
  items: { name: string; custom: boolean; unit: string; quantity: number; days: number; base_price: number | null; client_price: number }[];
  request: { id: string; status: string; note: string; requested_at: string; response_note: string; decided_at: string | null; decided_by_name: string | null; current: boolean } | null;
};

const REVIEW_LABELS: Record<string, string> = {
  pending: 'Oczekuje na ocenę opiekuna', approved: 'Oferta zaakceptowana przez opiekuna',
  changes_requested: 'Opiekun prosi o zmiany', rejected: 'Brak akceptacji',
};
const PRICE_LABELS: Record<string, string> = {
  required: 'Cena wymaga zgody', approved: 'Ceny zatwierdzone', changes_requested: 'Poproszono o zmianę ceny', rejected: 'Ceny odrzucone', not_required: 'Ceny z cennika',
};
const pln = (value: number | null | undefined) => value == null ? null
  : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));

async function priceApproval(ctx: NativeContext, offerId: string): Promise<{ approval: PriceApproval | null; error: string | null }> {
  const { data, error } = await ctx.supabase.rpc('get_seller_offer_price_approval', { p_offer: offerId });
  if (error) {
    if (error.code === '42501') return { approval: null, error: null };
    if (['PGRST202', '42883', '42P01'].includes(error.code || '')) return { approval: null, error: 'Zgoda na cenę wymaga migracji 20261114230000_seller_price_approval_and_auto_review.sql.' };
    return { approval: null, error: error.message || 'Nie udało się sprawdzić zgody na cenę.' };
  }
  const raw = (data || {}) as Partial<PriceApproval>;
  return {
    error: null,
    approval: {
      status: String(raw.status || 'not_required'), price_key: raw.price_key || null, can_decide: raw.can_decide === true,
      items: Array.isArray(raw.items) ? raw.items.map((item) => ({
        name: String(item.name || 'Pozycja'), custom: item.custom === true, unit: String(item.unit || 'szt.'), quantity: Number(item.quantity || 0),
        days: Number(item.days || 1), base_price: item.base_price == null ? null : Number(item.base_price), client_price: Number(item.client_price || 0),
      })) : [],
      request: raw.request ? { ...raw.request, note: raw.request.note || '', response_note: raw.request.response_note || '' } : null,
    },
  };
}

export async function sellerOfferReview(ctx: NativeContext, request: Request, offerId: string) {
  // Ten sam odczyt co CRM — uprawnienia do oferty, opiekun, dokumenty, kontekst oceny, realizacja.
  const url = new URL(`/bridge/seller/offers/${offerId}`, request.url);
  const response = await sellerOfferWorkflow(new NextRequest(url, { headers: { authorization: request.headers.get('authorization') || '' } }), { params: { id: offerId } });
  const state = await response.json() as Workflow & { error?: string };
  if (!response.ok) throw Object.assign(new Error(state.error || 'Nie udało się wczytać oferty sprzedawcy.'), { status: response.status });

  const realization = state.realization;
  const accepted = realization?.offer_status === 'accepted';
  const confirmed = realization?.stage === 'confirmed';
  const cancelled = realization?.stage === 'cancelled';
  const closed = accepted || confirmed || cancelled;
  const price = closed ? { approval: null, error: null } : await priceApproval(ctx, offerId);
  const priceRequest = price.approval?.status === 'required'
    ? price.approval.request?.status === 'pending' ? 'pending' as const
      : price.approval.request?.status === 'changes_requested' ? 'changes_requested' as const : 'missing' as const
    : null;
  const currentReview = state.review && state.review.source_key === state.source_key ? state.review : null;
  const journey = sellerJourney({
    offerStatus: realization?.offer_status || 'draft',
    reviewStatus: currentReview?.status || null,
    priceApprovalRequired: price.approval ? price.approval.status === 'required' : state.offer_summary?.price_approval_required === true,
    priceRequest,
    hasPdf: state.documents.length > 0,
    pdfCurrent: state.documents.some((doc) => doc.current),
    isRealization: accepted || confirmed,
    realizationStage: realization?.stage,
    eventStatus: realization?.event_status,
  }, { viewer: 'manager' });

  // Jak `SellerOfferWorkflow.tsx`: ocena wysłanej wersji albo bezpośrednia ocena oferty bez zgłoszenia (np. klient zgodził się poza portalem).
  const pending = currentReview?.status === 'pending';
  const direct = state.can_manage && !closed && ['draft', 'sent', 'viewed'].includes(realization?.offer_status || '')
    && (!currentReview || ['changes_requested', 'rejected'].includes(currentReview.status));
  const canDecide = Boolean(state.can_manage && !closed && (pending || direct));
  const reviewDocumentId = pending ? currentReview!.document_id : state.documents.find((doc) => doc.current)?.id || null;
  const blockers: string[] = [];
  if (canDecide) {
    if (!reviewDocumentId) blockers.push('Potrzebny jest aktualny PDF przekazany do oceny.');
    if (!state.review_context) blockers.push('Odśwież status — nie wczytano danych do oceny.');
    if (!realization?.migration_ready) blockers.push('Obsługa akceptacji wymaga aktualizacji przez administratora.');
    if (direct && !realization?.crm_review_ready) blockers.push('Bezpośrednia ocena wymaga aktualizacji przez administratora.');
  }
  const approvalBlockers: string[] = [];
  if (canDecide) {
    if (!realization?.auto_event_ready) approvalBlockers.push('Automatyczne tworzenie wydarzenia wymaga migracji 20261028170000_seller_acceptance_event_handoff.sql.');
    if (!realization?.can_create_event) approvalBlockers.push('Akceptacja tworzy wydarzenie — potrzebujesz uprawnień do ofert i wydarzeń tej marki.');
    if (state.review_context?.date_error) approvalBlockers.push(state.review_context.date_error);
    if (!state.offer_summary) approvalBlockers.push('Odśwież status — nie udało się wczytać zakresu oferty.');
    else if (!state.offer_summary.items.length) approvalBlockers.push('Sprzedawca musi uzupełnić pozycje oferty.');
  }
  const summary = state.offer_summary;
  const approval = price.approval;
  return {
    offerId,
    title: state.title,
    number: state.offer_number,
    canManage: state.can_manage,
    seller: { name: state.source?.seller_name || summary?.seller_name || 'Sprzedawca', organization: state.source?.seller_organization || summary?.seller_organization || '' },
    client: {
      name: summary?.client_name || '', company: summary?.client_company || '',
      email: state.source?.portal_client_email || null, phone: state.source?.portal_client_phone || null,
    },
    eventDate: summary?.event_date || null,
    location: summary?.event_location || '',
    items: (summary?.items || []).map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, days: item.days })),
    summaryError: state.offer_summary_error || null,
    journey: {
      index: journey.index, key: journey.key, stageLabel: journey.stageLabel, state: journey.state, now: journey.now, tone: journey.tone,
      actor: SELLER_JOURNEY_ACTOR_LABELS[journey.actor].manager, needsAction: journey.needsAction, ended: journey.ended,
    },
    review: state.review ? {
      status: state.review.status, statusLabel: REVIEW_LABELS[state.review.status] || 'Ocena', current: Boolean(currentReview),
      requestNote: state.review.request_note || '', responseNote: state.review.response_note || '',
      requestedAt: state.review.requested_at || null, reviewedAt: state.review.reviewed_at || null, documentId: state.review.document_id,
    } : null,
    /** Zgłoszenie do odesłania przy decyzji bez zmian (`expectedReview`) — serwer CRM porównuje je z bieżącym. */
    reviewRaw: state.review ?? null,
    documents: state.documents.map((doc) => ({ id: doc.id, filename: doc.filename, createdAt: doc.created_at, current: doc.current })),
    decision: {
      canDecide,
      mode: canDecide ? (pending ? 'pending' : 'direct') : null,
      action: realization?.crm_review_ready ? 'review_in_crm' : 'review',
      documentId: canDecide ? reviewDocumentId : null,
      contextKey: state.review_context?.key || null,
      pastDate: state.review_context?.past_date === true,
      dateError: state.review_context?.date_error || null,
      blockers,
      approvalBlockers,
    },
    realization: realization ? {
      offerStatus: realization.offer_status, stage: realization.stage, eventId: realization.event_id, eventStatus: realization.event_status,
      canViewEvent: realization.can_view_event, accepted, confirmed, cancelled,
    } : null,
    price: approval && approval.status !== 'not_required' ? {
      status: approval.status,
      statusLabel: PRICE_LABELS[approval.status] || 'Zgoda na cenę',
      priceKey: approval.price_key,
      canDecide: approval.can_decide && approval.status === 'required',
      items: approval.items.map((item) => ({
        name: item.name, custom: item.custom, quantity: `${item.quantity} ${item.unit}${item.days > 1 ? ` × ${item.days} dni` : ''}`,
        basePrice: item.custom ? 'pozycja własna' : pln(item.base_price), clientPrice: pln(item.client_price) || '—',
        below: !item.custom && item.base_price != null && item.client_price < item.base_price,
      })),
      request: approval.request ? {
        status: approval.request.status, note: approval.request.note, requestedAt: approval.request.requested_at,
        responseNote: approval.request.response_note, decidedBy: approval.request.decided_by_name, current: approval.request.current,
      } : null,
    } : null,
    priceError: price.error,
    links: { crm: `/crm/offers/${offerId}`, event: realization?.event_id ? `/crm/events/${realization.event_id}?tab=seller-arrangements` : null },
  };
}

/** Zgoda na cenę albo prośba o zmianę — dla cen, które opiekun widział (`expectedKey`). */
export async function decideSellerOfferPrice(ctx: NativeContext, offerId: string, decision: string, note: string, expectedKey: string | null) {
  if (!['approved', 'changes_requested'].includes(decision)) throw Object.assign(new Error('Nieprawidłowa decyzja.'), { status: 400 });
  if (decision === 'changes_requested' && note.trim().length < 3) throw Object.assign(new Error('Napisz sprzedawcy, którą cenę lub pozycję trzeba zmienić.'), { status: 400 });
  const { error } = await ctx.supabase.rpc('decide_seller_offer_price_approval', {
    p_offer: offerId, p_decision: decision, p_note: note.trim().slice(0, 2000), p_expected_key: expectedKey,
  });
  if (error) throw error;
  return { ok: true, message: decision === 'approved' ? 'Ceny zatwierdzone — hotel może pokazać ofertę klientowi.' : 'Prośba o zmianę ceny wysłana do sprzedawcy.' };
}
