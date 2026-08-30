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
import { normalizeContractClauseHtml } from '@/lib/CRM/contracts/contractClauseContent';
import { placeContractClauses } from '@/lib/CRM/contracts/contractClauseSlots';
import { createContractDraftPdf } from '@/app/(crm)/crm/contract-templates/printDraft';

export interface DecisionMaker {
  id: string;
  title: string;
  can_sign_contracts: boolean;
  notes: string;
  contact: UnifiedContact;
}

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
  requirements: 'wymagania organizacyjne i techniczne',
  obligations: 'obowiązki zamawiającego',
  risks: 'ryzyka i odpowiedzialność',
  general: 'postanowienia dodatkowe',
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

  return {
    ...settings,
    selectedLogo,
    footerContent: {
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
  const [contractStatus, setContractStatus] = useState<ContractStatus>('draft');
  const [contractId, setContractId] = useState<string | null>(null);
  const [contractVersion, setContractVersion] = useState(1);
  const [contractLockedAt, setContractLockedAt] = useState<string | null>(null);
  const [companySignedAt, setCompanySignedAt] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
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

  const fetchContractData = async () => {
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
          budget,
          organization_id,
          location_id,
          location,
          category_id,
          contact_person_id,
          my_company_id,
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
          'id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content, version_number, locked_at, company_signed_at',
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
            'id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content',
          )
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        existingContract = fallbackResult.data as typeof existingContract;
      }

      const organization = event.organizations as unknown as OrganizationWithRelations | null;
      const legalRepresentative = organization?.legal_representative || null;
      const primaryContact = organization?.primary_contact || null;
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

      const rawTemplateId = event.selected_contract_template_id || template?.id || '';
      const finalTemplateId = rawTemplateId && rawTemplateId !== 'null' ? rawTemplateId : '';

      if (!finalTemplateId) {
        setTemplateId(null);
        setSelectedTemplateId(null);
        setLoading(false);
        return;
      }

      const { data: selectedTemplate, error: selectedTemplateError } = await supabase
        .from('contract_templates')
        .select('id, name, content, content_html, page_settings')
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
        .select('id, total_amount, offer_number, valid_until, status, created_at, updated_at')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (offersError) throw offersError;

      const activeOfferCandidates = (offerCandidates || []).filter(
        (offer: any) => !['rejected', 'cancelled', 'expired'].includes(String(offer.status)),
      );
      const offers =
        activeOfferCandidates.find((offer: any) => offer.status === 'accepted') ||
        activeOfferCandidates[0] ||
        null;

      let offerItems = null;
      if (offers?.id) {
        const { data: items } = await supabase
          .from('offer_items')
          .select(`
            *,
            product:offer_products!product_id(
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
      const totalPrice = offers?.total_amount || event.budget || 0;
      const depositAmount = Math.round(totalPrice * 0.3);

      const formatDate = (dateStr: string) => {
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

      const formatDateOnly = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('pl-PL', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
      };

      const formatTimeOnly = (dateStr: string) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('pl-PL', {
          hour: '2-digit',
          minute: '2-digit',
        });
      };

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
      const clausesByCategory: Record<string, string[]> = {
        requirements: [],
        obligations: [],
        risks: [],
        general: [],
      };
      offerItemsArray.forEach((item: any) => {
        const product = Array.isArray(item.product) ? item.product[0] : item.product;
        const variant = Array.isArray(item.product_variant)
          ? item.product_variant[0]
          : item.product_variant;
        const clauseSource = variant?.overrides_contract_clauses ? variant : product;
        const clause = normalizeContractClauseHtml(
          clauseSource?.recommended_contract_clauses,
        );
        if (!clause) return;
        const category = clausesByCategory[clauseSource.recommended_contract_clause_category]
          ? clauseSource.recommended_contract_clause_category
          : 'requirements';
        clausesByCategory[category].push(
          `<div class="product-contract-clause" data-clause-category="${category}" data-product-name="${escapeContractText(item.name || 'Produkt')}">${clause}</div>`,
        );
      });

      const clauseSection = (category: string, clauses: string[]) =>
        clauses.length
          ? `<div class="contract-product-clauses" data-clause-category="${category}">${clauses.join('')}</div>`
          : '';
      const rawClauseSections = {
        contract_clauses_requirements: clauseSection('requirements', clausesByCategory.requirements),
        contract_clauses_obligations: clauseSection('obligations', clausesByCategory.obligations),
        contract_clauses_risks: clauseSection('risks', clausesByCategory.risks),
        contract_clauses_general: clauseSection('general', clausesByCategory.general),
      };
      const offerItemsHtml =
        offerItemsArray.length > 0
          ? `<ul style="margin: 0; padding-left: 20px; list-style-type: none;">
            ${offerItemsArray
              .map(
                (item: any, index: number) => `
              <li style="margin-bottom: 5px;">
                <strong>${index + 1}. ${item.name || 'Produkt'}</strong>
              </li>
            `,
              )
              .join('')}
          </ul>`
          : '<p style="font-style: italic; color: #666;">Brak pozycji w ofercie</p>';

      const { generateOfferItemsTable, generateDecisionMakersListTable } =
        await import('@/lib/offerTemplateHelpers');
      const offerItemsTable = generateOfferItemsTable(offerItemsArray || []);
      const decisionMakersListHtml = generateDecisionMakersListTable(
        (decisionMakers as unknown as DecisionMaker[]) || [],
      );

      const organizationAddress = joinContractParts([
        organization?.address,
        joinRawContractParts([organization?.postal_code, organization?.city], ' '),
      ]);
      const contactAddress = joinContractParts([
        contact?.address,
        joinRawContractParts([contact?.postal_code, contact?.city], ' '),
      ]);
      const clientContractPartyBlock = organization
        ? `<div data-contract-party="client"><p style="font:inherit;line-height:inherit;margin:0;text-align:justify;"><strong>${escapeContractText(
            compactContractParts([organization.name, organization.legal_form]).join(' '),
          )}</strong>${organizationAddress ? `, ${organizationAddress}` : ''}${
            organization.nip ? `, NIP ${escapeContractText(String(organization.nip))}` : ''
          }${organization.regon ? `, REGON ${escapeContractText(String(organization.regon))}` : ''}${
            organization.krs ? `, KRS ${escapeContractText(String(organization.krs))}` : ''
          }${
            legalRepresentativeFullName
              ? `, reprezentowaną przez <strong>${escapeContractText(legalRepresentativeFullName)}</strong>`
              : ''
          }, zwaną dalej „Zleceniodawcą”.</p></div>`
        : `<div data-contract-party="client"><p style="font:inherit;line-height:inherit;margin:0;text-align:justify;"><strong>${escapeContractText(
            contact?.full_name ||
              compactContractParts([contact?.first_name, contact?.last_name]).join(' ') ||
              'Zleceniodawca',
          )}</strong>${contactAddress ? `, ${contactAddress}` : ''}${
            contact?.pesel ? `, PESEL ${escapeContractText(String(contact.pesel))}` : ''
          }, zwaną/zwanym dalej „Zleceniodawcą”.</p></div>`;

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
      const executorFullAddress = joinContractParts([
        executorAddressLine,
        joinRawContractParts([executorCompany?.postal_code, executorCompany?.city], ' '),
      ]);
      const executorRepresentative =
        executorCompany?.signature_name || 'Mateusz Kwiatkowski';
      const executorRepresentativeTitle = executorCompany?.signature_title || '';
      const executorContractPartyBlock = `<div data-contract-party="executor"><p style="font:inherit;line-height:inherit;margin:0;text-align:justify;"><strong>${escapeContractText(
        executorCompany?.legal_name || executorCompany?.name || 'Mavinci Sp. z o.o.',
      )}</strong>${executorFullAddress ? `, ${executorFullAddress}` : ''}${
        executorCompany?.krs ? `, KRS ${escapeContractText(String(executorCompany.krs))}` : ''
      }${executorCompany?.nip ? `, NIP ${escapeContractText(String(executorCompany.nip))}` : ''}${
        executorCompany?.regon ? `, REGON ${escapeContractText(String(executorCompany.regon))}` : ''
      }, reprezentowaną przez <strong>${escapeContractText(executorRepresentative)}</strong>${
        executorRepresentativeTitle
          ? ` — ${escapeContractText(executorRepresentativeTitle)}`
          : ''
      }, zwaną dalej „Zleceniobiorcą”.</p></div>`;

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

        organization_name: organization?.name || '',
        organization_alias: organization?.alias || '',
        organization_nip: formatPrefixedValue(organization?.nip, 'NIP', ','),
        organization_krs: formatPrefixedValue(organization?.krs, 'KRS', ','),
        organization_regon: formatPrefixedValue(organization?.regon, 'REGON', ','),
        organization_legal_form: organization?.legal_form || '',
        organization_address: organization?.address || '',
        organization_city: organization?.city || '',
        organization_postal_code: organization?.postal_code || '',
        organization_phone: organization?.phone || '',
        organization_email: organization?.email || '',
        organization_country: organization?.country || '',
        organization_full_address:
          organization?.address + ', ' + organization?.postal_code + ' ' + organization?.city,

        event_name: event.name || '',
        event_date: formatDateOnly(event.event_date),
        event_end_date: formatDate(event.event_end_date),
        event_date_only: formatDateOnly(event.event_date),
        event_end_date_only: formatDateOnly(event.event_end_date),
        event_time_start: formatTimeOnly(event.event_date),
        event_time_end: formatTimeOnly(event.event_end_date),

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

        decision_makers_list: decisionMakersListHtml,
        client_contract_party_block: clientContractPartyBlock,

        budget:
          totalPrice.toLocaleString('pl-PL', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) + ' zł',
        budget_words: numberToWords(totalPrice),
        deposit_amount:
          depositAmount.toLocaleString('pl-PL', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }) + ' zł',
        deposit_words: numberToWords(depositAmount),

        contract_number: contractNumber,
        contract_date: new Date().toLocaleDateString('pl-PL'),

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

        offer_number: offers?.offer_number || '',
        offer_valid_until: offers?.valid_until ? formatDateOnly(offers.valid_until) : '',
        offer_scope:
          offerItemsArray.length > 0
            ? offerItemsArray
                .map(
                  (item: any, i: number) =>
                    `${i + 1}. ${item.name || 'Produkt'}${item.quantity ? ` (x${item.quantity})` : ''}`,
                )
                .join(', ')
            : '',

        offer_items: offerItemsHtml,
        OFFER_ITEMS_TABLE: offerItemsTable,
      };

      Object.entries(rawClauseSections).forEach(([key, value]) => {
        varsMap[key] = replaceVariables(value, varsMap);
      });
      const templateFlow = includeContractFonts(
        template.page_settings?.flowContent ||
          template.page_settings?.pages?.join('') || template.content_html || template.content,
        varsMap,
      );
      const clausePlacement = placeContractClauses(templateFlow, varsMap);
      const flowWithAutomaticClauses = clausePlacement.flowContent;
      Object.assign(varsMap, clausePlacement.variables);
      setUnplacedClauseCategories(clausePlacement.unplacedClauseCategories);
      const sourceMeta = {
        sourceOfferId: offers?.id || null,
        sourceOfferStatus: offers?.status || null,
        sourceOfferUpdatedAt: offers?.updated_at || null,
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
      if (existingContract?.content) {
        try {
          const parsedContract = JSON.parse(existingContract.content);
          if (
            parsedContract.meta?.individuallyEdited === true &&
            parsedContract.pages &&
            Array.isArray(parsedContract.pages)
          ) {
            const renderedContract = await renderContractDocument(
              deduplicateProductClauseSections(
                includeContractFonts(
                  parsedContract.flowContent || parsedContract.pages.join(''),
                  varsMap,
                ),
              ),
              parsedContract.settings || templateSettings,
            );
            contentToSet = JSON.stringify({
              ...parsedContract,
              ...renderedContract,
            });
            setContractSourceOutdated(
              parsedContract.meta?.sourceOfferId !== sourceMeta.sourceOfferId ||
                parsedContract.meta?.sourceOfferUpdatedAt !== sourceMeta.sourceOfferUpdatedAt,
            );
          }
        } catch {
          // Starszy zapis bez metadanych zostanie odbudowany z aktualnych źródeł.
        }
      }

      if (!contentToSet) {
        // Dopóki treść nie była edytowana indywidualnie, źródłem prawdy jest oferta i szablon.
        contentToSet = currentSourceContent;
      }
      setContractContent(contentToSet);
    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
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
      return isNaN(num) ? 0 : Math.round(num);
    };

    if (updatedVariables.budget) {
      const budgetNum = extractNumber(updatedVariables.budget);
      updatedVariables.budget_words = numberToWords(budgetNum);
    }

    if (updatedVariables.deposit_amount) {
      const depositNum = extractNumber(updatedVariables.deposit_amount);
      updatedVariables.deposit_words = numberToWords(depositNum);
    }

    setVariables(updatedVariables);
    setEditedVariables(updatedVariables);

    try {
      const parsed = JSON.parse(originalTemplate);
      if (parsed.pages && Array.isArray(parsed.pages)) {
        const renderedContract = await renderContractDocument(
          replaceVariables(
            includeContractFonts(parsed.flowContent || parsed.pages.join(''), updatedVariables),
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

      // If no variables loaded yet (first template pick), do full reload
      if (Object.keys(variables).length === 0) {
        await fetchContractData();
        return;
      }

      const { data: template, error } = await supabase
        .from('contract_templates')
        .select('id, name, content, content_html, page_settings')
        .eq('id', newTemplateId)
        .single();

      if (error) throw error;
      setSelectedTemplateId(newTemplateId);
      setTemplateId(newTemplateId);

      let templateToStore = template.content_html || template.content;

      if (template.page_settings?.pages) {
        const baseFlow = includeContractFonts(
          template.page_settings.flowContent || template.page_settings.pages.join(''),
          variables,
        );
        const clausePlacement = placeContractClauses(baseFlow, variables);
        const flowContent = clausePlacement.flowContent;
        setUnplacedClauseCategories(clausePlacement.unplacedClauseCategories);
        const settings = applyEventCompanyBranding(
          getTemplateSettings(template.page_settings),
          eventCompanyBranding,
        );
        templateToStore = JSON.stringify({
          pages: template.page_settings.pages,
          flowContent,
          settings,
        });
      }
      setOriginalTemplate(templateToStore);

      let contentToSet = '';
      if (template.page_settings?.pages) {
        const parsedTemplate = JSON.parse(templateToStore);
        const source = parsedTemplate.flowContent;
        const clausePlacement = placeContractClauses(source, variables);
        const renderedContract = await renderContractDocument(
          replaceVariables(clausePlacement.flowContent, clausePlacement.variables),
          applyEventCompanyBranding(
            getTemplateSettings(template.page_settings),
            eventCompanyBranding,
          ),
        );
        contentToSet = JSON.stringify(renderedContract);
      } else {
        const templateToUse = includeContractFonts(
          template.content_html || template.content,
          variables,
        );
        const clausePlacement = placeContractClauses(templateToUse, variables);
        setUnplacedClauseCategories(clausePlacement.unplacedClauseCategories);
        const renderedContract = await renderContractDocument(
          replaceVariables(clausePlacement.flowContent, clausePlacement.variables),
          applyEventCompanyBranding(
            getTemplateSettings(template.page_settings),
            eventCompanyBranding,
          ),
        );
        contentToSet = JSON.stringify(renderedContract);
      }
      setContractContent(contentToSet);

      if (contractId) {
        const { error: contractUpdateError } = await supabase
          .from('contracts')
          .update({
            template_id: newTemplateId,
            content: contentToSet,
            modified_after_generation: true,
          })
          .eq('id', contractId);

        if (contractUpdateError) throw contractUpdateError;
      }

      showSnackbar(`Zmieniono szablon na: ${template.name}`, 'success');
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

  const handleDeleteContract = async () => {
    if (!contractId) {
      showSnackbar('Brak umowy do usunięcia', 'warning');
      return;
    }

    const confirmed = window.confirm(
      'Czy na pewno chcesz usunąć tę umowę? Tej operacji nie można cofnąć.',
    );
    if (!confirmed) return;

    try {
      if (generatedPdfPath) {
        const { error: storageError } = await supabase.storage
          .from('event-files')
          .remove([generatedPdfPath]);
        if (storageError) {
          console.error('Error removing PDF from storage:', storageError);
        }

        const { error: filesError } = await supabase
          .from('event_files')
          .delete()
          .eq('event_id', eventId)
          .eq('file_path', generatedPdfPath);
        if (filesError) {
          console.error('Error removing event_files entry:', filesError);
        }
      }

      const { error } = await supabase.from('contracts').delete().eq('id', contractId);

      if (error) throw error;

      setContractId(null);
      setContractStatus('draft');
      setGeneratedPdfPath(null);
      setModifiedAfterGeneration(false);
      showSnackbar('Umowa została usunięta wraz z plikiem PDF', 'success');
      await fetchContractData();
    } catch (err) {
      console.error('Error deleting contract:', err);
      showSnackbar('Błąd podczas usuwania umowy', 'error');
    }
  };

  const handleStatusChange = async (newStatus: ContractStatus) => {
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
    if (contractLockedAt) return false;
    if (isAdmin) return true;
    return contractStatus === 'draft' || contractStatus === 'cancelled';
  }, [contractLockedAt, isAdmin, contractStatus]);

  const canSendEmail = useMemo(() => {
    if (!contractId) return false;
    if (isAdmin) return true;
    if (employee?.id && contractCreatedBy === employee.id) return true;
    return false;
  }, [isAdmin, employee, contractId, contractCreatedBy]);

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

  const actions = useMemo(() => {
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

    baseActions.push({
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
        label: modifiedAfterGeneration ? 'Regeneruj PDF' : 'Generuj PDF',
        onClick: handlePrint,
        icon: <Download className="h-4 w-4" />,
        variant: 'primary' as const,
      });
    } else {
      baseActions.push(
        {
          label: 'Pokaż PDF',
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
        label: 'Wyślij umowę',
        onClick: () => setShowSendEmailModal(true),
        icon: <Mail className="h-4 w-4" />,
        variant: 'default' as const,
      });
    }

    if (canEdit) {
      baseActions.unshift(
        {
          label: contractSourceOutdated ? 'Oferta zmieniona — odśwież' : 'Odśwież z oferty',
          onClick: handleRefreshFromOffer,
          icon: <RefreshCw className="h-4 w-4" />,
          variant: contractSourceOutdated ? ('primary' as const) : ('default' as const),
          disabled: !sourceContractContent,
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

    if (contractId && canEdit) {
      baseActions.push({
        label: 'Usuń umowę',
        onClick: handleDeleteContract,
        icon: <X className="h-4 w-4" />,
        variant: 'danger' as const,
      });
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
    handleDeleteContract,
    isGeneratingPdf,
    isPrintingDraft,
    contractSourceOutdated,
    sourceContractContent,
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
                Podgląd uwzględnia dane wydarzenia, ofertę i klauzule produktów. Draft nie jest
                dokumentem finalnym.
              </p>
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
            {contractSourceOutdated && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200 lg:col-span-2">
                Oferta lub jej produkty zmieniły się po indywidualnej edycji umowy. Użyj „Oferta
                zmieniona — odśwież”, aby ponownie pobrać pozycje i klauzule. Operacja zastąpi
                indywidualnie zmienioną treść.
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
            {!generatedPdfPath && availableTemplates.length > 0 && (
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 md:p-4">
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/50">
                  Szablon umowy
                </label>

                <select
                  value={selectedTemplateId || ''}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] transition-all hover:border-[#d3bb73]/40 focus:outline-none focus:ring-2 focus:ring-[#d3bb73]"
                >
                  {availableTemplates.map((template) => (
                    <option
                      key={template.id}
                      value={template.id}
                      className="bg-[#1c1f33] text-[#e5e4e2]"
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

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 md:p-4">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/50">
                Status umowy
              </label>

              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-[#d3bb73]">
                  Wersja {contractVersion}
                </span>
                {contractLockedAt && (
                  <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-green-300">
                    Dokument zablokowany po podpisaniu
                  </span>
                )}
                {companySignedAt && (
                  <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-blue-300">
                    Podpis firmy potwierdzony
                  </span>
                )}
              </div>

              <select
                value={contractStatus}
                onChange={(e) => handleStatusChange(e.target.value as ContractStatus)}
                disabled={!canEdit && contractStatus !== 'draft'}
                className="w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] transition-all hover:border-[#d3bb73]/40 focus:outline-none focus:ring-2 focus:ring-[#d3bb73] disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="bg-[#1c1f33] text-[#e5e4e2]"
                    >
                      {getStatusLabel(status)}
                    </option>
                  );
                })}
              </select>

              {!canEdit && contractStatus === 'issued' && (
                <p className="mt-2 text-xs text-amber-400/80">
                  Tylko admin może anulować wystawioną umowę
                </p>
              )}

              {getStatusDate(contractStatus) && (
                <div className="mt-4 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]/70 px-3 py-2">
                  <div className="text-xs text-[#e5e4e2]/50">Data zmiany statusu</div>
                  <div className="mt-0.5 text-sm font-medium text-[#d3bb73]">
                    {getStatusDate(contractStatus)}
                  </div>
                </div>
              )}

              {isAdmin && contractId && !companySignedAt && contractStatus !== 'draft' && contractStatus !== 'cancelled' && (
                <button
                  type="button"
                  onClick={confirmCompanySignature}
                  className="mt-3 w-full rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                >
                  Potwierdź podpis firmy
                </button>
              )}
            </div>
          </div>
        </div>

        {editMode && (
          <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Edycja zmiennych</h3>
            <div className="grid max-h-96 grid-cols-2 gap-4 overflow-y-auto">
              {Object.entries(editedVariables).map(([key, value]) => (
                <div key={key}>
                  <label className="mb-1 block text-sm text-[#e5e4e2]/60">
                    {key.replace(/_/g, ' ')}
                  </label>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) =>
                      setEditedVariables({ ...editedVariables, [key]: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                  />
                </div>
              ))}
            </div>
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

      {showSendEmailModal && contractId && (
        <SendContractEmailModal
          contractId={contractId}
          eventId={eventId}
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
