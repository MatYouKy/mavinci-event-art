'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Loader, Paperclip } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { buildInvoicePdfHtml } from './invoices/helpers/buildInvoicePdfHtml';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  dispatchCrmEmail,
  formatScheduledEmailDate,
  resolveScheduledEmailDate,
} from '@/lib/emailScheduling';
import UnifiedEmailComposer, {
  buildUnifiedEmailContent,
  buildUnifiedEmailHtml,
  hasUnifiedEmailBody,
  plainTextToEmailHtml,
  unifiedEmailHtmlToPlainText,
  type UnifiedEmailDraft,
} from './UnifiedEmailComposer';

interface SendInvoiceEmailModalProps {
  invoiceId: string;
  invoiceNumber: string;
  clientEmail?: string;
  clientName?: string;
  pdfStoragePath?: string | null;
  onClose: () => void;
  onSent?: () => void;
}

interface InvoiceData {
  id: string;
  invoice_number: string;
  invoice_type: string;
  is_proforma: boolean;
  issue_date: string;
  sale_date: string;
  issue_place: string;
  payment_method: string;
  payment_due_date: string;
  bank_account: string;
  bank_name: string;
  seller_name: string;
  seller_nip: string;
  seller_street: string;
  seller_city: string;
  seller_postal_code: string;
  buyer_name: string;
  buyer_nip: string;
  buyer_street: string;
  buyer_city: string;
  buyer_postal_code: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  company_logo_url: string | null;
  status: string;
  footer_note: string;
  signature_name: string;
  website: string;
}

interface InvoiceItem {
  id: string;
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  value_net: number;
  vat_amount: number;
  value_gross: number;
}

interface RecipientOption {
  contactId: string | null;
  email: string;
  name: string;
  position: string | null;
  preferred: boolean;
}

interface EmailAccount {
  id: string;
  email_address: string;
  from_name?: string | null;
  account_type?: 'personal' | 'shared' | 'system' | null;
  is_default?: boolean | null;
}

// function getTypeLabel(type: string) {
//   const labels: Record<string, string> = {
//     standard: 'Faktura VAT',
//     proforma: 'Faktura Proforma',
//     corrective: 'Faktura korygująca',
//   };
//   return labels[type] || 'Faktura VAT';
// }

export default function SendInvoiceEmailModal({
  invoiceId,
  invoiceNumber,
  clientEmail = '',
  clientName = '',
  pdfStoragePath,
  onClose,
  onSent,
}: SendInvoiceEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const { currentEmployee, loading: loadingEmployee } = useCurrentEmployee();
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [invoiceCompanyId, setInvoiceCompanyId] = useState<string | null>(null);
  const [recipientOptions, setRecipientOptions] = useState<RecipientOption[]>([]);
  const [recipientOrganizationName, setRecipientOrganizationName] = useState(clientName);
  const [selectedRecipientName, setSelectedRecipientName] = useState(clientName);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [formData, setFormData] = useState<UnifiedEmailDraft>({
    fromAccountId: '',
    to: clientEmail,
    cc: '',
    bcc: '',
    subject: `Faktura ${invoiceNumber}`,
    messageHtml: plainTextToEmailHtml(`Dzień dobry,

W załączeniu przesyłam fakturę ${invoiceNumber}.

W razie pytań proszę o kontakt.`),
  });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (clientEmail) {
      setFormData((prev) => ({ ...prev, to: clientEmail }));
    }
  }, [clientEmail]);

  useEffect(() => {
    if (loadingEmployee) return;
    if (!currentEmployee?.id) {
      setEmailAccounts([]);
      setLoadingAccounts(false);
      return;
    }

    let cancelled = false;
    const loadAccounts = async () => {
      setLoadingAccounts(true);
      try {
        const [personalResult, assignmentsResult] = await Promise.all([
          supabase
            .from('employee_email_accounts')
            .select('id,email_address,from_name,account_type,is_default')
            .eq('employee_id', currentEmployee.id)
            .eq('is_active', true)
            .or('account_type.is.null,account_type.neq.system'),
          supabase
            .from('employee_email_account_assignments')
            .select('email_account_id')
            .eq('employee_id', currentEmployee.id)
            .eq('can_send', true),
        ]);
        if (personalResult.error) throw personalResult.error;
        if (assignmentsResult.error) throw assignmentsResult.error;

        const assignedIds = (assignmentsResult.data || []).map((row) => row.email_account_id);
        let assignedAccounts: EmailAccount[] = [];
        if (assignedIds.length) {
          const result = await supabase
            .from('employee_email_accounts')
            .select('id,email_address,from_name,account_type,is_default')
            .in('id', assignedIds)
            .eq('is_active', true)
            .or('account_type.is.null,account_type.neq.system');
          if (result.error) throw result.error;
          assignedAccounts = result.data || [];
        }

        const accounts = Array.from(
          new Map(
            [...(personalResult.data || []), ...assignedAccounts].map((account) => [account.id, account]),
          ).values(),
        ).sort((left, right) => {
          if (Boolean(left.is_default) !== Boolean(right.is_default)) return left.is_default ? -1 : 1;
          return left.email_address.localeCompare(right.email_address, 'pl');
        });
        if (cancelled) return;
        setEmailAccounts(accounts);
        setFormData((current) => ({
          ...current,
          fromAccountId: accounts.some((account) => account.id === current.fromAccountId)
            ? current.fromAccountId
            : accounts[0]?.id || '',
        }));
      } catch (error) {
        console.error('Error loading invoice sender accounts:', error);
        if (!cancelled) showSnackbar('Nie udało się pobrać skrzynek pracownika', 'error');
      } finally {
        if (!cancelled) setLoadingAccounts(false);
      }
    };
    void loadAccounts();
    return () => {
      cancelled = true;
    };
  }, [currentEmployee?.id, loadingEmployee, showSnackbar]);

  useEffect(() => {
    setRecipientsLoading(true);
    (async () => {
      const { data: inv } = await supabase
        .from('invoices')
        .select(
          'my_company_id,event_id,organization_id,buyer_contact_id,buyer_email,buyer_name',
        )
        .eq('id', invoiceId)
        .maybeSingle();

      if (inv?.my_company_id) {
        setInvoiceCompanyId(inv.my_company_id);
      } else if (inv?.event_id) {
        const { data: evt } = await supabase
          .from('events')
          .select('my_company_id')
          .eq('id', inv.event_id)
          .maybeSingle();
        if (evt?.my_company_id) setInvoiceCompanyId(evt.my_company_id);
      }

      const organizationId = inv?.organization_id || null;
      if (!organizationId) {
        const fallback: RecipientOption[] = clientEmail
          ? [
              {
                contactId: inv?.buyer_contact_id || null,
                email: clientEmail,
                name: inv?.buyer_name || clientName || clientEmail,
                position: null,
                preferred: true,
              },
            ]
          : [];
        setRecipientOptions(fallback);
        setRecipientsLoading(false);
        return;
      }

      const [organizationResult, contactsResult, preferredContactsResult] = await Promise.all([
        supabase
          .from('organizations')
          .select('id,name,alias,email')
          .eq('id', organizationId)
          .maybeSingle(),
        supabase
          .from('contact_organizations')
          .select(
            `
              contact_id,
              position,
              is_primary,
              contact:contacts(id,full_name,first_name,last_name,email)
            `,
          )
          .eq('organization_id', organizationId)
          .eq('is_current', true)
          .order('is_primary', { ascending: false }),
        inv?.event_id
          ? supabase
              .from('event_billing_contacts')
              .select('contact_id,is_primary')
              .eq('event_id', inv.event_id)
              .eq('organization_id', organizationId)
              .order('is_primary', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);

      const organization = organizationResult.data;
      const preferredContactIds = new Set(
        (preferredContactsResult.data || []).map((row) => row.contact_id),
      );

      const optionsWithPriority = (contactsResult.data || [])
        .map((relation: any) => {
          const contact = relation.contact;
          if (!contact?.email) return null;
          return {
            contactId: contact.id,
            email: String(contact.email).trim(),
            name:
              contact.full_name ||
              `${contact.first_name || ''} ${contact.last_name || ''}`.trim() ||
              contact.email,
            position: relation.position || null,
            preferred: preferredContactIds.has(contact.id),
            organizationPrimary: Boolean(relation.is_primary),
          };
        })
        .filter(Boolean)
        .sort((left: any, right: any) => {
          if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
          if (left.organizationPrimary !== right.organizationPrimary) {
            return left.organizationPrimary ? -1 : 1;
          }
          return left.name.localeCompare(right.name, 'pl');
        });

      const options: RecipientOption[] = optionsWithPriority.map(
        ({ organizationPrimary: _organizationPrimary, ...option }: any) => option,
      );

      if (organization?.email) {
        options.push({
          contactId: null,
          email: String(organization.email).trim(),
          name: organization.alias || organization.name,
          position: 'Ogólny adres organizacji',
          preferred: options.length === 0,
        });
      }

      if (inv?.buyer_email && !options.some((option) => option.email === inv.buyer_email)) {
        options.push({
          contactId: inv.buyer_contact_id || null,
          email: String(inv.buyer_email).trim(),
          name: inv.buyer_name || inv.buyer_email,
          position: 'Adres zapisany na fakturze',
          preferred: options.length === 0,
        });
      }

      const deduplicated = options.filter(
        (option, index, all) =>
          all.findIndex(
            (candidate) => candidate.email.toLowerCase() === option.email.toLowerCase(),
          ) === index,
      );

      setRecipientOptions(deduplicated);
      setRecipientOrganizationName(
        organization?.alias || organization?.name || inv?.buyer_name || '',
      );

      const suggestedRecipient = deduplicated[0];
      if (suggestedRecipient) {
        setFormData((previous) => ({ ...previous, to: suggestedRecipient.email }));
        setSelectedRecipientName(suggestedRecipient.name);
      }
      setRecipientsLoading(false);
    })().catch((error) => {
      console.error('Error loading invoice recipient suggestions:', error);
      setRecipientsLoading(false);
    });
  }, [invoiceId, clientEmail, clientName]);

  useEffect(() => {
    let cancelled = false;
    const refreshPreview = async () => {
      setPreviewLoading(true);
      try {
        const html = await buildUnifiedEmailHtml({
          draft: formData,
          purpose: 'invoice',
          recipientName: selectedRecipientName || clientName,
          companyId: invoiceCompanyId,
        });
        if (!cancelled) setPreviewHtml(html);
      } catch (error) {
        console.error('Error building invoice email preview:', error);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void refreshPreview();
    return () => {
      cancelled = true;
    };
  }, [formData, selectedRecipientName, clientName, invoiceCompanyId]);

  const generateInvoicePDF = async (): Promise<{ base64: string; filename: string }> => {
    const [invoiceRes, itemsRes] = await Promise.all([
      supabase.from('invoices').select('*').eq('id', invoiceId).single(),
      supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('position_number'),
    ]);

    if (invoiceRes.error || !invoiceRes.data) {
      throw new Error('Nie znaleziono faktury');
    }

    const invoice = invoiceRes.data as InvoiceData;
    const items = (itemsRes.data || []) as InvoiceItem[];

    const html = buildInvoicePdfHtml({
      buyerIsPrivatePerson: invoice.buyer_nip ? false : true,
      isProforma: invoice.is_proforma,
      footerNote: invoice.footer_note,
      signatureName: invoice.signature_name,
      website: invoice.website,
      invoiceNumber: invoice.invoice_number,
      invoiceType: invoice.invoice_type,
      issueDate: invoice.issue_date,
      saleDate: invoice.sale_date,
      issuePlace: invoice.issue_place,
      paymentMethod: invoice.payment_method,
      paymentDueDate: invoice.payment_due_date,
      bankAccount: invoice.bank_account,
      bankName: invoice.bank_name,
      sellerName: invoice.seller_name,
      sellerNip: invoice.seller_nip,
      sellerStreet: invoice.seller_street,
      sellerCity: invoice.seller_city,
      sellerPostalCode: invoice.seller_postal_code,
      buyerName: invoice.buyer_name,
      buyerNip: invoice.buyer_nip,
      buyerStreet: invoice.buyer_street,
      buyerCity: invoice.buyer_city,
      buyerPostalCode: invoice.buyer_postal_code,
      totalNet: invoice.total_net,
      totalVat: invoice.total_vat,
      totalGross: invoice.total_gross,
      companyLogoUrl: invoice.company_logo_url
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${invoice.company_logo_url}`
        : null,
      items: items.map((item) => ({
        positionNumber: item.position_number,
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        priceNet: item.price_net,
        vatRate: item.vat_rate,
        valueNet: item.value_net,
        vatAmount: item.vat_amount,
        valueGross: item.value_gross,
      })),
    });

    const response = await fetch('/bridge/invoices/invoice-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invoiceId,
        html,
        fileName: `Faktura_${invoiceNumber}.pdf`,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Nie udało się wygenerować PDF');
    }

    const result = await response.json();

    if (!result?.base64) {
      throw new Error('Route nie zwrócił zawartości PDF');
    }

    return {
      base64: result.base64,
      filename: result.filename || `Faktura_${invoiceNumber}.pdf`,
    };
  };

  const handleSend = async () => {
    if (!formData.to.trim()) {
      showSnackbar('Wprowadź adres email odbiorcy', 'error');
      return;
    }

    if (!formData.subject.trim()) {
      showSnackbar('Wprowadź temat wiadomości', 'error');
      return;
    }

    if (!hasUnifiedEmailBody(formData.messageHtml)) {
      showSnackbar('Wprowadź treść wiadomości', 'error');
      return;
    }

    if (!formData.fromAccountId) {
      showSnackbar('Wybierz skrzynkę pracownika, z której ma zostać wysłana faktura', 'error');
      return;
    }

    let scheduledAt: string | null;
    try {
      scheduledAt = resolveScheduledEmailDate(formData);
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nieprawidłowy termin wysyłki', 'error');
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak sesji użytkownika', 'error');
        setLoading(false);
        return;
      }

      const attachments: Array<{ filename: string; content: string; contentType: string }> = [];

      try {
        let base64: string;
        const filename = `Faktura_${invoiceNumber}.pdf`;

        if (pdfStoragePath) {
          showSnackbar('Pobieram PDF ze storage...', 'info');
          const { data: signedData, error: signedErr } = await supabase.storage
            .from('event-files')
            .createSignedUrl(pdfStoragePath, 300);

          if (signedErr || !signedData?.signedUrl) {
            throw new Error('Nie udalo sie pobrac PDF ze storage');
          }

          const pdfResp = await fetch(signedData.signedUrl);
          if (!pdfResp.ok) throw new Error('Blad pobierania PDF');
          const buffer = await pdfResp.arrayBuffer();
          base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
          );
        } else {
          showSnackbar('Generuje PDF faktury...', 'info');
          const pdfData = await generateInvoicePDF();
          base64 = pdfData.base64;
        }

        attachments.push({
          filename,
          content: base64,
          contentType: 'application/pdf',
        });
        showSnackbar('PDF gotowy, wysylam email...', 'info');
      } catch (pdfError: unknown | Error) {
        console.error('Error preparing PDF:', pdfError);
        showSnackbar(
          `Nie udalo sie przygotowac PDF: ${pdfError instanceof Error ? pdfError.message : 'Nieznany błąd'}. Wysylam bez zalacznika.`,
          'warning',
        );
      }

      const currentEmail = await buildUnifiedEmailContent({
        draft: formData,
        purpose: 'invoice',
        recipientName: selectedRecipientName || clientName,
        companyId: invoiceCompanyId,
      });
      const result = await dispatchCrmEmail({
        accessToken: session.access_token,
        functionName: 'send-invoice-email',
        scheduledAt,
        metadata: {
          entityType: 'invoice',
          entityId: invoiceId,
          actionUrl: `/crm/invoices/${invoiceId}`,
        },
        payload: {
          invoiceId,
          emailAccountId: formData.fromAccountId,
          to: formData.to,
          cc: formData.cc,
          bcc: formData.bcc,
          subject: formData.subject,
          message: unifiedEmailHtmlToPlainText(formData.messageHtml),
          messageHtml: currentEmail.html,
          signatureHtml: currentEmail.signatureHtml,
          attachments,
          recipientName: selectedRecipientName || clientName,
        },
      });

      showSnackbar(
        result.scheduled && result.scheduledAt
          ? `Faktura zostanie wysłana ${formatScheduledEmailDate(result.scheduledAt)}`
          : 'Faktura wysłana przez email z załącznikiem PDF',
        'success',
      );
      onSent?.();
      onClose();
    } catch (error: unknown | Error) {
      console.error('Error sending email:', error);
      showSnackbar(
        error instanceof Error ? error.message : 'Nieznany błąd podczas wysyłania email',
        'error',
      );
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <div className="flex items-center gap-3">
            <Mail className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-light text-[#e5e4e2]">Wyślij fakturę przez email</h2>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <UnifiedEmailComposer
            draft={formData}
            onChange={(next) => {
              if (next.to !== formData.to) setSelectedRecipientName('');
              setFormData(next);
            }}
            accounts={emailAccounts}
            accountsLoading={loadingAccounts || loadingEmployee}
            disabled={loading}
            showPreview={showPreview}
            onShowPreviewChange={setShowPreview}
            previewHtml={previewHtml}
            previewLoading={previewLoading}
            recipientHint={recipientOrganizationName ? (
              <span>Nabywca faktury: {recipientOrganizationName}</span>
            ) : null}
            recipientSuggestions={
              <>
            {recipientsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-[#e5e4e2]/45">
                <Loader className="h-3.5 w-3.5 animate-spin" /> Pobieranie kontaktów nabywcy...
              </div>
            ) : recipientOptions.length > 0 ? (
              <div className="mt-3 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]/60 p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/45">
                  Kontakty organizacji wskazanej na fakturze
                </p>
                <div className="flex flex-wrap gap-2">
                  {recipientOptions.map((recipient) => {
                    const selected = formData.to === recipient.email;
                    return (
                      <button
                        key={`${recipient.contactId || 'organization'}-${recipient.email}`}
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setFormData((previous) => ({ ...previous, to: recipient.email }));
                          setSelectedRecipientName(recipient.name);
                        }}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                          selected
                            ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                            : 'border-[#d3bb73]/15 bg-[#1c1f33] hover:border-[#d3bb73]/40'
                        }`}
                      >
                        <span className="block text-sm text-[#e5e4e2]">
                          {recipient.name}
                          {recipient.preferred && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-[#d3bb73]">
                              opiekun
                            </span>
                          )}
                        </span>
                        {recipient.position && (
                          <span className="block text-[11px] text-[#e5e4e2]/40">
                            {recipient.position}
                          </span>
                        )}
                        <span className="block text-xs text-[#d3bb73]/75">{recipient.email}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-amber-300/70">
                Organizacja wskazana na fakturze nie ma kontaktu z adresem e-mail. Wpisz adres
                ręcznie albo uzupełnij kartotekę organizacji.
              </p>
            )}
              </>
            }
          >
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-4">
            <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
              <Paperclip className="h-4 w-4 text-[#d3bb73]" />
              <span>
                <strong>Załącznik:</strong> Faktura_{invoiceNumber}.pdf
                {pdfStoragePath ? ' (z zapisanego PDF)' : ' (zostanie wygenerowany)'}
              </span>
            </div>
          </div>
          </UnifiedEmailComposer>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={onClose}
            disabled={loading || loadingAccounts || !formData.fromAccountId}
            className="rounded-lg px-6 py-2.5 text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                {formData.deliveryMode === 'scheduled' ? 'Planowanie...' : 'Wysyłanie...'}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {formData.deliveryMode === 'scheduled' ? 'Zaplanuj fakturę' : 'Wyślij fakturę'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
