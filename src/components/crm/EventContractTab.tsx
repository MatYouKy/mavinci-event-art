'use client';

import { useState, useEffect, useMemo } from 'react';
import { FileText, Download, Edit, Save, X, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { numberToWords } from '@/lib/offerTemplateHelpers';
import '@/styles/contractA4.css';
import ResponsiveActionBar from './ResponsiveActionBar';
import SendContractEmailModal from './SendContractEmailModal';

interface Props {
  eventId: string;
}

const replaceVariables = (template: string, variables: Record<string, string>): string => {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  });
  return result;
};

type ContractStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'signed_by_client'
  | 'signed_returned'
  | 'cancelled';

export function EventContractTab({ eventId }: Props) {
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

  useEffect(() => {
    fetchContractData();
  }, [eventId]);

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
          'id, status, issued_at, sent_at, signed_by_client_at, signed_returned_at, cancelled_at, created_by',
        )
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const contact = event.contacts;
      const organization = event.organizations;

      setClientEmail(contact?.email || organization?.email || '');
      setClientName(contact?.full_name || organization?.name || '');

      if (existingContract) {
        setContractId(existingContract.id);
        setContractStatus(existingContract.status as ContractStatus);
        setContractCreatedBy(existingContract.created_by);
        setStatusDates({
          issued_at: existingContract.issued_at,
          sent_at: existingContract.sent_at,
          signed_by_client_at: existingContract.signed_by_client_at,
          signed_returned_at: existingContract.signed_returned_at,
          cancelled_at: existingContract.cancelled_at,
        });
      }

      const template = event.event_categories?.contract_templates;

      if (!template) {
        setTemplateExists(false);
        setLoading(false);
        return;
      }

      setTemplateExists(true);
      setTemplateId(template.id);

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

      const location = event.locations;

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
      const cleaned = value.replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
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

  const handlePrint = async () => {
    if (!contractId) {
      showSnackbar('Najpierw zapisz umowę', 'warning');
      return;
    }

    try {
      const { default: html2pdf } = await import('html2pdf.js');
      const html2pdfFn: any = (html2pdf as any) || html2pdf;

      const contractElement = document.querySelector('.contract-a4-wrapper');
      if (!contractElement) {
        window.print();
        return;
      }

      const opt: any = {
        margin: 0,
        filename: `umowa-${contractId}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };

      const worker = html2pdfFn().from(contractElement).set(opt).toPdf();
      const pdfBlob: Blob = await worker.output('blob');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const fileName = `umowa-${timestamp}.pdf`;
      const storagePath = `${eventId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('event-files')
        .upload(storagePath, pdfBlob, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (!uploadError) {
        await supabase.from('event_files').insert([
          {
            event_id: eventId,
            folder_id: null,
            name: fileName,
            original_name: fileName,
            file_path: storagePath,
            file_size: pdfBlob.size,
            mime_type: 'application/pdf',
            thumbnail_url: null,
            uploaded_by: employee?.id,
          },
        ]);

        showSnackbar('Umowa PDF została zapisana w zakładce Pliki', 'success');
      }

      const previewUrl = URL.createObjectURL(pdfBlob);
      window.open(previewUrl, '_blank');
    } catch (err) {
      console.error('Error generating PDF:', err);
      window.print();
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
          content: contractContent
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

    const baseActions = [
      {
        label: 'Pobierz PDF',
        onClick: handlePrint,
        icon: <Download className="h-4 w-4" />,
        variant: 'primary' as const,
      },
    ];

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

    return baseActions;
  }, [editMode, canEdit, canSendEmail, handleCancel, handleSave, handlePrint]);

  if (loading) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8">
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
                          src="/erulers_logo_vect.png"
                          alt="EVENT RULERS"
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

                  <div className="contract-footer">
                    <div className="footer-logo">
                      <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                    </div>
                    <div className="footer-info">
                      <p>
                        <span className="font-bold">EVENT RULERS</span> –{' '}
                        <span className="italic">Więcej niż Wodzireje!</span>
                      </p>
                      <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
                      <p>tel: 698-212-279</p>
                    </div>
                  </div>

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
          }
          return (
            <div className="contract-a4-page">
              <div className="contract-header-logo">
                <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
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
                  <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
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
