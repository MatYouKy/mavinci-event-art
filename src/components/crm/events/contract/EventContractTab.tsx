/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Download,
  CreditCard as Edit,
  Save,
  X,
  Mail,
  Eye,
  Loader,
  Printer,
  FilePenLine,
  RefreshCw,
  ShieldAlert,
  ExternalLink,
  Sparkles,
  Search,
  ListChecks,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { numberToWords, replaceVariables } from '@/lib/offerTemplateHelpers';
import '@/styles/contractA4.css';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import SendContractEmailModal from '@/components/crm/SendContractEmailModal';
import { UnifiedContact } from '@/store/slices/contactsSlice';
import { ILocation } from '@/app/(crm)/crm/locations/type';
import { Organization } from '@/app/(crm)/crm/contacts/[id]/page';
import {
  getContractCssForPrint,
  getContractDocumentCss,
} from '../calculations/helpers/getContractCssForPrint';
import { renderContractDocument } from '@/lib/CRM/contracts/contractPagination';
import {
  normalizeContractClauseHtml,
  normalizeContractClausePointListHtml,
  parseContractClauseEntries,
  stripProductNameHeadingFromClauseHtml,
  getContractClauseTopicLabel,
  inferContractClauseTopic,
  type ContractClauseCategory,
  type ContractClausePrimaryCategory,
} from '@/lib/CRM/contracts/contractClauseContent';
import {
  buildEventContractClauseItems,
  parseEventContractClauseOverrides,
  serializeEventContractClauseItems,
  type EventContractClauseItem,
} from '@/lib/CRM/contracts/eventContractClauseOverrides';
import { assembleContractClauses, contractClauseSourceFingerprint, getSharedClauseConflicts } from '@/lib/CRM/contracts/contractClauseAssembly';
import { CONTRACT_STRUCTURE_VERSION, getSharedContractClauseForText } from '@/lib/CRM/contracts/sharedContractClauses';
import { placeContractClauses } from '@/lib/CRM/contracts/contractClauseSlots';
import { createContractDraftPdf } from '@/app/(crm)/crm/contract-templates/printDraft';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';
import { getCalculationNumber } from '@/lib/CRM/calculations/calculationNumber';
import {
  buildOfferRequirements,
  splitOfferRequirementLines,
  type OfferRequirementEntry,
} from '@/lib/CRM/Offers/offerRequirements';
import ContractAuditReviewModal from './ContractAuditReviewModal';
import EventContractClausesModal from './EventContractClausesModal';
import CancelContractModal from './CancelContractModal';
import SignedContractAttachments from './SignedContractAttachments';
import {
  applyContractAuditDecisions,
  extractContractAuditBlocks,
  getContractDocumentParts,
  type ContractAuditBlock,
  type ContractAuditResult,
} from '@/lib/CRM/contracts/contractAudit';
import {
  getLegalFormDisplayLabel,
  getOrganizationRegistryProfile,
  getRepresentationIntro,
  requiresKrsForLegalForm,
  resolveOrganizationLegalForm,
} from '@/lib/organizations/organizationLegalForm';

export interface DecisionMaker {
  id: string;
  title: string;
  can_sign_contracts: boolean;
  notes: string;
  contact: UnifiedContact;
}

type ContractPreflightIssue = {
  key: string;
  label: string;
  severity: 'blocker' | 'warning';
  actionHref?: string;
  actionLabel?: string;
};

type ContractAuditReviewState = {
  audit: ContractAuditResult;
  blocks: ContractAuditBlock[];
  sourceContent: string;
};

type ProductClauseCandidate = {
  id: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  title: string;
  productName: string;
  html: string;
  preview: string;
  sharedKey?: string;
  legacyOverrideId?: string;
};

type ProductClauseConflict = {
  key: string;
  category: ContractClausePrimaryCategory;
  topic: string;
  candidates: EventContractClauseItem[];
};

const CONTRACT_VARIABLE_LABELS: Record<string, string> = {
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

const NON_EDITABLE_CONTRACT_VARIABLES = new Set([
  '__contract_font_faces',
  'client_organization_id',
  'organization_krs_raw',
  'organization_legal_form_raw',
  'organization_registry_profile',
  'organization_requires_krs',
  'legal_representatives_list',
  'legal_representatives_count',
  'client_representation_type',
  'client_representation_verified_at_raw',
  'client_representation_block',
  'decision_makers_list',
  'client_contract_party_block',
  'executor_contract_party_block',
  'accepted_calculation_reference',
  'contract_source_references',
  'contract_scope_source_reference',
  'offer_id',
  'offer_status',
  'offer_is_accepted',
  'offer_items',
  'OFFER_ITEMS_TABLE',
]);

const normalizeVariableSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .trim();

const CONTRACT_REQUIREMENT_TOPIC_BY_OFFER_CATEGORY: Record<string, string> = {
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

const CONTRACT_ADDITIONAL_REQUIREMENT_TOPICS = new Set([
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

const parseStoredOfferRequirements = (value: unknown): OfferRequirementEntry[] => {
  if (Array.isArray(value)) return value as OfferRequirementEntry[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as OfferRequirementEntry[] : [];
  } catch {
    return [];
  }
};

const mapOfferRequirementToContractTopic = (
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

const REPRESENTATION_TYPE_LABELS: Record<string, string> = {
  sole: 'reprezentacja samodzielna',
  joint: 'reprezentacja łączna',
  joint_with_proxy: 'reprezentacja łączna z prokurentem',
  proxy: 'reprezentacja przez pełnomocnika lub prokurenta',
  other: 'inny sposób reprezentacji',
};

const formatPrefixedValue = (
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

const escapeContractText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const contractValueHtml = (value: string | number) =>
  `<strong data-contract-value="true" style="font-weight:700 !important;">${escapeContractText(
    String(value),
  )}</strong>`;

const contractRepresentativeTitleHtml = (value: string) => {
  // Korygujemy wyłącznie błędną etykietę, bez zgadywania rodzaju prokury.
  // Pozostałe stanowiska i dane zapisane w kartotece pozostają bez zmian.
  const title = value.trim().replace(/^prokurent\s+zarządu\.?$/iu, 'prokurent');
  return `<em style="font-weight:400 !important;font-style:italic !important;">${escapeContractText(title)}</em>`;
};

const multilineContractTextHtml = (value: string | null | undefined) =>
  String(value || '')
    .split(/\r?\n/)
    .map((line) => escapeContractText(line))
    .join('<br>');

const compactContractParts = (parts: Array<string | null | undefined>) =>
  parts.map((part) => String(part || '').trim()).filter(Boolean);

const joinRawContractParts = (
  parts: Array<string | null | undefined>,
  separator = ', ',
) => compactContractParts(parts).join(separator);

const joinContractParts = (
  parts: Array<string | null | undefined>,
  separator = ', ',
) => escapeContractText(joinRawContractParts(parts, separator));

const CONTRACT_CLAUSE_CATEGORY_LABELS: Record<string, string> = {
  conditions: 'warunki realizacji',
  requirements: 'wymagania organizacyjne i techniczne',
  obligations: 'obowiązki zamawiającego',
  risks: 'ryzyka i odpowiedzialność',
  additional_requirements: 'wymagania dodatkowe',
  general: 'postanowienia dodatkowe',
};

const EVENT_CONTRACT_CLAUSE_CATEGORY_ORDER: ContractClauseCategory[] = [
  'conditions',
  'requirements',
  'obligations',
  'risks',
  'additional_requirements',
  'general',
];

const normalizeClauseComparisonText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[„”"'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const deduplicateExactClauseItemsInSection = (section: HTMLElement) => {
  const seenItems = new Set<string>();
  const topLevelItems = Array.from(section.querySelectorAll<HTMLLIElement>('li')).filter(
    (item) => !item.parentElement?.closest('li'),
  );

  topLevelItems.forEach((item) => {
    const signature = normalizeClauseComparisonText(item.textContent || '');
    if (!signature) return;
    if (seenItems.has(signature)) item.remove();
    else seenItems.add(signature);
  });

  section.querySelectorAll('ol, ul').forEach((list) => {
    if (!list.querySelector(':scope > li')) list.remove();
  });
  section.querySelectorAll<HTMLElement>('.product-contract-clause').forEach((clause) => {
    if (!clause.textContent?.trim()) clause.remove();
  });
};

const deduplicateProductClauseSections = (html: string) => {
  if (typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  // Starsze wersje automatycznie dopisywały klauzule na końcu szablonu bez
  // zadeklarowanych obszarów. Taki fallback nie jest częścią indywidualnej
  // treści umowy i nie może wracać ze starego snapshotu.
  container
    .querySelectorAll('[data-auto-product-clauses="true"]')
    .forEach((section) => section.remove());
  container
    .querySelectorAll<HTMLElement>('.contract-product-clauses')
    .forEach(deduplicateExactClauseItemsInSection);
  const seenSections = new Set<string>();
  container.querySelectorAll<HTMLElement>('.contract-product-clauses').forEach((section) => {
    const signature = section.innerHTML.replace(/\s+/g, ' ').trim();
    if (seenSections.has(signature)) section.remove();
    else seenSections.add(signature);
  });
  return container.innerHTML;
};

const includeContractFonts = (flow: string, variables: Record<string, string>) => {
  // Wsteczna kompatybilność: usuń style zapisane dawniej w treści umowy.
  // Fonty są ładowane do document.fonts i przekazywane jako CSS do generatora PDF.
  return flow.replace(
    /<style\b[^>]*data-contract-fonts[^>]*>[\s\S]*?<\/style>/gi,
    '',
  );
};


const getTemplateSettings = (pageSettings: any) => ({
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
});

type EventCompanyBranding = {
  company: any;
  logoUrl: string | null;
  logoUrls: string[];
};

const resolveCompanyLogoUrl = (value?: string | null) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
};

const applyEventCompanyBranding = (
  settings: ReturnType<typeof getTemplateSettings>,
  branding: EventCompanyBranding | null,
) => {
  if (!branding) return settings;
  const { company, logoUrl, logoUrls } = branding;
  const normalizedCompanyLogos = new Set(logoUrls.filter(Boolean));
  const savedHeaderLogo = resolveCompanyLogoUrl(settings.selectedLogo);
  const savedFooterLogo = resolveCompanyLogoUrl(settings.footerContent?.logoUrl);
  const fallbackLogo = logoUrl || resolveCompanyLogoUrl(company.logo_url) || settings.selectedLogo;
  const selectedLogo =
    savedHeaderLogo && normalizedCompanyLogos.has(savedHeaderLogo)
      ? savedHeaderLogo
      : fallbackLogo;
  const selectedFooterLogo =
    savedFooterLogo && normalizedCompanyLogos.has(savedFooterLogo)
      ? savedFooterLogo
      : selectedLogo;
  const hasExplicitFooterTemplate = Boolean(settings.selectedFooterTemplateId);

  return {
    ...settings,
    selectedLogo,
    footerContent: hasExplicitFooterTemplate
      ? {
          ...settings.footerContent,
          logoUrl: settings.footerContent?.logoUrl || selectedLogo,
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



type OrganizationWithRelations = Organization & {
  legal_representative?: UnifiedContact | null;
  primary_contact?: UnifiedContact | null;
};

type ContractStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'signed_by_client'
  | 'signed_returned'
  | 'cancelled';

export function EventContractTab({ eventId }: { eventId: string }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { isAdmin, employee } = useCurrentEmployee();
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [contractContent, setContractContent] = useState('');
  const [originalTemplate, setOriginalTemplate] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [editedVariables, setEditedVariables] = useState<Record<string, string>>({});
  const [variableSearch, setVariableSearch] = useState('');
  const [contractStatus, setContractStatus] = useState<ContractStatus>('draft');
  const [preflightAcknowledgements, setPreflightAcknowledgements] = useState<{
    context: string;
    keys: string[];
  }>({ context: '', keys: [] });
  const [contractId, setContractId] = useState<string | null>(null);
  const [contractVersion, setContractVersion] = useState(1);
  const [contractLockedAt, setContractLockedAt] = useState<string | null>(null);
  const [companySignedAt, setCompanySignedAt] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [showCancelContractModal, setShowCancelContractModal] = useState(false);
  const [contractCreatedBy, setContractCreatedBy] = useState<string | null>(null);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isPrintingDraft, setIsPrintingDraft] = useState(false);
  const [clientEmail, setClientEmail] = useState('');
  const [clientName, setClientName] = useState('');
  const [statusDates, setStatusDates] = useState<{
    issued_at?: string;
    sent_at?: string;
    signed_by_client_at?: string;
    signed_returned_at?: string;
    cancelled_at?: string;
  }>({});
  const [generatedPdfPath, setGeneratedPdfPath] = useState<string | null>(null);
  const [modifiedAfterGeneration, setModifiedAfterGeneration] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [eventCompanyBranding, setEventCompanyBranding] =
    useState<EventCompanyBranding | null>(null);
  const [contractFontFaceCss, setContractFontFaceCss] = useState('');
  const [sourceContractContent, setSourceContractContent] = useState('');
  const [contractSourceOutdated, setContractSourceOutdated] = useState(false);
  const [unplacedClauseCategories, setUnplacedClauseCategories] = useState<string[]>([]);
  const [isAuditingContract, setIsAuditingContract] = useState(false);
  const [isApplyingContractAudit, setIsApplyingContractAudit] = useState(false);
  const [contractAuditReview, setContractAuditReview] =
    useState<ContractAuditReviewState | null>(null);
  const [productClauseConflicts, setProductClauseConflicts] =
    useState<ProductClauseConflict[]>([]);
  const [productClauseSelections, setProductClauseSelections] =
    useState<Record<string, string>>({});
  const [productClauseSelectionDraft, setProductClauseSelectionDraft] =
    useState<Record<string, string>>({});
  const [isApplyingProductClauseSelections, setIsApplyingProductClauseSelections] =
    useState(false);
  const [eventContractClauseItems, setEventContractClauseItems] =
    useState<EventContractClauseItem[]>([]);
  const [showEventContractClauses, setShowEventContractClauses] = useState(false);
  const [isSavingEventContractClauses, setIsSavingEventContractClauses] = useState(false);

  const unresolvedProductClauseConflicts = useMemo(
    () =>
      productClauseConflicts.filter(
        (conflict) => !productClauseSelections[conflict.key],
      ),
    [productClauseConflicts, productClauseSelections],
  );

  const usedContractVariableKeys = useMemo(() => {
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
    collectVariableKeys(placement.flowContent);
    return usedKeys;
  }, [eventContractClauseItems, originalTemplate, productClauseSelections, variables]);

  const editableContractVariables = useMemo(() => {
    const normalizedSearch = normalizeVariableSearch(variableSearch);

    return Object.entries(editedVariables)
      .filter(
        ([key]) =>
          usedContractVariableKeys.has(key) &&
          !NON_EDITABLE_CONTRACT_VARIABLES.has(key) &&
          !key.startsWith('contract_clauses_') &&
          Boolean(CONTRACT_VARIABLE_LABELS[key]),
      )
      .map(([key, value]) => ({
        key,
        value,
        label: CONTRACT_VARIABLE_LABELS[key],
      }))
      .filter(({ label }) =>
        normalizedSearch ? normalizeVariableSearch(label).includes(normalizedSearch) : true,
      )
      .sort((left, right) => left.label.localeCompare(right.label, 'pl'));
  }, [editedVariables, usedContractVariableKeys, variableSearch]);

  const contractAuditSensitiveValues = useMemo(() => {
    const identityKey =
      /(client|organization|contact|representative|executor|seller|customer|company|primary_|legal_)/i;

    return Object.entries(variables)
      .filter(([key]) => identityKey.test(key))
      .flatMap(([, value]) => {
        const plainValue = String(value || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return [plainValue, ...plainValue.split(/[,;|]/g).map((part) => part.trim())];
      })
      .filter((value, index, values) => value.length >= 4 && values.indexOf(value) === index);
  }, [variables]);

  const contractPreflightIssues = useMemo<ContractPreflightIssue[]>(() => {
    const issues: ContractPreflightIssue[] = [];
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
  }, [
    originalTemplate,
    selectedTemplateId,
    unresolvedProductClauseConflicts,
    usedContractVariableKeys,
    variables,
  ]);

  // Zgoda jest lokalna dla aktualnego dokumentu i użytkownika, nie wyłącza
  // walidacji globalnie. Zmieniona treść, dane lub uwagi wymagają nowej zgody.
  const preflightAcknowledgementContext = useMemo(() => JSON.stringify([
    eventId,
    employee?.id,
    selectedTemplateId || templateId,
    contractVersion,
    contractContent,
    variables,
    contractPreflightIssues,
  ]), [eventId, employee?.id, selectedTemplateId, templateId, contractVersion,
    contractContent, variables, contractPreflightIssues]);

  const isPreflightIssueAcknowledged = (key: string) =>
    preflightAcknowledgements.context === preflightAcknowledgementContext
    && preflightAcknowledgements.keys.includes(key);

  const acknowledgePreflightIssue = (key: string, checked: boolean) => {
    setPreflightAcknowledgements((current) => {
      const keys = current.context === preflightAcknowledgementContext ? current.keys : [];
      return {
        context: preflightAcknowledgementContext,
        keys: checked ? [...new Set([...keys, key])] : keys.filter((item) => item !== key),
      };
    });
  };

  const ensureContractPreflight = (action: string) => {
    // Uwagi sprawdzamy przy finalizacji szkicu, nie przy dalszej obsłudze
    // dokumentu, który został już wystawiony lub podpisany.
    if (!['draft', 'cancelled'].includes(contractStatus)) return true;
    const blockers = contractPreflightIssues.filter((issue) =>
      issue.severity === 'blocker' && !isPreflightIssueAcknowledged(issue.key));
    if (blockers.length === 0) return true;
    showSnackbar(
      `Przed ${action} uzupełnij dane albo potwierdź zapoznanie się z pozostałymi uwagami (${blockers.length}) nad podglądem umowy.`,
      'error',
    );
    return false;
  };

  useEffect(() => {
    fetchContractData();
    fetchAvailableTemplates();
  }, [eventId]);

  const fetchAvailableTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('contract_templates')
        .select('id, name')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) throw error;
      setAvailableTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  const fetchContractData = async (
    clauseSelectionOverride?: Record<string, string>,
    replaceExistingContent = false,
    templateIdOverride?: string,
  ) => {
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
          const { data: companyLogos } = await supabase
            .from('company_brandbook_logos')
            .select('url, is_default, order_index')
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
          resolvedCompanyBranding = {
            company,
            logoUrl: resolveCompanyLogoUrl(logoPath),
            logoUrls: companyLogoUrls,
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
          'id, template_id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content, version_number, locked_at, company_signed_at',
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
            'id, template_id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content',
          )
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        existingContract = fallbackResult.data as typeof existingContract;
      }

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
      const organizationRepresentationIntro = getRepresentationIntro({
        profile: organizationRegistryProfile,
        legalForm: resolvedOrganizationLegalForm,
        name: organization?.name,
      });
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
        const { flowContent } = placeContractClauses(baseFlow, variables);
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
      const fallbackBudget = Number(event.budget || 0);
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
      const depositPercent = 50;
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
      // Terminy zapisane bezpośrednio przy wydarzeniu mają pierwszeństwo.
      // Jeśli ich nie ma, umowa korzysta z początku odpowiedniej fazy.
      const resolvedPlannedSetupAt =
        event.planned_setup_at || setupPhase?.start_time || null;
      const resolvedPlannedTeardownAt =
        event.planned_teardown_at || teardownPhase?.start_time || null;

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
      const clientSigningAuthorizationText =
        legalSigners.length > 1
          ? 'osoby upoważnione do podpisywania dokumentów'
          : 'osoba upoważniona do podpisywania dokumentów';
      const registryHtml =
        organizationRegistryProfile === 'ceidg'
          ? `, rejestr: ${contractValueHtml('CEIDG')}`
          : '';
      const clientContractPartyBlock = organization
        ? `<span data-contract-party="client" style="font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;font-weight:400 !important;">${contractValueHtml(
            organization.name,
          )}${organizationAddress ? `, adres: ${contractValueHtml(organizationAddress)}` : ''}${
            organization.nip ? `, NIP: ${contractValueHtml(organization.nip)}` : ''
          }${organization.regon ? `, REGON: ${contractValueHtml(organization.regon)}` : ''}${
            organization.krs ? `, KRS: ${contractValueHtml(organization.krs)}` : ''
          }${registryHtml}${
            legalRepresentativesListHtml
              ? `, ${organizationRepresentationIntro} ${legalRepresentativesListHtml}, ${clientSigningAuthorizationText}`
              : ''
          }.</span>`
        : `<span data-contract-party="client" style="font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;font-weight:400 !important;">${contractValueHtml(
            contact?.full_name ||
              compactContractParts([contact?.first_name, contact?.last_name]).join(' ') ||
              'Zleceniodawca',
          )}${contactAddress ? `, adres: ${contractValueHtml(contactAddress)}` : ''}${
            contact?.pesel ? `, PESEL: ${contractValueHtml(contact.pesel)}` : ''
          }.</span>`;

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
        executorCompany?.signature_name || 'Mateusz Kwiatkowski';
      const executorRepresentativeTitle = executorCompany?.signature_title || '';
      const executorContractPartyBlock = `<span data-contract-party="executor" style="font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;font-weight:400 !important;">${contractValueHtml(
        executorCompany?.legal_name || executorCompany?.name || 'Mavinci Sp. z o.o.',
      )}${executorFullAddress ? `, adres: ${contractValueHtml(executorFullAddress)}` : ''}${
        executorCompany?.krs ? `, KRS: ${contractValueHtml(executorCompany.krs)}` : ''
      }${executorCompany?.nip ? `, NIP: ${contractValueHtml(executorCompany.nip)}` : ''}${
        executorCompany?.regon ? `, REGON: ${contractValueHtml(executorCompany.regon)}` : ''
      }, reprezentowaną przez: ${contractValueHtml(executorRepresentative)}${
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

      Object.entries(assembledClauses.sections).forEach(([key, value]) => {
        varsMap[key] = replaceVariables(value, varsMap);
      });
      const templateFlow = includeContractFonts(assembledClauses.flowContent, varsMap);
      const clausePlacement = placeContractClauses(templateFlow, varsMap);
      const flowWithAutomaticClauses = clausePlacement.flowContent;
      Object.assign(varsMap, clausePlacement.variables);
      setUnplacedClauseCategories(clausePlacement.unplacedClauseCategories);
      const sourceMeta = {
        contractStructureVersion: CONTRACT_STRUCTURE_VERSION,
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

      setVariables(varsMap);
      setEditedVariables(varsMap);
      let contentToSet = '';

      const currentSourceDocument = await renderContractDocument(
        replaceVariables(flowWithAutomaticClauses, varsMap),
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
            const renderedContract = await renderContractDocument(
              savedFlow,
              parsedContract.settings || templateSettings,
            );
            contentToSet = JSON.stringify({
              ...parsedContract,
              ...renderedContract,
            });
            setContractSourceOutdated(
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
      setContractContent(contentToSet);
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
    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
      if (replaceExistingContent) throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
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
      if (!updatedVariables[amountKey]) return;
      updatedVariables[wordsKey] = numberToWords(extractNumber(updatedVariables[amountKey]));
    };

    syncAmountInWords('budget', 'budget_words');
    syncAmountInWords('budget_netto', 'budget_netto_words');
    syncAmountInWords('budget_brutto', 'budget_brutto_words');

    if (updatedVariables.deposit_amount) {
      const depositNum = extractNumber(updatedVariables.deposit_amount);
      updatedVariables.deposit_words = numberToWords(depositNum);
    }

    setVariables(updatedVariables);
    setEditedVariables(updatedVariables);

    try {
      const parsed = JSON.parse(originalTemplate);
      if (parsed.pages && Array.isArray(parsed.pages)) {
        const assembled = assembleContractClauses(
          eventContractClauseItems,
          parsed.flowContent || parsed.pages.join(''),
          productClauseSelections,
        );
        Object.entries(assembled.sections).forEach(([key, value]) => {
          updatedVariables[key] = replaceVariables(value, updatedVariables);
        });
        const placement = placeContractClauses(assembled.flowContent, updatedVariables);
        Object.assign(updatedVariables, placement.variables);
        setUnplacedClauseCategories(placement.unplacedClauseCategories);
        setVariables({ ...updatedVariables });
        setEditedVariables({ ...updatedVariables });
        const renderedContract = await renderContractDocument(
          replaceVariables(
            includeContractFonts(placement.flowContent, updatedVariables),
            updatedVariables,
          ),
          parsed.settings || {},
        );
        setContractContent(
          JSON.stringify({
            ...renderedContract,
            meta: {
              ...(parsed.meta || {}),
              individuallyEdited: true,
              editSource: 'variables',
              termin_dostarczenia_materialow: updatedVariables.termin_dostarczenia_materialow || '',
            },
          }),
        );
      } else if (Array.isArray(parsed)) {
        const pages = parsed.map((page: string) => replaceVariables(page, updatedVariables));
        setContractContent(JSON.stringify(pages));
      } else {
        setContractContent(replaceVariables(originalTemplate, updatedVariables));
      }
    } catch {
      setContractContent(replaceVariables(originalTemplate, updatedVariables));
    }

    setEditMode(false);
    showSnackbar('Dane umowy zostały zaktualizowane', 'success');
  };

  const handleCancel = () => {
    setEditedVariables(variables);
    setEditMode(false);
  };

  const handleTemplateChange = async (newTemplateId: string) => {
    if (!newTemplateId) return;

    try {
      const templateUpdateResponse = await fetch('/bridge/events/contracts/template', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, templateId: newTemplateId }),
      });
      const templateUpdateResult = await templateUpdateResponse.json();

      if (!templateUpdateResponse.ok || templateUpdateResult.templateId !== newTemplateId) {
        throw new Error(
          templateUpdateResult.error || 'Nie udało się utrwalić wyboru szablonu.',
        );
      }

      // Zmiana szablonu korzysta z tej samej ścieżki co pierwsze generowanie.
      // Ponownie dobieramy klauzule do pól szablonu i wczytujemy jego wartości domyślne.
      await fetchContractData(undefined, true, newTemplateId);
      showSnackbar('Zmieniono szablon umowy', 'success');
    } catch (err) {
      console.error('Error changing template:', err);
      showSnackbar(
        err instanceof Error ? err.message : 'Błąd podczas zmiany szablonu',
        'error',
      );
    }
  };

  const ensureContractRecord = async (): Promise<string | null> => {
    if (contractId) return contractId;

    if (!templateId && !selectedTemplateId) {
      showSnackbar('Wybierz szablon umowy', 'error');
      return null;
    }

    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('contact_person_id, organization_id')
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      const clientId = eventData?.contact_person_id || eventData?.organization_id || null;
      const { data: newContract, error: createError } = await supabase
        .from('contracts')
        .insert({
          event_id: eventId,
          client_id: clientId,
          title: `Umowa dla eventu ${eventId}`,
          content: contractContent,
          status: 'draft',
          template_id: selectedTemplateId || templateId,
          created_by: employee?.id || null,
        })
        .select('id')
        .single();

      if (createError) throw createError;
      setContractId(newContract.id);
      return newContract.id;
    } catch (err) {
      console.error('Error creating contract:', err);
      showSnackbar('Błąd podczas tworzenia umowy', 'error');
      return null;
    }
  };

  const handlePrintDraft = async () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showSnackbar('Zezwól przeglądarce na otwieranie nowych kart', 'error');
      return;
    }

    printWindow.document.write(
      '<html><head><meta charset="utf-8"><title>Przygotowywanie draftu…</title></head>' +
        '<body style="font-family:Arial,sans-serif;padding:40px;color:#333">' +
        'Przygotowywanie wersji roboczej umowy…</body></html>',
    );
    printWindow.document.close();

    try {
      setIsPrintingDraft(true);
      let parsed: any = {};
      try {
        parsed = JSON.parse(contractContent);
      } catch {
        parsed = { flowContent: contractContent, pages: [contractContent], settings: {} };
      }
      const pages = Array.isArray(parsed?.pages) ? parsed.pages : [contractContent];
      const flowContent = parsed?.flowContent || pages.join('');
      const settings = parsed?.settings || {};
      const blob = await createContractDraftPdf({
        id: contractId || eventId,
        name: 'Umowa wydarzenia',
        description: 'Wersja robocza umowy wydarzenia',
        content: flowContent.replace(/<[^>]*>/g, ' ').trim() || 'Umowa wydarzenia',
        content_html: flowContent,
        page_settings: {
          ...settings,
          flowContent,
          pages,
          paginationMode: 'automatic',
        },
        is_active: true,
        created_at: new Date().toISOString(),
      });
      const url = URL.createObjectURL(blob);
      printWindow.location.href = url;
      printWindow.addEventListener('load', () => printWindow.print(), { once: true });
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      printWindow.close();
      console.error('Error printing contract draft:', err);
      showSnackbar(err?.message || 'Nie udało się przygotować draftu umowy', 'error');
    } finally {
      setIsPrintingDraft(false);
    }
  };

  const handleEditContractContent = async () => {
    const currentContractId = await ensureContractRecord();
    const currentTemplateId = selectedTemplateId || templateId;
    if (!currentContractId || !currentTemplateId) return;

    router.push(
      `/crm/contract-templates/${currentTemplateId}/edit-wysiwyg?contractId=${currentContractId}&eventId=${eventId}`,
    );
  };

  const handleRefreshFromOffer = async () => {
    if (!sourceContractContent) return;
    if (
      contractId &&
      !window.confirm(
        'Treść umowy zostanie odbudowana z aktualnego szablonu i najnowszej oferty. Indywidualne poprawki w treści zostaną zastąpione. Kontynuować?',
      )
    ) {
      return;
    }

    try {
      setContractContent(sourceContractContent);
      if (contractId) {
        const { error } = await supabase
          .from('contracts')
          .update({
            content: sourceContractContent,
            modified_after_generation: true,
          })
          .eq('id', contractId);
        if (error) throw error;
      }
      setContractSourceOutdated(false);
      setModifiedAfterGeneration(Boolean(contractId));
      showSnackbar('Umowa została odświeżona z aktualnej oferty i klauzul', 'success');
    } catch (err) {
      console.error('Error refreshing contract from offer:', err);
      showSnackbar('Nie udało się odświeżyć umowy z oferty', 'error');
    }
  };

  const handlePrint = async () => {
    if (!templateId && !selectedTemplateId) {
      showSnackbar('Wybierz szablon umowy przed wygenerowaniem PDF', 'error');
      return;
    }

    setIsGeneratingPdf(true);
    const currentContractId = await ensureContractRecord();
    if (!currentContractId) {
      setIsGeneratingPdf(false);
      return;
    }

    // 2) PDF na backendzie (Chromium)
    try {
      const contractContainer = document.querySelector(
        '.contract-a4-container',
      ) as HTMLElement | null;
      if (!contractContainer) {
        showSnackbar('Nie znaleziono widoku umowy', 'error');
        return;
      }

      const pagesHtml = contractContainer.innerHTML;

      // jeśli masz zamianę klas licznika stron – zostaw
      const pagesHtmlForPrint = pagesHtml.replace(
        /class="absolute bottom-4[^"]*text-\[#000\]\/50"/g,
        'class="contract-page-counter"',
      );

      const cssText = `${contractFontFaceCss}\n${getContractCssForPrint()}`;

      const res = await fetch('/bridge/events/contracts/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId,
          contractId: currentContractId,
          pagesHtml: pagesHtmlForPrint,
          cssText,
          createdBy: employee?.id ?? null,
          // fileName: `umowa-${eventId}.pdf` // opcjonalnie
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        console.error(json);
        showSnackbar(json?.error || 'Błąd generowania PDF', 'error');
        return;
      }

      // odśwież dane umowy (żeby złapać generated_pdf_path)
      await fetchContractData();

      showSnackbar('PDF umowy został wygenerowany i zapisany w Dokumenty → Umowy', 'success');
    } catch (e) {
      console.error(e);
      showSnackbar('Błąd generowania PDF', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleShowPdf = async () => {
    if (!generatedPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(generatedPdfPath, 3600);

      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    } catch (err) {
      console.error('Error showing PDF:', err);
      showSnackbar('Błąd podczas otwierania PDF', 'error');
    }
  };

  const handleDownloadPdf = async () => {
    if (!generatedPdfPath) return;

    try {
      const { data } = await supabase.storage
        .from('event-files')
        .createSignedUrl(generatedPdfPath, 3600);

      if (data?.signedUrl) {
        const response = await fetch(data.signedUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = generatedPdfPath.split('/').pop() || 'umowa.pdf';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
      }
    } catch (err) {
      console.error('Error downloading PDF:', err);
      showSnackbar('Błąd podczas pobierania PDF', 'error');
    }
  };

  const handleStatusChange = async (newStatus: ContractStatus) => {
    if (contractStatus === 'cancelled') return;
    if (newStatus === 'cancelled') {
      if (!isAdmin || !contractId) {
        showSnackbar('Anulowanie zapisanej umowy wymaga uprawnień administratora.', 'warning');
        return;
      }
      setShowCancelContractModal(true);
      return;
    }
    if (
      !['draft', 'cancelled'].includes(newStatus) &&
      !ensureContractPreflight('zmianą statusu umowy')
    ) {
      return;
    }

    const changesDocumentMode = ['draft', 'cancelled'].includes(contractStatus)
      !== ['draft', 'cancelled'].includes(newStatus);

    try {
      if (!contractId) {
        if (!templateId && !selectedTemplateId) {
          showSnackbar('Wybierz szablon umowy przed zmianą statusu', 'error');
          return;
        }

        const { data: eventData } = await supabase
          .from('events')
          .select('contact_person_id, organization_id')
          .eq('id', eventId)
          .single();

        const clientId = eventData?.contact_person_id || eventData?.organization_id || null;

        const statusDateField = `${newStatus}_at`;
        const insertData: any = {
          event_id: eventId,
          client_id: clientId,
          title: `Umowa dla eventu ${eventId}`,
          content: contractContent,
          status: newStatus,
          template_id: templateId,
        };

        if (newStatus !== 'draft') {
          insertData[statusDateField] = new Date().toISOString();
        }

        insertData.template_id = selectedTemplateId || templateId;

        const { data: newContract, error: createError } = await supabase
          .from('contracts')
          .insert(insertData)
          .select('id')
          .single();

        if (createError) throw createError;
        setContractId(newContract.id);
      } else {
        const statusDateField = `${newStatus}_at`;
        const updateData: any = {
          status: newStatus,
          content: contractContent,
          ...(changesDocumentMode ? { modified_after_generation: true } : {}),
        };

        if (newStatus !== 'draft') {
          updateData[statusDateField] = new Date().toISOString();
        }

        const { error: updateError } = await supabase
          .from('contracts')
          .update(updateData)
          .eq('id', contractId);

        if (updateError) throw updateError;
      }

      setContractStatus(newStatus);
      if (changesDocumentMode) setModifiedAfterGeneration(true);
      await fetchContractData();
      showSnackbar('Status umowy został zaktualizowany', 'success');
    } catch (err) {
      console.error('Error updating contract status:', err);
      showSnackbar('Błąd podczas aktualizacji statusu', 'error');
    }
  };

  const getStatusLabel = (status: ContractStatus) => {
    const labels: Record<ContractStatus, string> = {
      draft: '🟡 Szkic',
      issued: '🟢 Wystawiona',
      sent: '📤 Wysłana',
      signed_by_client: '✍️ Podpisana przez klienta',
      signed_returned: '✅ Podpisana odesłana',
      cancelled: '❌ Anulowana',
    };
    return labels[status];
  };

  const getStatusDate = (status: ContractStatus) => {
    const dateMap: Record<ContractStatus, string | undefined> = {
      draft: undefined,
      issued: statusDates.issued_at,
      sent: statusDates.sent_at,
      signed_by_client: statusDates.signed_by_client_at,
      signed_returned: statusDates.signed_returned_at,
      cancelled: statusDates.cancelled_at,
    };
    const date = dateMap[status];
    if (!date) return '';
    return new Date(date).toLocaleDateString('pl-PL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const canEdit = useMemo(() => {
    if (contractStatus === 'cancelled') return false;
    if (contractLockedAt) return false;
    if (isAdmin) return true;
    return contractStatus === 'draft' || contractStatus === 'cancelled';
  }, [contractLockedAt, isAdmin, contractStatus]);

  const isWorkingDraft = contractStatus === 'draft';

  const canSendEmail = useMemo(() => {
    if (contractStatus === 'cancelled') return false;
    if (!contractId) return false;
    if (isAdmin) return true;
    if (employee?.id && contractCreatedBy === employee.id) return true;
    return false;
  }, [isAdmin, employee, contractId, contractCreatedBy, contractStatus]);

  const confirmCompanySignature = async () => {
    if (!contractId || !employee?.id) return;
    const signedAt = new Date().toISOString();
    const { error } = await supabase
      .from('contracts')
      .update({ company_signed_at: signedAt, company_signed_by: employee.id })
      .eq('id', contractId);

    if (error) {
      showSnackbar(`Nie udało się potwierdzić podpisu firmy: ${error.message}`, 'error');
      return;
    }
    setCompanySignedAt(signedAt);
    showSnackbar('Podpis firmy został potwierdzony', 'success');
  };

  const handleApplyProductClauseSelections = async () => {
    const unresolved = productClauseConflicts.filter(
      (conflict) => !productClauseSelectionDraft[conflict.key],
    );
    if (unresolved.length > 0) {
      showSnackbar(
        `Wybierz wersję dla wszystkich rozbieżnych wspólnych ustaleń (${unresolved.length}).`,
        'warning',
      );
      return;
    }
    if (
      contractId &&
      !window.confirm(
        'Zastosowanie wyborów odbuduje draft z aktualnego szablonu, oferty i klauzul produktów. Indywidualne poprawki treści mogą zostać zastąpione. Kontynuować?',
      )
    ) {
      return;
    }

    try {
      setIsApplyingProductClauseSelections(true);
      await fetchContractData(productClauseSelectionDraft, true);
      showSnackbar('Wybory klauzul zostały zastosowane do umowy', 'success');
    } catch (error) {
      console.error('Error applying product clause selections:', error);
      showSnackbar('Nie udało się zastosować wyborów klauzul', 'error');
    } finally {
      setIsApplyingProductClauseSelections(false);
    }
  };

  const handleSaveEventContractClauses = async (items: EventContractClauseItem[]) => {
    let hasIndividualEdits = modifiedAfterGeneration;
    try {
      const parsedContract = JSON.parse(contractContent);
      hasIndividualEdits = hasIndividualEdits || parsedContract?.meta?.individuallyEdited === true;
    } catch {
      // Starsza treść umowy bez metadanych nie wymaga dodatkowego ostrzeżenia.
    }

    if (
      contractId &&
      hasIndividualEdits &&
      !window.confirm(
        'Zapisanie klauzul odbuduje draft z aktualnego szablonu i oferty. Indywidualne poprawki naniesione bezpośrednio w treści umowy mogą zostać zastąpione. Kontynuować?',
      )
    ) {
      return;
    }

    try {
      setIsSavingEventContractClauses(true);
      const clauseOverrides = serializeEventContractClauseItems(items);
      const { error } = await supabase
        .from('events')
        .update({ contract_clause_overrides: clauseOverrides })
        .eq('id', eventId);
      if (error) {
        if (['42703', 'PGRST204'].includes(error.code || '')) {
          throw new Error(
            'Brakuje pola klauzul wydarzenia w bazie. Uruchom najnowszą migrację Supabase i spróbuj ponownie.',
          );
        }
        throw error;
      }

      setShowEventContractClauses(false);
      await fetchContractData(undefined, true);
      showSnackbar('Klauzule tej umowy zostały zapisane', 'success');
    } catch (error) {
      console.error('Error saving event contract clauses:', error);
      showSnackbar(
        error instanceof Error ? error.message : 'Nie udało się zapisać klauzul umowy',
        'error',
      );
    } finally {
      setIsSavingEventContractClauses(false);
    }
  };

  const handleStartContractAudit = async () => {
    if (!isWorkingDraft) {
      showSnackbar('Audyt AI można zastosować wyłącznie do wersji roboczej umowy', 'warning');
      return;
    }
    if (!contractContent) {
      showSnackbar('Brak treści umowy do audytu', 'warning');
      return;
    }

    const allBlocks = extractContractAuditBlocks(
      contractContent,
      contractAuditSensitiveValues,
    );
    const auditBlocks = allBlocks.filter((block) => !block.protected);
    if (auditBlocks.length < 2) {
      showSnackbar('Po wyłączeniu danych stron pozostało za mało treści do audytu', 'warning');
      return;
    }

    try {
      setIsAuditingContract(true);
      const { data, error } = await supabase.functions.invoke('audit-contract', {
        body: {
          eventId,
          contractId,
          blocks: auditBlocks.map(({ protected: _protected, ...block }) => block),
        },
      });

      if (error) {
        throw new Error((data as { error?: string } | null)?.error || error.message);
      }
      const audit = (data as { result?: ContractAuditResult } | null)?.result;
      if (!audit) throw new Error('Asystent nie zwrócił wyniku audytu');

      setContractAuditReview({
        audit,
        blocks: allBlocks,
        sourceContent: contractContent,
      });
    } catch (err) {
      console.error('Error auditing contract:', err);
      showSnackbar(
        err instanceof Error ? err.message : 'Nie udało się przeprowadzić audytu umowy',
        'error',
      );
    } finally {
      setIsAuditingContract(false);
    }
  };

  const handleApplyContractAudit = async (selections: Record<string, string>) => {
    if (!contractAuditReview) return;
    if (contractAuditReview.sourceContent !== contractContent) {
      showSnackbar('Treść umowy zmieniła się od audytu. Uruchom audyt ponownie.', 'warning');
      setContractAuditReview(null);
      return;
    }

    try {
      setIsApplyingContractAudit(true);
      const applied = applyContractAuditDecisions(
        contractContent,
        contractAuditReview.audit,
        selections,
        contractAuditSensitiveValues,
      );
      if (applied.removed === 0 && applied.changed === 0) {
        setContractAuditReview(null);
        showSnackbar('Nie wybrano zmian do zastosowania', 'info');
        return;
      }

      const currentContractId = await ensureContractRecord();
      if (!currentContractId) return;

      const parts = getContractDocumentParts(contractContent);
      const renderedContract = await renderContractDocument(
        applied.flowContent,
        parts.settings,
      );
      const auditedContent = JSON.stringify({
        ...parts.parsed,
        ...renderedContract,
        meta: {
          ...(parts.parsed.meta || {}),
          individuallyEdited: true,
          editSource: 'ai-audit',
          lastAiAuditAt: contractAuditReview.audit.generatedAt || new Date().toISOString(),
          lastAiAuditModel: contractAuditReview.audit.model || null,
        },
      });

      const { error } = await supabase
        .from('contracts')
        .update({
          content: auditedContent,
          modified_after_generation: true,
        })
        .eq('id', currentContractId);
      if (error) throw error;

      setContractContent(auditedContent);
      setModifiedAfterGeneration(true);
      setContractAuditReview(null);
      showSnackbar(
        `Audyt zastosowany: usunięto ${applied.removed}, poprawiono ${applied.changed} fragmentów`,
        'success',
      );
    } catch (err) {
      console.error('Error applying contract audit:', err);
      showSnackbar(
        err instanceof Error ? err.message : 'Nie udało się zastosować audytu',
        'error',
      );
    } finally {
      setIsApplyingContractAudit(false);
    }
  };

  const actions = useMemo(() => {
    if (contractStatus === 'cancelled') {
      return generatedPdfPath ? [
        {
          label: 'Pokaż archiwalny PDF',
          onClick: handleShowPdf,
          icon: <Eye className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Pobierz archiwalny PDF',
          onClick: handleDownloadPdf,
          icon: <Download className="h-4 w-4" />,
          variant: 'default' as const,
        },
      ] : [];
    }
    if (editMode) {
      return [
        {
          label: 'Anuluj',
          onClick: handleCancel,
          icon: <X className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Zapisz',
          onClick: handleSave,
          icon: <Save className="h-4 w-4" />,
          variant: 'primary' as const,
        },
      ];
    }

    const baseActions = [];

    if (isWorkingDraft) baseActions.push({
      label: isPrintingDraft ? 'Przygotowywanie…' : 'Drukuj draft',
      onClick: handlePrintDraft,
      icon: isPrintingDraft ? (
        <Loader className="h-4 w-4 animate-spin" />
      ) : (
        <Printer className="h-4 w-4" />
      ),
      variant: 'default' as const,
      disabled: isPrintingDraft,
    });

    if (!generatedPdfPath || modifiedAfterGeneration) {
      baseActions.push({
        label: modifiedAfterGeneration
          ? isWorkingDraft
            ? 'Regeneruj PDF draftu'
            : 'Regeneruj PDF'
          : isWorkingDraft
            ? 'Generuj PDF draftu'
            : 'Generuj PDF',
        onClick: handlePrint,
        icon: <Download className="h-4 w-4" />,
        variant: 'primary' as const,
      });
    } else {
      baseActions.push(
        {
          label: isWorkingDraft ? 'Pokaż PDF draftu' : 'Pokaż / drukuj umowę',
          onClick: handleShowPdf,
          icon: <Eye className="h-4 w-4" />,
          variant: 'primary' as const,
        },
        {
          label: 'Pobierz PDF',
          onClick: handleDownloadPdf,
          icon: <Download className="h-4 w-4" />,
          variant: 'default' as const,
        },
      );
    }

    if (canSendEmail) {
      baseActions.unshift({
        label: isWorkingDraft ? 'Wyślij draft' : 'Wyślij umowę',
        onClick: () => {
          if (isWorkingDraft || ensureContractPreflight('wysłaniem finalnej umowy')) {
            setShowSendEmailModal(true);
          }
        },
        icon: <Mail className="h-4 w-4" />,
        variant: 'default' as const,
      });
    }

    if (canEdit && isWorkingDraft) {
      baseActions.unshift({
        label: isAuditingContract ? 'Audytowanie…' : 'Audyt AI',
        onClick: handleStartContractAudit,
        icon: isAuditingContract ? (
          <Loader className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        ),
        variant: 'default' as const,
        disabled: isAuditingContract,
        pin: true,
      });
    }

    if (canEdit) {
      baseActions.unshift(
        {
          label: contractSourceOutdated ? 'Dane zmienione — odśwież' : 'Odśwież ze źródeł',
          onClick: handleRefreshFromOffer,
          icon: <RefreshCw className="h-4 w-4" />,
          variant: contractSourceOutdated ? ('primary' as const) : ('default' as const),
          disabled: !sourceContractContent,
        },
        {
          label: 'Klauzule tej umowy',
          onClick: () => setShowEventContractClauses(true),
          icon: <ListChecks className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Edytuj treść umowy',
          onClick: handleEditContractContent,
          icon: <FilePenLine className="h-4 w-4" />,
          variant: 'default' as const,
        },
        {
          label: 'Edytuj zmienne',
          onClick: () => setEditMode(true),
          icon: <Edit className="h-4 w-4" />,
          variant: 'default' as const,
        },
      );
    }

    return baseActions;
  }, [
    editMode,
    canEdit,
    canSendEmail,
    generatedPdfPath,
    modifiedAfterGeneration,
    contractId,
    handleCancel,
    handleSave,
    handlePrint,
    handleShowPdf,
    handleDownloadPdf,
    handleStartContractAudit,
    isGeneratingPdf,
    isPrintingDraft,
    isAuditingContract,
    contractSourceOutdated,
    sourceContractContent,
    contractPreflightIssues,
    preflightAcknowledgements,
    preflightAcknowledgementContext,
    contractStatus,
    isWorkingDraft,
  ]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        <div className="text-center text-[#e5e4e2]/60">Ładowanie danych umowy...</div>
      </div>
    );
  }

  if (!selectedTemplateId) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
          <div className="text-center">
            <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <h3 className="mb-2 text-xl text-[#e5e4e2]">Wybierz szablon umowy</h3>
            <p className="mb-6 text-[#e5e4e2]/60">
              Dla tej kategorii wydarzenia nie został przypisany domyślny szablon. Wybierz szablon z listy poniżej.
            </p>

            {availableTemplates.length > 0 ? (
              <div className="mx-auto max-w-md">
                <select
                  value=""
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-sm text-[#e5e4e2] transition-all hover:border-[#d3bb73]/40 focus:outline-none focus:ring-2 focus:ring-[#d3bb73]"
                >
                  <option value="" disabled className="bg-[#1c1f33] text-[#e5e4e2]/50">
                    Wybierz szablon...
                  </option>
                  {availableTemplates.map((t) => (
                    <option key={t.id} value={t.id} className="bg-[#1c1f33] text-[#e5e4e2]">
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-[#e5e4e2]/40">
                Brak aktywnych szablonów umów.{' '}
                <a href="/crm/event-categories" className="text-[#d3bb73] hover:underline">
                  Dodaj szablony
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: getContractDocumentCss() }} />
      <div className="space-y-6">
        <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
          <div className="mb-5 flex flex-col gap-4 md:mb-6 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-light leading-tight text-[#e5e4e2] md:text-2xl">
                Umowa na realizację wydarzenia
              </h2>
              <p className="mt-1 text-sm text-[#e5e4e2]/50">
                {contractStatus === 'cancelled'
                  ? 'Umowa anulowana. Zachowano jej treść, PDF i historię. Zapisany PDF jest dokumentem archiwalnym.'
                  : isWorkingDraft
                  ? 'Podgląd uwzględnia dane wydarzenia, ofertę i klauzule produktów. Aby wystawić finalną umowę, sprawdź uwagi i wybierz status „Wystawiona”.'
                  : 'Umowa finalna. Generowany PDF i wysyłka dotyczą umowy, nie wersji roboczej.'}
              </p>
              {selectedTemplateName && (
                <p className="mt-2 text-xs text-[#e5e4e2]/55">
                  Szablon umowy: <span className="font-medium text-[#d3bb73]">{selectedTemplateName}</span>
                </p>
              )}
            </div>

            <div className="flex shrink-0 justify-start md:justify-end">
              {isGeneratingPdf ? (
                <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 md:w-auto">
                  <Loader className="h-4 w-4 animate-spin text-[#d3bb73]" />
                  <span className="text-sm text-[#e5e4e2]/60">Generowanie PDF...</span>
                </div>
              ) : (
                <ResponsiveActionBar actions={actions} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {isWorkingDraft && contractPreflightIssues.length > 0 && (
              <div className="rounded-lg border border-amber-400/10 bg-amber-400/10 p-4 text-sm text-amber-100 lg:col-span-2">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-amber-200">
                      Uwagi do sprawdzenia
                    </div>
                    <p className="mt-1 text-xs leading-5 text-amber-100/75">
                      Poniższe uwagi nie blokują generowania PDF ani drukowania umowy.
                      Aby wystawić lub wysłać finalną umowę mimo wskazanych braków, zaznacz
                      zapoznanie się z odpowiednimi uwagami. Potwierdzenie nie uzupełnia danych
                      i obowiązuje tylko dla bieżącej treści w tej sesji.
                    </p>
                    <div className="mt-3 space-y-2">
                      {contractPreflightIssues.map((issue) => (
                        <div
                          key={issue.key}
                          className="flex flex-col gap-2 rounded-md border border-amber-300/10 bg-black/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 py-1">
                            <input
                              type="checkbox"
                              checked={isPreflightIssueAcknowledged(issue.key)}
                              onChange={(e) => acknowledgePreflightIssue(issue.key, e.target.checked)}
                              disabled={!employee?.id || isGeneratingPdf}
                              className="mt-1 h-4 w-4 shrink-0 rounded accent-[#d3bb73] disabled:cursor-not-allowed"
                            />
                            <span className="min-w-0">
                              <span className="block leading-5">{issue.label}</span>
                              <span className="mt-1 block text-xs leading-5 text-amber-100/75">
                                {isPreflightIssueAcknowledged(issue.key)
                                  ? 'Potwierdzono — świadomie akceptuję tę uwagę przy wystawieniu i wysłaniu finalnej umowy.'
                                  : 'Zapoznałem(-am) się z uwagą i świadomie akceptuję wystawienie oraz wysłanie finalnej umowy mimo tego braku.'}
                              </span>
                            </span>
                          </label>
                          {issue.actionHref && (
                            <a
                              href={issue.actionHref}
                              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#d3bb73] hover:underline"
                            >
                              {issue.actionLabel || 'Uzupełnij'}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isWorkingDraft && unresolvedProductClauseConflicts.length > 0 && (
              <div className="rounded-xl border border-[#d3bb73]/30 bg-[#2c0b18] p-4 text-sm text-[#e5e4e2] lg:col-span-2 md:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-[#d3bb73]">
                      <ShieldAlert className="h-4 w-4" />
                      Rozbieżne wersje wspólnych ustaleń
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-[#e5e4e2]/60">
                      W źródłach umowy występują różne wersje tej samej wspólnej zasady.
                      Wybierz treść, która ma znaleźć się w umowie. Ustalenia specyficzne dla
                      różnych produktów nie są wzajemnie wykluczane.
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-[#d3bb73]/15 px-2.5 py-1 text-xs font-semibold text-[#d3bb73]">
                    {unresolvedProductClauseConflicts.length}
                  </span>
                </div>

                <div className="mt-4 space-y-4">
                  {unresolvedProductClauseConflicts.map((conflict) => (
                    <section key={conflict.key} className="rounded-lg border border-white/10 bg-black/15 p-3 md:p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[#d3bb73]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#d3bb73]">
                          {CONTRACT_CLAUSE_CATEGORY_LABELS[conflict.category]}
                        </span>
                        <span className="font-medium text-[#f2eee2]">
                          {getContractClauseTopicLabel(conflict.topic)}
                        </span>
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {conflict.candidates.map((candidate) => (
                          <label
                            key={candidate.id}
                            className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                              productClauseSelectionDraft[conflict.key] === candidate.id
                                ? 'border-white/10 bg-[#d3bb73]/15'
                                : 'border-white/10 bg-white/[0.025] hover:border-white/20'
                            }`}
                          >
                            <span className="flex items-start gap-2">
                              <input
                                type="radio"
                                name={`product-clause-${conflict.key}`}
                                checked={productClauseSelectionDraft[conflict.key] === candidate.id}
                                onChange={() => setProductClauseSelectionDraft((current) => ({
                                  ...current,
                                  [conflict.key]: candidate.id,
                                }))}
                                className="mt-1 accent-[#d3bb73]"
                              />
                              <span className="min-w-0">
                                <span className="block text-xs font-semibold text-[#d3bb73]">
                                  {candidate.productName}
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-[#e5e4e2]/65">
                                  {candidate.preview || candidate.title}
                                </span>
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-[#e5e4e2]/45">
                    Wybrano {unresolvedProductClauseConflicts.filter((conflict) => Boolean(productClauseSelectionDraft[conflict.key])).length} z {unresolvedProductClauseConflicts.length} typów.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleApplyProductClauseSelections()}
                    disabled={
                      isApplyingProductClauseSelections ||
                      unresolvedProductClauseConflicts.some((conflict) => !productClauseSelectionDraft[conflict.key])
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-semibold text-[#210811] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isApplyingProductClauseSelections && <Loader className="h-4 w-4 animate-spin" />}
                    {isApplyingProductClauseSelections ? 'Aktualizowanie…' : 'Zastosuj wybory do umowy'}
                  </button>
                </div>
              </div>
            )}
            {contractSourceOutdated && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200 lg:col-span-2">
                Oferta, jej produkty lub harmonogram techniczny zmieniły się po indywidualnej
                edycji umowy. Użyj „Dane zmienione — odśwież”, aby ponownie pobrać aktualne dane.
                Operacja zastąpi indywidualnie zmienioną treść.
              </div>
            )}
            {unplacedClauseCategories.length > 0 && (
              <div className="rounded-lg border border-blue-400/25 bg-blue-400/10 p-3 text-sm text-blue-100 lg:col-span-2">
                <strong>Klauzule produktowe zostały pominięte.</strong>{' '}
                Ten szablon nie przewiduje miejsca dla sekcji: {unplacedClauseCategories.map(
                  (category) => CONTRACT_CLAUSE_CATEGORY_LABELS[category] || category,
                ).join(', ')}. Dokument zostanie wygenerowany bez nich — w przypadku umowy
                uproszczonej nie musisz nic robić.
              </div>
            )}
            {canEdit && (
              <div className="rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-3 lg:col-span-2 md:p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#e5e4e2]">
                      <ListChecks className="h-4 w-4 text-[#d3bb73]" />
                      Klauzule tej umowy
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">
                      Edytuj lub wyłącz automatyczne klauzule i dodaj ustalenia klienta tylko dla tego wydarzenia.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {EVENT_CONTRACT_CLAUSE_CATEGORY_ORDER.map((category) => {
                        const categoryItems = eventContractClauseItems.filter(
                          (item) => item.category === category,
                        );
                        if (categoryItems.length === 0) return null;
                        const activeItems = categoryItems.filter((item) => item.enabled).length;
                        return (
                          <span
                            key={category}
                            className="rounded-full border border-white/10 bg-white/[0.025] px-2.5 py-1 text-[10px] text-[#e5e4e2]/55"
                          >
                            {CONTRACT_CLAUSE_CATEGORY_LABELS[category] || category}: {activeItems}
                          </span>
                        );
                      })}
                      {eventContractClauseItems.length === 0 && (
                        <span className="text-[11px] text-[#e5e4e2]/35">
                          Brak klauzul automatycznych — możesz dodać własne.
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowEventContractClauses(true)}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/35 px-4 py-2.5 text-sm font-medium text-[#e7cf86] transition-colors hover:bg-[#d3bb73]/10"
                  >
                    <ListChecks className="h-4 w-4" />
                    Zarządzaj klauzulami
                  </button>
                </div>
              </div>
            )}
            {canEdit && isWorkingDraft && !generatedPdfPath && availableTemplates.length > 0 && (
              <div className="rounded-lg bg-[#210811]/65 p-3 md:p-4 lg:col-span-2">
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/50">
                  Szablon umowy
                </label>

                <select
                  value={selectedTemplateId || ''}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="min-h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-[#351020] px-3 py-2.5 text-sm text-[#e5e4e2] transition-colors hover:bg-[#411326] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50"
                >
                  {availableTemplates.map((template) => (
                    <option
                      key={template.id}
                      value={template.id}
                      className="bg-[#351020] text-[#e5e4e2]"
                    >
                      {template.name}
                    </option>
                  ))}
                </select>

                <p className="mt-2 text-xs text-amber-400/80">
                  Zmiana możliwa tylko przed generacją PDF
                </p>
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl bg-[#210811]/65 px-4 py-3 lg:col-span-2 md:gap-4 md:px-5">
                <label htmlFor={`contract-status-${eventId}`} className="shrink-0 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/55">
                  Status umowy
                </label>
                <div className="min-w-0 max-w-full" title={!canEdit && contractStatus === 'issued' ? 'Tylko admin może anulować wystawioną umowę' : undefined}>
                {canEdit || contractStatus === 'draft' ? (
              <select
                id={`contract-status-${eventId}`}
                value={contractStatus}
                onChange={(e) => handleStatusChange(e.target.value as ContractStatus)}
                className="min-h-11 w-full cursor-pointer rounded-lg border border-white/10 bg-[#351020] px-4 py-3 text-sm text-[#e5e4e2] transition-colors hover:bg-[#411326] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50"
              >
                {(
                  [
                    'draft',
                    'issued',
                    'sent',
                    'signed_by_client',
                    'signed_returned',
                    'cancelled',
                  ] as ContractStatus[]
                ).map((status) => {
                  const isDisabled =
                    !isAdmin &&
                    ((contractStatus === 'issued' && status !== 'issued') ||
                      (status === 'cancelled' && contractStatus !== 'cancelled') ||
                      (status === 'draft' && contractStatus !== 'draft'));

                  return (
                    <option
                      key={status}
                      value={status}
                      disabled={isDisabled}
                      className="bg-[#351020] text-[#e5e4e2]"
                    >
                      {getStatusLabel(status)}
                    </option>
                  );
                })}
              </select>
                ) : (
                  <p id={`contract-status-${eventId}`} className="py-1 text-sm font-medium text-[#e5e4e2]">
                    {getStatusLabel(contractStatus)}
                  </p>
                )}

                </div>

              <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <span className="whitespace-nowrap rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-[#d3bb73]">
                  Wersja {contractVersion}
                </span>
                {contractLockedAt && (
                  <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-green-300">
                    Dokument zablokowany po podpisaniu
                  </span>
                )}
                {companySignedAt && (
                  <span className="rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-[#d3bb73]">
                    Podpis firmy potwierdzony
                  </span>
                )}
              {getStatusDate(contractStatus) && (
                <span className="text-xs text-[#e5e4e2]/55" title="Data zmiany statusu">
                  {getStatusDate(contractStatus)}
                </span>
              )}
              </div>

              {isAdmin && contractId && contractStatus !== 'cancelled' && (
                <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                  {!companySignedAt && contractStatus !== 'draft' && (
                    <button
                      type="button"
                      onClick={confirmCompanySignature}
                      className="min-h-11 rounded-lg border-0 bg-[#d3bb73]/10 px-4 py-2.5 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/15 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50"
                    >
                      Potwierdź podpis firmy
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowCancelContractModal(true)}
                    disabled={isGeneratingPdf || isPrintingDraft}
                    className="min-h-11 rounded-lg border-0 bg-red-400/5 px-4 py-2.5 text-sm font-medium text-red-200/80 transition-colors hover:bg-red-400/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-300/40 disabled:opacity-40"
                  >
                    Anuluj umowę
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {contractId && companySignedAt && ['signed_by_client', 'signed_returned', 'cancelled'].includes(contractStatus) && (
          <SignedContractAttachments
            key={contractId}
            contractId={contractId}
            cancelled={contractStatus === 'cancelled'}
          />
        )}

        {editMode && (
          <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h3 className="text-lg font-medium text-[#e5e4e2]">Edycja zmiennych</h3>
                <p className="mt-1 text-sm text-[#e5e4e2]/50">
                  Pokazane są wyłącznie pola używane w tej umowie.
                </p>
              </div>
              <label className="relative block w-full md:max-w-sm">
                <span className="sr-only">Szukaj zmiennej</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/45" />
                <input
                  type="search"
                  value={variableSearch}
                  onChange={(event) => setVariableSearch(event.target.value)}
                  placeholder="Szukaj pola, np. numer umowy"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-3 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/35 focus:border-[#d3bb73]/60 focus:outline-none"
                />
              </label>
            </div>

            {editableContractVariables.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {editableContractVariables.map(({ key, value, label }) => {
                  const useTextarea =
                    value.length > 100 ||
                    ['client_representation_rule', 'client_representation_basis', 'offer_scope'].includes(key);

                  return (
                    <div key={key}>
                      <label className="mb-1 block text-sm text-[#e5e4e2]/70">{label}</label>
                      {useTextarea ? (
                        <textarea
                          value={value}
                          rows={3}
                          onChange={(event) =>
                            setEditedVariables((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      ) : (
                        <input
                          type="text"
                          value={value}
                          onChange={(event) =>
                            setEditedVariables((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#d3bb73]/20 px-4 py-8 text-center text-sm text-[#e5e4e2]/50">
                {variableSearch
                  ? 'Nie znaleziono pola o takiej nazwie.'
                  : 'Ten szablon nie zawiera pól przeznaczonych do ręcznej edycji.'}
              </div>
            )}
          </div>
        )}

        <div className="contract-a4-container">
          {(() => {
            try {
              const parsed = JSON.parse(contractContent);
              const pages = parsed.pages || (Array.isArray(parsed) ? parsed : null);
              const settings = parsed.settings || {
                logoScale: 80,
                logoPositionX: 50,
                logoPositionY: 0,
                lineHeight: 1.6,
                selectedLogo: '/erulers_logo_vect.png',
                selectedFooter: 'default',
                footerContent: {
                  companyName: 'EVENT RULERS',
                  tagline: 'Więcej niż Wodzireje!',
                  website: 'www.eventrulers.pl',
                  email: 'biuro@eventrulers.pl',
                  phone: '698-212-279',
                  logoUrl: '/erulers_logo_vect.png',
                },
                footerLogoScale: 80,
              };

              if (pages && Array.isArray(pages)) {
                return pages.map((pageContent: string, pageIndex: number) => (
                  <div key={pageIndex} className="contract-a4-page">
                    {pageIndex === 0 && (
                      <>
                        <div
                          className={`contract-header-logo ${
                            settings.logoPositionX <= 33
                              ? 'justify-start'
                              : settings.logoPositionX >= 67
                                ? 'justify-end'
                                : 'justify-center'
                          }`}
                          style={{
                            marginTop: `${settings.logoPositionY}mm`,
                          }}
                        >
                          <img
                            src={
                              settings.selectedLogo?.startsWith('http')
                                ? settings.selectedLogo
                                : `https://mavinci.pl${settings.selectedLogo || '/erulers_logo_vect.png'}`
                            }
                            alt="Logo"
                            style={{
                              maxWidth: `${settings.logoScale}%`,
                              height: 'auto',
                            }}
                          />
                        </div>

                        <div className="contract-current-date">
                          Olsztyn,{' '}
                          {new Date().toLocaleDateString('pl-PL', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </div>
                      </>
                    )}

                    <div
                      className="contract-content"
                      style={{
                        lineHeight: String(settings.lineHeight),
                        fontFamily: settings.selectedFont || 'Georgia, serif',
                        minHeight: 0,
                        flex: '1 1 0',
                        overflow: 'hidden',
                      }}
                      dangerouslySetInnerHTML={{ __html: pageContent }}
                    />

                    {settings.selectedFooter !== 'none' && (
                      <div
                        className="contract-footer"
                        style={{ fontFamily: settings.selectedFont || 'Georgia, serif' }}
                      >
                        {settings.selectedFooter === 'default' && (
                          <div className="footer-logo">
                            <img
                              src={
                                (
                                  settings.footerContent?.logoUrl || settings.selectedLogo
                                )?.startsWith('http')
                                  ? settings.footerContent?.logoUrl || settings.selectedLogo
                                  : `https://mavinci.pl${settings.footerContent?.logoUrl || settings.selectedLogo || '/erulers_logo_vect.png'}`
                              }
                              alt="Logo"
                              style={{
                                maxWidth: `${settings.footerLogoScale || 80}%`,
                                height: 'auto',
                              }}
                            />
                          </div>
                        )}
                        <div className="footer-info">
                          <p>
                            <span className="font-bold">
                              {settings.footerContent?.companyName ?? 'EVENT RULERS'}
                            </span>
                            {settings.footerContent?.tagline && (
                              <>
                                {' '}
                                – <span className="italic">{settings.footerContent.tagline}</span>
                              </>
                            )}
                          </p>
                          <p>
                            {[
                              settings.footerContent?.website ?? 'www.eventrulers.pl',
                              settings.footerContent?.email ?? 'biuro@eventrulers.pl',
                            ].filter(Boolean).join(' | ')}
                          </p>
                          {settings.footerContent?.phone !== '' && (
                            <p>tel: {settings.footerContent?.phone ?? '698-212-279'}</p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="contract-page-counter">
                      {pageIndex + 1}/{pages.length}
                    </div>
                  </div>
                ));
              }
            } catch (e) {
              // Fallback dla starych szablonów - spróbuj wyciągnąć logo z parsed settings jeśli istnieje
              let fallbackLogoUrl = 'https://mavinci.pl/erulers_logo_vect.png';
              try {
                const parsed = JSON.parse(contractContent);
                const logoUrl = parsed?.settings?.selectedLogo || parsed?.selectedLogo;
                if (logoUrl?.startsWith('http')) {
                  fallbackLogoUrl = logoUrl;
                }
              } catch {
                // Użyj domyślnego URL
              }

              return (
                <div className="contract-a4-page">
                  <div className="contract-header-logo">
                    <img src={fallbackLogoUrl} alt="EVENT RULERS" />
                  </div>

                  <div className="contract-current-date">
                    Olsztyn,{' '}
                    {new Date().toLocaleDateString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>

                  <div
                    className="contract-content"
                    dangerouslySetInnerHTML={{ __html: contractContent }}
                  />

                  <div className="contract-footer">
                    <div className="footer-logo">
                      <img src={fallbackLogoUrl} alt="EVENT RULERS" />
                    </div>
                    <div className="footer-info">
                      <p>
                        <strong>EVENT RULERS</strong> – <em>Więcej niż Wodzireje!</em>
                      </p>
                      <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
                      <p>tel: 698-212-279</p>
                    </div>
                  </div>
                </div>
              );
            }
          })()}
        </div>
      </div>

      {showCancelContractModal && isAdmin && contractId && (
        <CancelContractModal
          contractId={contractId}
          eventId={eventId}
          status={contractStatus}
          templateName={selectedTemplateName}
          onClose={() => setShowCancelContractModal(false)}
          onCancelled={() => {
            setShowCancelContractModal(false);
            setShowSendEmailModal(false);
            setEditMode(false);
            setContractStatus('cancelled');
            showSnackbar('Umowa została anulowana. Treść, PDF i historia zostały zachowane.', 'success');
            void fetchContractData();
          }}
        />
      )}

      {contractAuditReview && (
        <ContractAuditReviewModal
          audit={contractAuditReview.audit}
          blocks={contractAuditReview.blocks}
          isApplying={isApplyingContractAudit}
          onClose={() => setContractAuditReview(null)}
          onApply={handleApplyContractAudit}
        />
      )}

      {showEventContractClauses && canEdit && (
        <EventContractClausesModal
          eventId={eventId}
          items={eventContractClauseItems}
          isSaving={isSavingEventContractClauses}
          onClose={() => setShowEventContractClauses(false)}
          onSave={handleSaveEventContractClauses}
        />
      )}

      {showSendEmailModal && contractId && (
        <SendContractEmailModal
          contractId={contractId}
          eventId={eventId}
          isDraft={isWorkingDraft}
          clientEmail={clientEmail}
          clientName={clientName}
          onClose={() => setShowSendEmailModal(false)}
          onSent={() => {
            fetchContractData();
          }}
        />
      )}
    </>
  );
}
