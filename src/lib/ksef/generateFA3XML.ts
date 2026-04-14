/**
 * Generator XML FA(3) dla KSeF
 * Wersja uporządkowana:
 * - prepareFA3Invoice() przygotowuje dane
 * - validatePreparedFA3Invoice() waliduje dane gotowe do XML
 * - generateFA3XML() buduje XML wyłącznie z przygotowanego modelu
 */

export type FA3CorrectionData = {
  correctedInvoiceNumber: string;
  correctedInvoiceIssueDate: string;
  correctedInvoiceKsefNumber?: string;
  correctedInvoiceWasInKsef: boolean;
  correctionReason: string;
};

export type FA3PreparedInvoice = {
  seller: {
    nip: string;
    name: string;
    street: string;
    postalCode: string;
    city: string;
    countryCode: string;
    email: string;
    phone: string;
  };
  buyer: {
    isGv: boolean;
    nip?: string;
    name: string;
    street: string;
    postalCode: string;
    city: string;
    countryCode: string;
    email?: string;
    phone?: string;
    customerNumber?: string;
    internalId?: string;
    isJst: boolean;
  };
  invoice: {
    marginProcedure: boolean;
    newTransport: boolean;
    metodaKasowa: boolean;
    samofakturowanie: boolean;
    odwrotneObciazenie: boolean;
    splitPayment: boolean;
    number: string;
    type: 'VAT' | 'ZAL' | 'KON' | 'KOR' | 'KOR_ZAL' | 'KOR_ROZ';
    issueDate: string;
    saleDate: string;
    paymentDueDate: string;
    paymentMethod: string;
    totalNet: number;
    totalVat: number;
    totalGross: number;
    bankAccount?: string;
    bankName?: string;
    correction?: FA3CorrectionData;
    items: Array<{
      lineNumber: number;
      name: string;
      unit: string;
      quantity: number;
      priceNet: number;
      valueNet: number;
      vatRate: number;
      vatAmount: number;
      valueGross: number;
      stanPrzed?: boolean;
    }>;
  };
};

type GenerateFA3XMLOptions = {
  debug?: boolean;
};

function pickFirstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeNip(nip?: string | null): string | undefined {
  const normalized = (nip || '').replace(/[^0-9]/g, '');
  return normalized || undefined;
}

function normalizeCountryCode(country?: string | null): string {
  const value = (country || '').trim().toUpperCase();

  if (!value) return 'PL';
  if (['PL', 'POLSKA', 'POLAND'].includes(value)) return 'PL';
  if (['DE', 'NIEMCY', 'GERMANY'].includes(value)) return 'DE';
  if (['CZ', 'CZECHY', 'CZECH REPUBLIC'].includes(value)) return 'CZ';
  if (['SK', 'SŁOWACJA', 'SLOWACJA', 'SLOVAKIA'].includes(value)) return 'SK';
  if (['GB', 'UK', 'WIELKA BRYTANIA', 'UNITED KINGDOM'].includes(value)) return 'GB';

  if (/^[A-Z]{2}$/.test(value)) return value;

  return 'PL';
}

function normalizeBankAccount(account?: string | null): string | undefined {
  const normalized = (account || '').replace(/\s+/g, '');
  return normalized || undefined;
}

function normalizePhone(phone?: string | null): string | undefined {
  const value = (phone || '').trim();
  return value || undefined;
}

function normalizeCustomerToken(value?: string | null): string | undefined {
  const normalized = (value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 256);

  return normalized || undefined;
}

function formatDate(date: string): string {
  return date.split('T')[0];
}

function formatDecimal(value: number): string {
  return Number(value || 0).toFixed(2);
}

function getVatRateCode(rate: number): string {
  switch (rate) {
    case 23:
      return '23';
    case 8:
      return '8';
    case 5:
      return '5';
    case 0:
      return 'zw';
    default:
      return '23';
  }
}

function getPaymentMethodCode(method: string): string {
  const methodUpper = (method || '').toUpperCase();

  if (methodUpper.includes('PRZELEW') || methodUpper.includes('TRANSFER')) {
    return '6';
  }
  if (methodUpper.includes('GOTÓWKA') || methodUpper.includes('CASH')) {
    return '1';
  }
  if (methodUpper.includes('KARTA') || methodUpper.includes('CARD')) {
    return '5';
  }

  return '6';
}

function buildPodmiot2Jst(data: FA3PreparedInvoice): string {
  const jstValue = data.buyer.isJst ? '1' : '2';
  const gvValue = data.buyer.isGv ? '1' : '2';

  return `
    <JST>${jstValue}</JST>
    <GV>${gvValue}</GV>`;
}

function buildPodmiot1Extra(data: FA3PreparedInvoice): string {
  const email = data.seller.email?.trim();
  const phone = data.seller.phone?.trim();
  const chunks: string[] = [];

  if (email || phone) {
    chunks.push(`
    <DaneKontaktowe>
      ${email ? `<Email>${escapeXml(email)}</Email>` : ''}
      ${phone ? `<Telefon>${escapeXml(phone)}</Telefon>` : ''}
    </DaneKontaktowe>`);
  }

  return chunks.join('');
}

function buildPodmiot2Extra(data: FA3PreparedInvoice): string {
  const email = data.buyer.email?.trim();
  const phone = data.buyer.phone?.trim();
  const customerNumber = data.buyer.customerNumber?.trim();
  const internalId = data.buyer.internalId?.trim();

  const chunks: string[] = [];

  if (email || phone) {
    chunks.push(`
    <DaneKontaktowe>
      ${email ? `<Email>${escapeXml(email)}</Email>` : ''}
      ${phone ? `<Telefon>${escapeXml(phone)}</Telefon>` : ''}
    </DaneKontaktowe>`);
  }

  if (customerNumber) {
    chunks.push(`
    <NrKlienta>${escapeXml(customerNumber)}</NrKlienta>`);
  }

  if (internalId) {
    chunks.push(`
    <IDNabywcy>${escapeXml(internalId)}</IDNabywcy>`);
  }

  return chunks.join('');
}

function buildAdnotacjeXml(data: FA3PreparedInvoice): string {
  const chunks: string[] = [];

  if (data.invoice.metodaKasowa === true) {
    chunks.push('<P_16>1</P_16>');
  } else {
    chunks.push('<P_16>2</P_16>');
  }
  if (data.invoice.samofakturowanie === true) {
    chunks.push('<P_17>1</P_17>');
  } else {
    chunks.push('<P_17>2</P_17>');
  }
  if (data.invoice.odwrotneObciazenie === true) {
    chunks.push('<P_18>1</P_18>');
  } else {
    chunks.push('<P_18>2</P_18>');
  }

  if (data.invoice.splitPayment === true) {
    chunks.push('<P_18A>1</P_18A>');
  } else {
    chunks.push('<P_18A>2</P_18A>');
  }

  // opcjonalne struktury (tylko gdy true)
  if (data.invoice.newTransport === true) {
    chunks.push(`
      <NoweSrodkiTransportu>
        <P_22N>1</P_22N>
      </NoweSrodkiTransportu>`);
  }

  if (data.invoice.marginProcedure === true) {
    chunks.push(`
      <PMarzy>
        <P_PMarzyN>1</P_PMarzyN>
      </PMarzy>`);
  }

  return `
    <Adnotacje>
      ${chunks.join('')}
    </Adnotacje>`;
}

function buildPaymentXml(data: FA3PreparedInvoice): string {
  const hasPayment =
    !!data.invoice.paymentDueDate ||
    !!data.invoice.paymentMethod ||
    !!data.invoice.bankAccount;

  if (!hasPayment) {
    return '';
  }

  return `
    <Platnosc>
      ${data.invoice.paymentDueDate ? `<TerminPlatnosci>${formatDate(data.invoice.paymentDueDate)}</TerminPlatnosci>` : ''}
      ${data.invoice.paymentMethod ? `<FormaPlatnosci>${getPaymentMethodCode(data.invoice.paymentMethod)}</FormaPlatnosci>` : ''}
      ${
        data.invoice.bankAccount
          ? `
      <RachunekBankowy>
        <NrRB>${escapeXml(data.invoice.bankAccount)}</NrRB>
      </RachunekBankowy>`
          : ''
      }
      ${data.invoice.bankName ? `<NazwaBanku>${escapeXml(data.invoice.bankName)}</NazwaBanku>` : ''}
    </Platnosc>`;
}

function getFa3RodzajFaktury(invoice: any): 'VAT' | 'ZAL' | 'KON' | 'KOR' | 'KOR_ZAL' | 'KOR_ROZ' {
  if (invoice?.invoice_type === 'corrective') {
    const relatedType = invoice?.corrected_invoice_type;
    if (relatedType === 'advance') return 'KOR_ZAL';
    if (relatedType === 'final') return 'KOR_ROZ';
    return 'KOR';
  }

  if (invoice?.is_advance === true || invoice?.invoice_type === 'advance') {
    return 'ZAL';
  }

  if (invoice?.is_final === true || invoice?.invoice_type === 'final') {
    return 'KON';
  }

  return 'VAT';
}

export function prepareFA3Invoice(invoice: any, organization: any): FA3PreparedInvoice {
  return {
    seller: {
      nip: normalizeNip(invoice?.seller_nip) || '',
      name: pickFirstNonEmpty(invoice?.seller_name) || '',
      street: pickFirstNonEmpty(invoice?.seller_street) || '',
      postalCode: pickFirstNonEmpty(invoice?.seller_postal_code) || '',
      city: pickFirstNonEmpty(invoice?.seller_city) || '',
      countryCode: normalizeCountryCode(invoice?.seller_country),
      email: pickFirstNonEmpty(invoice?.seller_email),
      phone: normalizePhone(pickFirstNonEmpty(invoice?.seller_phone)),
    },
    buyer: {
      nip: normalizeNip(pickFirstNonEmpty(invoice?.buyer_nip, organization?.nip)),
      name: pickFirstNonEmpty(invoice?.buyer_name, organization?.name) || '',
      street: pickFirstNonEmpty(invoice?.buyer_street, organization?.address) || '',
      postalCode: pickFirstNonEmpty(invoice?.buyer_postal_code, organization?.postal_code) || '',
      city: pickFirstNonEmpty(invoice?.buyer_city, organization?.city) || '',
      countryCode: normalizeCountryCode(
        pickFirstNonEmpty(invoice?.buyer_country, organization?.country),
      ),
      email: pickFirstNonEmpty(invoice?.buyer_email, organization?.email),
      phone: normalizePhone(pickFirstNonEmpty(invoice?.buyer_phone, organization?.phone)),
      customerNumber: normalizeCustomerToken(
        pickFirstNonEmpty(organization?.alias, organization?.krs, organization?.regon),
      ),
      internalId: normalizeCustomerToken(
        pickFirstNonEmpty(organization?.alias, organization?.krs, organization?.regon),
      ),
      isJst: organization?.is_jst ?? false,
      isGv: organization?.is_gv ?? false,
    },
    invoice: {
      number: pickFirstNonEmpty(invoice?.invoice_number) || '',
      marginProcedure: invoice?.margin_procedure ?? false,
      newTransport: invoice?.new_transport ?? false,
      splitPayment: invoice?.split_payment ?? false,
      metodaKasowa: invoice?.metoda_kasowa ?? false,
      samofakturowanie: invoice?.samofakturowanie ?? false,
      odwrotneObciazenie: invoice?.odwrotne_obciazenie ?? false,
      type: getFa3RodzajFaktury(invoice),
      issueDate: invoice?.issue_date || '',
      saleDate: invoice?.sale_date || '',
      paymentDueDate: invoice?.payment_due_date || '',
      paymentMethod: pickFirstNonEmpty(invoice?.payment_method) || 'przelew',
      totalNet: Number(invoice?.total_net || 0),
      totalVat: Number(invoice?.total_vat || 0),
      totalGross: Number(invoice?.total_gross || 0),
      bankAccount: normalizeBankAccount(invoice?.bank_account),
      bankName: pickFirstNonEmpty(invoice?.bank_name),
      correction: invoice?.invoice_type === 'corrective' ? {
        correctedInvoiceNumber: invoice?.corrected_invoice_number || '',
        correctedInvoiceIssueDate: invoice?.corrected_invoice_issue_date || '',
        correctedInvoiceKsefNumber: invoice?.corrected_invoice_ksef_number || undefined,
        correctedInvoiceWasInKsef: invoice?.corrected_invoice_was_in_ksef ?? false,
        correctionReason: invoice?.correction_reason || '',
      } : undefined,
      items: (invoice?.invoice_items || []).map((item: any, index: number) => ({
        lineNumber: Number(item?.position_number ?? index + 1),
        name: pickFirstNonEmpty(item?.name) || '',
        unit: pickFirstNonEmpty(item?.unit) || 'szt',
        quantity: Number(item?.quantity || 0),
        priceNet: Number(item?.price_net || 0),
        valueNet: Number(item?.value_net || 0),
        vatRate: Number(item?.vat_rate || 0),
        vatAmount: Number(item?.vat_amount || 0),
        valueGross: Number(item?.value_gross || 0),
      })),
    },
  };
}

export function validatePreparedFA3Invoice(
  data: FA3PreparedInvoice,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.invoice.number) errors.push('Brak numeru faktury');
  if (!data.invoice.issueDate) errors.push('Brak daty wystawienia');
  if (!data.invoice.saleDate) errors.push('Brak daty sprzedaży');

  if (!data.seller.nip || data.seller.nip.length !== 10) {
    errors.push('Nieprawidłowy NIP sprzedawcy');
  }

  if (!data.seller.name) errors.push('Brak nazwy sprzedawcy');
  if (!data.seller.street) errors.push('Brak ulicy sprzedawcy');
  if (!data.seller.postalCode) errors.push('Brak kodu pocztowego sprzedawcy');
  if (!data.seller.city) errors.push('Brak miasta sprzedawcy');
  if (!data.seller.email) errors.push('Brak email sprzedawcy');
  if (!data.seller.phone) errors.push('Brak telefonu sprzedawcy');

  if (!data.buyer.name) errors.push('Brak nazwy nabywcy');
  if (!data.buyer.street) errors.push('Brak ulicy nabywcy');
  if (!data.buyer.postalCode) errors.push('Brak kodu pocztowego nabywcy');
  if (!data.buyer.city) errors.push('Brak miasta nabywcy');

  if (!data.invoice.items.length) {
    errors.push('Brak pozycji faktury');
  }

  data.invoice.items.forEach((item, index) => {
    if (!item.name) errors.push(`Pozycja ${index + 1}: brak nazwy`);
    if (item.quantity <= 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa ilość`);
    if (item.priceNet < 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa cena netto`);
    if (item.valueNet < 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa wartość netto`);
  });

  const isCorrectiveType = ['KOR', 'KOR_ZAL', 'KOR_ROZ'].includes(data.invoice.type);

  if (!isCorrectiveType && data.invoice.totalGross <= 0) {
    errors.push('Nieprawidłowa suma brutto');
  }

  if (isCorrectiveType) {
    const correction = data.invoice.correction;
    if (!correction) {
      errors.push('Brak danych faktury korygowanej (DaneFaKorygowanej)');
    } else {
      if (!correction.correctedInvoiceNumber) {
        errors.push('Brak numeru faktury korygowanej');
      }
      if (!correction.correctedInvoiceIssueDate) {
        errors.push('Brak daty wystawienia faktury korygowanej');
      }
      if (!correction.correctionReason) {
        errors.push('Brak przyczyny korekty');
      }
      if (correction.correctedInvoiceWasInKsef && !correction.correctedInvoiceKsefNumber) {
        errors.push('Brak numeru KSeF faktury korygowanej');
      }
    }
  }

  if (
    !data.buyer.email &&
    !data.buyer.phone &&
    !data.buyer.customerNumber &&
    !data.buyer.internalId
  ) {
    errors.push(
      'Podmiot2 musi zawierać co najmniej jedno z pól: buyer.email, buyer.phone, buyer.customerNumber albo buyer.internalId',
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateFA3Requirements(
  data: FA3PreparedInvoice,
): { valid: boolean; errors: string[] } {
  return validatePreparedFA3Invoice(data);
}

export function debugFA3PreparedInvoice(data: FA3PreparedInvoice): void {
  const podmiot2Extra = buildPodmiot2Extra(data);

  const podmiot2Xml = `
  <Podmiot2>
    <DaneIdentyfikacyjne>
      ${data.buyer.nip ? `<NIP>${escapeXml(data.buyer.nip)}</NIP>` : ''}
      <Nazwa>${escapeXml(data.buyer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${escapeXml(data.buyer.countryCode)}</KodKraju>
      <AdresL1>${escapeXml(data.buyer.street)}</AdresL1>
      <AdresL2>${escapeXml(data.buyer.postalCode)} ${escapeXml(data.buyer.city)}</AdresL2>
    </Adres>${podmiot2Extra}
  </Podmiot2>`;
}

function buildDaneFaKorygowanejXml(data: FA3PreparedInvoice): string {
  const correction = data.invoice.correction;
  if (!correction) return '';

  const chunks: string[] = [];

  chunks.push(`<DaneFaKorygowanej>`);
  chunks.push(`  <DataWystFaKorygowanej>${formatDate(correction.correctedInvoiceIssueDate)}</DataWystFaKorygowanej>`);
  chunks.push(`  <NrFaKorygowanej>${escapeXml(correction.correctedInvoiceNumber)}</NrFaKorygowanej>`);

  if (correction.correctedInvoiceWasInKsef && correction.correctedInvoiceKsefNumber) {
    chunks.push(`  <NrKSeFFaKorygowanej>${escapeXml(correction.correctedInvoiceKsefNumber)}</NrKSeFFaKorygowanej>`);
  } else {
    chunks.push(`  <NrKSeFN>1</NrKSeFN>`);
  }

  chunks.push(`</DaneFaKorygowanej>`);

  return chunks.join('\n    ');
}

function buildPrzyczynaKorektyXml(data: FA3PreparedInvoice): string {
  const correction = data.invoice.correction;
  if (!correction?.correctionReason) return '';

  return `<PrzyczynaKorekty>${escapeXml(correction.correctionReason)}</PrzyczynaKorekty>`;
}

export function generateFA3XML(
  data: FA3PreparedInvoice,
  options: GenerateFA3XMLOptions = {},
): string {
  const currentDateTime = new Date().toISOString();

  const podmiot1Extra = buildPodmiot1Extra(data);
  const podmiot2Extra = buildPodmiot2Extra(data);
  const podmiot2Jst = buildPodmiot2Jst(data);
  const adnotacjeXml = buildAdnotacjeXml(data);
  const paymentXml = buildPaymentXml(data);
  const rodzajFaktury = data.invoice.type;
  const isCorrectiveType = ['KOR', 'KOR_ZAL', 'KOR_ROZ'].includes(rodzajFaktury);
  const daneFaKorygowanejXml = isCorrectiveType ? buildDaneFaKorygowanejXml(data) : '';
  const przyczynaKorektyXml = isCorrectiveType ? buildPrzyczynaKorektyXml(data) : '';

  const invoiceRowsXml = data.invoice.items
    .map(
      (item) => `
  <FaWiersz>
    <NrWierszaFa>${item.lineNumber}</NrWierszaFa>
    ${item.stanPrzed ? '<StanPrzed>1</StanPrzed>' : ''}
    <P_7>${escapeXml(item.name)}</P_7>
    <P_8A>${escapeXml(item.unit)}</P_8A>
    <P_8B>${formatDecimal(item.quantity)}</P_8B>
    <P_9A>${formatDecimal(item.priceNet)}</P_9A>
    <P_11>${formatDecimal(item.valueNet)}</P_11>
    <P_12>${getVatRateCode(item.vatRate)}</P_12>
  </FaWiersz>`
    )
    .join('');

  const rowsCtrlXml = `
  <FaWierszCtrl>
    <LiczbaWierszyFaktury>${data.invoice.items.length}</LiczbaWierszyFaktury>
    <WartoscWierszyFaktury>${formatDecimal(
      data.invoice.items.reduce((sum, item) => sum + Number(item.valueNet || 0), 0),
    )}</WartoscWierszyFaktury>
  </FaWierszCtrl>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>${currentDateTime}</DataWytworzeniaFa>
    <SystemInfo>Mavinci CRM v1.0</SystemInfo>
  </Naglowek>

  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${escapeXml(data.seller.nip)}</NIP>
      <Nazwa>${escapeXml(data.seller.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${escapeXml(data.seller.countryCode)}</KodKraju>
      <AdresL1>${escapeXml(data.seller.street)}</AdresL1>
      <AdresL2>${escapeXml(data.seller.postalCode)} ${escapeXml(data.seller.city)}</AdresL2>
    </Adres>
    ${podmiot1Extra}
  </Podmiot1>

  <Podmiot2>
    <DaneIdentyfikacyjne>
      ${data.buyer.nip ? `<NIP>${escapeXml(data.buyer.nip)}</NIP>` : ''}
      <Nazwa>${escapeXml(data.buyer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${escapeXml(data.buyer.countryCode)}</KodKraju>
      <AdresL1>${escapeXml(data.buyer.street)}</AdresL1>
      <AdresL2>${escapeXml(data.buyer.postalCode)} ${escapeXml(data.buyer.city)}</AdresL2>
    </Adres>
    ${podmiot2Extra}
    ${podmiot2Jst}
  </Podmiot2>

  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>${formatDate(data.invoice.issueDate)}</P_1>
    <P_1M>${escapeXml(data.seller.city)}</P_1M>
    <P_2>${escapeXml(data.invoice.number)}</P_2>
    <P_6>${formatDate(data.invoice.saleDate)}</P_6>
    <P_13_1>${formatDecimal(data.invoice.totalNet)}</P_13_1>
    <P_14_1>${formatDecimal(data.invoice.totalVat)}</P_14_1>
    <P_15>${formatDecimal(data.invoice.totalGross)}</P_15>
    ${daneFaKorygowanejXml}
    ${przyczynaKorektyXml}
    ${invoiceRowsXml}
    ${rowsCtrlXml}
    ${adnotacjeXml}
    ${paymentXml}
    <RodzajFaktury>${rodzajFaktury}</RodzajFaktury>
  </Fa>
</Faktura>`;
  return xml;
}