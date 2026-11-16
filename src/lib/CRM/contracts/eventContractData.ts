/*
 * Składanie umowy wydarzenia — kod 1:1 z zakładki „Umowa” (`EventContractTab`), wydzielony, żeby ten sam proces liczył
 * umowę w CRM w przeglądarce i w silniku dokumentów na Macu (`/native-engine/contracts`, Chrome z tokenem pracownika).
 * `fetchEventContractData` pobiera wydarzenie, firmę, klienta, ofertę albo kalkulację, szablon i klauzule, składa zmienne
 * i treść, dzieli ją na strony (`renderContractDocument`) i przekazuje wynik przez te same settery co komponent.
 * Pomocnicze funkcje i typy poniżej są przeniesione z komponentu bez zmian. Na końcu pliku — pola, warunki, depozyt
 * i uwagi przed wystawieniem (wcześniej `useMemo` i `handleSave` / `saveDeposit` w komponencie), wspólne z Makiem.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickPrintLogo, type BrandbookLogoRow } from '@/lib/brandbook/printLogo';
import { eventMoney, fetchEventFinancials } from '@/lib/CRM/events/eventFinancials';
import { numberToWords, replaceVariables } from '@/lib/offerTemplateHelpers';
import type { UnifiedContact } from '@/store/slices/contactsSlice';
import type { ILocation } from '@/app/(crm)/crm/locations/type';
import type { Organization } from '@/app/(crm)/crm/contacts/[id]/page';
import { renderContractDocument } from '@/lib/CRM/contracts/contractPagination';
import {
  normalizeContractClauseHtml,
  normalizeContractClausePointListHtml,
  parseContractClauseEntries,
  stripProductNameHeadingFromClauseHtml,
  getContractClauseTopicLabel,
  inferContractClauseTopic,
  type ContractClausePrimaryCategory,
} from '@/lib/CRM/contracts/contractClauseContent';
import type { ContractRequirement as ContractClauseEntryRequirement } from '@/lib/CRM/contracts/contractRequirements';
import {
  buildEventContractClauseItems,
  parseEventContractClauseOverrides,
  type EventContractClauseItem,
} from '@/lib/CRM/contracts/eventContractClauseOverrides';
import { assembleContractClauses, contractClauseSourceFingerprint, getSharedClauseConflicts } from '@/lib/CRM/contracts/contractClauseAssembly';
import { CONTRACT_STRUCTURE_VERSION, getSharedContractClauseForText } from '@/lib/CRM/contracts/sharedContractClauses';
import { placeContractClauses } from '@/lib/CRM/contracts/contractClauseSlots';
import {
  applyContractConditions,
  CONTRACT_CLIENT_VARIABLE,
  contractConditionVariableNames,
  contractConditionVariables,
  contractOptionVariable,
  resolveContractOptions,
} from '@/lib/CRM/contracts/contractConditions';
import { getContractDocumentParts } from '@/lib/CRM/contracts/contractAudit';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';
import { getCalculationNumber } from '@/lib/CRM/calculations/calculationNumber';
import {
  buildOfferRequirements,
  splitOfferRequirementLines,
  type OfferRequirementEntry,
} from '@/lib/CRM/Offers/offerRequirements';
import {
  getLegalFormDisplayLabel,
  getOrganizationRegistryProfile,
  requiresKrsForLegalForm,
  resolveOrganizationLegalForm,
} from '@/lib/organizations/organizationLegalForm';

export type ContractPartySigner = { id: string; fullName: string; title: string };

export function clientPartyWithSigners(base: string, signers: ContractPartySigner[]) {
  const people = signers.map(person => `${contractValueHtml(person.fullName)}${person.title ? ` - ${contractRepresentativeTitleHtml(person.title)}` : ''}`).join(' oraz ');
  const introduction = signers.length === 1
    ? 'osoba uprawniona do zawarcia umowy:'
    : 'osoby uprawnione do zawarcia umowy:';
  return base.replace(/\.<\/span>$/, `${people ? `, ${introduction} ${people}` : ''}.</span>`);
}

export interface DecisionMaker {
  id: string;
  title: string;
  can_sign_contracts: boolean;
  notes: string;
  contact: UnifiedContact;
}

export type ProductClauseCandidate = {
  id: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  title: string;
  productName: string;
  html: string;
  preview: string;
  sharedKey?: string;
  legacyOverrideId?: string;
  requirement?: ContractClauseEntryRequirement;
  coveredBy?: string;
};

export type ProductClauseConflict = {
  key: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  candidates: EventContractClauseItem[];
};

export const CONTRACT_REQUIREMENT_TOPIC_BY_OFFER_CATEGORY: Record<string, string> = {
  people: 'people',
  resources: 'resources',
  place: 'place',
  time: 'time',
  power: 'power',
  internet: 'internet',
  access: 'access',
  setup: 'time',
  schedule: 'time',
  surface: 'surface',
  venue_approval: 'permissions',
  permissions: 'permissions',
  safety: 'safety',
  logistics: 'logistics',
  technical: 'technical',
  other: 'technical',
};

export const CONTRACT_ADDITIONAL_REQUIREMENT_TOPICS = new Set([
  'accommodation',
  'backstage',
  'hospitality',
  'parking',
  'transport',
  'security',
  'coordination',
  'materials',
  'documentation',
  'insurance_additional',
  'other_additional',
]);

export const parseStoredOfferRequirements = (value: unknown): OfferRequirementEntry[] => {
  if (Array.isArray(value)) return value as OfferRequirementEntry[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as OfferRequirementEntry[] : [];
  } catch {
    return [];
  }
};

export const mapOfferRequirementToContractTopic = (
  offerCategory: string,
  description: string,
): { category: ContractClausePrimaryCategory; topic: string } => {
  const normalizedCategory = String(offerCategory || '').trim().toLowerCase();
  if (CONTRACT_ADDITIONAL_REQUIREMENT_TOPICS.has(normalizedCategory)) {
    return {
      category: 'additional_requirements',
      topic: normalizedCategory,
    };
  }

  return {
    category: 'requirements',
    topic:
      CONTRACT_REQUIREMENT_TOPIC_BY_OFFER_CATEGORY[normalizedCategory] ||
      inferContractClauseTopic('requirements', description),
  };
};

export const REPRESENTATION_TYPE_LABELS: Record<string, string> = {
  sole: 'reprezentacja samodzielna',
  joint: 'reprezentacja łączna',
  joint_with_proxy: 'reprezentacja łączna z prokurentem',
  proxy: 'reprezentacja przez pełnomocnika lub prokurenta',
  other: 'inny sposób reprezentacji',
};

export const formatPrefixedValue = (
  value?: string | number | null,
  prefix?: string,
  suffix?: string,
) => {
  const cleanValue = String(value ?? '').trim();

  if (!cleanValue) return '';

  const hasPrefix =
    prefix &&
    cleanValue.toUpperCase().startsWith(prefix.toUpperCase());

  const baseValue = hasPrefix
    ? cleanValue
    : prefix
      ? `${prefix} ${cleanValue}`
      : cleanValue;

  return suffix ? `${baseValue}${suffix}` : baseValue;
};

export const escapeContractText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const contractValueHtml = (value: string | number) =>
  `<strong data-contract-value="true" style="font-weight:700 !important;">${escapeContractText(
    String(value),
  )}</strong>`;

export const contractRepresentativeTitleHtml = (value: string) => {
  // Korygujemy wyłącznie błędną etykietę, bez zgadywania rodzaju prokury.
  // Pozostałe stanowiska i dane zapisane w kartotece pozostają bez zmian.
  const title = value.trim().replace(/^prokurent\s+zarządu\.?$/iu, 'prokurent');
  return `<em style="font-weight:400 !important;font-style:italic !important;">${escapeContractText(title)}</em>`;
};

export const multilineContractTextHtml = (value: string | null | undefined) =>
  String(value || '')
    .split(/\r?\n/)
    .map((line) => escapeContractText(line))
    .join('<br>');

export const compactContractParts = (parts: Array<string | null | undefined>) =>
  parts.map((part) => String(part || '').trim()).filter(Boolean);

export const joinRawContractParts = (
  parts: Array<string | null | undefined>,
  separator = ', ',
) => compactContractParts(parts).join(separator);

export const joinContractParts = (
  parts: Array<string | null | undefined>,
  separator = ', ',
) => escapeContractText(joinRawContractParts(parts, separator));

export const includeContractFonts = (flow: string, variables: Record<string, string>) => {
  // Wsteczna kompatybilność: usuń style zapisane dawniej w treści umowy.
  // Fonty są ładowane do document.fonts i przekazywane jako CSS do generatora PDF.
  return flow.replace(
    /<style\b[^>]*data-contract-fonts[^>]*>[\s\S]*?<\/style>/gi,
    '',
  );
};

export const getTemplateSettings = (pageSettings: any) => ({
  logoScale: pageSettings?.logoScale ?? 80,
  logoPositionX: pageSettings?.logoPositionX ?? 50,
  logoPositionY: pageSettings?.logoPositionY ?? 0,
  lineHeight: pageSettings?.lineHeight ?? 1.6,
  selectedFont: pageSettings?.selectedFont ?? 'Georgia, serif',
  selectedLogo: pageSettings?.selectedLogo ?? '/erulers_logo_vect.png',
  selectedFooter: pageSettings?.selectedFooter ?? 'default',
  selectedFooterTemplateId: pageSettings?.selectedFooterTemplateId ?? null,
  footerContent: pageSettings?.footerContent ?? {
    companyName: 'EVENT RULERS',
    tagline: 'Więcej niż Wodzireje!',
    website: 'www.eventrulers.pl',
    email: 'biuro@eventrulers.pl',
    phone: '698-212-279',
    logoUrl: '/erulers_logo_vect.png',
  },
  footerLogoScale: pageSettings?.footerLogoScale ?? 80,
  clauseTypography: pageSettings?.clauseTypography,
  // Szablon w nowym formacie (style dokumentu jak w Wordzie) — wygląd treści i klauzul wyznaczają jego style.
  ...(pageSettings?.documentStyles ? { documentStyles: pageSettings.documentStyles } : {}),
  // Opcje umowy szablonu (np. nocleg) — przełączane w ustawieniach tej umowy.
  ...(Array.isArray(pageSettings?.contractOptions) ? { contractOptions: pageSettings.contractOptions } : {}),
});

export type EventCompanyBranding = {
  company: any;
  logoUrl: string | null;
  logoUrls: string[];
  /** „Logo do druku” z brandbooka (do czasu zaznaczenia — primary-black), jak na fakturach i kalkulacjach. */
  printLogoUrl: string | null;
  /** W brandbooku zaznaczono „Logo do druku” — ma pierwszeństwo przed logo wybranym w szablonie. */
  printLogoExplicit: boolean;
};

export const resolveCompanyLogoUrl = (value?: string | null) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
};

export const applyEventCompanyBranding = (
  settings: ReturnType<typeof getTemplateSettings>,
  branding: EventCompanyBranding | null,
) => {
  if (!branding) return settings;
  const { company, logoUrl, logoUrls, printLogoUrl, printLogoExplicit } = branding;
  const normalizedCompanyLogos = new Set(logoUrls.filter(Boolean));
  const savedHeaderLogo = resolveCompanyLogoUrl(settings.selectedLogo);
  const savedFooterLogo = resolveCompanyLogoUrl(settings.footerContent?.logoUrl);
  // Umowa to wydruk: „Logo do druku” zaznaczone w brandbooku firmy wydarzenia ma pierwszeństwo przed logo
  // wybranym w szablonie (szablon bywa wspólny dla kilku marek). Bez zaznaczenia: logo z szablonu, jeśli należy
  // do firmy wydarzenia, potem primary-black, logo domyślne, logo firmy.
  // „Bez logo” w szablonie ('') to świadoma decyzja o nagłówku bez logo — wygrywa także z „Logo do druku”.
  // Stopka korzysta wtedy z logo firmy wydarzenia jak dotąd.
  const noHeaderLogo = settings.selectedLogo === '';
  const forcedPrintLogo = printLogoExplicit && printLogoUrl ? printLogoUrl : null;
  const fallbackLogo = printLogoUrl || logoUrl || resolveCompanyLogoUrl(company.logo_url) || settings.selectedLogo;
  const brandLogo =
    forcedPrintLogo ||
    (savedHeaderLogo && normalizedCompanyLogos.has(savedHeaderLogo)
      ? savedHeaderLogo
      : fallbackLogo);
  const selectedLogo = noHeaderLogo ? '' : brandLogo;
  const selectedFooterLogo =
    forcedPrintLogo ||
    (savedFooterLogo && normalizedCompanyLogos.has(savedFooterLogo)
      ? savedFooterLogo
      : brandLogo);
  const hasExplicitFooterTemplate = Boolean(settings.selectedFooterTemplateId);

  return {
    ...settings,
    selectedLogo,
    footerContent: hasExplicitFooterTemplate
      ? {
          ...settings.footerContent,
          logoUrl: forcedPrintLogo || settings.footerContent?.logoUrl || brandLogo,
        }
      : {
          companyName: company.legal_name || company.name || '',
          tagline: '',
          website: company.website || '',
          email: company.email || '',
          phone: company.phone || '',
          logoUrl: selectedFooterLogo,
        },
  };
};

export type OrganizationWithRelations = Organization & {
  legal_representative?: UnifiedContact | null;
  primary_contact?: UnifiedContact | null;
};

export type ContractStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'accepted'
  | 'signed_by_client'
  | 'signed_returned'
  | 'cancelled';

/** Bez obszaru „kwoty” kalkulacje i kwoty są niedostępne (RLS) — umowa liczyłaby 0 zł. */
export const CONTRACT_AMOUNTS_REQUIRED =
  'Kwoty umowy widzi osoba z dostępem do kwot — poproś sprzedawcę lub administratora.';

/** Daty statusów umowy (`statusDates` w zakładce „Umowa”). */
export type EventContractStatusDates = {
  accepted_at?: string;
  issued_at?: string;
  sent_at?: string;
  signed_by_client_at?: string;
  signed_returned_at?: string;
  cancelled_at?: string;
};

/** Wcześniejsze wersje umowy wydarzenia („Dokumenty i historia”). */
export type EventContractHistoryItem = { id: string; title: string; created_at: string; generated_pdf_path: string | null };

/**
 * Dane i stan zakładki „Umowa”, z których korzysta składanie umowy: klient Supabase (w CRM — sesja przeglądarki, na Macu —
 * token pracownika), uprawnienie do kwot, bieżące zmienne i wybory klauzul oraz settery stanu (w CRM — `useState`).
 */
export type EventContractDataContext = {
  supabase: SupabaseClient;
  eventId: string;
  canViewAmounts: boolean;
  variables: Record<string, string>;
  productClauseSelections: Record<string, string>;
  showSnackbar: (message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number) => void;
  setClientEmail: Dispatch<SetStateAction<string>>;
  setClientName: Dispatch<SetStateAction<string>>;
  setClientPartyBase: Dispatch<SetStateAction<string>>;
  setClientPartySigners: Dispatch<SetStateAction<ContractPartySigner[]>>;
  setCompanySignedAt: Dispatch<SetStateAction<string | null>>;
  setContractContent: Dispatch<SetStateAction<string>>;
  setContractCreatedBy: Dispatch<SetStateAction<string | null>>;
  setContractFontFaceCss: Dispatch<SetStateAction<string>>;
  setContractId: Dispatch<SetStateAction<string | null>>;
  setContractLockedAt: Dispatch<SetStateAction<string | null>>;
  setContractSourceOutdated: Dispatch<SetStateAction<boolean>>;
  setContractStatus: Dispatch<SetStateAction<ContractStatus>>;
  setContractVersion: Dispatch<SetStateAction<number>>;
  setEditedVariables: Dispatch<SetStateAction<Record<string, string>>>;
  setEventCompanyBranding: Dispatch<SetStateAction<EventCompanyBranding | null>>;
  setEventContractClauseItems: Dispatch<SetStateAction<EventContractClauseItem[]>>;
  setGeneratedPdfPath: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setModifiedAfterGeneration: Dispatch<SetStateAction<boolean>>;
  setOriginalTemplate: Dispatch<SetStateAction<string>>;
  setPreviousContracts: Dispatch<SetStateAction<EventContractHistoryItem[]>>;
  setProductClauseConflicts: Dispatch<SetStateAction<ProductClauseConflict[]>>;
  setProductClauseSelectionDraft: Dispatch<SetStateAction<Record<string, string>>>;
  setProductClauseSelections: Dispatch<SetStateAction<Record<string, string>>>;
  setSavedClientSignerIds: Dispatch<SetStateAction<string[]>>;
  setSelectedClientSignerIds: Dispatch<SetStateAction<string[]>>;
  setSelectedTemplateId: Dispatch<SetStateAction<string | null>>;
  setSelectedTemplateName: Dispatch<SetStateAction<string>>;
  setSourceContractContent: Dispatch<SetStateAction<string>>;
  setStatusDates: Dispatch<SetStateAction<EventContractStatusDates>>;
  setTemplateId: Dispatch<SetStateAction<string | null>>;
  setUnplacedClauseCategories: Dispatch<SetStateAction<string[]>>;
  setVariableOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  setVariables: Dispatch<SetStateAction<Record<string, string>>>;
};

/** `fetchContractData` z zakładki „Umowa” — treść bez zmian, stan przez `context`. */
export async function fetchEventContractData(
  context: EventContractDataContext,
  clauseSelectionOverride?: Record<string, string>,
  replaceExistingContent = false,
  templateIdOverride?: string,
) {
  const {
    supabase,
    eventId,
    canViewAmounts,
    variables,
    productClauseSelections,
    showSnackbar,
    setClientEmail,
    setClientName,
    setClientPartyBase,
    setClientPartySigners,
    setCompanySignedAt,
    setContractContent,
    setContractCreatedBy,
    setContractFontFaceCss,
    setContractId,
    setContractLockedAt,
    setContractSourceOutdated,
    setContractStatus,
    setContractVersion,
    setEditedVariables,
    setEventCompanyBranding,
    setEventContractClauseItems,
    setGeneratedPdfPath,
    setLoading,
    setModifiedAfterGeneration,
    setOriginalTemplate,
    setPreviousContracts,
    setProductClauseConflicts,
    setProductClauseSelectionDraft,
    setProductClauseSelections,
    setSavedClientSignerIds,
    setSelectedClientSignerIds,
    setSelectedTemplateId,
    setSelectedTemplateName,
    setSourceContractContent,
    setStatusDates,
    setTemplateId,
    setUnplacedClauseCategories,
    setVariableOverrides,
    setVariables,
  } = context;
    if (replaceExistingContent && !canViewAmounts) {
      // Przeliczenie umowy bez dostępu do kwot dałoby 0 zł — wywołujący pokaże błąd.
      throw new Error(CONTRACT_AMOUNTS_REQUIRED);
    }
    try {
      setLoading(true);

      const { data: event, error: eventError } = await supabase
        .from('events')
        .select(
          `
          id,
          name,
          event_date,
          event_end_date,
          planned_setup_at,
          planned_teardown_at,
          budget,
          organization_id,
          billing_arrangement,
          billing_organization_id,
          location_id,
          location,
          category_id,
          contact_person_id,
          my_company_id,
          financial_source,
          purchase_order_number,
          accepted_calculation_id,
          selected_contract_template_id,
          locations:location_id(name, formatted_address, address, city, postal_code),
          organizations:organizations!events_organization_id_fkey(
          *,
          legal_representative:legal_representative_id(
            id,
            first_name,
            last_name,
            full_name,
            email,
            phone,
            pesel,
            address,
            city,
            postal_code
          ),
          primary_contact:primary_contact_id(
            id,
            first_name,
            last_name,
            full_name,
            email,
            phone,
            mobile,
            business_phone,
            position
          )
        ),
          contacts:contact_person_id(first_name, last_name, full_name, email, phone, pesel, address, city, postal_code),
          event_categories:category_id(
            name,
            contract_template_id,
            contract_templates:contract_template_id(id, name, content, content_html, page_settings)
          )
        `,
        )
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;
      if (!event) throw new Error('Nie znaleziono wydarzenia');
      // Budżet z event_financials (events.budget jest po migracji puste; bez obszaru „kwoty” — brak wartości).
      const eventFinancials = await fetchEventFinancials(supabase, event.id);

      const { data: eventClauseOverridesData, error: eventClauseOverridesError } =
        await supabase
          .from('events')
          .select('contract_clause_overrides')
          .eq('id', eventId)
          .maybeSingle();
      if (
        eventClauseOverridesError &&
        !['42703', 'PGRST204'].includes(eventClauseOverridesError.code || '')
      ) {
        throw eventClauseOverridesError;
      }
      const storedEventClauseOverrides =
        eventClauseOverridesData?.contract_clause_overrides || null;

      const { data: technicalSchedulePhases, error: technicalSchedulePhasesError } =
        await supabase
          .from('event_phases')
          .select(
            'id, name, start_time, end_time, sequence_order, phase_type:event_phase_types(name)',
          )
          .eq('event_id', eventId)
          .order('start_time', { ascending: true });

      if (technicalSchedulePhasesError) {
        console.error(
          'Error fetching event phases for contract schedule:',
          technicalSchedulePhasesError,
        );
      }

      const { data: invoiceSettings } = await supabase
        .from('invoice_settings')
        .select('default_payment_days')
        .limit(1)
        .maybeSingle();

      let resolvedCompanyBranding: EventCompanyBranding | null = null;
      if (event.my_company_id) {
        const { data: company } = await supabase
          .from('my_companies')
          .select('id, name, legal_name, nip, regon, krs, street, building_number, apartment_number, city, postal_code, email, phone, website, logo_url, bank_account, bank_name, signature_name, signature_title')
          .eq('id', event.my_company_id)
          .maybeSingle();

        if (company) {
          // „*”: kolumna use_for_print (logo do druku) — także przed migracją 20261104180000.
          const { data: companyLogos } = await supabase
            .from('company_brandbook_logos')
            .select('*')
            .eq('company_id', company.id)
            .order('is_default', { ascending: false })
            .order('order_index', { ascending: true });
          const logoPath =
            companyLogos?.find((logo: any) => logo.is_default)?.url ||
            companyLogos?.[0]?.url ||
            company.logo_url ||
            null;
          const companyLogoUrls = Array.from(
            new Set(
              [
                ...(companyLogos || []).map((logo: any) => logo.url),
                company.logo_url,
              ]
                .map((value) => resolveCompanyLogoUrl(value))
                .filter(Boolean) as string[],
            ),
          );
          const printLogo = pickPrintLogo((companyLogos || []) as BrandbookLogoRow[]);
          resolvedCompanyBranding = {
            company,
            logoUrl: resolveCompanyLogoUrl(logoPath),
            logoUrls: companyLogoUrls,
            printLogoUrl: resolveCompanyLogoUrl(printLogo?.url ?? null),
            printLogoExplicit: printLogo?.use_for_print === true,
          };
        }
      }
      setEventCompanyBranding(resolvedCompanyBranding);

      let decisionMakers: any[] | null = null;
      if (event.organization_id) {
        const { data, error: decisionMakersError } = await supabase
          .from('organization_decision_makers')
          .select(
            `
              id,
              title,
              can_sign_contracts,
              notes,
              contact:contact_id(
                id,
                first_name,
                last_name,
                full_name,
                email,
                phone,
                mobile,
                position
              )
            `,
          )
          .eq('organization_id', event.organization_id);

        if (decisionMakersError) throw decisionMakersError;
        decisionMakers = data;
      }

      const contractResult = await supabase
        .from('contracts')
        .select(
          'id, template_id, status, accepted_at, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content, version_number, locked_at, company_signed_at',
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let existingContract = contractResult.data;
      if (contractResult.error && ['42703', 'PGRST204'].includes(contractResult.error.code ?? '')) {
        const fallbackResult = await supabase
          .from('contracts')
          .select(
            'id, template_id, status, accepted_at, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content',
          )
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        existingContract = fallbackResult.data as typeof existingContract;
      }

      const { data: historicalContracts } = await supabase.from('contracts')
        .select('id, title, created_at, generated_pdf_path')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
      setPreviousContracts((historicalContracts || []).filter((item) => item.id !== existingContract?.id));

      let storedMaterialsDeadline: string | null = null;
      let storedIndividualEdits = false;
      let storedProductClauseSelections: Record<string, string> = {};
      if (existingContract?.content) {
        try {
          const parsedExistingContract = JSON.parse(existingContract.content);
          storedIndividualEdits = parsedExistingContract?.meta?.individuallyEdited === true;
          const savedDeadline = parsedExistingContract?.meta?.termin_dostarczenia_materialow;
          if (typeof savedDeadline === 'string') storedMaterialsDeadline = savedDeadline;
          if (
            parsedExistingContract?.meta?.productClauseSelections &&
            typeof parsedExistingContract.meta.productClauseSelections === 'object'
          ) {
            storedProductClauseSelections = parsedExistingContract.meta.productClauseSelections;
          }
        } catch {
          // Starszy zapis umowy nie zawiera metadanych wyboru klauzul.
        }
      }
      const requestedProductClauseSelections = clauseSelectionOverride || {
        ...storedProductClauseSelections,
        ...productClauseSelections,
      };

      const organization = event.organizations as unknown as OrganizationWithRelations | null;
      const resolvedOrganizationLegalForm = resolveOrganizationLegalForm({
        legalForm: organization?.legal_form,
        name: organization?.name,
        krs: organization?.krs,
      });
      const organizationRegistryProfile = getOrganizationRegistryProfile({
        legalForm: resolvedOrganizationLegalForm,
        name: organization?.name,
        krs: organization?.krs,
      });
      const organizationLegalFormLabel = getLegalFormDisplayLabel(
        resolvedOrganizationLegalForm,
      );
      const organizationRequiresKrs = requiresKrsForLegalForm(
        resolvedOrganizationLegalForm,
      );
      const primaryContact = organization?.primary_contact || null;
      const legalRepresentative = organization?.contact_is_representative
        ? primaryContact
        : organization?.legal_representative || null;
      const contact = event.contacts as unknown as UnifiedContact | null;

      const legalRepresentativeFullName =
        legalRepresentative?.full_name ||
        [legalRepresentative?.first_name, legalRepresentative?.last_name].filter(Boolean).join(' ');

      const primaryContactFullName =
        primaryContact?.full_name ||
        [primaryContact?.first_name, primaryContact?.last_name].filter(Boolean).join(' ');

      const primaryContactEmail = primaryContact?.email || '';
      const primaryContactPhone =
        primaryContact?.phone || primaryContact?.mobile || '' || primaryContact?.business_phone;

      const legalSigners = (() => {
        const signers: Array<{
          id: string;
          fullName: string;
          title: string;
        }> = [];
        const seen = new Set<string>();
        const addSigner = (
          person: UnifiedContact | null | undefined,
          title?: string | null,
        ) => {
          const fullName =
            person?.full_name ||
            [person?.first_name, person?.last_name].filter(Boolean).join(' ');
          const key = person?.id || fullName.toLocaleLowerCase('pl-PL');
          if (!fullName || !key || seen.has(key)) return;
          seen.add(key);
          signers.push({
            id: key,
            fullName,
            title: String(title || (person as any)?.position || '').trim(),
          });
        };

        addSigner(legalRepresentative, organization?.legal_representative_title);
        (decisionMakers || [])
          .filter((person: any) => person.can_sign_contracts)
          .forEach((person: any) => addSigner(person.contact, person.title));
        return signers;
      })();
      const legalRepresentativesListInlineHtml = legalSigners
        .map((signer) => {
          const title = signer.title ? ` - ${contractRepresentativeTitleHtml(signer.title)}` : '';
          return `${escapeContractText(signer.fullName)}${title}`;
        })
        .join(', ');
      const legalRepresentativesListHtml = legalSigners
        .map((signer) => {
          const title = signer.title ? ` - ${contractRepresentativeTitleHtml(signer.title)}` : '';
          return `${contractValueHtml(signer.fullName)}${title}`;
        })
        .join(' oraz ');
      const representationType = String(organization?.representation_type || '');
      const representationTypeLabel = REPRESENTATION_TYPE_LABELS[representationType] || '';
      const representationRule = String(organization?.representation_rule || '').trim();
      const representationBasis = String(organization?.representation_basis || '').trim();

      setClientEmail(contact?.email || organization?.email || '');
      setClientName(contact?.full_name || organization?.name || '');

      if (existingContract) {
        setContractId(existingContract.id);
        setContractStatus(existingContract.status as ContractStatus);
        setContractVersion(existingContract.version_number || 1);
        setContractLockedAt(existingContract.locked_at || null);
        setCompanySignedAt(existingContract.company_signed_at || null);
        setContractCreatedBy(existingContract.created_by);
        setGeneratedPdfPath(existingContract.generated_pdf_path || null);
        setModifiedAfterGeneration(existingContract.modified_after_generation || false);
        setStatusDates({
          accepted_at: existingContract.accepted_at,
          issued_at: existingContract.issued_at,
          sent_at: existingContract.sent_at,
          signed_by_client_at: existingContract.signed_by_client_at,
          signed_returned_at: existingContract.signed_returned_at,
          cancelled_at: existingContract.cancelled_at,
        });
      }

      // Extract contract template from event.event_categories
      // Supabase returns contract_templates as a single object (not array) when using foreign key join
      let template = null;

      if (event.event_categories) {
        // event_categories can be an object or array depending on the response
        const category = Array.isArray(event.event_categories)
          ? event.event_categories[0]
          : event.event_categories;

        if (category) {
          // contract_templates is returned as a single object, not an array
          if (category.contract_templates) {
            template = category.contract_templates;
          }
        }
      }

      // Normalize template as expected type or null
      template = template
        ? (template as unknown as {
            id: string;
            name: string;
            content: string;
            content_html: string;
            page_settings: any;
            created_at: string;
            updated_at: string;
          } | null)
        : null;

      const savedTemplateId = existingContract && (storedIndividualEdits || existingContract.generated_pdf_path || existingContract.locked_at || existingContract.status !== 'draft')
        ? existingContract.template_id : null;
      let defaultTemplateId = '';
      if (!templateIdOverride && !savedTemplateId && !event.selected_contract_template_id && !template?.id) {
        const { data: defaultTemplate, error: defaultTemplateError } = await supabase
          .from('contract_templates')
          .select('id')
          .eq('is_active', true)
          .contains('page_settings', { contractStructureDefault: true })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (defaultTemplateError) throw defaultTemplateError;
        defaultTemplateId = defaultTemplate?.id || '';
      }
      const rawTemplateId = templateIdOverride || savedTemplateId || event.selected_contract_template_id || template?.id || defaultTemplateId;
      const finalTemplateId = rawTemplateId && rawTemplateId !== 'null' ? rawTemplateId : '';

      if (!finalTemplateId) {
        setTemplateId(null);
        setSelectedTemplateId(null);
        setSelectedTemplateName('');
        setLoading(false);
        return;
      }

      const { data: selectedTemplate, error: selectedTemplateError } = await supabase
        .from('contract_templates')
        .select('id, name, content, content_html, page_settings, updated_at')
        .eq('id', finalTemplateId)
        .single();

      if (selectedTemplateError) throw selectedTemplateError;
      if (!selectedTemplate) throw new Error('Nie znaleziono wybranego szablonu');

      template = selectedTemplate;

      const templateSettings = applyEventCompanyBranding(
        getTemplateSettings(template.page_settings),
        resolvedCompanyBranding,
      );

      setTemplateId(template.id);
      setSelectedTemplateId(template.id);
      setSelectedTemplateName(template.name);

      let templateToStore = template.content_html || template.content;

      if (template.page_settings?.pages) {
        const baseFlow = template.page_settings.flowContent || template.page_settings.pages.join('');
        const { flowContent } = placeContractClauses(baseFlow, variables, [], { keepConditions: true });
        templateToStore = JSON.stringify({
          pages: template.page_settings.pages,
          flowContent,
          settings: templateSettings,
        });
      }
      setOriginalTemplate(templateToStore);

      const { data: offerCandidates, error: offersError } = await supabase
        .from('offers')
        .select('id, subtotal, discount_percent, discount_amount, tax_percent, tax_amount, total_amount, client_type, offer_number, valid_until, status, created_at, updated_at, offer_requirements')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (offersError) throw offersError;

      const acceptedOffer = (offerCandidates || []).find(
        (offer: any) => offer.status === 'accepted',
      );
      // Wersja robocza umowy musi móc korzystać z aktualnie przygotowywanej
      // oferty. Zaakceptowana oferta zawsze ma pierwszeństwo, ale jeżeli jej nie
      // ma, pobieramy najnowszą wysłaną lub roboczą zamiast gubić cały zakres,
      // wymagania i klauzule produktów.
      const offers = acceptedOffer ||
        (offerCandidates || []).find((offer: any) => offer.status === 'sent') ||
        (offerCandidates || []).find((offer: any) => offer.status === 'draft') ||
        null;

      let acceptedCalculation: any = null;
      if (event.accepted_calculation_id) {
        const { data: calculation, error: calculationError } = await supabase
          .from('event_calculations')
          .select(
            'id, name, created_at, is_accepted, generated_pdf_path, event_calculation_items(id, name, description, quantity, unit, unit_price, days, vat_rate, position)',
          )
          .eq('id', event.accepted_calculation_id)
          .eq('event_id', eventId)
          .maybeSingle();

        if (calculationError) throw calculationError;
        if (calculation?.is_accepted) acceptedCalculation = calculation;
      }

      if (!acceptedCalculation) {
        const { data: calculation, error: calculationError } = await supabase
          .from('event_calculations')
          .select(
            'id, name, created_at, is_accepted, generated_pdf_path, event_calculation_items(id, name, description, quantity, unit, unit_price, days, vat_rate, position)',
          )
          .eq('event_id', eventId)
          .eq('is_accepted', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (calculationError) throw calculationError;
        acceptedCalculation = calculation || null;
      }

      const { data: weddingCard } = await supabase
        .from('wedding_cards')
        .select('id')
        .eq('event_id', eventId)
        .limit(1)
        .maybeSingle();

      let offerItems = null;
      if (offers?.id) {
        const { data: items } = await supabase
          .from('offer_items')
          .select(`
            *,
            product:offer_products!product_id(
              name,
              offer_requirements,
              offer_additional_requirements,
              recommended_contract_clauses,
              recommended_contract_clause_category
            ),
            product_variant:offer_product_variants!product_variant_id(
              overrides_contract_clauses,
              recommended_contract_clauses,
              recommended_contract_clause_category
            )
          `)
          .eq('offer_id', offers.id)
          .order('display_order', { ascending: true });
        offerItems = items;
      }

      const contractNumber = `UMW/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0')}`;
      const offerTotals = offers ? getOfferTotals(offers) : null;
      const calculationItemsArray = Array.isArray(acceptedCalculation?.event_calculation_items)
        ? [...acceptedCalculation.event_calculation_items].sort(
            (a: any, b: any) => Number(a.position || 0) - Number(b.position || 0),
          )
        : [];
      const calculationNet = calculationItemsArray.reduce(
        (sum: number, item: any) =>
          sum +
          Number(item.quantity || 0) *
            Number(item.unit_price || 0) *
            Number(item.days || 1),
        0,
      );
      const calculationGross = calculationItemsArray.reduce((sum: number, item: any) => {
        const itemNet =
          Number(item.quantity || 0) *
          Number(item.unit_price || 0) *
          Number(item.days || 1);
        return sum + itemNet * (1 + Number(item.vat_rate || 0) / 100);
      }, 0);
      const useCalculationFinancials = Boolean(
        acceptedCalculation && (event.financial_source === 'calculation' || !offers),
      );
      const fallbackBudget = Number(eventMoney(event, eventFinancials, 'budget') || 0);
      const budgetNet = useCalculationFinancials
        ? calculationNet
        : offerTotals
          ? offerTotals.net
          : fallbackBudget;
      const budgetGross = useCalculationFinancials
        ? calculationGross
        : offerTotals
          ? offerTotals.gross
          : fallbackBudget;
      const eventCategoryName = String((event.event_categories as any)?.name || '').toLowerCase();
      const isWedding =
        Boolean(weddingCard) ||
        eventCategoryName.includes('wese') ||
        eventCategoryName.includes('wedding');
      const contractBudget = isWedding ? budgetNet : budgetGross;
      const depositPercent = isWedding ? 30 : 50;
      const depositAmount = Math.round((budgetGross * depositPercent / 100 + Number.EPSILON) * 100) / 100;
      const paymentTermDays = Math.max(
        1,
        Number(invoiceSettings?.default_payment_days || 14),
      );
      const discountAmount = useCalculationFinancials ? 0 : offerTotals?.discountAmount || 0;
      const discountPercent = useCalculationFinancials ? 0 : offerTotals?.discountPercent || 0;
      const budgetBeforeDiscountNet =
        useCalculationFinancials ? calculationNet : offerTotals ? offerTotals.listNet : budgetNet;

      const formatMoney = (value: number) =>
        value.toLocaleString('pl-PL', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) + ' zł';

      const formatDate = (dateStr?: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('pl-PL', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      };

      const formatDateOnly = (dateStr?: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('pl-PL', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
      };

      const formatTimeOnly = (dateStr?: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('pl-PL', {
          hour: '2-digit',
          minute: '2-digit',
        });
      };

      const formatEventScheduleContract = (startDateStr: string, endDateStr: string) => {
        if (!startDateStr) return '';
        const startDate = formatDateOnly(startDateStr);
        const startTime = formatTimeOnly(startDateStr);
        if (!endDateStr) {
          return `w dniu <strong>${startDate}</strong> od godziny <strong>${startTime}</strong>`;
        }

        const endDate = formatDateOnly(endDateStr);
        const endTime = formatTimeOnly(endDateStr);
        if (startDate === endDate) {
          return `w dniu <strong>${startDate}</strong>, w godzinach <strong>${startTime}–${endTime}</strong>`;
        }

        return `od dnia <strong>${startDate}</strong> od godziny <strong>${startTime}</strong> do dnia <strong>${endDate}</strong> do godziny <strong>${endTime}</strong>`;
      };

      const formatPlannedTechnicalSchedule = (
        setupDateStr?: string | null,
        teardownDateStr?: string | null,
      ) => {
        const setup = formatDate(setupDateStr);
        const teardown = formatDate(teardownDateStr);
        const accessScope =
          'w zakresie niezbędnym do wniesienia, montażu, przeprowadzenia prób technicznych oraz demontażu i odbioru sprzętu.';
        if (setup && teardown) {
          return `Planowany montaż rozpocznie się <strong>${setup}</strong>, a planowany demontaż rozpocznie się <strong>${teardown}</strong>. Zamawiający zapewni Wykonawcy dostęp do miejsca realizacji w powyższych terminach, ${accessScope}`;
        }
        if (setup) return `Planowany montaż rozpocznie się <strong>${setup}</strong>. Zamawiający zapewni Wykonawcy dostęp do miejsca realizacji w powyższym terminie, ${accessScope}`;
        if (teardown) return `Planowany demontaż rozpocznie się <strong>${teardown}</strong>. Zamawiający zapewni Wykonawcy dostęp do miejsca realizacji w powyższym terminie, ${accessScope}`;
        return '';
      };

      const normalizePhaseName = (value?: string | null) =>
        String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLocaleLowerCase('pl-PL')
          .replace(/\s+/g, ' ')
          .trim();
      const getPhaseTypeName = (phase: any) => {
        const relation = phase?.phase_type;
        return normalizePhaseName(
          Array.isArray(relation) ? relation[0]?.name : relation?.name,
        );
      };
      const phaseMatches = (phase: any, expectedName: 'montaz' | 'demontaz') =>
        [getPhaseTypeName(phase), normalizePhaseName(phase?.name)].some(
          (name) =>
            name === expectedName ||
            name.startsWith(`${expectedName} `) ||
            name.startsWith(`${expectedName} -`),
        );
      const schedulePhases = (technicalSchedulePhases || []).filter(
        (phase: any) => Number.isFinite(new Date(phase.start_time).getTime()),
      );
      const setupPhase = schedulePhases.find((phase: any) =>
        phaseMatches(phase, 'montaz'),
      );
      const teardownPhase = schedulePhases.find((phase: any) =>
        phaseMatches(phase, 'demontaz'),
      );
      // Timeline is authoritative. Keep the legacy date only until its phase is added.
      const resolvedPlannedSetupAt =
        setupPhase?.start_time || event.planned_setup_at || null;
      const resolvedPlannedTeardownAt =
        teardownPhase?.start_time || event.planned_teardown_at || null;

      const location = event.locations as unknown as ILocation;

      const parseLocationString = (locationStr: string) => {
        if (!locationStr) return { address: '', city: '', postal: '' };
        const parts = locationStr.split(',').map((s) => s.trim());
        if (parts.length >= 3) {
          const postalCity = parts[1].trim().split(' ');
          return {
            address: parts[0] || '',
            postal: postalCity[0] || '',
            city: postalCity.slice(1).join(' ') || '',
          };
        }
        return { address: locationStr, city: '', postal: '' };
      };

      const locationString = event.location || '';
      const parsedLocation = parseLocationString(locationString);

      const offerItemsArray = offerItems || [];
      const calculationContractItems = calculationItemsArray.map((item: any) => {
        const quantity = Number(item.quantity || 0);
        const days = Number(item.days || 1);
        const unitPrice = Number(item.unit_price || 0);
        return {
          id: item.id,
          name: item.name || 'Pozycja kalkulacji',
          description: item.description || null,
          quantity,
          days,
          unit: item.unit || 'szt.',
          unit_price: unitPrice,
          discount_percent: null,
          total: quantity * days * unitPrice,
        };
      });
      // Zaakceptowana oferta jest źródłem zakresu, jeżeli istnieje. Kalkulacja
      // wypełnia tabelę dopiero wtedy, gdy wydarzenie nie ma zaakceptowanej oferty.
      const contractScopeItems =
        offerItemsArray.length > 0 ? offerItemsArray : calculationContractItems;
      const { data: contractFonts } = await supabase
        .from('company_brandbook_fonts')
        .select('*')
        .order('order_index');
      const fontFaceCss = (contractFonts || [])
        .filter((font: any) => font.file_url)
        .map(
          (font: any) =>
            `@font-face{font-family:'${String(font.family).replace(/'/g, "\\'")}';src:url('${font.file_url}');font-weight:${font.weight || '400'};font-style:normal;font-display:swap;}`,
        )
        .join('');
      setContractFontFaceCss(fontFaceCss);
      await Promise.all(
        (contractFonts || []).filter((font: any) => font.file_url).map(async (font: any) => {
          const loadedFont = new FontFace(font.family, `url(${font.file_url})`, {
            weight: font.weight || '400',
          });
          await loadedFont.load();
          document.fonts.add(loadedFont);
        }),
      );
      const clauseCandidates: ProductClauseCandidate[] = [];
      offerItemsArray.forEach((item: any) => {
        const product = Array.isArray(item.product) ? item.product[0] : item.product;
        const variant = Array.isArray(item.product_variant)
          ? item.product_variant[0]
          : item.product_variant;
        const clauseSource = variant?.overrides_contract_clauses ? variant : product;
        const clauseEntries = parseContractClauseEntries(
          clauseSource?.recommended_contract_clauses,
          clauseSource?.recommended_contract_clause_category || 'requirements',
        );
        clauseEntries.forEach((entry) => {
          const clause = normalizeContractClausePointListHtml(
            stripProductNameHeadingFromClauseHtml(
              normalizeContractClauseHtml(entry.content),
              item.name,
            ),
          );
          if (!clause) return;
          const productName = String(item.name || product?.name || 'Produkt').trim();
          const candidateId = `${String(item.id || item.product_id || productName)}:${entry.id}`;
          clauseCandidates.push({
            id: candidateId,
            category: entry.category,
            topic: entry.topic,
            title: entry.title || getContractClauseTopicLabel(entry.topic),
            productName,
            html: clause,
            sharedKey: entry.sharedKey,
            requirement: entry.requirement,
            coveredBy: entry.coveredBy,
            legacyOverrideId: entry.legacyId ? `${String(item.id || item.product_id || productName)}:${entry.legacyId}` : undefined,
            preview: clause.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 420),
          });
        });
      });

      // Wymagania zatwierdzone na poziomie oferty są tym samym źródłem prawdy
      // dla strony „Warunki techniczne i organizacyjne” oraz dla placeholderów
      // umowy. Wcześniej umowa czytała wyłącznie recommended_contract_clauses,
      // dlatego warunek obecny w ofercie mógł zniknąć z umowy.
      const normalizedRequirementItems = offerItemsArray.map((item: any) => ({
        ...item,
        product: Array.isArray(item.product) ? item.product[0] : item.product,
      }));
      const approvedOfferRequirements = buildOfferRequirements({
        items: normalizedRequirementItems,
        storedRequirements: parseStoredOfferRequirements(offers?.offer_requirements),
        refreshAutomaticSources: offers?.status === 'draft',
      }).filter((requirement) => requirement.included !== false);

      approvedOfferRequirements.forEach((requirement, requirementIndex) => {
        const requirementLines = splitOfferRequirementLines(requirement.description);
        const descriptions = requirementLines.length > 0
          ? requirementLines
          : [String(requirement.description || '').trim()].filter(Boolean);
        const sourceLabel = requirement.sources?.length
          ? requirement.sources.join(' · ')
          : offers?.offer_number
            ? `Oferta ${offers.offer_number}`
            : 'Oferta';

        const descriptionText = descriptions.join(' ');
        const shared = getSharedContractClauseForText(descriptionText);
        const mapped = shared || mapOfferRequirementToContractTopic(
          requirement.category,
          descriptionText,
        );
        const clause = normalizeContractClausePointListHtml(
          shared?.content || descriptions.map((description) => `<p>${escapeContractText(description)}</p>`).join(''),
        );
        if (!clause) return;
        const stableRequirementKey = String(
          requirement.key || `${requirement.category}:${requirementIndex}`,
        );
        clauseCandidates.push({
          id: `offer-requirement:${stableRequirementKey}`,
          sharedKey: shared?.key,
          category: mapped.category,
          topic: mapped.topic,
          title: String(
            requirement.title || getContractClauseTopicLabel(mapped.topic),
          ).trim(),
          productName: sourceLabel,
          html: clause,
          preview: descriptionText.replace(/\s+/g, ' ').trim().slice(0, 420),
        });
      });

      // Wpisy tego samego tematu są uzupełnieniami, a nie automatycznie
      // wykluczającymi się wariantami. Zachowujemy także szczegóły produktów.
      const resolvedEventContractClauses = buildEventContractClauseItems(
        clauseCandidates,
        storedEventClauseOverrides,
      );
      const clauseConflicts = getSharedClauseConflicts(resolvedEventContractClauses);
      const validProductClauseSelections = clauseConflicts.reduce<Record<string, string>>(
        (result, conflict) => {
          const selectedId = requestedProductClauseSelections[conflict.key];
          if (conflict.candidates.some((candidate) => candidate.id === selectedId)) {
            result[conflict.key] = selectedId;
          }
          return result;
        },
        {},
      );
      const sourceProductClausesFingerprint = contractClauseSourceFingerprint(clauseCandidates);
      setProductClauseConflicts(clauseConflicts);
      setProductClauseSelections(validProductClauseSelections);
      setProductClauseSelectionDraft(validProductClauseSelections);
      setEventContractClauseItems(resolvedEventContractClauses);
      const assembledClauses = assembleContractClauses(
        resolvedEventContractClauses,
        template.page_settings?.flowContent || template.page_settings?.pages?.join('') ||
          template.content_html || template.content,
        validProductClauseSelections,
      );
      const offerItemsHtml =
        contractScopeItems.length > 0
          ? `<span data-contract-offer-items="true" style="font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;color:inherit;">${contractScopeItems
              .map((item: any, index: number) => {
                const quantity = Number(item.quantity);
                const quantityPrefix = Number.isFinite(quantity) && quantity > 1
                  ? `${quantity.toLocaleString('pl-PL', { maximumFractionDigits: 3 })}x `
                  : '';
                return `<span style="display:block;font-family:inherit;font-size:inherit;line-height:inherit;margin:0 0 2pt;"><strong style="font-family:inherit;font-size:inherit;line-height:inherit;">${index + 1}. ${quantityPrefix}${escapeContractText(item.name || 'Produkt')}</strong></span>`;
              })
              .join('')}</span>`
          : '<span style="font:inherit;font-style:italic;color:#666;">Brak pozycji w zaakceptowanym źródle zakresu</span>';

      const { generateOfferItemsTable, generateDecisionMakersListTable } =
        await import('@/lib/offerTemplateHelpers');
      const offerItemsTable = generateOfferItemsTable(contractScopeItems);
      const decisionMakersListHtml = generateDecisionMakersListTable(
        (decisionMakers as unknown as DecisionMaker[]) || [],
      );

      const organizationAddress = joinRawContractParts([
        organization?.address,
        joinRawContractParts([organization?.postal_code, organization?.city], ' '),
      ]);
      const contactAddress = joinRawContractParts([
        contact?.address,
        joinRawContractParts([contact?.postal_code, contact?.city], ' '),
      ]);
      const clientContractPartyBase = organization
        ? `<span data-contract-party="client" style="font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;font-weight:400 !important;">${contractValueHtml(
            organization.name,
          )}${organizationAddress ? `, adres: ${contractValueHtml(organizationAddress)}` : ''}${
            organization.nip ? `, NIP: ${contractValueHtml(organization.nip)}` : ''
          }${organization.regon ? `, REGON: ${contractValueHtml(organization.regon)}` : ''}${
            organization.krs ? `, KRS: ${contractValueHtml(organization.krs)}` : ''
          }.</span>`
        : `<span data-contract-party="client" style="font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;font-weight:400 !important;">${contractValueHtml(
            contact?.full_name ||
              compactContractParts([contact?.first_name, contact?.last_name]).join(' ') ||
              'Zleceniodawca',
          )}${contactAddress ? `, adres: ${contractValueHtml(contactAddress)}` : ''}${
            contact?.pesel ? `, PESEL: ${contractValueHtml(contact.pesel)}` : ''
          }.</span>`;

      const clientContractPartyBlock = organization
        ? clientPartyWithSigners(clientContractPartyBase, legalSigners)
        : clientContractPartyBase;
      setClientPartyBase(organization ? clientContractPartyBase : '');
      setClientPartySigners(organization ? legalSigners : []);

      let invoiceBuyer = organization;
      // Klient rozliczany na inną organizację z karty klienta (np. szkoła → gmina): nabywcą jest ta organizacja.
      const clientInvoiceBuyerId = (organization as { invoice_buyer_organization_id?: string | null } | null)
        ?.invoice_buyer_organization_id || null;
      const clientRecipientRole = (organization as { invoice_recipient_role?: number | null } | null)
        ?.invoice_recipient_role === 2 ? 2 : 8;
      const payerId = event.billing_arrangement && event.billing_arrangement !== 'direct'
        ? event.billing_organization_id
        : clientInvoiceBuyerId;
      if (payerId) {
        const { data: payer, error: payerError } = await supabase.from('organizations')
          .select('*').eq('id', payerId).single();
        if (payerError) throw payerError;
        invoiceBuyer = payer as OrganizationWithRelations;
      }
      const clientIsJstUnit = Boolean(organization && clientInvoiceBuyerId && invoiceBuyer?.id === clientInvoiceBuyerId
        && clientRecipientRole === 8);
      const invoicePartyDetails = (party: OrganizationWithRelations) => [
        contractValueHtml(party.name),
        escapeContractText(joinRawContractParts([party.address, joinRawContractParts([party.postal_code, party.city], ' ')])),
        party.nip ? `NIP: ${contractValueHtml(party.nip)}` : '',
      ].filter(Boolean).join(', ');
      const recipientInternalId = clientIsJstUnit ? '' : organization?.ksef_internal_id?.trim();
      const invoiceRecipient = organization && (invoiceBuyer?.id !== organization.id || recipientInternalId)
        ? clientIsJstUnit
          ? `<span style="display:block;font:inherit;">Odbiorca (jednostka podrzędna JST): ${invoicePartyDetails(organization)}.</span>`
          : `<span style="display:block;font:inherit;">Odbiorca (Podmiot inny w KSeF): ${invoicePartyDetails(organization)}${recipientInternalId ? `, numer identyfikacji wewnętrznej: ${contractValueHtml(recipientInternalId)}` : ''}.</span>`
        : '';
      const clientInvoiceDetailsBlock = invoiceBuyer
        ? `<span style="font:inherit;"><span style="display:block;font:inherit;">Nabywca: ${invoicePartyDetails(invoiceBuyer)}.</span>${invoiceRecipient}</span>`
        : `<span style="font:inherit;">Nabywca: ${contractValueHtml(contact?.full_name || [contact?.first_name, contact?.last_name].filter(Boolean).join(' '))}${contactAddress ? `, ${escapeContractText(contactAddress)}` : ''}.</span>`;

      const executorCompany = resolvedCompanyBranding?.company;
      const executorAddressLine = joinRawContractParts([
        executorCompany?.street,
        joinRawContractParts(
          [
            executorCompany?.building_number,
            executorCompany?.apartment_number
              ? `/${executorCompany.apartment_number}`
              : '',
          ],
          '',
        ),
      ], ' ');
      const executorFullAddress = joinRawContractParts([
        executorAddressLine,
        joinRawContractParts([executorCompany?.postal_code, executorCompany?.city], ' '),
      ]);
      const executorRepresentative =
        executorCompany?.signature_name?.trim() || '';
      const executorRepresentativeTitle = executorCompany?.signature_title?.trim() || '';
      const executorContractPartyBlock = `<span data-contract-party="executor" style="font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;font-weight:400 !important;">${contractValueHtml(
        executorCompany?.legal_name || executorCompany?.name || 'Mavinci Sp. z o.o.',
      )}${executorFullAddress ? `, adres: ${contractValueHtml(executorFullAddress)}` : ''}${
        executorCompany?.krs ? `, KRS: ${contractValueHtml(executorCompany.krs)}` : ''
      }${executorCompany?.nip ? `, NIP: ${contractValueHtml(executorCompany.nip)}` : ''}${
        executorCompany?.regon ? `, REGON: ${contractValueHtml(executorCompany.regon)}` : ''
      }, reprezentowaną przez: ${contractValueHtml(executorRepresentative || '[uzupełnij reprezentanta wykonawcy]')}${
        executorRepresentativeTitle
          ? ` — ${contractValueHtml(executorRepresentativeTitle)}`
          : ''
      }, osoba upoważniona do podpisywania dokumentów.</span>`;

      const acceptedCalculationNumber = getCalculationNumber(
        acceptedCalculation?.id,
        acceptedCalculation?.created_at,
      );
      const offerIsAccepted = offers?.status === 'accepted';
      const offerReference = offers?.offer_number
        ? `${offerIsAccepted ? 'zaakceptowana oferta' : 'oferta robocza'} nr <strong>${escapeContractText(offers.offer_number)}</strong>`
        : '';
      const calculationReference = acceptedCalculationNumber
        ? `zaakceptowana kalkulacja nr <strong>${escapeContractText(acceptedCalculationNumber)}</strong>`
        : '';
      const sourceReferences = [offerReference, calculationReference].filter(Boolean);
      const contractSourceReferences =
        sourceReferences.length > 0
          ? sourceReferences.join(' oraz ')
          : 'uzgodnione i zaakceptowane zestawienie zakresu';
      const contractScopeSourceReference = offerReference
        ? `${offerIsAccepted ? 'zaakceptowanej ofercie' : 'ofercie roboczej'} nr <strong>${escapeContractText(String(offers?.offer_number || ''))}</strong>`
        : calculationReference
          ? `zaakceptowanej kalkulacji nr <strong>${escapeContractText(acceptedCalculationNumber)}</strong>`
          : 'uzgodnionym i zaakceptowanym zestawieniu zakresu';

      const templateMaterialsDeadline =
        template.page_settings?.contractVariableDefaults?.termin_dostarczenia_materialow;
      const materialsDeadline = storedMaterialsDeadline ?? (
        typeof templateMaterialsDeadline === 'string' ? templateMaterialsDeadline : ''
      );

      const varsMap: Record<string, string> = {
        __contract_font_faces: '',
        contact_first_name: contact?.first_name || '',
        contact_last_name: contact?.last_name || '',
        contact_full_name: contact?.full_name || '',
        contact_email: contact?.email || '',
        contact_phone: contact?.phone || '',
        contact_pesel: contact?.pesel || '',
        contact_address: contact?.address || '',
        contact_city: contact?.city || '',
        contact_postal_code: contact?.postal_code || '',

        client_organization_id: organization?.id || '',
        organization_name: organization?.name || '',
        organization_alias: organization?.alias || '',
        organization_business_type: organization?.business_type || '',
        organization_nip: formatPrefixedValue(organization?.nip, 'NIP', ','),
        organization_krs: formatPrefixedValue(organization?.krs, 'KRS', ','),
        organization_krs_raw: organization?.krs || '',
        organization_regon: formatPrefixedValue(organization?.regon, 'REGON', ','),
        organization_legal_form: organizationLegalFormLabel,
        organization_legal_form_raw: resolvedOrganizationLegalForm || '',
        organization_registry_profile: organizationRegistryProfile,
        organization_requires_krs: organizationRequiresKrs ? 'true' : 'false',
        organization_address: organization?.address || '',
        organization_city: organization?.city || '',
        organization_postal_code: organization?.postal_code || '',
        organization_phone: organization?.phone || '',
        organization_email: organization?.email || '',
        organization_country: organization?.country || '',
        organization_full_address: joinRawContractParts([
          organization?.address,
          joinRawContractParts([organization?.postal_code, organization?.city], ' '),
        ]),
        zamiownienie: multilineContractTextHtml(event.purchase_order_number),
        zamowienie: multilineContractTextHtml(event.purchase_order_number),

        event_name: event.name || '',
        event_date: formatDateOnly(event.event_date),
        event_end_date: formatDate(event.event_end_date),
        event_date_only: formatDateOnly(event.event_date),
        event_end_date_only: formatDateOnly(event.event_end_date),
        event_time_start: formatTimeOnly(event.event_date),
        event_time_end: formatTimeOnly(event.event_end_date),
        event_schedule_contract: formatEventScheduleContract(
          event.event_date,
          event.event_end_date,
        ),
        planned_setup_at: formatDate(resolvedPlannedSetupAt),
        planned_setup_date: formatDateOnly(resolvedPlannedSetupAt),
        planned_setup_time: formatTimeOnly(resolvedPlannedSetupAt),
        planned_teardown_at: formatDate(resolvedPlannedTeardownAt),
        planned_teardown_date: formatDateOnly(resolvedPlannedTeardownAt),
        planned_teardown_time: formatTimeOnly(resolvedPlannedTeardownAt),
        planned_technical_schedule: formatPlannedTechnicalSchedule(
          resolvedPlannedSetupAt,
          resolvedPlannedTeardownAt,
        ),

        location_name: location?.name || parsedLocation.address || '',
        location_address: location?.address || parsedLocation.address || '',
        location_city: location?.city || parsedLocation.city || '',
        location_postal_code: location?.postal_code || parsedLocation.postal || '',
        location_full: location?.formatted_address || locationString || '',

        primary_contact_full_name: primaryContactFullName,
        primary_contact_first_name: primaryContact?.first_name || '',
        primary_contact_last_name: primaryContact?.last_name || '',
        primary_contact_position: formatPrefixedValue(primaryContact?.position, '-', '.'),
        primary_contact_email: formatPrefixedValue(primaryContactEmail, 'e-mail:', ','),
        primary_contact_phone: formatPrefixedValue(primaryContactPhone, 'telefon:', ','),

        legal_representative_full_name: formatPrefixedValue(legalRepresentativeFullName, ''),
        legal_representative_first_name: legalRepresentative?.first_name || '',
        legal_representative_last_name: legalRepresentative?.last_name || '',
        legal_representative_email: legalRepresentative?.email || '',
        legal_representative_phone: legalRepresentative?.phone || legalRepresentative?.mobile || '',
        legal_representative_pesel: legalRepresentative?.pesel || '',
        legal_representative_address: legalRepresentative?.address || '',
        legal_representative_city: legalRepresentative?.city || '',
        legal_representative_postal_code: legalRepresentative?.postal_code || '',
        legal_representative_title: formatPrefixedValue(organization?.legal_representative_title, '-', '.'),
        legal_representatives_list: legalRepresentativesListInlineHtml,
        legal_representatives_count: String(legalSigners.length),
        client_representation_type: representationType,
        client_representation_type_label: representationTypeLabel,
        client_representation_rule: representationRule,
        client_representation_basis: representationBasis,
        client_representation_verified_at: formatDateOnly(
          organization?.representation_verified_at,
        ),
        client_representation_verified_at_raw:
          organization?.representation_verified_at || '',
        client_representation_block: representationRule
          ? `Sposób reprezentacji: ${contractValueHtml(representationRule)}${
              representationBasis
                ? ` (podstawa weryfikacji: ${contractValueHtml(representationBasis)})`
                : ''
            }.`
          : '',

        decision_makers_list: decisionMakersListHtml,
        client_contract_party_block: clientContractPartyBlock,
        client_invoice_details_block: clientInvoiceDetailsBlock,

        // {{budget}} pozostaje aliasem kwoty umowy. Dla wesel jest nią netto,
        // a dla pozostałych realizacji dotychczasowa wartość brutto.
        budget: formatMoney(contractBudget),
        budget_words: numberToWords(contractBudget),
        budget_netto: formatMoney(budgetNet),
        budget_netto_words: numberToWords(budgetNet),
        budget_brutto: formatMoney(budgetGross),
        budget_brutto_words: numberToWords(budgetGross),
        budget_before_discount_netto: formatMoney(budgetBeforeDiscountNet),
        discount_amount: formatMoney(discountAmount),
        discount_percent:
          discountPercent.toLocaleString('pl-PL', {
            minimumFractionDigits: discountPercent > 0 ? 2 : 0,
            maximumFractionDigits: 2,
          }) + '%',
        deposit_amount: formatMoney(depositAmount),
        deposit_words: numberToWords(depositAmount),
        deposit_percent: `${depositPercent}%`,
        payment_term_days: String(paymentTermDays),
        // Zapisana wartość umowy ma pierwszeństwo przed domyślną wartością szablonu.
        termin_dostarczenia_materialow: materialsDeadline,

        contract_number: contractNumber,
        contract_date: new Date().toLocaleDateString('pl-PL'),
        accepted_calculation_number: acceptedCalculationNumber,
        accepted_calculation_name: acceptedCalculation?.name || '',
        accepted_calculation_reference: calculationReference,
        contract_source_references: contractSourceReferences,
        contract_scope_source_reference: contractScopeSourceReference,

        executor_name:
          resolvedCompanyBranding?.company.legal_name ||
          resolvedCompanyBranding?.company.name ||
          'Mavinci Sp. z o.o.',
        executor_address: resolvedCompanyBranding
          ? [
              resolvedCompanyBranding.company.street,
              [
                resolvedCompanyBranding.company.building_number,
                resolvedCompanyBranding.company.apartment_number,
              ].filter(Boolean).join('/'),
            ].filter(Boolean).join(' ')
          : 'ul. Marcina Kasprzaka 15/66',
        executor_postal_code: resolvedCompanyBranding?.company.postal_code || '10-057',
        executor_city: resolvedCompanyBranding?.company.city || 'Olsztyn',
        executor_nip: resolvedCompanyBranding?.company.nip || '7394011583',
        executor_regon: resolvedCompanyBranding?.company.regon || '',
        executor_krs: resolvedCompanyBranding?.company.krs || '',
        executor_phone: resolvedCompanyBranding?.company.phone || '698-212-279',
        executor_email: resolvedCompanyBranding?.company.email || 'biuro@mavinci.pl',
        executor_website: resolvedCompanyBranding?.company.website || '',
        executor_bank_account: resolvedCompanyBranding?.company.bank_account || '',
        executor_bank_name: resolvedCompanyBranding?.company.bank_name || '',
        executor_representative_name: executorRepresentative,
        executor_representative_title: executorRepresentativeTitle,
        executor_contract_party_block: executorContractPartyBlock,

        offer_id: offers?.id || '',
        offer_number: offers?.offer_number || '',
        offer_status: offers?.status || '',
        offer_is_accepted: offerIsAccepted ? 'true' : '',
        offer_valid_until: offers?.valid_until ? formatDateOnly(offers.valid_until) : '',
        offer_scope:
          contractScopeItems.length > 0
            ? contractScopeItems
                .map(
                  (item: any, i: number) => {
                    const quantity = Number(item.quantity);
                    const quantityPrefix = Number.isFinite(quantity) && quantity > 1
                      ? `${quantity.toLocaleString('pl-PL', { maximumFractionDigits: 3 })}x `
                      : '';
                    return `${i + 1}. ${quantityPrefix}${item.name || 'Produkt'}`;
                  },
                )
                .join(', ')
            : '',

        offer_items: offerItemsHtml,
        OFFER_ITEMS_TABLE: offerItemsTable,
      };
      // Warunki szablonu: rodzaj klienta, kategoria wydarzenia i domyślne opcje umowy (`contractConditions.ts`).
      const eventCategory = Array.isArray(event.event_categories) ? event.event_categories[0] : event.event_categories;
      Object.assign(varsMap, contractConditionVariables({
        isCompany: Boolean(organization),
        categoryName: (eventCategory as { name?: string } | null)?.name || '',
        options: resolveContractOptions(template.page_settings),
      }));

      Object.entries(assembledClauses.sections).forEach(([key, value]) => {
        varsMap[key] = replaceVariables(value, varsMap);
      });
      const templateFlow = includeContractFonts(assembledClauses.flowContent, varsMap);
      // Sekcje warunkowe zostają w źródle umowy — zmiana opcji przelicza treść bez ponownego generowania.
      const clausePlacement = placeContractClauses(templateFlow, varsMap, [], { keepConditions: true });
      const flowWithAutomaticClauses = clausePlacement.flowContent;
      Object.assign(varsMap, clausePlacement.variables);
      setUnplacedClauseCategories(clausePlacement.unplacedClauseCategories);
      const sourceMeta = {
        contractStructureVersion: CONTRACT_STRUCTURE_VERSION,
        sourceExecutorPartyFingerprint: JSON.stringify([
          event.my_company_id || null,
          executorContractPartyBlock,
          clientInvoiceDetailsBlock,
        ]),
        sourceTemplateId: template.id,
        sourceTemplateUpdatedAt: template.updated_at,
        termin_dostarczenia_materialow: materialsDeadline,
        sourceOfferId: offers?.id || null,
        sourceOfferStatus: offers?.status || null,
        sourceOfferUpdatedAt: offers?.updated_at || null,
        sourcePlannedSetupAt: resolvedPlannedSetupAt,
        sourcePlannedTeardownAt: resolvedPlannedTeardownAt,
        sourceProductClausesFingerprint,
        sourceEventClauseOverridesFingerprint: JSON.stringify(
          parseEventContractClauseOverrides(storedEventClauseOverrides),
        ),
        productClauseSelections: validProductClauseSelections,
      };
      setOriginalTemplate(JSON.stringify({
        flowContent: flowWithAutomaticClauses,
        pages: template.page_settings?.pages || [flowWithAutomaticClauses],
        settings: templateSettings,
        meta: sourceMeta,
      }));

      let savedOverrides: Record<string, string> = {};
      let savedSignerIds = legalSigners.map(person => person.id);
      if (existingContract?.content && !replaceExistingContent) {
        try {
          const saved = JSON.parse(existingContract.content);
          if (saved.meta?.sourceTemplateId === template.id && Array.isArray(saved.meta?.clientContractSignerIds)) {
            savedSignerIds = saved.meta.clientContractSignerIds.filter((id: unknown): id is string => typeof id === 'string');
          }

          if (saved.meta?.sourceTemplateId === template.id && saved.meta?.variableOverrides &&
              typeof saved.meta.variableOverrides === 'object' && !Array.isArray(saved.meta.variableOverrides)) {
            savedOverrides = Object.fromEntries(Object.entries(saved.meta.variableOverrides)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
          }
        } catch { /* Historical documents have no variable overrides. */ }
      }
      setSelectedClientSignerIds(savedSignerIds);
      setSavedClientSignerIds(savedSignerIds);
      setVariableOverrides(savedOverrides);
      setVariables({ ...varsMap, ...savedOverrides });
      setEditedVariables({ ...varsMap, ...savedOverrides });
      let contentToSet = '';

      const currentSourceDocument = await renderContractDocument(
        replaceVariables(applyContractConditions(flowWithAutomaticClauses, { ...varsMap, ...savedOverrides }), varsMap),
        templateSettings,
      );
      const currentSourceContent = JSON.stringify({
        ...currentSourceDocument,
        meta: sourceMeta,
      });
      setSourceContractContent(currentSourceContent);
      setContractSourceOutdated(false);

      // Jeśli istnieje zapisana umowa, użyj jej contentu zamiast szablonu
      if (existingContract?.content && !replaceExistingContent) {
        try {
          const parsedContract = JSON.parse(existingContract.content);
          if (
            (parsedContract.meta?.individuallyEdited === true ||
              existingContract.generated_pdf_path ||
              existingContract.status !== 'draft' || existingContract.locked_at) &&
            (typeof parsedContract.flowContent === 'string' || Array.isArray(parsedContract.pages))
          ) {
            const savedFlow = includeContractFonts(
              parsedContract.flowContent || parsedContract.pages.join(''),
              varsMap,
            );
            // Szkic (niewystawiony) dostaje aktualne logo do druku firmy wydarzenia także przy indywidualnych
            // zmianach treści — logo to oprawa, nie treść. Umowa wystawiona / zablokowana zachowuje zapisane logo.
            const draftBranding = existingContract.status === 'draft' && !existingContract.locked_at && parsedContract.settings
              ? {
                  ...parsedContract.settings,
                  selectedLogo: templateSettings.selectedLogo,
                  footerContent: parsedContract.settings.footerContent
                    ? { ...parsedContract.settings.footerContent, logoUrl: templateSettings.footerContent?.logoUrl }
                    : parsedContract.settings.footerContent,
                }
              : null;
            const savedSettings = draftBranding || parsedContract.settings || templateSettings;
            const renderedContract = await renderContractDocument(
              savedFlow,
              savedSettings,
            );
            contentToSet = JSON.stringify({
              ...parsedContract,
              ...(draftBranding ? { settings: draftBranding } : {}),
              ...renderedContract,
            });
            setContractSourceOutdated(
              parsedContract.meta?.sourceExecutorPartyFingerprint !== sourceMeta.sourceExecutorPartyFingerprint ||
                parsedContract.meta?.sourceTemplateId !== sourceMeta.sourceTemplateId ||
                parsedContract.meta?.sourceTemplateUpdatedAt !== sourceMeta.sourceTemplateUpdatedAt ||
                parsedContract.meta?.contractStructureVersion !== sourceMeta.contractStructureVersion ||
                parsedContract.meta?.sourceOfferId !== sourceMeta.sourceOfferId ||
                parsedContract.meta?.sourceOfferUpdatedAt !== sourceMeta.sourceOfferUpdatedAt ||
                parsedContract.meta?.sourcePlannedSetupAt !== sourceMeta.sourcePlannedSetupAt ||
                parsedContract.meta?.sourcePlannedTeardownAt !==
                  sourceMeta.sourcePlannedTeardownAt ||
                parsedContract.meta?.sourceProductClausesFingerprint !==
                  sourceMeta.sourceProductClausesFingerprint ||
                parsedContract.meta?.sourceEventClauseOverridesFingerprint !==
                  sourceMeta.sourceEventClauseOverridesFingerprint,
            );
          }
        } catch {
          // Starszy zapis bez metadanych zostanie odbudowany z aktualnych źródeł.
        }
      }

      if (!contentToSet && existingContract?.content && !replaceExistingContent &&
        (existingContract.generated_pdf_path || existingContract.status !== 'draft' || existingContract.locked_at)) {
        contentToSet = existingContract.content;
      }
      if (!contentToSet) {
        // Dopóki treść nie była edytowana indywidualnie, źródłem prawdy jest oferta i szablon.
        contentToSet = currentSourceContent;
      }
      if (replaceExistingContent && existingContract?.id) {
        const { error: clauseSelectionUpdateError } = await supabase
          .from('contracts')
          .update({
            content: contentToSet,
            template_id: template.id,
            modified_after_generation: true,
          })
          .eq('id', existingContract.id);
        if (clauseSelectionUpdateError) throw clauseSelectionUpdateError;
        setModifiedAfterGeneration(true);
      }
      setContractContent(contentToSet);
    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
      if (replaceExistingContent) throw err;
    } finally {
      setLoading(false);
    }
}

// MARK: Pola, warunki, depozyt i uwagi przed wystawieniem (zakładka „Umowa”)

export type ContractPreflightIssue = {
  key: string;
  label: string;
  severity: 'blocker' | 'warning';
  actionHref?: string;
  actionLabel?: string;
};

export const CONTRACT_VARIABLE_LABELS: Record<string, string> = {
  executor_contract_party_block: 'Pełne dane wykonawcy',
  client_contract_party_block: 'Pełne dane klienta',
  client_invoice_details_block: 'Dane do faktury — nabywca i odbiorca',
  legal_representatives_list: 'Lista reprezentantów klienta',
  client_representation_block: 'Sposób reprezentacji klienta — pełna treść',
  decision_makers_list: 'Lista osób decyzyjnych',
  offer_items: 'Pozycje oferty',
  OFFER_ITEMS_TABLE: 'Tabela pozycji oferty',
  contract_clauses_all: 'Wszystkie klauzule',
  contract_clauses_conditions: 'Warunki realizacji',
  contract_clauses_requirements: 'Wymagania podstawowe',
  contract_clauses_obligations: 'Obowiązki zamawiającego',
  contract_clauses_risks: 'Ryzyka i odpowiedzialność',
  contract_clauses_additional_requirements: 'Wymagania dodatkowe',
  contract_clauses_general: 'Postanowienia dodatkowe',
  contact_first_name: 'Imię kontaktu',
  contact_last_name: 'Nazwisko kontaktu',
  contact_full_name: 'Imię i nazwisko kontaktu',
  contact_email: 'E-mail kontaktu',
  contact_phone: 'Telefon kontaktu',
  contact_pesel: 'PESEL kontaktu',
  contact_address: 'Adres kontaktu',
  contact_city: 'Miasto kontaktu',
  contact_postal_code: 'Kod pocztowy kontaktu',
  organization_name: 'Nazwa klienta',
  organization_alias: 'Skrócona nazwa klienta',
  organization_business_type: 'Rodzaj działalności klienta',
  organization_nip: 'NIP klienta',
  organization_krs: 'KRS klienta',
  organization_regon: 'REGON klienta',
  organization_legal_form: 'Forma prawna klienta',
  organization_address: 'Ulica i numer klienta',
  organization_city: 'Miasto klienta',
  organization_postal_code: 'Kod pocztowy klienta',
  organization_phone: 'Telefon klienta',
  organization_email: 'E-mail klienta',
  organization_country: 'Kraj klienta',
  organization_full_address: 'Pełny adres klienta',
  zamiownienie: 'Numer PO / zamówienia klienta',
  zamowienie: 'Numer PO / zamówienia klienta',
  termin_dostarczenia_materialow: 'Termin dostarczenia materiałów',
  event_name: 'Nazwa wydarzenia',
  event_date: 'Data rozpoczęcia wydarzenia',
  event_end_date: 'Data zakończenia wydarzenia',
  event_date_only: 'Dzień rozpoczęcia wydarzenia',
  event_end_date_only: 'Dzień zakończenia wydarzenia',
  event_time_start: 'Godzina rozpoczęcia wydarzenia',
  event_time_end: 'Godzina zakończenia wydarzenia',
  event_schedule_contract: 'Termin wydarzenia do umowy',
  planned_setup_at: 'Planowany montaż – data i godzina',
  planned_setup_date: 'Planowany montaż – data',
  planned_setup_time: 'Planowany montaż – godzina',
  planned_teardown_at: 'Planowany demontaż – data i godzina',
  planned_teardown_date: 'Planowany demontaż – data',
  planned_teardown_time: 'Planowany demontaż – godzina',
  planned_technical_schedule: 'Termin montażu i demontażu',
  location_name: 'Nazwa lokalizacji',
  location_address: 'Adres lokalizacji',
  location_city: 'Miasto lokalizacji',
  location_postal_code: 'Kod pocztowy lokalizacji',
  location_full: 'Pełny adres lokalizacji',
  primary_contact_full_name: 'Główna osoba kontaktowa',
  primary_contact_first_name: 'Imię głównej osoby kontaktowej',
  primary_contact_last_name: 'Nazwisko głównej osoby kontaktowej',
  primary_contact_position: 'Stanowisko głównej osoby kontaktowej',
  primary_contact_email: 'E-mail głównej osoby kontaktowej',
  primary_contact_phone: 'Telefon głównej osoby kontaktowej',
  legal_representative_full_name: 'Reprezentant prawny klienta',
  legal_representative_first_name: 'Imię reprezentanta prawnego',
  legal_representative_last_name: 'Nazwisko reprezentanta prawnego',
  legal_representative_email: 'E-mail reprezentanta prawnego',
  legal_representative_phone: 'Telefon reprezentanta prawnego',
  legal_representative_pesel: 'PESEL reprezentanta prawnego',
  legal_representative_address: 'Adres reprezentanta prawnego',
  legal_representative_city: 'Miasto reprezentanta prawnego',
  legal_representative_postal_code: 'Kod pocztowy reprezentanta prawnego',
  legal_representative_title: 'Stanowisko reprezentanta prawnego',
  client_representation_type_label: 'Sposób reprezentacji klienta',
  client_representation_rule: 'Dokładne zasady reprezentacji klienta',
  client_representation_basis: 'Podstawa weryfikacji reprezentacji',
  client_representation_verified_at: 'Data weryfikacji reprezentacji',
  budget: 'Kwota umowy',
  budget_words: 'Kwota umowy słownie',
  budget_netto: 'Kwota netto po rabacie',
  budget_netto_words: 'Kwota netto słownie',
  budget_brutto: 'Kwota brutto po rabacie',
  budget_brutto_words: 'Kwota brutto słownie',
  budget_before_discount_netto: 'Wartość netto przed rabatem',
  discount_amount: 'Wartość rabatu',
  discount_percent: 'Rabat procentowy',
  deposit_amount: 'Kwota zadatku',
  deposit_words: 'Kwota zadatku słownie',
  deposit_percent: 'Procent zadatku',
  payment_term_days: 'Termin płatności w dniach',
  contract_number: 'Numer umowy',
  contract_date: 'Data umowy',
  accepted_calculation_number: 'Numer zaakceptowanej kalkulacji',
  accepted_calculation_name: 'Nazwa zaakceptowanej kalkulacji',
  executor_name: 'Nazwa wykonawcy',
  executor_address: 'Ulica i numer wykonawcy',
  executor_postal_code: 'Kod pocztowy wykonawcy',
  executor_city: 'Miasto wykonawcy',
  executor_nip: 'NIP wykonawcy',
  executor_regon: 'REGON wykonawcy',
  executor_krs: 'KRS wykonawcy',
  executor_phone: 'Telefon wykonawcy',
  executor_email: 'E-mail wykonawcy',
  executor_website: 'Strona internetowa wykonawcy',
  executor_bank_account: 'Numer rachunku wykonawcy',
  executor_bank_name: 'Nazwa banku wykonawcy',
  executor_representative_name: 'Reprezentant wykonawcy',
  executor_representative_title: 'Stanowisko reprezentanta wykonawcy',
  offer_number: 'Numer oferty',
  offer_valid_until: 'Termin ważności oferty',
  offer_scope: 'Zakres oferty',
};

export const normalizeVariableSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .trim();

/** Pole z treścią HTML (bloki stron, klauzule, tabele) — edytor wizualny zamiast pola tekstowego. */
export const isEventContractHtmlField = (key: string, variables: Record<string, string>) =>
  /<[a-z][\s\S]*>/i.test(variables[key] || '') ||
  key.endsWith('_block') || key.startsWith('contract_clauses_') ||
  ['offer_items', 'OFFER_ITEMS_TABLE', 'legal_representatives_list', 'decision_makers_list'].includes(key);

/** Dłuższe pole tekstowe (kilka wierszy). */
export const isEventContractLongField = (key: string, value: string) =>
  value.length > 100 ||
  ['client_representation_rule', 'client_representation_basis', 'offer_scope'].includes(key);

/** Pola `{{…}}` użyte w aktualnej treści umowy razem z klauzulami (`usedContractVariableKeys`). */
export function eventContractUsedVariableKeys(
  eventContractClauseItems: EventContractClauseItem[],
  originalTemplate: string,
  productClauseSelections: Record<string, string>,
  variables: Record<string, string>,
) {
  // Liczy się aktualna treść, nie historyczne strony ani metadane szablonu.
  const { flowContent } = getContractDocumentParts(originalTemplate);
  const assembled = assembleContractClauses(
    eventContractClauseItems,
    flowContent,
    productClauseSelections,
  );
  const placement = placeContractClauses(assembled.flowContent, {
    ...variables,
    ...assembled.sections,
  });
  const usedKeys = new Set<string>();
  const collectVariableKeys = (html: string) => {
    for (const match of html.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
      const key = match[1];
      if (usedKeys.has(key)) continue;
      usedKeys.add(key);
      // Sprawdzamy tylko klauzule użyte w dokumencie, przed podmianą ich zmiennych.
      if (key.startsWith('contract_clauses_')) {
        collectVariableKeys(placement.variables[key] || '');
      }
    }
  };
  collectVariableKeys(flowContent);
  collectVariableKeys(placement.flowContent);
  return usedKeys;
}

/** Warunki szablonu ustawiane w tej umowie: rodzaj klienta i opcje (`contractConditionSettings`). */
export function eventContractConditionSettings(originalTemplate: string) {
  const { flowContent } = getContractDocumentParts(originalTemplate);
  const names = contractConditionVariableNames(flowContent);
  let options: ReturnType<typeof resolveContractOptions> = [];
  try {
    options = resolveContractOptions(JSON.parse(originalTemplate)?.settings);
  } catch {
    options = [];
  }
  const client = names.has(CONTRACT_CLIENT_VARIABLE);
  return {
    client,
    options,
    keys: [...(client ? [CONTRACT_CLIENT_VARIABLE] : []), ...options.map((option) => contractOptionVariable(option.key))],
  };
}

/** Pola do ręcznej edycji w tej umowie (`editableContractVariables`): nazwa, wartość, wyszukiwanie. */
export function eventContractEditableVariables(
  usedContractVariableKeys: Set<string>,
  editedVariables: Record<string, string>,
  variableSearch: string,
) {
  const normalizedSearch = normalizeVariableSearch(variableSearch);

  return Array.from(usedContractVariableKeys)
    .map((key) => ({
      key,
      value: editedVariables[key] || '',
      label: CONTRACT_VARIABLE_LABELS[key] || key,
    }))
    .filter(({ label, key }) =>
      normalizedSearch ? normalizeVariableSearch(`${label} ${key}`).includes(normalizedSearch) : true,
    )
    .sort((left, right) => left.label.localeCompare(right.label, 'pl'));
}

/** Uwagi przed wystawieniem umowy (`contractPreflightIssues`): dane klienta i reprezentacji, pola i źródło zakresu. */
export function eventContractPreflightIssues({
  originalTemplate,
  selectedTemplateId,
  unresolvedProductClauseConflicts,
  usedContractVariableKeys,
  variables,
}: {
  originalTemplate: string;
  selectedTemplateId: string | null;
  unresolvedProductClauseConflicts: ProductClauseConflict[];
  usedContractVariableKeys: Set<string>;
  variables: Record<string, string>;
}) {
  const issues: ContractPreflightIssue[] = [];
  if (
    (usedContractVariableKeys.has('executor_contract_party_block') ||
      usedContractVariableKeys.has('executor_representative_name')) &&
    !variables.executor_representative_name?.trim()
  ) {
    issues.push({
      key: 'executor-representative',
      label: 'Uzupełnij reprezentanta firmy realizującej wydarzenie w danych tej firmy.',
      severity: 'blocker',
    });
  }
  const organizationId = variables.client_organization_id;
  const organizationHref = organizationId
    ? `/crm/contacts/${organizationId}?tab=details`
    : undefined;

  if (organizationId) {
    const organizationAddressComplete = Boolean(
      variables.organization_address &&
        variables.organization_postal_code &&
        variables.organization_city,
    );
    const signerCount = Number(variables.legal_representatives_count || 0);
    const representationType = variables.client_representation_type;
    const registryProfile = variables.organization_registry_profile;
    const requiresKrs = variables.organization_requires_krs === 'true';

    if (!variables.organization_legal_form_raw) {
      issues.push({
        key: 'organization-legal-form',
        label: 'Wybierz formę prawną lub typ podmiotu klienta.',
        severity: 'blocker',
        actionHref: organizationHref,
        actionLabel: 'Dane organizacji',
      });
    }

    if (!organizationAddressComplete) {
      issues.push({
        key: 'organization-address',
        label: 'Uzupełnij pełny adres rejestrowy organizacji: ulicę, kod pocztowy i miasto.',
        severity: 'blocker',
        actionHref: organizationHref,
        actionLabel: 'Dane organizacji',
      });
    }
    if (requiresKrs && !variables.organization_krs_raw) {
      issues.push({
        key: 'organization-krs',
        label: 'Numer KRS jest wymagany dla wybranej formy prawnej.',
        severity: 'blocker',
        actionHref: organizationHref,
        actionLabel: 'Dane organizacji',
      });
    }
    if (signerCount < 1) {
      const representativeLabel =
        registryProfile === 'ceidg'
          ? 'Wskaż właściciela ujawnionego w CEIDG albo pełnomocnika uprawnionego do zawarcia umowy.'
          : registryProfile === 'civil_partnership'
            ? 'Wskaż wspólnika albo pełnomocnika uprawnionego do zawarcia umowy.'
            : registryProfile === 'institution'
              ? 'Wskaż dyrektora, kierownika albo pełnomocnika uprawnionego do zawarcia umowy.'
              : registryProfile === 'krs'
                ? 'Wskaż osobę lub osoby uprawnione do reprezentacji zgodnie z KRS.'
                : 'Wskaż osobę uprawnioną do działania w imieniu podmiotu.';
      issues.push({
        key: 'legal-representative',
        label: representativeLabel,
        severity: 'blocker',
        actionHref: organizationHref,
        actionLabel: 'Reprezentanci',
      });
    }
    if (
      registryProfile === 'krs' &&
      (
        !representationType ||
        !variables.client_representation_rule ||
        !variables.client_representation_basis ||
        !variables.client_representation_verified_at_raw
      )
    ) {
      issues.push({
        key: 'representation-method',
        label:
          'Uzupełnij typ i dokładny sposób reprezentacji, podstawę oraz datę weryfikacji w Dziale 2 KRS.',
        severity: 'blocker',
        actionHref: organizationHref,
        actionLabel: 'Sposób reprezentacji',
      });
    }
    if (['joint', 'joint_with_proxy'].includes(representationType) && signerCount < 2) {
      issues.push({
        key: 'joint-representation',
        label:
          'Wybrano reprezentację łączną, ale wskazano mniej niż dwie osoby uprawnione do podpisu.',
        severity: 'blocker',
        actionHref: organizationHref,
        actionLabel: 'Dodaj współreprezentanta',
      });
    }
    if (
      registryProfile === 'krs' &&
      originalTemplate &&
      ![
        'client_contract_party_block',
        'client_representation_block',
        'client_representation_rule',
      ].some((placeholder) => originalTemplate.includes(placeholder))
    ) {
      issues.push({
        key: 'representation-placeholder',
        label:
          'Szablon nie wyświetla sposobu reprezentacji. Dodaj pełne dane strony klienta albo blok reprezentacji.',
        severity: 'blocker',
        actionHref: selectedTemplateId
          ? `/crm/contract-templates/${selectedTemplateId}/edit-wysiwyg`
          : undefined,
        actionLabel: 'Edytuj szablon',
      });
    }
    if (
      ['joint', 'joint_with_proxy'].includes(representationType) &&
      originalTemplate &&
      !['client_contract_party_block', 'legal_representatives_list'].some((placeholder) =>
        originalTemplate.includes(placeholder),
      )
    ) {
      issues.push({
        key: 'joint-signers-placeholder',
        label:
          'Szablon reprezentacji łącznej nie wyświetla wszystkich osób podpisujących.',
        severity: 'blocker',
        actionHref: selectedTemplateId
          ? `/crm/contract-templates/${selectedTemplateId}/edit-wysiwyg`
          : undefined,
        actionLabel: 'Edytuj szablon',
      });
    }
    if (!variables.primary_contact_full_name) {
      issues.push({
        key: 'primary-contact',
        label: 'Wskaż główną osobę kontaktową po stronie klienta.',
        severity: 'warning',
        actionHref: organizationHref,
        actionLabel: 'Osoba kontaktowa',
      });
    }
  }

  if (
    usedContractVariableKeys.has('termin_dostarczenia_materialow') &&
    !variables.termin_dostarczenia_materialow?.trim()
  ) {
    issues.push({
      key: 'materials-deadline',
      label: 'Uzupełnij termin dostarczenia materiałów w edycji zmiennych umowy.',
      severity: 'blocker',
    });
  }

  if (!variables.accepted_calculation_number && !variables.offer_number) {
    issues.push({
      key: 'accepted-source',
      label: 'Brak zaakceptowanej oferty lub kalkulacji stanowiącej źródło zakresu umowy.',
      severity: 'warning',
    });
  }
  if (variables.offer_number && variables.offer_status !== 'accepted') {
    issues.push({
      key: 'working-offer-source',
      label: `Draft korzysta z aktualnej oferty roboczej ${variables.offer_number}. Przed finalizacją sprawdź, czy jej zakres jest zatwierdzony.`,
      severity: 'warning',
      actionHref: variables.offer_id ? `/crm/offers/${variables.offer_id}` : undefined,
      actionLabel: 'Otwórz ofertę',
    });
  }

  if (unresolvedProductClauseConflicts.length > 0) {
    issues.push({
      key: 'product-clause-type-conflicts',
      label: `Rozstrzygnij rozbieżne wersje wspólnych ustaleń (${unresolvedProductClauseConflicts.length}).`,
      severity: 'blocker',
    });
  }

  return issues;
}

/**
 * „Zapisz” w edycji pól i warunków (`handleSave`): nadpisania tej umowy, kwoty słownie, klauzule na swoich miejscach
 * i nowa treść stron z zaznaczeniem indywidualnej edycji. Zwraca wynik bez zapisu — zapis szkicu robi wywołujący.
 */
export async function buildEventContractFieldsUpdate({
  variables,
  editedVariables,
  variableOverrides,
  editableKeys,
  originalTemplate,
  eventContractClauseItems,
  productClauseSelections,
  selectedClientSignerIds,
}: {
  variables: Record<string, string>;
  editedVariables: Record<string, string>;
  variableOverrides: Record<string, string>;
  /** Pola użyte w treści i klucze warunków (`usedContractVariableKeys` + `contractConditionSettings.keys`). */
  editableKeys: Iterable<string>;
  originalTemplate: string;
  eventContractClauseItems: EventContractClauseItem[];
  productClauseSelections: Record<string, string>;
  selectedClientSignerIds: string[];
}) {
  const overrides = { ...variableOverrides };
  new Set(editableKeys).forEach((key) => {
    if ((editedVariables[key] || '') !== (variables[key] || '')) overrides[key] = editedVariables[key] || '';
  });
  const updatedVariables = { ...editedVariables };

  const extractNumber = (value: string) => {
    if (!value) return 0;
    const cleaned = value
      .replace(/\s/g, '')
      .replace(',', '.')
      .replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.round(num * 100) / 100;
  };

  const syncAmountInWords = (amountKey: string, wordsKey: string) => {
    if (!updatedVariables[amountKey] || Object.prototype.hasOwnProperty.call(overrides, wordsKey)) return;
    updatedVariables[wordsKey] = numberToWords(extractNumber(updatedVariables[amountKey]));
  };

  syncAmountInWords('budget', 'budget_words');
  syncAmountInWords('budget_netto', 'budget_netto_words');
  syncAmountInWords('budget_brutto', 'budget_brutto_words');

  if (updatedVariables.deposit_amount && !Object.prototype.hasOwnProperty.call(overrides, 'deposit_words')) {
    const depositNum = extractNumber(updatedVariables.deposit_amount);
    updatedVariables.deposit_words = numberToWords(depositNum);
  }

  let finalVariables = updatedVariables;
  let contractContent = '';
  let unplacedClauseCategories: string[] | null = null;

  try {
    const parsed = JSON.parse(originalTemplate);
    if (parsed.pages && Array.isArray(parsed.pages)) {
      const assembled = assembleContractClauses(
        eventContractClauseItems,
        parsed.flowContent || parsed.pages.join(''),
        productClauseSelections,
      );
      Object.entries(assembled.sections).forEach(([key, value]) => {
        if (!Object.prototype.hasOwnProperty.call(overrides, key)) updatedVariables[key] = replaceVariables(value, updatedVariables);
      });
      Object.assign(updatedVariables, overrides);
      const placement = placeContractClauses(assembled.flowContent, updatedVariables, Object.keys(overrides));
      Object.assign(updatedVariables, placement.variables);
      unplacedClauseCategories = placement.unplacedClauseCategories;
      finalVariables = { ...updatedVariables };
      const renderedContract = await renderContractDocument(
        replaceVariables(
          includeContractFonts(placement.flowContent, updatedVariables),
          updatedVariables,
        ),
        parsed.settings || {},
      );
      contractContent = JSON.stringify({
        ...renderedContract,
        meta: {
          ...(parsed.meta || {}),
          individuallyEdited: true,
          editSource: 'variables',
          variableOverrides: overrides,
          clientContractSignerIds: selectedClientSignerIds,
          termin_dostarczenia_materialow: updatedVariables.termin_dostarczenia_materialow || '',
        },
      });
    } else if (Array.isArray(parsed)) {
      const pages = parsed.map((page: string) => replaceVariables(page, updatedVariables));
      contractContent = JSON.stringify(pages);
    } else {
      contractContent = replaceVariables(originalTemplate, updatedVariables);
    }
  } catch {
    contractContent = replaceVariables(originalTemplate, updatedVariables);
  }

  return { overrides, variables: finalVariables, contractContent, unplacedClauseCategories };
}

/** Liczba z pola depozytu („30%”, „1 230,50 zł”). */
export const readContractDepositNumber = (value: string) => Number(value.replace(/\s/g, '').replace(',', '.').replace(/zł|%/g, ''));

/** „Zapisz depozyt”: procent od 0 do 100 albo kwota do wartości brutto umowy → pola depozytu (procent, kwota, słownie). */
export function eventContractDepositPatch(
  depositPercentInput: string,
  depositAmountInput: string,
  variables: Record<string, string>,
): { patch: Record<string, string> } | { error: string } {
  const readDepositNumber = readContractDepositNumber;
  const percent = readDepositNumber(depositPercentInput);
  const amount = readDepositNumber(depositAmountInput);
  const total = readDepositNumber(variables.budget_brutto || '0');
  if (!depositPercentInput.trim() || !depositAmountInput.trim() || !Number.isFinite(percent) || !Number.isFinite(amount) || total <= 0 || percent < 0 || percent > 100 || amount < 0 || amount > total) {
    return { error: 'Podaj procent od 0 do 100 lub kwotę nieprzekraczającą wartości brutto umowy.' };
  }
  const amountRounded = Math.round(amount * 100) / 100;
  return {
    patch: {
      deposit_percent: `${percent.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`,
      deposit_amount: amountRounded.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł',
      deposit_words: numberToWords(amountRounded),
    },
  };
}

/** Treść umowy po zmianie depozytu (`saveDeposit`): nadpisania, klauzule na swoich miejscach, strony. */
export async function buildEventContractDepositContent({
  patch,
  variables,
  variableOverrides,
  originalTemplate,
  eventContractClauseItems,
  productClauseSelections,
  selectedClientSignerIds,
}: {
  patch: Record<string, string>;
  variables: Record<string, string>;
  variableOverrides: Record<string, string>;
  originalTemplate: string;
  eventContractClauseItems: EventContractClauseItem[];
  productClauseSelections: Record<string, string>;
  selectedClientSignerIds: string[];
}) {
  const overrides = { ...variableOverrides, ...patch };
  const updated: Record<string, string> = { ...variables, ...patch };
  const parsed = JSON.parse(originalTemplate);
  const assembled = assembleContractClauses(eventContractClauseItems, parsed.flowContent || parsed.pages.join(''), productClauseSelections);
  Object.entries(assembled.sections).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) updated[key] = replaceVariables(value, updated);
  });
  const placement = placeContractClauses(assembled.flowContent, updated, Object.keys(overrides));
  Object.assign(updated, placement.variables);
  const rendered = await renderContractDocument(replaceVariables(includeContractFonts(placement.flowContent, updated), updated), parsed.settings || {});
  const content = JSON.stringify({ ...rendered, meta: { ...(parsed.meta || {}), individuallyEdited: true, editSource: 'variables', variableOverrides: overrides, clientContractSignerIds: selectedClientSignerIds } });
  return { content, updated, overrides };
}
