/**
 * Wspólna oś oferty z portalu sprzedawcy — pięć etapów zamiast kilkunastu nazw statusów.
 * Ta sama oś jest w portalu hotelu, w CRM (ocena oferty, kokpit opiekuna), w aplikacji na Maca i w aplikacji mobilnej.
 * Kopia 1:1: src/lib/seller/offerJourney.ts ↔ mobile/src/lib/offerJourney.ts (scripts/ci/check-shared-copies.mjs).
 *
 * Etap wynika wyłącznie z zapisanych decyzji: status oferty, ocena opiekuna dla bieżącej wersji, przejście do realizacji
 * i status wydarzenia. Daty ani wyświetlenia linku niczego nie przesuwają. Bez zależności od Reacta i Supabase.
 */

export const SELLER_JOURNEY_STAGES = [
  { key: 'offer', label: 'Oferta', hint: 'Hotel przygotowuje ofertę w kreatorze' },
  { key: 'client', label: 'U klienta', hint: 'Klient dostaje PDF lub link i decyduje' },
  { key: 'manager', label: 'U opiekuna', hint: 'Opiekun sprawdza termin, zespół i sprzęt' },
  { key: 'event', label: 'Wydarzenie', hint: 'Potwierdzenie terminu i wspólne przygotowanie' },
  { key: 'settlement', label: 'Rozliczenie', hint: 'Po wydarzeniu: podsumowanie i wynagrodzenie' },
] as const;

export type SellerJourneyStageKey = typeof SELLER_JOURNEY_STAGES[number]['key'];

/**
 * Te same etapy w widoku pracowników MAVINCI (CRM, Mac, aplikacja mobilna): etap `event` nazywa się „Event”, jak w całym
 * interfejsie pracowników. Portal hotelu zostaje przy nazwach z SELLER_JOURNEY_STAGES („Wydarzenie”).
 */
export const SELLER_JOURNEY_STAGES_TEAM: readonly { key: SellerJourneyStageKey; label: string; hint: string }[] = SELLER_JOURNEY_STAGES.map((item) => (
  item.key === 'event' ? { ...item, label: 'Event' }
    : item.key === 'settlement' ? { ...item, hint: 'Po evencie: podsumowanie i wynagrodzenie' }
      : item
));
/** Kto teraz działa. `none` — sprawa zakończona albo nikt nie musi nic robić. */
export type SellerJourneyActor = 'seller' | 'client' | 'manager' | 'none';
export type SellerJourneyTone = 'action' | 'waiting' | 'success' | 'danger' | 'neutral';
export type SellerJourneyViewer = 'seller' | 'manager';

export type SellerJourneyInput = {
  /** offers.status (portalowe oferty pozostają `draft` aż do akceptacji opiekuna). */
  offerStatus: string;
  /** Decyzja opiekuna dla bieżącej wersji oferty; null, gdy brak albo dotyczy starszej wersji. */
  reviewStatus?: string | null;
  /** Sprzedawca zapisał zgodę klienta przy przekazaniu oferty. */
  clientConfirmed?: boolean;
  /** offers.partner_approval_status = 'required' — pozycja własna albo cena poniżej stawki. */
  priceApprovalRequired?: boolean;
  /** Prośba o zgodę na cenę: czeka na opiekuna, opiekun prosi o zmianę, jeszcze nie wysłana (src/lib/seller/priceApproval.ts). */
  priceRequest?: 'pending' | 'changes_requested' | 'missing' | null;
  /** Istnieje zapisany PDF oferty (undefined — nie wiadomo, np. na liście). */
  hasPdf?: boolean;
  /** Bieżący PDF odpowiada zapisanym danym oferty. */
  pdfCurrent?: boolean;
  /** Klient zaakceptował ofertę online pod linkiem. */
  clientAcceptedOnline?: boolean;
  /** Klient obejrzał ofertę pod linkiem. */
  clientViewed?: boolean;
  /** Oferta jest już realizacją (akceptacja opiekuna utworzyła wydarzenie). */
  isRealization?: boolean;
  /** seller_offer_workflow_state.realization.stage: offer | awaiting_crm_confirmation | confirmed | cancelled. */
  realizationStage?: string | null;
  /** events.status powiązanego wydarzenia. */
  eventStatus?: string | null;
};

export type SellerJourney = {
  index: number;
  key: SellerJourneyStageKey;
  stageLabel: string;
  /** Krótki stan wewnątrz etapu, np. „Do poprawy”, „Czeka na potwierdzenie terminu”. */
  state: string;
  actor: SellerJourneyActor;
  /** Jedno zdanie „co teraz” dla oglądającego. */
  now: string;
  tone: SellerJourneyTone;
  /** Oglądający ma coś zrobić. */
  needsAction: boolean;
  /** Sprawa zakończona bez dalszych kroków (odrzucona, anulowana, wygasła). */
  ended: boolean;
};

const CLOSED_EVENT = ['completed', 'invoiced', 'settled'];
const CONFIRMED_EVENT = ['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress'];
const PAUSED_EVENT = ['on_hold', 'paused'];

function stage(index: number, team: boolean) {
  const stages: readonly { key: SellerJourneyStageKey; label: string }[] = team ? SELLER_JOURNEY_STAGES_TEAM : SELLER_JOURNEY_STAGES;
  const position = Math.max(0, Math.min(stages.length - 1, index));
  return { index: position, key: stages[position].key, stageLabel: stages[position].label };
}

/**
 * Etap oferty na wspólnej osi.
 * @param options.managerName imię opiekuna („Anna sprawdza ofertę”); bez imienia — „Opiekun”.
 * @param options.viewer `seller` — portal hotelu; `manager` — CRM i aplikacje pracowników MAVINCI.
 */
export function sellerJourney(input: SellerJourneyInput, options: { viewer?: SellerJourneyViewer; managerName?: string | null } = {}): SellerJourney {
  const viewer = options.viewer || 'seller';
  const manager = (options.managerName || '').trim().split(/\s+/)[0] || 'Opiekun';
  const seller = viewer === 'seller';
  const result = (index: number, state: string, actor: SellerJourneyActor, now: string, tone: SellerJourneyTone, ended = false): SellerJourney => ({
    ...stage(index, !seller), state, actor, now, tone, ended,
    needsAction: !ended && ((seller && actor === 'seller') || (!seller && actor === 'manager')),
  });
  const event = input.eventStatus || '';
  const realization = input.isRealization || input.offerStatus === 'accepted'
    || ['awaiting_crm_confirmation', 'confirmed', 'cancelled'].includes(input.realizationStage || '');

  if (realization) {
    if (event === 'cancelled' || input.realizationStage === 'cancelled') {
      return result(3, 'Anulowane', 'none', seller ? 'Wydarzenie zostało anulowane. Historia, dokumenty i rozmowa pozostają dostępne.' : 'Event został anulowany. Historia, dokumenty i rozmowa pozostają dostępne.', 'danger', true);
    }
    if (PAUSED_EVENT.includes(event)) {
      return result(3, 'Wstrzymane', 'manager', seller ? 'Wydarzenie jest wstrzymane. Dalsze kroki ustalicie z opiekunem w rozmowie.' : 'Event jest wstrzymany. Ustal dalsze kroki ze sprzedawcą.', 'waiting');
    }
    if (CLOSED_EVENT.includes(event)) {
      return result(4, event === 'settled' ? 'Rozliczone' : seller ? 'Po wydarzeniu' : 'Po evencie', event === 'settled' ? 'none' : 'manager',
        seller ? (event === 'settled' ? 'Wydarzenie jest rozliczone. Dokumenty i historia pozostają dostępne.' : 'Wydarzenie się odbyło. Możesz przekazać opiekunowi podsumowanie i uwagi klienta.')
          : (event === 'settled' ? 'Event rozliczony.' : 'Rozlicz event i — jeśli dotyczy — wynagrodzenie sprzedawcy.'),
        'success');
    }
    if (event === 'in_progress') {
      return result(3, 'Trwa', 'none', seller ? 'Wydarzenie trwa. W sprawach bieżących korzystaj z kontaktów do zespołu.' : 'Event trwa.', 'success');
    }
    if (input.realizationStage === 'confirmed' || CONFIRMED_EVENT.includes(event)) {
      return result(3, 'Potwierdzone', 'seller',
        seller ? 'Termin potwierdzony. Uzupełnij swoje kroki przygotowania — opiekun przygotuje plan wydarzenia.' : 'Termin potwierdzony. Przygotujcie realizację razem ze sprzedawcą.',
        'success');
    }
    return result(3, 'Czeka na potwierdzenie terminu', 'manager',
      seller ? `${manager} potwierdza termin i przygotowanie wydarzenia. Dostaniesz powiadomienie.` : 'Oferta przyjęta. Potwierdź termin i przygotowanie eventu.',
      'waiting');
  }

  switch (input.reviewStatus) {
    case 'pending':
      return result(2, input.clientConfirmed === false ? 'Opiekun sprawdza (bez zgody klienta)' : 'Opiekun sprawdza', 'manager',
        seller ? `${manager} sprawdza termin, zespół i sprzęt. Teraz nic nie musisz robić.` : 'Sprawdź termin, zespół i sprzęt, potem zapisz decyzję.',
        'waiting');
    case 'changes_requested':
      return result(2, 'Do poprawy', 'seller',
        seller ? `${manager} prosi o poprawki. Popraw ofertę i wyślij ją ponownie.` : 'Czekamy na poprawki sprzedawcy.',
        'action');
    case 'rejected':
      return result(2, 'Bez zgody opiekuna', 'seller',
        seller ? 'Opiekun nie przyjął tej wersji. Przeczytaj uzasadnienie i ustal dalsze kroki w rozmowie.' : 'Oferta bez zgody. Sprzedawca może ją poprawić i wysłać ponownie.',
        'danger');
    case 'approved':
      return result(3, 'Czeka na potwierdzenie terminu', 'manager',
        seller ? `Oferta przyjęta. ${manager} potwierdza termin — dostaniesz powiadomienie.` : 'Oferta przyjęta. Potwierdź termin i przygotowanie eventu.',
        'waiting');
    default:
      break;
  }

  if (input.offerStatus === 'rejected') return result(1, 'Klient odrzucił', 'none', 'Klient nie przyjął oferty.', 'neutral', true);
  // Zgoda na cenę przed pokazaniem oferty klientowi: do zgody PDF dla klienta i link są wstrzymane.
  if (input.priceApprovalRequired && input.priceRequest) {
    if (input.priceRequest === 'pending') {
      return result(0, 'Cena czeka na zgodę', 'manager',
        seller ? `${manager} sprawdza ceny. PDF dla klienta i link odblokują się po zgodzie — dostaniesz powiadomienie.` : 'Sprawdź ceny i zatwierdź je albo poproś o zmianę.',
        'waiting');
    }
    if (input.priceRequest === 'changes_requested') {
      return result(0, 'Opiekun prosi o zmianę ceny', 'seller',
        seller ? `${manager} prosi o zmianę ceny. Popraw ofertę — po zapisie prośba o zgodę wyśle się sama.` : 'Czekamy na poprawioną cenę od sprzedawcy.',
        'action');
    }
    return result(0, 'Poproś o zgodę na cenę', 'seller',
      seller ? 'Oferta ma pozycję własną albo cenę poniżej stawki. Poproś opiekuna o zgodę — potem pobierzesz PDF dla klienta.' : 'Sprzedawca jeszcze nie poprosił o zgodę na cenę.',
      'action');
  }
  if (input.offerStatus === 'expired') {
    return result(1, 'Wygasła', 'seller', seller ? 'Zmień datę ważności, jeśli klient nadal jest zainteresowany.' : 'Oferta wygasła.', 'neutral', true);
  }
  if (input.clientAcceptedOnline) {
    return result(1, 'Klient zaakceptował', 'seller',
      seller ? 'Klient zaakceptował ofertę online. Wyślij ją do opiekuna.' : 'Klient zaakceptował online. Czekamy, aż sprzedawca wyśle ofertę.',
      'action');
  }
  if (input.hasPdf === false || input.pdfCurrent === false) {
    const state = input.hasPdf === false ? 'W przygotowaniu' : 'PDF do aktualizacji';
    const now = seller
      ? input.hasPdf === false ? 'Dokończ ofertę i wygeneruj PDF.' : 'Oferta zmieniła się po wygenerowaniu PDF. Zaktualizuj PDF przed wysłaniem.'
      : 'Sprzedawca przygotowuje ofertę.';
    return result(0, state, 'seller', input.priceApprovalRequired ? `${now} ${seller ? 'Cenę zatwierdzi opiekun.' : ''}`.trim() : now, 'action');
  }
  if (input.hasPdf === undefined && input.offerStatus === 'draft' && !input.clientViewed) {
    // Lista bez informacji o PDF: nie zgadujemy, czy klient już ma ofertę.
    return result(0, input.priceApprovalRequired ? 'Cena do zgody opiekuna' : 'W przygotowaniu', 'seller',
      seller ? 'Przygotuj PDF i przekaż go klientowi. Po jego zgodzie wyślij ofertę do opiekuna.' : 'Sprzedawca przygotowuje ofertę dla klienta.',
      'action');
  }
  return result(1, input.clientViewed ? 'Klient obejrzał' : input.priceApprovalRequired ? 'PDF gotowy · cena do zgody' : 'PDF gotowy', 'seller',
    seller
      ? 'Przekaż PDF klientowi razem ze swoją ofertą. Gdy klient się zgodzi, wyślij ofertę do opiekuna. Akceptacja przez link trafi do opiekuna sama.'
      : 'Oferta jest u klienta. Czekamy na jego decyzję i przekazanie przez sprzedawcę.',
    'action');
}

/** Filtry listy ofert sprzedawcy w aplikacji pracowników — po etapach osi i po tym, kto działa. */
export const SELLER_JOURNEY_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Wszystkie etapy' },
  { value: 'mine', label: 'Wymaga mojej reakcji' },
  ...SELLER_JOURNEY_STAGES_TEAM.slice(0, 4).map((item) => ({ value: item.key, label: item.label })),
  { value: 'ended', label: 'Zakończone bez realizacji' },
];

export function sellerJourneyMatches(journey: SellerJourney, filter: string) {
  if (filter === 'all') return true;
  if (filter === 'mine') return journey.needsAction;
  if (filter === 'ended') return journey.ended;
  return journey.key === filter && !journey.ended;
}

export const SELLER_JOURNEY_ACTOR_LABELS: Record<SellerJourneyActor, { seller: string; manager: string }> = {
  seller: { seller: 'Ty', manager: 'Sprzedawca' },
  client: { seller: 'Klient', manager: 'Klient' },
  manager: { seller: 'Opiekun', manager: 'Ty' },
  none: { seller: '—', manager: '—' },
};

/** Oferta z get_crm_seller_workspace — karta sprzedawcy na Macu (`src/lib/native/sellers.ts`) i w aplikacji mobilnej. */
export type SellerWorkspaceOfferFacts = {
  status: string;
  review_status: string | null;
  generated_at: string | null;
  event_id: string | null;
  guest_link: { view_count?: number; accepted_at?: string | null } | null;
};

/** Wejście osi dla oferty z karty sprzedawcy: zgoda na cenę z offers.partner_approval_status, status powiązanego wydarzenia. */
export function sellerWorkspaceJourneyInput(
  offer: SellerWorkspaceOfferFacts,
  extra: { priceApprovalRequired?: boolean; eventStatus?: string | null } = {},
): SellerJourneyInput {
  return {
    offerStatus: offer.status,
    reviewStatus: offer.review_status,
    priceApprovalRequired: extra.priceApprovalRequired === true,
    hasPdf: Boolean(offer.generated_at),
    clientAcceptedOnline: Boolean(offer.guest_link?.accepted_at),
    clientViewed: Number(offer.guest_link?.view_count || 0) > 0,
    isRealization: Boolean(offer.event_id),
    eventStatus: offer.event_id ? extra.eventStatus || null : null,
  };
}
