/**
 * „Gotowość do pracy” sprzedawcy w CRM — co jeszcze trzeba ustawić po dodaniu, zanim hotel sprzeda pierwsze wydarzenie.
 * Fakty liczy baza (get_crm_seller_readiness, migracja 20261115190000_seller_onboarding_and_demo_join.sql);
 * tutaj tylko kroki i teksty. Bez zależności od Reacta i Supabase — w etapie 4 ta sama logika trafi na Maca i do aplikacji mobilnej.
 */

export type SellerReadinessFacts = {
  status: string;
  partner_type: string;
  person: { kind: 'contact' | 'employee'; email: string | null };
  organization: {
    id: string; name: string; is_hotel: boolean; location_id: string | null; location_name: string | null;
    rooms: number; branding: boolean;
  } | null;
  brands: { active: number; default_ok: boolean; commission: boolean; commissions_visible: boolean } | null;
  manager: { name: string | null; ok: boolean } | null;
  portal: { enabled: boolean; portal_account?: 'none' | 'invited' | 'active'; last_sign_in_at?: string | null; invited_at?: string | null };
  guide: Record<string, boolean | string>;
  activity: { offers: number; first_offer_at: string | null; events: number; inquiries: number; qr_links: number };
  created_at?: string;
};

export type SellerReadinessState = 'done' | 'todo' | 'waiting' | 'optional';
/** Gdzie prowadzi przycisk kroku: sekcja ustawień, kartoteka lokalizacji, branding, ponowne zaproszenie. */
export type SellerReadinessAction =
  | { kind: 'settings'; section: 'organization' | 'pricing' | 'access' | 'manager'; label: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'branding'; label: string }
  | { kind: 'resend'; label: string };

export type SellerReadinessStep = {
  key: 'person' | 'hotel' | 'brands' | 'manager' | 'portal' | 'branding' | 'guide' | 'first';
  label: string;
  state: SellerReadinessState;
  detail: string;
  /** Bez tego kroku hotel nie zacznie pracy (pozostałe są zalecane). */
  required: boolean;
  action?: SellerReadinessAction;
};

const GUIDE_STEPS = ['hotel_checked', 'branding_seen', 'manager_met', 'journey_seen', 'first_step'];

const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' }) : '';

export function sellerReadinessSteps(facts: SellerReadinessFacts): SellerReadinessStep[] {
  const org = facts.organization;
  const brands = facts.brands || { active: 0, default_ok: false, commission: false, commissions_visible: false };
  const portal = facts.portal || { enabled: false };
  const account = portal.portal_account || 'none';
  const contact = facts.person.kind === 'contact';
  const guideDone = facts.guide?.completed === true;
  const guideSteps = GUIDE_STEPS.filter((key) => facts.guide?.[key] === true).length;
  const steps: SellerReadinessStep[] = [
    {
      key: 'person', label: 'Osoba z adresem e-mail', required: true,
      state: contact && facts.person.email ? 'done' : 'todo',
      detail: !contact ? 'Portal hotelowy wymaga osoby z kartoteki kontaktów (nie pracownika CRM).'
        : facts.person.email ? `Zaproszenie i powiadomienia trafią na ${facts.person.email}.`
        : 'Kontakt nie ma adresu e-mail — uzupełnij go w danych kontaktowych, inaczej zaproszenie nie wyjdzie.',
    },
    {
      key: 'hotel', label: 'Hotel, lokalizacja i sale', required: true,
      state: org?.location_id && org.rooms > 0 ? 'done' : 'todo',
      detail: !org ? 'Wskaż organizację, w imieniu której sprzedawca składa oferty.'
        : !org.location_id ? `${org.name} nie ma lokalizacji w kartotece. Powiąż organizację z lokalizacją — sale pochodzą z niej.`
        : org.rooms === 0 ? `${org.location_name || org.name}: brak sal. Dodaj sale (i teren zewnętrzny), aby hotel wybierał je w kreatorze.`
        : `${org.name} · ${org.rooms} ${org.rooms === 1 ? 'sala' : org.rooms < 5 ? 'sale' : 'sal'} w lokalizacji ${org.location_name || ''}`.trim(),
      action: !org ? { kind: 'settings', section: 'organization', label: 'Wskaż hotel' }
        : org.location_id && org.rooms === 0 ? { kind: 'link', href: `/crm/locations/${org.location_id}`, label: 'Dodaj sale' }
        : !org.location_id ? { kind: 'link', href: `/crm/contacts/${org.id}`, label: 'Otwórz organizację' } : undefined,
    },
    {
      key: 'brands', label: 'Marka, cennik i prowizja', required: true,
      state: brands.active > 0 && brands.default_ok ? 'done' : 'todo',
      detail: brands.active === 0 ? 'Włącz co najmniej jedną markę — bez niej sprzedawca nie zobaczy cennika.'
        : !brands.default_ok ? 'Wskaż domyślny cennik nowych ofert (sprzedawca ma kilka aktywnych marek).'
        : `${brands.active} ${brands.active === 1 ? 'aktywna marka' : 'aktywne marki'}${brands.commission ? ' · rozliczenie prowizyjne' : ''}${brands.commission && !brands.commissions_visible ? ' (prowizja jeszcze ukryta przed hotelem)' : ''}.`,
      action: brands.active === 0 || !brands.default_ok ? { kind: 'settings', section: 'pricing', label: 'Ustaw marki' } : undefined,
    },
    {
      key: 'manager', label: 'Opiekun', required: true,
      state: facts.manager?.ok ? 'done' : 'todo',
      detail: facts.manager?.ok ? `${facts.manager.name || 'Opiekun'} odpowiada za rozmowy, zgody na ceny i ocenę ofert.`
        : facts.manager ? `${facts.manager.name || 'Przypisana osoba'} nie może prowadzić sprzedawców — wybierz innego opiekuna.`
        : 'Bez opiekuna rozmowy i zgody na ceny trafiają do administratorów. Przypisz opiekuna.',
      action: facts.manager?.ok ? undefined : { kind: 'settings', section: 'manager', label: 'Przypisz opiekuna' },
    },
    {
      key: 'portal', label: 'Logowanie do portalu', required: true,
      state: account === 'active' ? 'done' : account === 'invited' ? 'waiting' : 'todo',
      detail: account === 'active' ? `Hotel zalogował się${portal.last_sign_in_at ? ` (ostatnio ${dateLabel(portal.last_sign_in_at)})` : ''}.`
        : account === 'invited' ? `Zaproszenie wysłane${portal.invited_at ? ` ${dateLabel(portal.invited_at)}` : ''} — hotel jeszcze się nie zalogował. Link w e-mailu wygasa; w razie potrzeby wyślij go ponownie.`
        : portal.enabled ? 'Dostęp jest włączony, ale konto nie jest połączone. Zapisz ustawienia ponownie, aby wysłać zaproszenie.'
        : 'Włącz „Nadaj dostęp do portalu sprzedawcy” i zapisz — zaproszenie wyjdzie na e-mail kontaktu.',
      action: account === 'invited' ? { kind: 'resend', label: 'Wyślij zaproszenie ponownie' }
        : account === 'none' ? { kind: 'settings', section: 'access', label: portal.enabled ? 'Wyślij zaproszenie' : 'Nadaj dostęp' } : undefined,
    },
    {
      key: 'branding', label: 'Wygląd ofert (logo i kolory)', required: false,
      state: org?.branding ? 'done' : 'optional',
      detail: org?.branding ? 'Oferty mają logo i kolory hotelu.' : 'Hotel ustawi logo w przewodniku w portalu. Możesz też zrobić to za niego w „Branding i wizytówka”.',
      action: org?.branding ? undefined : { kind: 'branding', label: 'Ustaw wygląd' },
    },
    {
      key: 'guide', label: 'Przewodnik w portalu', required: false,
      state: guideDone ? 'done' : account === 'active' ? 'waiting' : 'optional',
      detail: guideDone ? 'Hotel przeszedł przewodnik „Witaj w portalu MAVINCI”.'
        : facts.guide?.dismissed === true ? 'Hotel zamknął przewodnik bez przejścia wszystkich kroków. Zaproponuj krótką rozmowę.'
        : account === 'active' ? `Hotel jest w trakcie przewodnika (${guideSteps}/${GUIDE_STEPS.length} kroków).`
        : 'Przewodnik otworzy się przy pierwszym logowaniu.',
    },
    {
      key: 'first', label: 'Pierwsza oferta lub zapytanie', required: false,
      state: facts.activity.offers > 0 || facts.activity.inquiries > 0 ? 'done' : account === 'active' ? 'waiting' : 'optional',
      detail: facts.activity.offers > 0
        ? `Ofert: ${facts.activity.offers}${facts.activity.events ? ` · wydarzeń: ${facts.activity.events}` : ''}${facts.activity.first_offer_at ? ` · pierwsza ${dateLabel(facts.activity.first_offer_at)}` : ''}.`
        : facts.activity.inquiries > 0 ? `Zapytań o termin: ${facts.activity.inquiries}. Oferty jeszcze nie ma.`
        : account === 'active' ? 'Hotel jeszcze nic nie wysłał. Zadzwoń i przygotujcie razem pierwszą ofertę.'
        : 'Pojawi się po pierwszym logowaniu hotelu.',
    },
  ];
  return steps;
}

export function sellerReadinessSummary(steps: SellerReadinessStep[]) {
  const required = steps.filter((step) => step.required);
  const requiredDone = required.filter((step) => step.state === 'done').length;
  return {
    done: steps.filter((step) => step.state === 'done').length,
    total: steps.length,
    requiredDone,
    requiredTotal: required.length,
    /** Wszystko, bez czego hotel nie zacznie, jest ustawione (logowanie może jeszcze czekać na hotel). */
    ready: required.every((step) => step.state === 'done' || (step.key === 'portal' && step.state === 'waiting')),
    complete: steps.every((step) => step.state === 'done'),
  };
}

export const SELLER_READINESS_MIGRATION = '20261115190000_seller_onboarding_and_demo_join.sql';
