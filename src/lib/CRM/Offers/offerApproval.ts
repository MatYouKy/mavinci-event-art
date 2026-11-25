import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Akceptacja rabatu i marży oferty (progi `sales_offer_guardrails`: rabat powyżej limitu, np. 10%, albo marża poniżej progu)
 * — jeden opis stanu dla CRM (`OfferApprovalBanner` w karcie „Informacje”) i Maca (`OfferApprovalPanel`, przez `offerDetail`).
 * Sprzedawca: „Wyślij do akceptacji” z uzasadnieniem (`request_offer_approval`; administrator dostaje powiadomienie).
 * Administrator albo zarządzający finansami (`current_employee_can_approve_offers`): wysyła ofertę od razu, bez prośby;
 * prośbę sprzedawcy „Zaakceptuj” albo „Odrzuć” z powodem (`decide_offer_approval`; powód odrzucenia jest wymagany,
 * sprzedawca dostaje powiadomienie i widzi powód przy ofercie). Wysyłkę bez akceptacji blokuje też serwer (`send-offer-email`).
 */

export type OfferGuardrailReason = { kind: 'discount' | 'margin' | string; message?: string; value?: number | string; limit?: number | string };

export type OfferGuardrailStatus = {
  required: boolean;
  reasons: OfferGuardrailReason[];
  discount_percent: number;
  margin_percent: number | null;
  margin_known: boolean;
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approval_valid: boolean;
  approval_note: string | null;
  approval_requested_at?: string | null;
  approval_decided_at?: string | null;
  can_send: boolean;
  can_approve: boolean;
  limits: { enabled: boolean; max_discount_percent: number | string; min_margin_percent: number | string };
};

/** Osoby z historii akceptacji (imię i nazwisko). */
export type OfferApprovalPeople = { requestedBy?: string | null; decidedBy?: string | null };

export type OfferApprovalView = {
  /** success — zaakceptowane, pending — czeka na decyzję, warning — wymaga akceptacji / odrzucone, info — podpowiedź. */
  tone: 'success' | 'pending' | 'warning' | 'info';
  title: string;
  /** „Rabat 30,07% przekracza limit 10%”, „Marża 18% jest poniżej progu 25%”. */
  reasons: string[];
  /** Uzasadnienie sprzedawcy, powód odrzucenia albo notatka akceptacji. */
  note: { label: string; text: string } | null;
  /** „Prośba: Jan Kowalski · 25.11.2026, 10:13”, „Odrzucenie: …”, „Akceptacja: …”. */
  meta: string | null;
  hint: string | null;
  /** Sprzedawca: „Wyślij do akceptacji”. */
  canRequest: boolean;
  /** Akceptujący: „Zaakceptuj” (`approveLabel`). */
  canApprove: boolean;
  /** Akceptujący przy prośbie sprzedawcy: „Odrzuć” (powód wymagany). */
  canReject: boolean;
  approveLabel: string;
  /** Wysyłka oferty zablokowana do akceptacji (przycisk „Wyślij ofertę” wyłączony z podpowiedzią). */
  blocksSending: boolean;
  notePlaceholder: string;
};

export const OFFER_APPROVAL_NOTE_LIMIT = 2000;
export const OFFER_APPROVAL_REJECT_NOTE = 'Podaj powód odrzucenia — sprzedawca zobaczy go przy ofercie.';
/** Komunikaty po czynności (te same na Macu — `OfferApprovalPanel`). */
export const OFFER_APPROVAL_DONE = {
  request: 'Wysłano do akceptacji — administrator dostanie powiadomienie',
  approve: 'Warunki oferty zaakceptowane',
  reject: 'Odrzucono — powód widać przy ofercie',
} as const;

const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const percent = (value: unknown) => `${number(value).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`;
const dateTime = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
};
const metaLine = (label: string, person: string | null | undefined, at: string | null | undefined) => {
  const parts = [person?.trim(), dateTime(at)].filter(Boolean);
  return parts.length ? `${label}: ${parts.join(' · ')}` : null;
};

function reasonText(reason: OfferGuardrailReason) {
  if (reason.kind === 'discount' && reason.value !== undefined && reason.limit !== undefined) {
    return `Rabat ${percent(reason.value)} przekracza limit ${percent(reason.limit)}`;
  }
  if (reason.kind === 'margin' && reason.value !== undefined && reason.limit !== undefined) {
    return `Marża ${percent(reason.value)} jest poniżej progu ${percent(reason.limit)}`;
  }
  return reason.message || 'Oferta przekracza progi handlowe';
}

/** Stan akceptacji do pokazania przy podsumowaniu oferty; `null` — nic do pokazania (progi wyłączone albo oferta w normie). */
export function offerApprovalView(status: OfferGuardrailStatus | null | undefined, people: OfferApprovalPeople = {}): OfferApprovalView | null {
  if (!status || !status.limits?.enabled) return null;
  const approver = status.can_approve === true;
  const base = {
    reasons: [] as string[], note: null, meta: null, hint: null, canRequest: false, canApprove: false, canReject: false,
    approveLabel: 'Zaakceptuj', blocksSending: false,
    notePlaceholder: approver
      ? 'Uzasadnienie decyzji — sprzedawca je zobaczy (wymagane przy odrzuceniu)'
      : 'Uzasadnienie dla administratora (np. stały klient, duże zamówienie)',
  };

  if (!status.required) {
    if (status.margin_known) return null;
    return {
      ...base,
      tone: 'info',
      title: 'Marża nie jest kontrolowana',
      hint: `Oferta nie ma kosztów pozycji. Uzupełnij koszty w katalogu produktów, aby system pilnował progu marży ${percent(status.limits.min_margin_percent)}.`,
    };
  }

  const reasons = (status.reasons || []).map(reasonText);
  const discount = (status.reasons || []).some((reason) => reason.kind === 'discount');
  const subject = discount ? 'rabatu' : 'warunków oferty';
  const note = (status.approval_note || '').trim();
  const blocksSending = status.can_send !== true;

  if (status.approval_valid) {
    return {
      ...base,
      tone: 'success',
      title: discount ? 'Rabat zaakceptowany — ofertę można wysłać' : 'Warunki zaakceptowane — ofertę można wysłać',
      reasons,
      note: note ? { label: 'Notatka', text: note } : null,
      meta: metaLine('Akceptacja', people.decidedBy, status.approval_decided_at),
    };
  }

  if (status.approval_status === 'pending') {
    return {
      ...base,
      tone: 'pending',
      title: approver ? `Sprzedawca prosi o akceptację ${subject}` : 'Czeka na akceptację administratora',
      reasons,
      note: note ? { label: 'Uzasadnienie sprzedawcy', text: note } : null,
      meta: metaLine('Prośba', people.requestedBy, status.approval_requested_at),
      hint: approver
        ? 'Zaakceptuj albo odrzuć z uzasadnieniem — sprzedawca dostanie powiadomienie.'
        : 'Po decyzji dostaniesz powiadomienie. Do tego czasu oferty nie można wysłać.',
      canApprove: approver,
      canReject: approver,
      blocksSending,
    };
  }

  if (status.approval_status === 'rejected') {
    return {
      ...base,
      tone: 'warning',
      title: approver ? 'Akceptacja odrzucona' : `Administrator odrzucił prośbę o akceptację ${subject}`,
      reasons,
      note: note ? { label: 'Powód odrzucenia', text: note } : null,
      meta: metaLine('Odrzucenie', people.decidedBy, status.approval_decided_at),
      hint: approver
        ? 'Jako administrator możesz wysłać ofertę od razu.'
        : 'Popraw rabat albo wyślij ponownie do akceptacji z uzasadnieniem.',
      canRequest: !approver,
      canApprove: approver,
      blocksSending,
    };
  }

  // Bez prośby albo warunki zmienione po akceptacji (wyższy rabat, inna wartość pozycji, niższa marża).
  const changed = status.approval_status === 'approved';
  return {
    ...base,
    tone: 'warning',
    title: changed
      ? 'Warunki zmieniły się po akceptacji — potrzebna ponowna akceptacja'
      : approver
        ? `${discount ? 'Rabat' : 'Warunki'} ponad limit — jako administrator możesz wysłać ofertę od razu`
        : 'Oferta wymaga akceptacji administratora przed wysłaniem',
    reasons,
    meta: changed ? metaLine('Poprzednia akceptacja', people.decidedBy, status.approval_decided_at) : null,
    hint: approver
      ? 'Akceptacja jest potrzebna tylko wtedy, gdy ofertę wyśle sprzedawca.'
      : '„Wyślij do akceptacji” — administrator dostanie powiadomienie, a Ty — jego decyzję.',
    canRequest: !approver,
    canApprove: approver,
    approveLabel: 'Zaakceptuj warunki',
    blocksSending,
  };
}

const personName = (row: { name?: string | null; surname?: string | null } | undefined) =>
  row ? [row.name, row.surname].filter(Boolean).join(' ').trim() || null : null;

/**
 * Stan progów oferty z bazy (`get_offer_guardrail_status`, uprawnienia osoby) i osoby z historii akceptacji.
 * Starsza baza bez progów, oferta niedostępna albo błąd — `null` (bez sekcji akceptacji).
 */
export async function loadOfferApproval(client: SupabaseClient, offerId: string): Promise<OfferApprovalView | null> {
  const { data, error } = await client.rpc('get_offer_guardrail_status', { p_offer_id: offerId });
  if (error || !data) return null;
  const status = data as OfferGuardrailStatus;
  if (!status.limits?.enabled || !status.required) return offerApprovalView(status);
  const people: OfferApprovalPeople = {};
  if (status.approval_status) {
    const { data: offer } = await client.from('offers').select('approval_requested_by, approval_decided_by').eq('id', offerId).maybeSingle();
    const row = (offer || {}) as { approval_requested_by?: string | null; approval_decided_by?: string | null };
    const ids = [row.approval_requested_by, row.approval_decided_by].filter((id): id is string => Boolean(id));
    if (ids.length) {
      const { data: employees } = await client.from('employees').select('id, name, surname').in('id', ids);
      const byId = new Map(((employees || []) as Array<{ id: string; name?: string | null; surname?: string | null }>).map((person) => [person.id, person]));
      people.requestedBy = personName(row.approval_requested_by ? byId.get(row.approval_requested_by) : undefined);
      people.decidedBy = personName(row.approval_decided_by ? byId.get(row.approval_decided_by) : undefined);
    }
  }
  return offerApprovalView(status, people);
}
