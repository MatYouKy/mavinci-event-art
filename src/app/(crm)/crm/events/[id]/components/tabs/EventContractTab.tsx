/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Download, Edit, Save, X, Mail, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { numberToWords, replaceVariables } from '@/lib/offerTemplateHelpers';
import '@/styles/contractA4.css';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import SendContractEmailModal from '@/components/crm/SendContractEmailModal';
import { UnifiedContact } from '@/store/slices/contactsSlice';
import { ILocation } from '@/app/(crm)/crm/locations/type';
import { buildContractHtml } from '../../helpers/buildContractHtml';

export const getContractCssForPrint = () => `
/* ===== BASE: contractA4.css (Twoje, 1:1) ===== */
.contract-a4-container {
  background: #f5f5f5;
  padding: 20px;
  min-height: 100vh;
}

.contract-a4-page {
  position: relative;
  width: 210mm;
  margin: 0 auto 20px auto;
  padding: 20mm 25mm 5mm;
  min-height: 297mm !important;
  background: white;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.6;
  color: #000;
  page-break-after: always;
  break-after: page;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.contract-a4-page:last-of-type { margin-bottom: 0; }

.contract-header-logo {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 4mm;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.contract-header-logo.justify-start { justify-content: flex-start; }
.contract-header-logo.justify-center { justify-content: center; }
.contract-header-logo.justify-end { justify-content: flex-end; }

.contract-header-logo img {
  height: auto;
  object-fit: contain;
  max-width: 80%;
}

.contract-current-date {
  position: absolute;
  top: 20mm;
  right: 25mm;
  text-align: right;
  font-size: 10pt;
  color: #333;
  font-weight: 500;
  z-index: 10;
}

.contract-content {
  flex: 1;
  text-align: justify;
  color: #000;
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.6;
  direction: ltr !important;
  unicode-bidi: embed !important;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

.contract-content > * {
  display: block;
  white-space: pre-wrap;
}

/* inline formatowanie */
.contract-content strong,
.contract-content b,
.contract-content em,
.contract-content i,
.contract-content u,
.contract-content s,
.contract-content strike,
.contract-content del {
  display: inline !important;
}

.contract-content p,
.contract-content pre {
  display: block;
  margin: 0;
  padding: 0;
  text-align: justify;
  white-space: pre-wrap;
  font-family: Arial, sans-serif;
  font-size: 12pt;
  line-height: 1.6;
  border: none;
  background: transparent;
  color: #000;
}

.contract-content s,
.contract-content strike,
.contract-content del {
  text-decoration-line: line-through;
  text-decoration-thickness: 2px;
  text-decoration-skip-ink: none;
}

.contract-content h1,
.contract-content h2,
.contract-content h3,
.contract-content h4 {
  display: block;
  margin-top: 1.5em;
  margin-bottom: 0.75em;
  font-weight: bold;
  white-space: pre-wrap;
  color: #000;
}

.contract-content h1 { font-size: 18pt; text-align: center; }
.contract-content h2 { font-size: 16pt; }
.contract-content h3 { font-size: 14pt; }

.contract-content strong,
.contract-content b { font-weight: bold; color: #000; }

.contract-content em,
.contract-content i { font-style: italic; color: #000; }

.contract-content u { text-decoration: underline; color: #000; }

.contract-footer {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #d3bb73;
  margin-top: auto;
  width: 100%;
  min-height: 15mm;
  padding-top: 5px;
  background: white;
  pointer-events: none;
  flex-shrink: 0;
  position: relative;
  opacity: 0.7;
}

.footer-logo {
  width: 100%;
  display: flex;
  justify-content: flex-start;
  align-items: center;
}

.footer-logo img { height: 50px; width: auto; object-fit: contain; }

.footer-info {
  width: 100%;
  text-align: right;
  font-size: 10pt;
  color: #333;
  line-height: 1.2;
}

.footer-info p { margin: 4px 0; color: #333; }
.footer-info strong { font-weight: bold; color: #000; }
.footer-info em { font-style: italic; color: #666; }

.footer-page-number {
  position: absolute;
  bottom: 10mm;
  right: 25mm;
  font-size: 10pt;
  color: #666;
}

/* ===== PRINT (iframe) ===== */
@page { size: A4 portrait; margin: 0; }

html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
}

* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

/* W iframe NIE robimy visibility:hidden na całe body — bo i tak drukujesz tylko iframe */
.contract-a4-container {
  background: #fff !important;
  padding: 0 !important;
  margin: 0 !important;
  min-height: auto !important;
  box-shadow: none !important;
}

/* kluczowe: usuń “centrowanie” i dolny margines kartki, żeby nie było białych przesunięć */
.contract-a4-page {
  margin: 0 !important;
  box-shadow: none !important;
  width: 210mm !important;
}

/* ostatnia strona bez dokładania pustej */
.contract-a4-page:last-child,
.contract-a4-page:last-of-type {
  page-break-after: auto !important;
  break-after: auto !important;
}

/* ===== PATCH: zamiennik Tailwinda dla numeracji stron ===== */
.contract-page-counter {
  position: absolute;
  bottom: 4mm;
  left: 25mm;
  right: 25mm;
  text-align: center;
  font-size: 10pt;
  color: rgba(0,0,0,0.5);
}
`;

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
          locations:location_id(name, formatted_address, address, city, postal_code),
          organizations:organization_id(name, nip, address, city, postal_code, phone, email),
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

      const { data: existingContract } = await supabase
        .from('contracts')
        .select(
          'id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by, generated_pdf_path, modified_after_generation',
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const contact = event.contacts as unknown as UnifiedContact | null;
      const organization = event.organizations as unknown as UnifiedContact | null;

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

      if (!template) {
        setTemplateExists(false);
        setLoading(false);
        return;
      }

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
        .select('id, total_amount')
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
      const depositAmount = Math.round(totalPrice * 0.5);

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
              <li style="margin-bottom: 8px;">
                <strong>${index + 1}. ${item.name || 'Produkt'}</strong>
                ${item.quantity ? `<br/><span style="margin-left: 20px; font-size: 11pt;">Ilość: ${item.quantity}</span>` : ''}
              </li>
            `,
              )
              .join('')}
          </ul>`
          : '<p style="font-style: italic; color: #666;">Brak pozycji w ofercie</p>';

      const { generateOfferItemsTable } = await import('@/lib/offerTemplateHelpers');
      const offerItemsTable = generateOfferItemsTable(offerItemsArray || []);

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
        organization_nip: organization?.nip || '',
        organization_address: organization?.address || '',
        organization_city: organization?.city || '',
        organization_postal_code: organization?.postal_code || '',
        organization_phone: organization?.phone || '',
        organization_email: organization?.email || '',

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

        executor_name: 'EVENT RULERS',
        executor_address: 'ul. Przykładowa 1',
        executor_postal_code: '30-000',
        executor_city: 'Kraków',
        executor_nip: '1234567890',
        executor_phone: '698-212-279',
        executor_email: 'biuro@eventrulers.pl',

        offer_items: offerItemsHtml,
        OFFER_ITEMS_TABLE: offerItemsTable,
      };

      setVariables(varsMap);
      setEditedVariables(varsMap);

      let contentToSet = '';
      if (template.page_settings?.pages) {
        const pages = template.page_settings.pages.map((page: string) =>
          replaceVariables(page, varsMap),
        );
        contentToSet = JSON.stringify({
          pages,
          settings: {
            logoScale: template.page_settings.logoScale || 80,
            logoPositionX: template.page_settings.logoPositionX || 50,
            logoPositionY: template.page_settings.logoPositionY || 0,
            lineHeight: template.page_settings.lineHeight || 1.6,
            selectedLogo: template.page_settings.selectedLogo || '/erulers_logo_vect.png',
            selectedFooter: template.page_settings.selectedFooter || 'default',
          },
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
          settings: {
            logoScale: template.page_settings.logoScale || 80,
            logoPositionX: template.page_settings.logoPositionX || 50,
            logoPositionY: template.page_settings.logoPositionY || 0,
            lineHeight: template.page_settings.lineHeight || 1.6,
          },
        });
      } else {
        const templateToUse = template.content_html || template.content;
        contentToSet = replaceVariables(templateToUse, variables);
      }
      setContractContent(contentToSet);

      showSnackbar(`Zmieniono szablon na: ${template.name}`, 'success');
    } catch (err) {
      console.error('Error changing template:', err);
      showSnackbar('Błąd podczas zmiany szablonu', 'error');
    }
  };

  const handlePrint = async () => {
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
      const { error } = await supabase.from('contracts').delete().eq('id', contractId);

      if (error) throw error;

      setContractId(null);
      setContractStatus('draft');
      setGeneratedPdfPath(null);
      setModifiedAfterGeneration(false);
      showSnackbar('Umowa została usunięta', 'success');
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
        <div className="no-print rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="mb-1 text-2xl font-light text-[#e5e4e2]">
                Umowa na realizację wydarzenia
              </h2>
              <p className="text-sm text-[#e5e4e2]/60">
                Automatycznie wygenerowana z danych wydarzenia
              </p>
            </div>
            <div className="flex items-center gap-3">
              <ResponsiveActionBar actions={actions} />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {!generatedPdfPath && availableTemplates.length > 0 && (
              <div className="max-w-md">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Szablon umowy
                  <span className="ml-2 text-xs text-amber-400">
                    (zmiana możliwa tylko przed generacją PDF)
                  </span>
                </label>
                <select
                  value={selectedTemplateId || ''}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] transition-all hover:border-[#d3bb73]/40 focus:outline-none focus:ring-2 focus:ring-[#d3bb73]"
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
              </div>
            )}

            <div className="flex items-center gap-6">
              <div className="max-w-md flex-1">
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Wybierz status
                  {!canEdit && contractStatus === 'issued' && (
                    <span className="ml-2 text-xs text-amber-400">
                      (🔒 Tylko admin może anulować)
                    </span>
                  )}
                </label>
                <select
                  value={contractStatus}
                  onChange={(e) => handleStatusChange(e.target.value as ContractStatus)}
                  disabled={!canEdit && contractStatus !== 'draft'}
                  className="w-full cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-base text-[#e5e4e2] transition-all hover:border-[#d3bb73]/40 focus:outline-none focus:ring-2 focus:ring-[#d3bb73] disabled:cursor-not-allowed disabled:opacity-50"
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
              </div>
              {getStatusDate(contractStatus) && (
                <div className="flex-1">
                  <div className="mb-1 text-sm text-[#e5e4e2]/60">Data zmiany statusu</div>
                  <div className="text-base font-medium text-[#d3bb73]">
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
                            src={`https://mavinci.pl${settings.selectedLogo}`}
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
                        minHeight: pageIndex === 0 ? '160mm' : '250mm',
                      }}
                      dangerouslySetInnerHTML={{ __html: pageContent }}
                    />

                    {settings.selectedFooter !== 'none' && (
                      <div className="contract-footer">
                        {settings.selectedFooter === 'default' && (
                          <div className="footer-logo">
                            <img
                              src={`https://mavinci.pl${settings.footerContent?.logoUrl || settings.selectedLogo}`}
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
              // Fallback dla starych szablonów
              return (
                <div className="contract-a4-page">
                  <div className="contract-header-logo">
                    <img src="https://mavinci.pl/erulers_logo_vect.png" alt="EVENT RULERS" />
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
                      <img src="https://mavinci.pl/erulers_logo_vect.png" alt="EVENT RULERS" />
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
