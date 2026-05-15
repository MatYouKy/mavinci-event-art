/* eslint-disable @next/next/no-img-element */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Download, CreditCard as Edit, Save, X, Mail, Eye, Loader } from 'lucide-react';
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
import { getContractCssForPrint } from '../calculations/helpers/getContractCssForPrint';

export interface DecisionMaker {
  id: string;
  title: string;
  can_sign_contracts: boolean;
  notes: string;
  contact: UnifiedContact;
}

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
});



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
  const { showSnackbar } = useSnackbar();
  const { isAdmin, employee } = useCurrentEmployee();
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [contractContent, setContractContent] = useState('');
  const [originalTemplate, setOriginalTemplate] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [editedVariables, setEditedVariables] = useState<Record<string, string>>({});
  const [templateExists, setTemplateExists] = useState(false);
  const [contractStatus, setContractStatus] = useState<ContractStatus>('draft');
  const [contractId, setContractId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [contractCreatedBy, setContractCreatedBy] = useState<string | null>(null);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
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
          selected_contract_template_id,
          locations:location_id(name, formatted_address, address, city, postal_code),
          organizations:organization_id(
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

      const { data: decisionMakers, error: decisionMakersError } = await supabase
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

      if (eventError) throw eventError;

      const { data: existingContract } = await supabase
        .from('contracts')
        .select(
          'id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation, content',
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

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
        ? (template as {
            id: string;
            name: string;
            content: string;
            content_html: string;
            page_settings: any;
          })
        : null;

      if (!template && !event.selected_contract_template_id) {
        setTemplateExists(false);
        setLoading(false);
        return;
      }

      const finalTemplateId = event.selected_contract_template_id || template.id;

      const { data: selectedTemplate, error: selectedTemplateError } = await supabase
        .from('contract_templates')
        .select('id, name, content, content_html, page_settings')
        .eq('id', finalTemplateId)
        .single();

      if (selectedTemplateError) throw selectedTemplateError;
      if (!selectedTemplate) throw new Error('Nie znaleziono wybranego szablonu');

      template = selectedTemplate;

      setTemplateExists(true);
      setTemplateId(template.id);
      setSelectedTemplateId(template.id);

      let templateToStore = template.content_html || template.content;
      let pageSettingsToStore = template.page_settings;

      if (template.page_settings?.pages) {
        templateToStore = JSON.stringify({
          pages: template.page_settings.pages,
          settings: {
            logoScale: template.page_settings.logoScale || 80,
            logoPositionX: template.page_settings.logoPositionX || 50,
            logoPositionY: template.page_settings.logoPositionY || 0,
            lineHeight: template.page_settings.lineHeight || 1.6,
            selectedLogo: template.page_settings.selectedLogo || '/erulers_logo_vect.png',
            selectedFooter: template.page_settings.selectedFooter || 'default',
            footerContent: template.page_settings.footerContent || {
              companyName: 'EVENT RULERS',
              tagline: 'Więcej niż Wodzireje!',
              website: 'www.eventrulers.pl',
              email: 'biuro@eventrulers.pl',
              phone: '698-212-279',
              logoUrl: '/erulers_logo_vect.png',
            },
            footerLogoScale: template.page_settings.footerLogoScale || 80,
          },
        });
      }
      setOriginalTemplate(templateToStore);

      const { data: offers } = await supabase
        .from('offers')
        .select('id, total_amount, offer_number, valid_until')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let offerItems = null;
      if (offers?.id) {
        const { data: items } = await supabase
          .from('offer_items')
          .select('*')
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

      const varsMap: Record<string, string> = {
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
        organization_nip: organization?.nip || '',
        organization_krs: organization?.krs || '',
        organization_regon: organization?.regon || '',
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
        primary_contact_position: primaryContact?.position || '',
        primary_contact_email: primaryContactEmail || '',
        primary_contact_phone: primaryContactPhone || '',

        legal_representative_full_name: legalRepresentativeFullName,
        legal_representative_first_name: legalRepresentative?.first_name || '',
        legal_representative_last_name: legalRepresentative?.last_name || '',
        legal_representative_email: legalRepresentative?.email || '',
        legal_representative_phone: legalRepresentative?.phone || legalRepresentative?.mobile || '',
        legal_representative_pesel: legalRepresentative?.pesel || '',
        legal_representative_address: legalRepresentative?.address || '',
        legal_representative_city: legalRepresentative?.city || '',
        legal_representative_postal_code: legalRepresentative?.postal_code || '',
        legal_representative_title: organization?.legal_representative_title || '',

        decision_makers_list: decisionMakersListHtml,

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

        executor_name: 'Mavinci Sp. z o.o.',
        executor_address: 'ul. Marcina Kasprzaka 15/66',
        executor_postal_code: '10-057',
        executor_city: 'Olsztyn',
        executor_nip: '7394011583',
        executor_phone: '698-212-279',
        executor_email: 'biuro@mavinci.pl',

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

      setVariables(varsMap);
      setEditedVariables(varsMap);
      const templateSettings = getTemplateSettings(template.page_settings);
      let contentToSet = '';

      // Jeśli istnieje zapisana umowa, użyj jej contentu zamiast szablonu
      if (existingContract?.content) {
        try {
          const parsedContract = JSON.parse(existingContract.content);
          if (parsedContract.pages && Array.isArray(parsedContract.pages)) {
            contentToSet = JSON.stringify({
              ...parsedContract,
              settings: templateSettings,
            });
          } else {
            contentToSet = existingContract.content;
          }
        } catch {
          contentToSet = existingContract.content;
        }
      } else if (template.page_settings?.pages) {
        // Jeśli nie ma umowy, wygeneruj z szablonu
        const pages = template.page_settings.pages.map((page: string) =>
          replaceVariables(page, varsMap),
        );
        contentToSet = JSON.stringify({
          pages,
          settings: templateSettings,
        });
      } else {
        const templateToUse = template.content_html || template.content;
        contentToSet = replaceVariables(templateToUse, varsMap);
      }
      setContractContent(contentToSet);
    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
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
        const pages = parsed.pages.map((page: string) => replaceVariables(page, updatedVariables));
        setContractContent(
          JSON.stringify({
            pages,
            settings: parsed.settings,
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
      const { error: eventTemplateError } = await supabase
        .from('events')
        .update({
          selected_contract_template_id: newTemplateId,
        })
        .eq('id', eventId);

      if (eventTemplateError) throw eventTemplateError;
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
        templateToStore = JSON.stringify({
          pages: template.page_settings.pages,
          settings: {
            logoScale: template.page_settings.logoScale || 80,
            logoPositionX: template.page_settings.logoPositionX || 50,
            logoPositionY: template.page_settings.logoPositionY || 0,
            lineHeight: template.page_settings.lineHeight || 1.6,
            selectedLogo: template.page_settings.selectedLogo || '/erulers_logo_vect.png',
            selectedFooter: template.page_settings.selectedFooter || 'default',
            footerContent: template.page_settings.footerContent || {
              companyName: 'EVENT RULERS',
              tagline: 'Więcej niż Wodzireje!',
              website: 'www.eventrulers.pl',
              email: 'biuro@eventrulers.pl',
              phone: '698-212-279',
              logoUrl: '/erulers_logo_vect.png',
            },
            footerLogoScale: template.page_settings.footerLogoScale || 80,
          },
        });
      }
      setOriginalTemplate(templateToStore);

      let contentToSet = '';
      if (template.page_settings?.pages) {
        const pages = template.page_settings.pages.map((page: string) =>
          replaceVariables(page, variables),
        );
        contentToSet = JSON.stringify({
          pages,
          settings: getTemplateSettings(template.page_settings),
        });
      } else {
        const templateToUse = template.content_html || template.content;
        contentToSet = replaceVariables(templateToUse, variables);
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
      showSnackbar('Błąd podczas zmiany szablonu', 'error');
    }
  };

  const handlePrint = async () => {
    setIsGeneratingPdf(true);
    let currentContractId = contractId;

    // 1) upewnij się, że contract istnieje (zostawiam jak u Ciebie)
    if (!currentContractId) {
      if (!templateId) {
        showSnackbar('Brak szablonu umowy dla tej kategorii wydarzenia', 'error');
        return;
      }

      try {
        const { data: eventData } = await supabase
          .from('events')
          .select('contact_person_id, organization_id')
          .eq('id', eventId)
          .single();

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
          })
          .select('id')
          .single();

        if (createError) throw createError;
        currentContractId = newContract.id;
        setContractId(newContract.id);
      } catch (err) {
        console.error('Error creating contract:', err);
        showSnackbar('Błąd podczas tworzenia umowy', 'error');
        return;
      }
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

      const cssText = getContractCssForPrint();

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
        if (!templateId) {
          showSnackbar('Brak szablonu umowy dla tej kategorii wydarzenia', 'error');
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
    if (isAdmin) return true;
    return contractStatus === 'draft' || contractStatus === 'cancelled';
  }, [isAdmin, contractStatus]);

  const canSendEmail = useMemo(() => {
    if (!contractId) return false;
    if (isAdmin) return true;
    if (employee?.id && contractCreatedBy === employee.id) return true;
    return false;
  }, [isAdmin, employee, contractId, contractCreatedBy]);

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
      baseActions.unshift({
        label: 'Edytuj zmienne',
        onClick: () => setEditMode(true),
        icon: <Edit className="h-4 w-4" />,
        variant: 'default' as const,
      });
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
  ]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
        <div className="text-center text-[#e5e4e2]/60">Ładowanie danych umowy...</div>
      </div>
    );
  }

  if (!templateExists) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
        <div className="text-center">
          <FileText className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <h3 className="mb-2 text-xl text-[#e5e4e2]">Brak szablonu umowy</h3>
          <p className="mb-4 text-[#e5e4e2]/60">
            Dla tej kategorii wydarzenia nie został przypisany szablon umowy.
          </p>
          <p className="text-sm text-[#e5e4e2]/40">
            Przejdź do{' '}
            <a href="/crm/event-categories" className="text-[#d3bb73] hover:underline">
              kategorii wydarzeń
            </a>{' '}
            aby przypisać szablon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
          <div className="mb-5 flex flex-col gap-4 md:mb-6 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h2 className="text-xl font-light leading-tight text-[#e5e4e2] md:text-2xl">
                Umowa na realizację wydarzenia
              </h2>
              <p className="mt-1 text-sm text-[#e5e4e2]/50">
                Automatycznie wygenerowana z danych wydarzenia
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
                        minHeight: pageIndex === 0 ? '160mm' : '250mm',
                      }}
                      dangerouslySetInnerHTML={{ __html: pageContent }}
                    />

                    {settings.selectedFooter !== 'none' && (
                      <div className="contract-footer">
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
                              {settings.footerContent?.companyName || 'EVENT RULERS'}
                            </span>
                            {settings.footerContent?.tagline && (
                              <>
                                {' '}
                                – <span className="italic">{settings.footerContent.tagline}</span>
                              </>
                            )}
                          </p>
                          <p>
                            {settings.footerContent?.website || 'www.eventrulers.pl'} |{' '}
                            {settings.footerContent?.email || 'biuro@eventrulers.pl'}
                          </p>
                          <p>tel: {settings.footerContent?.phone || '698-212-279'}</p>
                        </div>
                      </div>
                    )}

                    {pages.length > 1 && (
                      <div className="absolute bottom-4 mx-auto w-[calc(100%-50mm)] text-center text-xs text-[#000]/50">
                        {pageIndex + 1} z {pages.length}
                      </div>
                    )}
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
