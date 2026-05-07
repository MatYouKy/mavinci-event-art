'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, FileText, AlertCircle, CheckCircle2, Building2, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { MyCompany } from '@/app/(crm)/crm/settings/my-companies/page';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  onSuccess: () => void;
}

interface Offer {
  id: string;
  offer_number: string;
  status: string;
  total_net: number;
  total_gross: number;
  items: Array<{
    name: string;
    quantity: number;
    price_net: number;
    vat_rate: number;
  }>;
}

interface EventDetails {
  name: string;
  event_date: string;
  organization_id: string;
  contact_person_id: string;
  organization_name: string | null;
  contact_name: string | null;
  buyer_nip: string | null;
  buyer_street: string | null;
  buyer_postal_code: string | null;
  buyer_city: string | null;
}

export default function IssueInvoiceFromEventModal({
  isOpen,
  onClose,
  eventId,
  onSuccess,
}: Props) {
  const { showSnackbar } = useSnackbar();

  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [sendingToKSeF, setSendingToKSeF] = useState(false);
  const [myCompanies, setMyCompanies] = useState<MyCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selectedOfferId, setSelectedOfferId] = useState<string>('');
  const [eventDetails, setEventDetails] = useState<EventDetails | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const [invoiceData, setInvoiceData] = useState({
    issue_date: new Date().toISOString().split('T')[0],
    sale_date: new Date().toISOString().split('T')[0],
    payment_days: 7,
  });

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, eventId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Pobierz firmy
      const { data: companies } = await supabase
        .from('my_companies')
        .select('*')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (companies) {
        setMyCompanies(companies);
        const defaultCompany = companies.find((c) => c.is_default);
        if (defaultCompany) {
          setSelectedCompanyId(defaultCompany.id);
        } else if (companies.length > 0) {
          setSelectedCompanyId(companies[0].id);
        }
      }

      // Pobierz oferty zaakceptowane dla eventu
      const { data: offersData } = await supabase
        .from('offers')
        .select(`
          id,
          offer_number,
          status,
          total_net,
          total_gross,
          offer_items (
            name,
            quantity,
            price_net,
            vat_rate
          )
        `)
        .eq('event_id', eventId)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });

      if (offersData && offersData.length > 0) {
        const formattedOffers = offersData.map((offer: any) => ({
          ...offer,
          items: offer.offer_items || [],
        }));
        setOffers(formattedOffers);
        setSelectedOfferId(formattedOffers[0].id);
      }

      // Pobierz szczegóły eventu
      const { data: event } = await supabase
        .from('events')
        .select(`
          name,
          event_date,
          organization_id,
          contact_person_id,
          organizations:organization_id (
            name,
            nip,
            street,
            postal_code,
            city
          ),
          contacts:contact_person_id (
            first_name,
            last_name,
            nip,
            street,
            postal_code,
            city
          )
        `)
        .eq('id', eventId)
        .single();

      if (event) {
        const org = event.organizations as any;
        const contact = event.contacts as any;

        setEventDetails({
          name: event.name,
          event_date: event.event_date,
          organization_id: event.organization_id,
          contact_person_id: event.contact_person_id,
          organization_name: org?.name || null,
          contact_name: contact ? `${contact.first_name} ${contact.last_name}` : null,
          buyer_nip: org?.nip || contact?.nip || null,
          buyer_street: org?.street || contact?.street || null,
          buyer_postal_code: org?.postal_code || contact?.postal_code || null,
          buyer_city: org?.city || contact?.city || null,
        });

        // Ustaw datę sprzedaży na datę eventu
        if (event.event_date) {
          setInvoiceData((prev) => ({
            ...prev,
            sale_date: event.event_date.split('T')[0],
          }));
        }
      }
    } catch (err: any) {
      console.error('Error fetching data:', err);
      showSnackbar('Błąd podczas ładowania danych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const validateInvoiceData = (): boolean => {
    const errors: string[] = [];

    if (!selectedCompanyId) {
      errors.push('Wybierz firmę wystawiającą fakturę');
    }

    if (!selectedOfferId || offers.length === 0) {
      errors.push('Brak zaakceptowanej oferty dla tego eventu');
    }

    if (!eventDetails) {
      errors.push('Brak danych eventu');
    }

    if (!eventDetails?.buyer_nip) {
      errors.push('Klient nie ma uzupełnionego numeru NIP - wymagany do KSeF');
    }

    if (!eventDetails?.buyer_street || !eventDetails?.buyer_city || !eventDetails?.buyer_postal_code) {
      errors.push('Klient nie ma kompletnych danych adresowych');
    }

    // Sprawdź czy firma ma kredencjały KSeF
    const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);
    if (selectedCompany) {
      // To sprawdzimy asynchronicznie
    }

    setValidationErrors(errors);
    return errors.length === 0;
  };

  const checkKSeFCredentials = async (): Promise<boolean> => {
    try {
      const { data } = await supabase
        .from('ksef_credentials')
        .select('id')
        .eq('my_company_id', selectedCompanyId)
        .eq('is_active', true)
        .maybeSingle();

      if (!data) {
        setValidationErrors((prev) => [
          ...prev,
          'Wybrana firma nie ma skonfigurowanych danych uwierzytelniających KSeF',
        ]);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Error checking KSeF credentials:', err);
      return false;
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidationErrors([]);

    const basicValid = validateInvoiceData();
    if (!basicValid) {
      setValidating(false);
      return;
    }

    const ksefValid = await checkKSeFCredentials();
    setValidating(false);

    if (ksefValid) {
      showSnackbar('Walidacja przeszła pomyślnie - można wystawić fakturę', 'success');
    }
  };

  const calculatePaymentDueDate = () => {
    const date = new Date(invoiceData.issue_date);
    date.setDate(date.getDate() + invoiceData.payment_days);
    return date.toISOString().split('T')[0];
  };

  const handleIssueInvoice = async () => {
    // Walidacja
    if (!validateInvoiceData()) {
      showSnackbar('Uzupełnij wszystkie wymagane dane', 'error');
      return;
    }

    const ksefValid = await checkKSeFCredentials();
    if (!ksefValid) {
      showSnackbar('Brak konfiguracji KSeF dla wybranej firmy', 'error');
      return;
    }

    try {
      setLoading(true);
      setSendingToKSeF(true);

      const selectedOffer = offers.find((o) => o.id === selectedOfferId);
      const selectedCompany = myCompanies.find((c) => c.id === selectedCompanyId);

      if (!selectedOffer || !selectedCompany || !eventDetails) {
        throw new Error('Brak wymaganych danych');
      }

      // 1. Wygeneruj numer faktury
      const { data: invoiceNumber, error: numberError } = await supabase.rpc(
        'generate_invoice_number',
        { p_invoice_type: 'vat' }
      );

      if (numberError || !invoiceNumber) {
        throw new Error('Nie udało się wygenerować numeru faktury');
      }

      // 2. Określ nabywcę (organizacja lub kontakt)
      const buyerId = eventDetails.organization_id || eventDetails.contact_person_id;
      const buyerName = eventDetails.organization_name || eventDetails.contact_name || '';

      // 3. Utwórz fakturę
      const { data: employee } = await supabase
        .from('employees')
        .select('id')
        .eq('id', (await supabase.auth.getUser()).data.user?.id)
        .maybeSingle();

      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          invoice_number: invoiceNumber,
          invoice_type: 'vat',
          status: 'draft',
          issue_date: invoiceData.issue_date,
          sale_date: invoiceData.sale_date,
          payment_due_date: calculatePaymentDueDate(),
          event_id: eventId,
          organization_id: buyerId,
          my_company_id: selectedCompanyId,
          seller_name: selectedCompany.legal_name,
          seller_nip: selectedCompany.nip,
          seller_street: '', // Uzupełni się z my_companies
          seller_postal_code: '',
          seller_city: '',
          seller_country: 'Polska',
          buyer_name: buyerName,
          buyer_nip: eventDetails.buyer_nip,
          buyer_street: eventDetails.buyer_street || '',
          buyer_postal_code: eventDetails.buyer_postal_code || '',
          buyer_city: eventDetails.buyer_city || '',
          buyer_country: 'Polska',
          payment_method: 'Przelew',
          bank_name: selectedCompany.bank_name || '',
          bank_account: selectedCompany.bank_account || '',
          issue_place: '',
          created_by: employee?.id,
        })
        .select()
        .single();

      if (invoiceError || !invoice) {
        throw new Error(invoiceError?.message || 'Nie udało się utworzyć faktury');
      }

      // 4. Dodaj pozycje faktury z oferty
      const itemsToInsert = selectedOffer.items.map((item, index) => {
        const valueNet = item.quantity * item.price_net;
        const vatAmount = Math.round((valueNet * item.vat_rate) / 100 * 100) / 100;
        const valueGross = valueNet + vatAmount;

        return {
          invoice_id: invoice.id,
          position_number: index + 1,
          name: item.name,
          unit: 'szt.',
          quantity: item.quantity,
          price_net: item.price_net,
          vat_rate: item.vat_rate,
          value_net: valueNet,
          vat_amount: vatAmount,
          value_gross: valueGross,
        };
      });

      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(itemsToInsert);

      if (itemsError) {
        throw new Error('Nie udało się dodać pozycji faktury');
      }

      // 5. Wyślij do KSeF
      const ksefResponse = await fetch('/bridge/ksef/invoices/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });

      const ksefData = await ksefResponse.json();

      if (!ksefResponse.ok) {
        // Szczegółowe błędy KSeF
        if (ksefData.details) {
          if (Array.isArray(ksefData.details)) {
            throw new Error(`Błędy KSeF:\n${ksefData.details.join('\n')}`);
          } else {
            throw new Error(`Błąd KSeF: ${ksefData.details}`);
          }
        }
        throw new Error(ksefData.error || 'Nie udało się wysłać faktury do KSeF');
      }

      // 6. Historia
      await supabase.from('invoice_history').insert({
        invoice_id: invoice.id,
        action: 'created_from_event',
        changed_by: employee?.id,
        changes: {
          event_id: eventId,
          offer_id: selectedOfferId,
          ksef_reference: ksefData.ksef_reference_number,
        },
      });

      showSnackbar(
        `Faktura ${invoiceNumber} została wystawiona i wysłana do KSeF`,
        'success'
      );

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error issuing invoice:', err);
      const errorMessage = err.message || 'Błąd podczas wystawiania faktury';
      showSnackbar(errorMessage, 'error');

      // Pokaż szczegółowe błędy
      if (errorMessage.includes('\n')) {
        const errors = errorMessage.split('\n');
        setValidationErrors(errors);
      }
    } finally {
      setLoading(false);
      setSendingToKSeF(false);
    }
  };

  if (!isOpen) return null;

  const selectedOffer = offers.find((o) => o.id === selectedOfferId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#d3bb73]/20 p-2">
              <FileText className="h-6 w-6 text-[#d3bb73]" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[#e5e4e2]">Wystaw Fakturę do KSeF</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {eventDetails?.name || 'Ładowanie...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Błędy walidacji */}
              {validationErrors.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    Wykryto problemy:
                  </div>
                  <ul className="ml-6 list-disc space-y-1 text-sm text-red-400">
                    {validationErrors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Firma wystawiająca */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Firma wystawiająca *
                </label>
                <select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                >
                  <option value="">Wybierz firmę...</option>
                  {myCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name} - NIP: {company.nip}
                      {company.is_default && ' (domyślna)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Oferta */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Oferta bazowa *
                </label>
                <select
                  value={selectedOfferId}
                  onChange={(e) => setSelectedOfferId(e.target.value)}
                  disabled={offers.length === 0}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] disabled:opacity-50 focus:border-[#d3bb73] focus:outline-none"
                >
                  {offers.length === 0 ? (
                    <option value="">Brak zaakceptowanych ofert</option>
                  ) : (
                    offers.map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        {offer.offer_number} - {offer.total_gross.toFixed(2)} zł brutto
                      </option>
                    ))
                  )}
                </select>
                {offers.length === 0 && (
                  <p className="mt-1 text-xs text-red-400">
                    Musisz najpierw zaakceptować ofertę dla tego eventu
                  </p>
                )}
              </div>

              {/* Nabywca */}
              {eventDetails && (
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#d3bb73]/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
                    <Building2 className="h-4 w-4" />
                    Nabywca
                  </div>
                  <div className="space-y-1 text-sm text-[#e5e4e2]/80">
                    <div className="font-medium">
                      {eventDetails.organization_name || eventDetails.contact_name || 'Brak danych'}
                    </div>
                    {eventDetails.buyer_nip && (
                      <div className="text-xs text-[#e5e4e2]/60">NIP: {eventDetails.buyer_nip}</div>
                    )}
                    {eventDetails.buyer_street && (
                      <div className="text-xs text-[#e5e4e2]/60">
                        {eventDetails.buyer_street}, {eventDetails.buyer_postal_code}{' '}
                        {eventDetails.buyer_city}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Daty */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Data wystawienia *
                  </label>
                  <input
                    type="date"
                    value={invoiceData.issue_date}
                    onChange={(e) =>
                      setInvoiceData({ ...invoiceData, issue_date: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Data sprzedaży *
                  </label>
                  <input
                    type="date"
                    value={invoiceData.sale_date}
                    onChange={(e) =>
                      setInvoiceData({ ...invoiceData, sale_date: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </div>

              {/* Termin płatności */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Termin płatności (dni) *
                </label>
                <input
                  type="number"
                  value={invoiceData.payment_days}
                  onChange={(e) =>
                    setInvoiceData({ ...invoiceData, payment_days: parseInt(e.target.value) })
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <p className="mt-1 text-xs text-[#e5e4e2]/60">
                  Data płatności: {calculatePaymentDueDate()}
                </p>
              </div>

              {/* Pozycje faktury (podgląd) */}
              {selectedOffer && (
                <div>
                  <div className="mb-2 text-sm font-medium text-[#e5e4e2]">
                    Pozycje z oferty ({selectedOffer.items.length})
                  </div>
                  <div className="space-y-2">
                    {selectedOffer.items.slice(0, 3).map((item, i) => (
                      <div
                        key={i}
                        className="rounded border border-[#d3bb73]/10 bg-[#0a0d1a] p-3 text-sm"
                      >
                        <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/60">
                          {item.quantity} x {item.price_net.toFixed(2)} zł + VAT {item.vat_rate}%
                        </div>
                      </div>
                    ))}
                    {selectedOffer.items.length > 3 && (
                      <div className="text-center text-xs text-[#e5e4e2]/40">
                        ... i {selectedOffer.items.length - 3} więcej
                      </div>
                    )}
                  </div>

                  <div className="mt-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                    <div className="flex justify-between text-lg font-medium">
                      <span className="text-[#e5e4e2]/60">Razem brutto:</span>
                      <span className="text-[#d3bb73]">
                        {selectedOffer.total_gross.toFixed(2)} zł
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Info KSeF */}
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400" />
                  <div className="text-sm text-blue-400">
                    <div className="mb-1 font-medium">Wysyłka do KSeF</div>
                    <div>
                      Faktura zostanie automatycznie wysłana do Krajowego Systemu e-Faktur. Przed
                      wysłaniem sprawdzana jest poprawność danych oraz dostępność certyfikatów.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={handleValidate}
            disabled={loading || validating || offers.length === 0}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-6 py-3 text-[#e5e4e2] hover:bg-[#d3bb73]/5 disabled:opacity-50"
          >
            {validating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Sprawdzanie...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-5 w-5" />
                Sprawdź poprawność
              </>
            )}
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/20 px-6 py-3 text-[#e5e4e2] hover:bg-[#d3bb73]/5"
            >
              Anuluj
            </button>
            <button
              onClick={handleIssueInvoice}
              disabled={loading || validationErrors.length > 0 || offers.length === 0}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {sendingToKSeF ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Wysyłanie do KSeF...
                </>
              ) : loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Tworzenie...
                </>
              ) : (
                <>
                  <FileText className="h-5 w-5" />
                  Wystaw i wyślij do KSeF
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
