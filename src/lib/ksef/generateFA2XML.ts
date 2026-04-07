/**
 * Generator XML FA(2) dla KSeF
 * Generuje poprawny XML faktury zgodny z formatem FA(2) wymaganym przez KSeF
 */

interface InvoiceItem {
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

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  issue_date: string;
  sale_date: string;
  payment_due_date: string;
  payment_method: string;

  seller_name: string;
  seller_nip: string;
  seller_street: string;
  seller_postal_code: string;
  seller_city: string;
  seller_country: string;

  buyer_name: string;
  buyer_nip: string;
  buyer_street: string;
  buyer_postal_code: string;
  buyer_city: string;
  buyer_country: string;
  buyer_email?: string;
  buyer_phone?: string;

  bank_account?: string;

  total_net: number;
  total_vat: number;
  total_gross: number;

  invoice_items: InvoiceItem[];
}

/**
 * Escape XML special characters
 */
function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date: string): string {
  return date.split('T')[0];
}

/**
 * Format decimal to KSeF format (2 decimal places)
 */
function formatDecimal(value: number): string {
  return value.toFixed(2);
}

/**
 * Get VAT rate code for KSeF
 */
function getVatRateCode(rate: number): string {
  switch (rate) {
    case 23: return '23';
    case 8: return '8';
    case 5: return '5';
    case 0: return 'zw'; // zwolniony
    default: return '23';
  }
}

/**
 * Get payment method code for KSeF
 */
function getPaymentMethodCode(method: string): string {
  const methodUpper = method.toUpperCase();
  if (methodUpper.includes('PRZELEW') || methodUpper.includes('TRANSFER')) {
    return '6'; // Przelew
  }
  if (methodUpper.includes('GOTÓWKA') || methodUpper.includes('CASH')) {
    return '1'; // Gotówka
  }
  if (methodUpper.includes('KARTA') || methodUpper.includes('CARD')) {
    return '5'; // Karta płatnicza
  }
  return '6'; // Domyślnie przelew
}

/**
 * Generate FA(2) XML for KSeF invoice
 */
export function generateFA2XML(invoice: Invoice): string {
  const currentDateTime = new Date().toISOString();

  // Group items by VAT rate
  const itemsByVatRate = invoice.invoice_items.reduce((acc, item) => {
    const rate = item.vat_rate;
    if (!acc[rate]) {
      acc[rate] = [];
    }
    acc[rate].push(item);
    return acc;
  }, {} as Record<number, InvoiceItem[]>);

  // Calculate summary by VAT rate
  const vatSummary = Object.entries(itemsByVatRate).map(([rate, items]) => {
    const totalNet = items.reduce((sum, item) => sum + item.value_net, 0);
    const totalVat = items.reduce((sum, item) => sum + item.vat_amount, 0);
    const totalGross = items.reduce((sum, item) => sum + item.value_gross, 0);

    return {
      rate: Number(rate),
      netAmount: totalNet,
      vatAmount: totalVat,
      grossAmount: totalGross,
    };
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Naglowek>
    <KodFormularza kodSystemowy="FA(2)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>2</WariantFormularza>
    <DataWytworzeniaFa>${currentDateTime}</DataWytworzeniaFa>
    <SystemInfo>Mavinci CRM v1.0</SystemInfo>
  </Naglowek>

  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${escapeXml(invoice.seller_nip.replace(/[^0-9]/g, ''))}</NIP>
      <Nazwa>${escapeXml(invoice.seller_name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>${escapeXml(invoice.seller_street)}</AdresL1>
      <AdresL2>${escapeXml(invoice.seller_postal_code)} ${escapeXml(invoice.seller_city)}</AdresL2>
    </Adres>
  </Podmiot1>

  <Podmiot2>
    <DaneIdentyfikacyjne>
      ${invoice.buyer_nip ? `<NIP>${escapeXml(invoice.buyer_nip.replace(/[^0-9]/g, ''))}</NIP>` : ''}
      <Nazwa>${escapeXml(invoice.buyer_name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>${escapeXml(invoice.buyer_street)}</AdresL1>
      <AdresL2>${escapeXml(invoice.buyer_postal_code)} ${escapeXml(invoice.buyer_city)}</AdresL2>
    </Adres>
    ${invoice.buyer_email ? `<AdresEmail>${escapeXml(invoice.buyer_email)}</AdresEmail>` : ''}
    ${invoice.buyer_phone ? `<Telefon>${escapeXml(invoice.buyer_phone)}</Telefon>` : ''}
  </Podmiot2>

  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>${formatDate(invoice.issue_date)}</P_1>
    <P_1M>${escapeXml(invoice.seller_city)}</P_1M>
    <P_2A>${escapeXml(invoice.invoice_number)}</P_2A>
    <P_6>${formatDate(invoice.sale_date)}</P_6>

    ${invoice.invoice_items.map((item, index) => `
    <FaWiersz>
      <NrWierszaFa>${item.position_number}</NrWierszaFa>
      <P_7>${escapeXml(item.name)}</P_7>
      <P_8A>${escapeXml(item.unit)}</P_8A>
      <P_8B>${formatDecimal(item.quantity)}</P_8B>
      <P_9A>${formatDecimal(item.price_net)}</P_9A>
      <P_11>${formatDecimal(item.value_net)}</P_11>
      <P_12>${getVatRateCode(item.vat_rate)}</P_12>
    </FaWiersz>`).join('')}

    ${vatSummary.map((summary, index) => `
    <FaWierszCtrl>
      <LpFaWierszCtrl>${index + 1}</LpFaWierszCtrl>
      <P_11>${formatDecimal(summary.netAmount)}</P_11>
      <P_12>${getVatRateCode(summary.rate)}</P_12>
    </FaWierszCtrl>`).join('')}

    <P_13_1>${formatDecimal(invoice.total_net)}</P_13_1>
    <P_14_1>${formatDecimal(invoice.total_vat)}</P_14_1>
    <P_15>${formatDecimal(invoice.total_gross)}</P_15>

    <Zamowienie>
      <WartoscZamowienia>${formatDecimal(invoice.total_gross)}</WartoscZamowienia>
    </Zamowienie>

    <Platnosc>
      <Zaplacono>
        <DataZaplaty>${formatDate(invoice.payment_due_date)}</DataZaplaty>
        <FormaPlatnosci>${getPaymentMethodCode(invoice.payment_method)}</FormaPlatnosci>
      </Zaplacono>
      ${invoice.bank_account ? `
      <RachunekBankowy>
        <NrRB>${escapeXml(invoice.bank_account.replace(/\s/g, ''))}</NrRB>
      </RachunekBankowy>` : ''}
    </Platnosc>

    <Adnotacje>
      <P_16>2</P_16>
      <P_17>2</P_17>
      <P_18>2</P_18>
      <P_18A>2</P_18A>
      <Zwolnienie>
        <P_19N>1</P_19N>
      </Zwolnienie>
      <NoweSrodkiTransportu>
        <P_22N>1</P_22N>
      </NoweSrodkiTransportu>
      <P_23>2</P_23>
      <PMarzy>
        <P_PMarzyN>1</P_PMarzyN>
      </PMarzy>
    </Adnotacje>
  </Fa>
</Faktura>`;

  return xml;
}

/**
 * Validate XML against FA(2) requirements
 */
export function validateFA2Requirements(invoice: Invoice): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!invoice.invoice_number) errors.push('Brak numeru faktury');
  if (!invoice.issue_date) errors.push('Brak daty wystawienia');
  if (!invoice.sale_date) errors.push('Brak daty sprzedaży');

  // Seller validation
  if (!invoice.seller_nip || invoice.seller_nip.length < 10) {
    errors.push('Nieprawidłowy NIP sprzedawcy');
  }
  if (!invoice.seller_name) errors.push('Brak nazwy sprzedawcy');
  if (!invoice.seller_street) errors.push('Brak adresu sprzedawcy');
  if (!invoice.seller_city) errors.push('Brak miasta sprzedawcy');
  if (!invoice.seller_postal_code) errors.push('Brak kodu pocztowego sprzedawcy');

  // Buyer validation
  if (!invoice.buyer_name) errors.push('Brak nazwy nabywcy');

  // Items validation
  if (!invoice.invoice_items || invoice.invoice_items.length === 0) {
    errors.push('Brak pozycji na fakturze');
  }

  invoice.invoice_items.forEach((item, index) => {
    if (!item.name) errors.push(`Pozycja ${index + 1}: brak nazwy`);
    if (item.quantity <= 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa ilość`);
    if (item.price_net <= 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa cena`);
  });

  // Totals validation
  if (invoice.total_gross <= 0) errors.push('Nieprawidłowa suma brutto');

  return {
    valid: errors.length === 0,
    errors,
  };
}
