import { getPaymentAwareInvoiceFooterNote } from '@/lib/invoices/paymentAwareFooterNote';
import { getInvoicePartyDataCorrection, type InvoicePartyDataBefore } from '@/lib/invoices/partyDataCorrection';

export type FA3VatCode = '23' | '8' | '5' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np I' | 'np II' | 'oo';

export type FA3VatSummary = {
  vatCode: FA3VatCode;
  net: number;
  vat: number;
  gross: number;
};

export type FA3CorrectionData = {
  kind?: 'amount' | 'party_data';
  partyDataBefore?: InvoicePartyDataBefore;
  correctedInvoiceNumber: string;
  correctedInvoiceIssueDate: string;
  correctedInvoiceKsefNumber?: string;
  correctedInvoiceWasInKsef: boolean;
  correctionReason: string;
  correctionType?: 1 | 2 | 3;
  amountBeforeCorrection?: number;
};

export type FA3SettledInvoice = {
  id?: string;
  invoiceNumber: string;
  invoiceType: string;
  issueDate?: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  ksefReferenceNumber?: string | null;
  ksef_reference_number?: string | null;
  vatBreakdown?: FA3VatSummary[];
};

export type FA3SettlementSummary = {
  invoiceTotalNet: number;
  invoiceTotalVat: number;
  invoiceTotalGross: number;
  settledNet: number;
  settledVat: number;
  settledGross: number;
  remainingNet: number;
  remainingVat: number;
  remainingGross: number;
};

/**
 * Rola odbiorcy w Podmiot3: 2 = jednostka wewnętrzna nabywcy (IDWew z NIP-em nabywcy),
 * 8 = jednostka podrzędna JST – odbiorca (własny NIP; nabywca w Podmiot2 ma JST = 1).
 */
export type FA3RecipientRole = 2 | 8;

/** Odbiorca zapisany wraz z fakturą (Podmiot3). */
export type FA3Recipient = {
  name: string;
  nip?: string;
  internalId?: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  role: FA3RecipientRole;
};

export type FA3PreparedInvoice = {
  recipient?: FA3Recipient;
  seller: {
    nip: string;
    name: string;
    street: string;
    postalCode: string;
    city: string;
    countryCode: string;
    email?: string;
    phone?: string;
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
    /** Opcjonalny klucz FA(3) IDNabywcy (do 32 znaków), nie nazwa ani alias. */
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
    type: 'VAT' | 'ZAL' | 'ROZ' | 'KOR' | 'KOR_ZAL' | 'KOR_ROZ';
    footerNote?: string;
    currencyCode: string;
    isFinalInvoice: boolean;
    settledInvoices: FA3SettledInvoice[];
    settlementSummary?: FA3SettlementSummary;
    issueDate: string;
    saleDate: string;
    paymentDueDate: string;
    paymentMethod: string;
    paymentDate?: string | null;
    paidAmount?: number | null;
    paymentStatus?: 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'refund_due' | 'partially_refunded' | 'refunded' | 'not_applicable' | null;
    totalNet: number;
    totalVat: number;
    totalGross: number;
    vatSummary: FA3VatSummary[];
    orderItems: Array<{
      lineNumber: number;
      name: string;
      unit: string;
      quantity: number;
      priceNet: number;
      valueNet: number;
      vatRate: number;
      vatCode: FA3VatCode;
      vatAmount: number;
      valueGross: number;
      exemptionReason?: string;
    }>;
    orderTotalGross?: number;
    bankAccount?: string;
    bankName?: string;
    bankSwiftCode?: string;
    correction?: FA3CorrectionData;
    items: Array<{
      lineNumber: number;
      name: string;
      unit: string;
      quantity: number;
      priceNet: number;
      valueNet: number;
      vatRate: number;
      vatCode: FA3VatCode;
      exemptionReason?: string;
      vatAmount: number;
      valueGross: number;
      stanPrzed?: boolean;
    }>;
  };
};

type GenerateFA3XMLOptions = {
  debug?: boolean;
};

// Słowniki i ograniczenia FA(3) 1-0E, a nie bieżące słowniki środowiska JS:
// https://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd
const FA3_CURRENCIES = new Set(('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GGP GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS IMP INR IQD IRR ISK JEP JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XUA XXX YER ZAR ZMW ZWL').split(' '));
const FA3_COUNTRIES = new Set(('AF AX AL DZ AD AO AI AQ AG AN SA AR AM AW AU AT AZ BS BH BD BB BE BZ BJ BM BT BY BO BQ BA BW BR BN IO BG BF BI XC CL CN HR CW CY TD ME DK DM DO DJ EG EC ER EE ET FK FJ PH FI FR TF GA GM GH GI GR GD GL GE GU GG GY GF GP GT GN GQ GW HT ES HN HK IN ID IQ IR IE IS IL JM JP YE JE JO KY KH CM CA QA KZ KE KG KI CO KM CG CD KP XK CR CU KW LA LS LB LR LY LI LT LV LU MK MG YT MO MW MV MY ML MT MP MA MQ MR MU MX XL FM UM MD MC MN MS MZ MM NA NR NP NL DE NE NG NI NU NF NO NC NZ PS OM PK PW PA PG PY PE PN PF PL GS PT PR CF CZ KR ZA RE RU RO RW EH BL KN LC MF VC SV SV WS AS SM SN RS SC SL SG SK SI SO LK PM US SZ SD SS SR SJ SH SY CH SE TJ TH TW TZ TG TK TO TT TN TR TM TV UG UA UY UZ VU WF VA HU VE GB VN IT TL CI BV CX IM SX CK VI VG HM CC MH FO SB ST TC ZM CV ZW AE XI').split(' '));
const FA3_VAT_CODES = new Set<FA3VatCode>(['23', '8', '5', '0 KR', '0 WDT', '0 EX', 'zw', 'np I', 'np II', 'oo']);
const POLISH_NIP_PATTERN = /^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/;
const INTERNAL_ID_PATTERN = /^[1-9]((\d[1-9])|([1-9]\d))\d{7}-\d{5}$/;
const KSEF_NUMBER_PATTERN = /^([1-9]((\d[1-9])|([1-9]\d))\d{7}|M\d{9}|[A-Z]{3}\d{7})-(20[2-9][0-9]|2[1-9][0-9]{2}|[3-9][0-9]{3})(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1])-([0-9A-F]{6})-?([0-9A-F]{6})-([0-9A-F]{2})$/;

function hasValidXmlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
  });
}

function isValidPolishNip(value?: string): boolean {
  if (!value || !POLISH_NIP_PATTERN.test(value)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const checksum = weights.reduce((sum, weight, index) => sum + weight * Number(value[index]), 0) % 11;
  return checksum !== 10 && checksum === Number(value[9]);
}

function isValidFA3Date(value: string, minimum: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  const date = formatDate(value);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date &&
    date >= minimum && date <= '2050-01-01';
}

function validateFA3Text(errors: string[], label: string, value: string | undefined, maximum: number, required = false): void {
  const normalized = (value || '').replace(/[\t\n\r ]+/g, ' ').trim();
  if (required && !normalized) errors.push(`${label}: brak wartości`);
  if (Array.from(normalized).length > maximum) errors.push(`${label}: maksymalnie ${maximum} znaków. Treść nie została skrócona.`);
  if (value && !hasValidXmlCharacters(value)) errors.push(`${label}: niedozwolony znak XML; popraw treść przed wysłaniem`);
}

function validateFA3Number(errors: string[], label: string, value: number, maximum = 1e16): void {
  if (!Number.isFinite(value) || Math.abs(value) >= maximum) errors.push(`${label}: nieprawidłowa wartość liczbowa`);
}

function normalizeSwift(swift?: string | null): string | undefined {
  const value = (swift || '').replace(/\s+/g, '').toUpperCase();
  return value || undefined;
}

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
  // Usuwamy tylko polski prefiks i formatowanie. Zagranicznego identyfikatora
  // nie wolno zmieniać w pozorny polski NIP przez usunięcie jego liter.
  const normalized = (nip || '').trim().replace(/^PL(?=[\s\d-])/i, '').replace(/[\s-]+/g, '');
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

  return value;
}

function normalizeBankAccount(account?: string | null): string | undefined {
  const normalized = (account || '').replace(/\s+/g, '');
  return normalized || undefined;
}

function normalizePhone(phone?: string | null): string | undefined {
  const value = (phone || '').trim();
  return value || undefined;
}

function normalizeBuyerInternalId(value?: string | null): string | undefined {
  // xs:token: normalizujemy wyłącznie białe znaki XML, bez obcinania klucza.
  const normalized = (value || '').replace(/[\t\n\r ]+/g, ' ').replace(/^ +| +$/g, '');
  return normalized || undefined;
}

function buyerInternalIdValidationError(value?: string | null): string | undefined {
  const normalized = normalizeBuyerInternalId(value);
  if (normalized && Array.from(normalized).length > 32) {
    return 'Identyfikator nabywcy KSeF (IDNabywcy) może mieć maksymalnie 32 znaki. To opcjonalny klucz, nie nazwa organizacji. Pełnej nazwy nabywcy nie należy skracać.';
  }
  return undefined;
}

function normalizeKsefText(value?: string | null): string | undefined {
  const normalized = (value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || undefined;
}

function formatDate(date: string): string {
  return date.split('T')[0];
}

function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Nieprawidłowa kwota w fakturze KSeF');
  return value.toFixed(2);
}

function formatPreciseDecimal(value: number, digits: number): string {
  if (!Number.isFinite(value)) throw new Error('Nieprawidłowa ilość lub cena w fakturze KSeF');
  return value.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function normalizeVatCode(code: unknown, rate: number): FA3VatCode {
  const normalized = String(code ?? '').trim().toLowerCase();
  const recognized: Record<string, FA3VatCode> = {
    '23': '23',
    '8': '8',
    '5': '5',
    '0 kr': '0 KR',
    '0 wdt': '0 WDT',
    '0 ex': '0 EX',
    zw: 'zw',
    'np i': 'np I',
    'np ii': 'np II',
    oo: 'oo',
  };
  if (recognized[normalized]) {
    return recognized[normalized];
  }
  if (normalized === '0') {
    throw new Error('Stawka 0% wymaga wskazania rodzaju: krajowa, WDT albo eksport.');
  }
  if (normalized === 'np') {
    throw new Error('Pozycja niepodlegająca VAT wymaga wskazania: np I albo np II.');
  }

  if (normalized) throw new Error(`Nieobsługiwany kod VAT: ${String(code)}. Popraw stawkę przed wysłaniem do KSeF.`);

  switch (rate) {
    case 23:
      return '23';
    case 8:
      return '8';
    case 5:
      return '5';
    case 0:
      throw new Error('Stawka 0% wymaga wskazania rodzaju: krajowa, WDT albo eksport.');
    default:
      throw new Error(`Nieobsługiwana stawka VAT: ${rate}`);
  }
}

function getVatRateCode(code: FA3VatCode): string {
  return code;
}



function getPaymentMethodCode(method: string): string | undefined {
  const methodUpper = (method || '').toUpperCase();

  if (methodUpper.includes('PRZELEW') || methodUpper.includes('TRANSFER')) {
    return '6';
  }
  if (methodUpper.includes('GOTÓWKA') || methodUpper.includes('CASH')) {
    return '1';
  }
  if (methodUpper.includes('KARTA') || methodUpper.includes('CARD')) {
    return '2';
  }
  if (methodUpper.includes('BON') || methodUpper.includes('VOUCHER')) return '3';
  if (methodUpper.includes('CZEK') || methodUpper.includes('CHEQUE')) return '4';
  if (methodUpper.includes('KREDYT') || methodUpper === 'CREDIT') return '5';
  if (methodUpper.includes('BLIK') || methodUpper.includes('MOBIL')) return '7';
  return undefined;
}

function buildPaymentMethodXml(method: string): string {
  if (!method) return '';
  const code = getPaymentMethodCode(method);
  return code ? `<FormaPlatnosci>${code}</FormaPlatnosci>`
    : `<PlatnoscInna>1</PlatnoscInna><OpisPlatnosci>${escapeXml(method)}</OpisPlatnosci>`;
}

function buildPodmiot3Xml(recipient?: FA3Recipient): string {
  if (!recipient) return '';
  const identity = recipient.internalId
    ? `<IDWew>${escapeXml(recipient.internalId)}</IDWew>`
    : recipient.nip ? `<NIP>${escapeXml(recipient.nip)}</NIP>` : '<BrakID>1</BrakID>';
  return `
  <Podmiot3>
    <DaneIdentyfikacyjne>
      ${identity}
      <Nazwa>${escapeXml(recipient.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${escapeXml(recipient.countryCode)}</KodKraju>
      <AdresL1>${escapeXml(recipient.street)}</AdresL1>
      <AdresL2>${escapeXml(recipient.postalCode)} ${escapeXml(recipient.city)}</AdresL2>
    </Adres>
    <Rola>${recipient.role}</Rola>
  </Podmiot3>`;
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
  const internalId = normalizeBuyerInternalId(data.buyer.internalId);
  const internalIdError = buyerInternalIdValidationError(internalId);
  // Chronimy także bezpośrednich użytkowników generatora, poza ścieżką walidacji API.
  if (internalIdError) throw new Error(internalIdError);

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
  const p16 = data.invoice.metodaKasowa ? '1' : '2';
  const p17 = data.invoice.samofakturowanie ? '1' : '2';
  const p18 = data.invoice.odwrotneObciazenie ? '1' : '2';
  const p18A = data.invoice.splitPayment ? '1' : '2';

  const exemptionItem = [...data.invoice.items, ...data.invoice.orderItems].find(
    (item) => item.vatCode === 'zw',
  );
  const zwolnienieXml = exemptionItem
    ? `
    <Zwolnienie>
      <P_19>1</P_19>
      <P_19A>${escapeXml(exemptionItem.exemptionReason)}</P_19A>
    </Zwolnienie>`
    : `
    <Zwolnienie>
      <P_19N>1</P_19N>
    </Zwolnienie>`;

  const noweSrodkiTransportuXml = data.invoice.newTransport
    ? `
    <NoweSrodkiTransportu>
      <P_22>1</P_22>
    </NoweSrodkiTransportu>`
    : `
    <NoweSrodkiTransportu>
      <P_22N>1</P_22N>
    </NoweSrodkiTransportu>`;

  const p23 = '2';

  const pMarzyXml = data.invoice.marginProcedure
    ? `
    <PMarzy>
      <P_PMarzy>1</P_PMarzy>
    </PMarzy>`
    : `
    <PMarzy>
      <P_PMarzyN>1</P_PMarzyN>
    </PMarzy>`;

  return `
    <Adnotacje>
      <P_16>${p16}</P_16>
      <P_17>${p17}</P_17>
      <P_18>${p18}</P_18>
      <P_18A>${p18A}</P_18A>${zwolnienieXml}${noweSrodkiTransportuXml}
      <P_23>${p23}</P_23>${pMarzyXml}
    </Adnotacje>`;
}

function buildPaymentXml(data: FA3PreparedInvoice): string {
  // Korekta danych nie potwierdza nowej zapłaty ani nie tworzy zobowiązania.
  if (data.invoice.correction?.kind === 'party_data') return '';
  const paymentDueDate = data.invoice.paymentDueDate
    ? formatDate(data.invoice.paymentDueDate)
    : null;

  const shouldShowPaymentDueDate =
    !['paid', 'refund_due', 'partially_refunded', 'refunded'].includes(
      data.invoice.paymentStatus || '',
    ) && !!paymentDueDate;

  const paymentDate = data.invoice.paymentDate
    ? formatDate(data.invoice.paymentDate)
    : null;
  const paidAmount = Number(data.invoice.paidAmount ?? 0);
  const isPaid = data.invoice.paymentStatus === 'paid' && !!paymentDate;
  const isPartiallyPaid =
    data.invoice.paymentStatus === 'partially_paid' &&
    paidAmount > 0 &&
    !!paymentDate;

  const hasPayment =
    isPaid ||
    isPartiallyPaid ||
    shouldShowPaymentDueDate ||
    !!data.invoice.paymentMethod ||
    !!data.invoice.bankAccount;

  if (!hasPayment) return '';

  return `
    <Platnosc>
      ${
        isPaid
          ? `
      <Zaplacono>1</Zaplacono>
      <DataZaplaty>${paymentDate}</DataZaplaty>`
          : isPartiallyPaid
            ? `
      <ZnacznikZaplatyCzesciowej>1</ZnacznikZaplatyCzesciowej>
      <ZaplataCzesciowa>
        <KwotaZaplatyCzesciowej>${formatDecimal(paidAmount)}</KwotaZaplatyCzesciowej>
        <DataZaplatyCzesciowej>${paymentDate}</DataZaplatyCzesciowej>
        ${buildPaymentMethodXml(data.invoice.paymentMethod)}
      </ZaplataCzesciowa>`
            : ''
      }
      ${
        shouldShowPaymentDueDate
          ? `
      <TerminPlatnosci>
        <Termin>${paymentDueDate}</Termin>
      </TerminPlatnosci>`
          : ''
      }
      ${
        data.invoice.paymentMethod
          ? `
      ${buildPaymentMethodXml(data.invoice.paymentMethod)}`
          : ''
      }
      ${
        data.invoice.bankAccount
          ? `
      <RachunekBankowy>
        <NrRB>${escapeXml(data.invoice.bankAccount)}</NrRB>
        ${
          data.invoice.bankSwiftCode
            ? `<SWIFT>${escapeXml(data.invoice.bankSwiftCode)}</SWIFT>`
            : ''
        }
        ${
          data.invoice.bankName
            ? `<NazwaBanku>${escapeXml(data.invoice.bankName)}</NazwaBanku>`
            : ''
        }
      </RachunekBankowy>`
          : ''
      }
    </Platnosc>`;
}

function getFa3RodzajFaktury(invoice: any): 'VAT' | 'ZAL' | 'ROZ' | 'KOR' | 'KOR_ZAL' | 'KOR_ROZ' {
  const isFinalInvoice =
    invoice?.is_final_invoice === true ||
    invoice?.is_final === true ||
    invoice?.invoice_type === 'final' ||
    String(invoice?.invoice_number || '').startsWith('FKO/');

  if (invoice?.invoice_type === 'corrective') {
    const relatedType = invoice?.corrected_invoice_type;

    if (relatedType === 'advance') return 'KOR_ZAL';

    if (
      relatedType === 'final' ||
      String(invoice?.corrected_invoice_number || '').startsWith('FKO/')
    ) {
      return 'KOR_ROZ';
    }

    return 'KOR';
  }

  if (invoice?.is_advance === true || invoice?.invoice_type === 'advance') {
    return 'ZAL';
  }

  if (isFinalInvoice) {
    return 'ROZ';
  }

  return 'VAT';
}

function buildInvoiceItems(invoice: any): FA3PreparedInvoice['invoice']['items'] {
  const items: FA3PreparedInvoice['invoice']['items'] = [];
  const isCorrectiveInvoice = invoice?.invoice_type === 'corrective';

  (invoice?.invoice_items || []).forEach((item: any, index: number) => {
    const sourceLineNumber = Number(item?.position_number ?? index + 1);
    const name = pickFirstNonEmpty(item?.name) || '';
    const unit = pickFirstNonEmpty(item?.unit) || 'szt';
    const vatRate = Number(item?.vat_rate || 0);
    const vatCode = normalizeVatCode(item?.vat_code, vatRate);
    const exemptionReason = pickFirstNonEmpty(item?.vat_exemption_reason);

    const hasBefore = item?.before_quantity != null && item?.before_price_net != null;

    if (isCorrectiveInvoice && hasBefore) {
      const beforeQty = Number(item.before_quantity ?? 0);
      const beforePriceNet = Number(item.before_price_net ?? 0);
      const beforeValueNet = Number(item.before_value_net ?? beforeQty * beforePriceNet);
      const beforeVatAmount = Number(
        item.before_vat_amount ?? Math.round(beforeValueNet * vatRate) / 100,
      );
      const beforeValueGross = Number(item.before_value_gross ?? beforeValueNet + beforeVatAmount);

      items.push({
        lineNumber: items.length + 1,
        name,
        unit,
        quantity: beforeQty,
        priceNet: beforePriceNet,
        valueNet: beforeValueNet,
        vatRate,
        vatCode,
        exemptionReason,
        vatAmount: beforeVatAmount,
        valueGross: beforeValueGross,
        stanPrzed: true,
      });

      const afterQty = Number(item.after_quantity ?? item.quantity ?? 0);
      const afterPriceNet = Number(item.after_price_net ?? item.price_net ?? 0);
      const afterValueNet = Number(item.after_value_net ?? afterQty * afterPriceNet);
      const afterVatAmount = Number(
        item.after_vat_amount ?? Math.round(afterValueNet * vatRate) / 100,
      );
      const afterValueGross = Number(
        item.after_value_gross ?? afterValueNet + afterVatAmount,
      );

      items.push({
        lineNumber: items.length + 1,
        name,
        unit,
        quantity: afterQty,
        priceNet: afterPriceNet,
        valueNet: afterValueNet,
        vatRate,
        vatCode,
        exemptionReason,
        vatAmount: afterVatAmount,
        valueGross: afterValueGross,
      });

      return;
    }

    items.push({
      lineNumber: sourceLineNumber,
      name,
      unit,
      quantity: Number(item?.quantity || 0),
      priceNet: Number(item?.price_net || 0),
      valueNet: Number(item?.value_net || 0),
      vatRate,
      vatCode,
      exemptionReason,
      vatAmount: Number(item?.vat_amount || 0),
      valueGross: Number(item?.value_gross || 0),
    });
  });

  return items;
}

function buildVatSummary(items: any[]): FA3VatSummary[] {
  const buckets = new Map<FA3VatCode, FA3VatSummary>();

  items.forEach((item) => {
    const vatRate = Number(item?.vat_rate ?? 0);
    const vatCode = normalizeVatCode(item?.vat_code, vatRate);
    const current = buckets.get(vatCode) ?? { vatCode, net: 0, vat: 0, gross: 0 };
    current.net += Number(item?.value_net ?? 0);
    current.vat += Number(item?.vat_amount ?? 0);
    current.gross += Number(item?.value_gross ?? 0);
    buckets.set(vatCode, current);
  });

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    net: Number(bucket.net.toFixed(2)),
    vat: Number(bucket.vat.toFixed(2)),
    gross: Number(bucket.gross.toFixed(2)),
  }));
}

function normalizeVatBreakdown(value: unknown): FA3VatSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry: any) => {
    const vatCode = normalizeVatCode(entry?.vatCode ?? entry?.vat_code, Number(entry?.vatRate ?? 0));
    return {
      vatCode,
      net: Number(entry?.net ?? entry?.valueNet ?? entry?.value_net ?? 0),
      vat: Number(entry?.vat ?? entry?.vatAmount ?? entry?.vat_amount ?? 0),
      gross: Number(entry?.gross ?? entry?.valueGross ?? entry?.value_gross ?? 0),
    };
  });
}

function buildOrderItems(invoice: any): FA3PreparedInvoice['invoice']['orderItems'] {
  const rawItems =
    Array.isArray(invoice?.invoice_order_items) && invoice.invoice_order_items.length
      ? invoice.invoice_order_items
      : invoice?.invoice_items || [];

  return rawItems.map((item: any, index: number) => {
    const vatRate = Number(item?.vat_rate ?? 0);
    const vatCode = normalizeVatCode(item?.vat_code, vatRate);
    const quantity = Number(item?.quantity ?? 0);
    const priceNet = Number(item?.price_net ?? 0);
    const valueNet = Number(item?.value_net ?? quantity * priceNet);
    const vatAmount = Number(item?.vat_amount ?? (valueNet * vatRate) / 100);
    return {
      lineNumber: Number(item?.position_number ?? index + 1),
      name: pickFirstNonEmpty(item?.name) || '',
      unit: pickFirstNonEmpty(item?.unit) || 'szt.',
      quantity,
      priceNet,
      valueNet,
      vatRate,
      vatCode,
      exemptionReason: pickFirstNonEmpty(item?.vat_exemption_reason),
      vatAmount,
      valueGross: Number(item?.value_gross ?? valueNet + vatAmount),
    };
  });
}

export function prepareFA3Invoice(
  invoice: any,
  _organization: any,
  recipient?: FA3Recipient | null,
): FA3PreparedInvoice {
  const partyDataBefore = getInvoicePartyDataCorrection(invoice);
  const isFinalInvoice =
    invoice?.is_final_invoice === true ||
    invoice?.is_final === true ||
    invoice?.invoice_type === 'final' ||
    String(invoice?.invoice_number || '').startsWith('FKO/');

  const settledInvoices: FA3SettledInvoice[] = Array.isArray(invoice?.settled_invoices)
    ? invoice.settled_invoices.map((inv: any) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? inv.invoice_number ?? '',
        invoiceType: inv.invoiceType ?? inv.invoice_type ?? 'advance',
        issueDate: inv.issueDate ?? inv.issue_date,
        totalNet: Number(inv.totalNet ?? inv.total_net ?? 0),
        totalVat: Number(inv.totalVat ?? inv.total_vat ?? 0),
        totalGross: Number(inv.totalGross ?? inv.total_gross ?? 0),
        ksefReferenceNumber:
          inv.ksefReferenceNumber ??
          inv.ksef_reference_number ??
          inv.ksefNumber ??
          inv.ksef_number ??
          inv.ksefId ??
          inv.ksef_id ??
          inv.referenceNumber ??
          inv.reference_number ??
          null,
        vatBreakdown: normalizeVatBreakdown(inv.vatBreakdown ?? inv.vat_breakdown),
      }))
    : [];

  const settlementSummary: FA3SettlementSummary | undefined = invoice?.settlement_summary
    ? {
        invoiceTotalNet: Number(invoice.settlement_summary.invoiceTotalNet ?? 0),
        invoiceTotalVat: Number(invoice.settlement_summary.invoiceTotalVat ?? 0),
        invoiceTotalGross: Number(invoice.settlement_summary.invoiceTotalGross ?? 0),
        settledNet: Number(invoice.settlement_summary.settledNet ?? 0),
        settledVat: Number(invoice.settlement_summary.settledVat ?? 0),
        settledGross: Number(invoice.settlement_summary.settledGross ?? 0),
        remainingNet: Number(invoice.settlement_summary.remainingNet ?? 0),
        remainingVat: Number(invoice.settlement_summary.remainingVat ?? 0),
        remainingGross: Number(invoice.settlement_summary.remainingGross ?? 0),
      }
    : undefined;

  return {
    recipient: recipient ? {
      name: recipient.name.trim(),
      nip: normalizeNip(recipient.nip),
      internalId: recipient.internalId?.trim() || undefined,
      street: recipient.street.trim(),
      postalCode: recipient.postalCode.trim(),
      city: recipient.city.trim(),
      countryCode: normalizeCountryCode(recipient.countryCode),
      role: recipient.role,
    } : undefined,
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
      // Dane zapisane na fakturze są jednym kompletem. Puste pole nie jest zgodą
      // na uzupełnienie go z aktualnego kontaktu ani z danych odbiorcy usługi.
      // Brakujące dane zatrzymuje walidacja, zamiast mieszać dwa adresy/podmioty.
      nip: normalizeNip(invoice?.buyer_nip),
      name: pickFirstNonEmpty(invoice?.buyer_name) || '',
      street: pickFirstNonEmpty(invoice?.buyer_street) || '',
      postalCode: pickFirstNonEmpty(invoice?.buyer_postal_code) || '',
      city: pickFirstNonEmpty(invoice?.buyer_city) || '',
      countryCode: normalizeCountryCode(invoice?.buyer_country),
      email: pickFirstNonEmpty(invoice?.buyer_email),
      phone: normalizePhone(pickFirstNonEmpty(invoice?.buyer_phone)),
      customerNumber: undefined,
      // CRM nie przechowuje osobnego klucza powiązania danych nabywcy w korektach.
      // IDNabywcy jest fakultatywne: nie zastępujemy go nazwą, aliasem, KRS ani REGON.
      internalId: undefined,
      // Nabywca jest JST, gdy fakturę otrzymuje jej jednostka podrzędna (Podmiot3, rola 8).
      isJst: invoice?.buyer_is_jst === true || recipient?.role === 8,
      isGv: invoice?.buyer_is_gv === true,
    },
    invoice: {
      number: pickFirstNonEmpty(invoice?.invoice_number) || '',
      currencyCode: (pickFirstNonEmpty(invoice?.currency_code, invoice?.currency) || 'PLN').toUpperCase(),
      marginProcedure: invoice?.margin_procedure ?? false,
      newTransport: invoice?.new_transport ?? false,
      splitPayment: invoice?.split_payment ?? false,
      metodaKasowa: invoice?.metoda_kasowa ?? false,
      samofakturowanie: invoice?.samofakturowanie ?? false,
      odwrotneObciazenie:
        invoice?.odwrotne_obciazenie === true ||
        (invoice?.invoice_items || []).some(
          (item: any) => normalizeVatCode(item?.vat_code, Number(item?.vat_rate ?? 0)) === 'oo',
        ),
      type: getFa3RodzajFaktury(invoice),
      isFinalInvoice,
      settledInvoices,
      settlementSummary,
      issueDate: invoice?.issue_date || '',
      saleDate: invoice?.sale_date || '',
      paymentDueDate: invoice?.payment_due_date || '',
      paymentDate: invoice?.payment_date || invoice?.paid_date || invoice?.paid_at || null,
      paidAmount: Number(invoice?.paid_amount ?? 0),
      paymentStatus: invoice?.payment_status ?? null,
      paymentMethod: pickFirstNonEmpty(invoice?.payment_method) || 'przelew',
      totalNet: Number(invoice?.total_net || 0),
      totalVat: Number(invoice?.total_vat || 0),
      totalGross: Number(invoice?.total_gross || 0),
      vatSummary: buildVatSummary(invoice?.invoice_items || []),
      orderItems: buildOrderItems(invoice),
      orderTotalGross: Number(
        invoice?.order_total_gross ??
          buildOrderItems(invoice).reduce((sum, item) => sum + item.valueGross, 0),
      ),
      bankAccount: normalizeBankAccount(invoice?.bank_account),
      bankName: pickFirstNonEmpty(invoice?.bank_name),
      bankSwiftCode: normalizeSwift(
        pickFirstNonEmpty(
          invoice?.bank_swift_code,
          invoice?.bankSwiftCode,
          invoice?.seller_bank_swift_code,
          invoice?.sellerBankSwiftCode,
          invoice?.my_company?.bank_swift_code,
          invoice?.myCompany?.bankSwiftCode,
        ),
      ),
      footerNote: normalizeKsefText(getPaymentAwareInvoiceFooterNote(invoice?.footer_note, {
        paymentStatus: invoice?.payment_status || (invoice?.status === 'paid' ? 'paid' : 'unpaid'),
        amountDue: isFinalInvoice && settlementSummary
          ? settlementSummary.remainingGross
          : Number(invoice?.total_gross ?? 0),
        paidAmount: Number(invoice?.paid_amount ?? 0),
      })),
      correction:
        invoice?.invoice_type === 'corrective'
          ? {
              kind: partyDataBefore ? 'party_data' : 'amount',
              partyDataBefore: partyDataBefore ?? undefined,
              correctedInvoiceNumber: invoice?.corrected_invoice_number || '',
              correctedInvoiceIssueDate: invoice?.corrected_invoice_issue_date || '',
              correctedInvoiceKsefNumber: invoice?.corrected_invoice_ksef_number || undefined,
              correctedInvoiceWasInKsef: invoice?.corrected_invoice_was_in_ksef ?? false,
              correctionReason: invoice?.correction_reason || '',
              correctionType: [1, 2, 3].includes(Number(invoice?.correction_type))
                ? (Number(invoice.correction_type) as 1 | 2 | 3)
                : undefined,
              amountBeforeCorrection:
                invoice?.corrected_amount_before != null
                  ? Number(invoice.corrected_amount_before)
                  : undefined,
            }
          : undefined,
      items: buildInvoiceItems(invoice),
    },
  };
}

export function validatePreparedFA3Invoice(
  data: FA3PreparedInvoice,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const isCorrectiveType = ['KOR', 'KOR_ZAL', 'KOR_ROZ'].includes(data.invoice.type);
  const isPartyDataCorrection = data.invoice.correction?.kind === 'party_data';

  // Preflight dotyczy również bezpośrednich wywołań generatora. Nie poprawiamy
  // w ciszy identyfikatorów, kwot ani treści wymaganej przez kontrahenta.
  validateFA3Text(errors, 'Numer faktury', data.invoice.number, 256);
  validateFA3Text(errors, 'Numer klienta', data.buyer.customerNumber, 256);
  validateFA3Text(errors, 'Identyfikator nabywcy', data.buyer.internalId, 32);
  validateFA3Text(errors, 'Opis płatności', data.invoice.paymentMethod, 256);
  validateFA3Text(errors, 'Nazwa banku', data.invoice.bankName, 256);
  validateFA3Text(errors, 'Adnotacje', data.invoice.footerNote, 256 * 9990);

  const dates: Array<[string, string | null | undefined, string]> = [
    ['Data wystawienia', data.invoice.issueDate, '2006-01-01'],
    ['Data sprzedaży', data.invoice.saleDate, '2006-01-01'],
    ['Termin płatności', data.invoice.paymentDueDate, '2016-07-01'],
    ['Data zapłaty', data.invoice.paymentDate, '2016-07-01'],
  ];
  dates.forEach(([label, value, minimum]) => {
    if (value && !isValidFA3Date(value, minimum)) errors.push(`${label}: nieprawidłowa data lub data poza zakresem FA(3) (${minimum}–2050-01-01)`);
  });

  if (!FA3_CURRENCIES.has(data.invoice.currencyCode)) errors.push('Kod waluty nie występuje w słowniku FA(3)');
  if (!['VAT', 'ZAL', 'ROZ', 'KOR', 'KOR_ZAL', 'KOR_ROZ'].includes(data.invoice.type)) errors.push('Nieobsługiwany rodzaj faktury FA(3)');
  if (data.invoice.marginProcedure) errors.push('Procedura marży wymaga dodatkowych danych, których ten generator jeszcze nie obsługuje. Wysyłka została zatrzymana.');
  if (data.invoice.newTransport) errors.push('Nowy środek transportu wymaga dodatkowych danych, których ten generator jeszcze nie obsługuje. Wysyłka została zatrzymana.');
  if (data.buyer.isGv) errors.push('Członek grupy VAT wymaga odrębnej roli odbiorcy (10), której ten generator jeszcze nie obsługuje. Nie można wysłać faktury z samym oznaczeniem GV.');
  if (data.buyer.isJst && data.recipient?.role !== 8) errors.push('Faktura dla JST wymaga wskazania jej jednostki podrzędnej jako odbiorcy (rola 8). Uzupełnij odbiorcę faktury.');

  ([['Sprzedawca', data.seller], ['Nabywca', data.buyer], ...(data.recipient ? [['Odbiorca', data.recipient]] : [])] as Array<[string, FA3PreparedInvoice['seller'] | FA3PreparedInvoice['buyer'] | FA3Recipient]>).forEach(([label, party]) => {
    validateFA3Text(errors, `${label} — nazwa`, party.name, 512, true);
    validateFA3Text(errors, `${label} — adres`, party.street, 512, true);
    validateFA3Text(errors, `${label} — kod pocztowy i miejscowość`, `${party.postalCode} ${party.city}`, 512, true);
    if (!FA3_COUNTRIES.has(party.countryCode)) errors.push(`${label}: nieprawidłowy kod kraju. Nie zastąpiono go automatycznie Polską.`);
    const contact = party as { email?: string; phone?: string };
    if (contact.email) {
      validateFA3Text(errors, `${label} — e-mail`, contact.email, 255);
      if (!/^.+@.+$/.test(contact.email)) errors.push(`${label}: nieprawidłowy adres e-mail`);
    }
    validateFA3Text(errors, `${label} — telefon`, contact.phone, 16);
  });
  validateFA3Text(errors, 'Miejsce wystawienia', data.seller.city, 256);

  if (data.buyer.nip && !isValidPolishNip(data.buyer.nip)) {
    errors.push('Nieprawidłowy NIP nabywcy. Zagranicznego identyfikatora nie można wysłać jako polskiego NIP; wymaga osobnej obsługi VAT UE / NrID.');
  }

  if (data.recipient) {
    const recipient = data.recipient;
    if (recipient.role !== 2 && recipient.role !== 8) errors.push('Nieobsługiwana rola odbiorcy KSeF; dozwolona jednostka wewnętrzna nabywcy (2) albo jednostka podrzędna JST (8)');
    if (!recipient.postalCode || !recipient.city) errors.push('Odbiorca: uzupełnij kod pocztowy i miejscowość');
    if (recipient.nip && !isValidPolishNip(recipient.nip)) errors.push('Odbiorca: nieprawidłowy NIP');
    if (recipient.role === 8) {
      if (!recipient.nip) errors.push('Odbiorca: jednostka podrzędna JST musi mieć własny NIP');
      if (recipient.internalId) errors.push('Odbiorca: jednostka podrzędna JST nie ma numeru IDWew — usuń go i podaj NIP jednostki');
      if (!data.buyer.nip) errors.push('Nabywca: faktura dla jednostki podrzędnej JST wymaga NIP nabywcy (np. gminy)');
      else if (recipient.nip && recipient.nip === data.buyer.nip) errors.push('Odbiorca: jednostka podrzędna JST musi mieć inny NIP niż nabywca');
    } else if (recipient.internalId) {
      if (!INTERNAL_ID_PATTERN.test(recipient.internalId) || !isValidPolishNip(recipient.internalId.slice(0, 10))) {
        errors.push('Odbiorca: IDWew musi mieć postać prawidłowy NIP–5 cyfr, np. 5252228219-00145');
      } else if (recipient.internalId.slice(0, 10) !== data.buyer.nip) {
        errors.push('Odbiorca: NIP w IDWew musi odpowiadać NIP nabywcy faktury');
      }
      if (recipient.nip && recipient.nip !== recipient.internalId.slice(0, 10)) errors.push('Odbiorca: NIP i IDWew wskazują różne podmioty — popraw dane przed wysłaniem');
    }
  }

  if (data.invoice.bankAccount && !/^[A-Za-z0-9]{10,34}$/.test(data.invoice.bankAccount)) errors.push('Numer rachunku: wymagane 10–34 znaki bez spacji i znaków specjalnych');
  if (data.invoice.bankSwiftCode && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(data.invoice.bankSwiftCode)) errors.push('Nieprawidłowy kod SWIFT banku');

  validateFA3Number(errors, 'Suma netto', data.invoice.totalNet);
  validateFA3Number(errors, 'Suma VAT', data.invoice.totalVat);
  validateFA3Number(errors, 'Suma brutto', data.invoice.totalGross);
  validateFA3Number(errors, 'Kwota zapłaty', Number(data.invoice.paidAmount ?? 0));
  data.invoice.vatSummary.forEach((entry) => {
    if (!FA3_VAT_CODES.has(entry.vatCode)) errors.push('Podsumowanie VAT zawiera nieobsługiwaną stawkę');
    validateFA3Number(errors, 'Podsumowanie VAT — netto', entry.net);
    validateFA3Number(errors, 'Podsumowanie VAT — podatek', entry.vat);
    validateFA3Number(errors, 'Podsumowanie VAT — brutto', entry.gross);
  });
  if (data.invoice.currencyCode !== 'PLN' && data.invoice.vatSummary.some((entry) => Math.abs(entry.vat) >= 0.005)) {
    errors.push('Faktura w walucie obcej z VAT wymaga kwot podatku przeliczonych na PLN. Ten generator nie ma jeszcze tych danych; nie wysłano niepełnej faktury.');
  }

  if (!data.invoice.number) errors.push('Brak numeru faktury');
  if (!data.invoice.issueDate) errors.push('Brak daty wystawienia');
  if (!data.invoice.saleDate) errors.push('Brak daty sprzedaży');

  if (!isValidPolishNip(data.seller.nip)) {
    errors.push('Nieprawidłowy NIP sprzedawcy');
  }

  if (!data.seller.name) errors.push('Brak nazwy sprzedawcy');
  if (!data.seller.street) errors.push('Brak ulicy sprzedawcy');
  if (!data.seller.postalCode) errors.push('Brak kodu pocztowego sprzedawcy');
  if (!data.seller.city) errors.push('Brak miasta sprzedawcy');

  if (!data.buyer.name) errors.push('Brak nazwy nabywcy');
  if (!data.buyer.street) errors.push('Brak ulicy nabywcy');
  if (!data.buyer.postalCode) errors.push('Brak kodu pocztowego nabywcy');
  if (!data.buyer.city) errors.push('Brak miasta nabywcy');

  const internalIdError = buyerInternalIdValidationError(data.buyer.internalId);
  if (internalIdError) errors.push(internalIdError);

  if (!isPartyDataCorrection && !data.invoice.items.length) {
    errors.push('Brak pozycji faktury');
  }

  if (data.invoice.items.length > 10000) errors.push('Faktura może zawierać maksymalnie 10 000 pozycji');

  const validateLine = (item: FA3PreparedInvoice['invoice']['items'][number], label: string): void => {
    validateFA3Text(errors, `${label} — nazwa`, item.name, 512);
    validateFA3Text(errors, `${label} — jednostka`, item.unit, 256, true);
    validateFA3Text(errors, `${label} — podstawa zwolnienia`, item.exemptionReason, 256);
    validateFA3Number(errors, `${label} — ilość`, item.quantity);
    validateFA3Number(errors, `${label} — cena netto`, item.priceNet, 1e14);
    validateFA3Number(errors, `${label} — netto`, item.valueNet);
    validateFA3Number(errors, `${label} — VAT`, item.vatAmount);
    validateFA3Number(errors, `${label} — brutto`, item.valueGross);
    if (!FA3_VAT_CODES.has(item.vatCode)) errors.push(`${label}: nieobsługiwana stawka VAT`);
    if (!Number.isFinite(item.vatRate)) errors.push(`${label}: nieprawidłowa stawka VAT`);
    const expectedRate = ['23', '8', '5'].includes(item.vatCode) ? Number(item.vatCode) : 0;
    if (FA3_VAT_CODES.has(item.vatCode) && item.vatRate !== expectedRate) errors.push(`${label}: kod VAT nie odpowiada zapisanej stawce liczbowej`);
  };

  data.invoice.items.forEach((item, index) => {
    validateLine(item, `Pozycja ${index + 1}`);
    if (!item.name) errors.push(`Pozycja ${index + 1}: brak nazwy`);
    if (item.quantity < 0 || (!isCorrectiveType && item.quantity === 0)) {
      errors.push(`Pozycja ${index + 1}: nieprawidłowa ilość`);
    }
    if (item.vatCode === 'zw' && !item.exemptionReason) {
      errors.push(`Pozycja ${index + 1}: brak podstawy prawnej zwolnienia z VAT`);
    }

    if (!isCorrectiveType) {
      if (item.priceNet < 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa cena netto`);
      if (item.valueNet < 0) errors.push(`Pozycja ${index + 1}: nieprawidłowa wartość netto`);
    }
  });

  if (!isCorrectiveType && data.invoice.totalGross <= 0) {
    errors.push('Nieprawidłowa suma brutto');
  }

  if (!isPartyDataCorrection && data.invoice.paymentStatus === 'not_applicable') {
    errors.push('Status płatności „Nie dotyczy” jest przeznaczony wyłącznie dla korekty danych stron');
  }

  if (!isPartyDataCorrection && data.invoice.paymentStatus === 'paid' && !data.invoice.paymentDate) {
    errors.push('Faktura opłacona: brak daty zapłaty wymaganej przez FA(3)');
  }

  if (!isPartyDataCorrection && data.invoice.paymentStatus === 'partially_paid') {
    if (!data.invoice.paymentDate) {
      errors.push('Faktura częściowo opłacona: brak daty zapłaty');
    }
    if (Number(data.invoice.paidAmount ?? 0) <= 0) {
      errors.push('Faktura częściowo opłacona: kwota zapłaty musi być większa od zera');
    }
    if (Number(data.invoice.paidAmount ?? 0) >= data.invoice.totalGross) {
      errors.push('Faktura częściowo opłacona: kwota zapłaty musi być niższa od sumy brutto');
    }
  }

  if (data.invoice.type === 'ROZ') {
    if (!data.invoice.settlementSummary) {
      errors.push('Faktura końcowa: brak settlementSummary');
    }

    if (!data.invoice.settledInvoices.length) {
      errors.push('Faktura końcowa: brak listy rozliczonych zaliczek');
    }

    if (data.invoice.settlementSummary?.remainingGross === undefined) {
      errors.push('Faktura końcowa: brak remainingGross');
    }

    if ((data.invoice.settlementSummary?.remainingGross ?? 0) < -0.01) {
      errors.push('Faktura końcowa: suma zaliczek przekracza wartość zamówienia');
    }

    const fullVatCodes = new Set(data.invoice.vatSummary.map((entry) => entry.vatCode));
    if (data.invoice.settledInvoices.length > 100) errors.push('FA(3) pozwala rozliczyć maksymalnie 100 faktur zaliczkowych');
    if (data.invoice.settlementSummary) {
      Object.values(data.invoice.settlementSummary).forEach((value) => validateFA3Number(errors, 'Rozliczenie zaliczek — kwota', value));
    }
    data.invoice.settledInvoices.forEach((settled) => {
      validateFA3Text(errors, 'Numer rozliczanej zaliczki', settled.invoiceNumber, 256, !settled.ksefReferenceNumber);
      if (settled.ksefReferenceNumber && !KSEF_NUMBER_PATTERN.test(settled.ksefReferenceNumber)) errors.push(`Zaliczka ${settled.invoiceNumber}: nieprawidłowy numer KSeF`);
      validateFA3Number(errors, 'Rozliczana zaliczka — netto', settled.totalNet);
      validateFA3Number(errors, 'Rozliczana zaliczka — VAT', settled.totalVat);
      validateFA3Number(errors, 'Rozliczana zaliczka — brutto', settled.totalGross);
      settled.vatBreakdown?.forEach((entry) => {
        if (!FA3_VAT_CODES.has(entry.vatCode)) errors.push(`Zaliczka ${settled.invoiceNumber}: nieobsługiwana stawka VAT`);
        validateFA3Number(errors, 'Rozliczana zaliczka — podstawa VAT', entry.net);
        validateFA3Number(errors, 'Rozliczana zaliczka — podatek', entry.vat);
      });
      if (!settled.vatBreakdown?.length && fullVatCodes.size > 1) {
        errors.push(`Faktura końcowa: brak rozbicia VAT zaliczki ${settled.invoiceNumber}`);
      }
    });
  }

  if (data.invoice.type === 'ZAL') {
    if (!data.invoice.orderItems.length) {
      errors.push('Faktura zaliczkowa: brak pozycji pełnego zamówienia');
    }
    if ((data.invoice.orderTotalGross ?? 0) + 0.01 < data.invoice.totalGross) {
      errors.push('Faktura zaliczkowa: kwota zaliczki przekracza wartość zamówienia');
    }
    validateFA3Number(errors, 'Pełna wartość zamówienia', data.invoice.orderTotalGross ?? 0);
    if (data.invoice.orderItems.length > 10000) errors.push('Zamówienie może zawierać maksymalnie 10 000 pozycji');
    data.invoice.orderItems.forEach((item, index) => {
      validateLine(item, `Zamówienie, pozycja ${index + 1}`);
      if (!item.name || item.quantity <= 0 || item.priceNet < 0 || item.valueNet < 0) errors.push(`Zamówienie, pozycja ${index + 1}: uzupełnij nazwę, dodatnią ilość i prawidłowe kwoty`);
      if (item.vatCode === 'zw' && !item.exemptionReason) errors.push(`Zamówienie, pozycja ${index + 1}: brak podstawy zwolnienia z VAT`);
    });
  }

  if (isCorrectiveType) {
    const correction = data.invoice.correction;

    if (!correction) {
      errors.push('Brak danych faktury korygowanej (DaneFaKorygowanej)');
    } else {
      validateFA3Text(errors, 'Numer faktury korygowanej', correction.correctedInvoiceNumber, 256);
      validateFA3Text(errors, 'Przyczyna korekty', correction.correctionReason, 256);
      if (correction.correctedInvoiceIssueDate && !isValidFA3Date(correction.correctedInvoiceIssueDate, '2006-01-01')) errors.push('Nieprawidłowa data faktury korygowanej');
      if (correction.correctedInvoiceWasInKsef && correction.correctedInvoiceKsefNumber && !KSEF_NUMBER_PATTERN.test(correction.correctedInvoiceKsefNumber)) errors.push('Nieprawidłowy numer KSeF faktury korygowanej');
      if (correction.amountBeforeCorrection != null) validateFA3Number(errors, 'Kwota przed korektą', correction.amountBeforeCorrection);
      if (!correction.correctedInvoiceNumber) {
        errors.push('Brak numeru faktury korygowanej');
      }

      if (!correction.correctedInvoiceIssueDate) {
        errors.push('Brak daty wystawienia faktury korygowanej');
      }

      if (!correction.correctionReason) {
        errors.push('Brak przyczyny korekty');
      }
      if (!isPartyDataCorrection && !correction.correctionType) {
        errors.push('Brak typu skutku korekty w ewidencji VAT');
      }

      if (correction.correctedInvoiceWasInKsef && !correction.correctedInvoiceKsefNumber) {
        errors.push('Brak numeru KSeF faktury korygowanej');
      }
    }
  }

  if (isPartyDataCorrection) {
    if (!isCorrectiveType) errors.push('Korekta danych stron wymaga rodzaju faktury korygującej');
    const before = data.invoice.correction?.partyDataBefore;
    if (!before || before.version !== 1 || !before.buyer || !Object.prototype.hasOwnProperty.call(before, 'recipient')) {
      errors.push('Korekta danych: brak kompletnego, zapisanego stanu sprzed korekty');
    } else {
      const parties = [
        ['Nabywca przed korektą', before.buyer],
        ...(before.recipient ? [['Odbiorca przed korektą', before.recipient]] : []),
      ] as Array<[string, InvoicePartyDataBefore['buyer'] | NonNullable<InvoicePartyDataBefore['recipient']>]>;
      parties.forEach(([label, party]) => {
        validateFA3Text(errors, `${label} — nazwa`, party.name, 512, true);
        validateFA3Text(errors, `${label} — adres`, party.street, 512, true);
        validateFA3Text(errors, `${label} — kod pocztowy i miejscowość`, `${party.postalCode} ${party.city}`, 512, true);
        if (!party.postalCode || !party.city) errors.push(`${label}: brak kodu pocztowego lub miejscowości`);
        if (!FA3_COUNTRIES.has(party.countryCode)) errors.push(`${label}: nieprawidłowy kod kraju`);
      });
      if (!isValidPolishNip(before.buyer.nip) || before.buyer.nip !== data.buyer.nip) {
        errors.push('Korekta danych wymaga tego samego prawidłowego NIP nabywcy przed i po korekcie. Zmiana NIP wymaga odrębnego postępowania.');
      }
      if (before.recipient) {
        validateFA3Text(errors, 'Odbiorca przed korektą — NIP', before.recipient.nip, 32);
        validateFA3Text(errors, 'Odbiorca przed korektą — IDWew', before.recipient.internalId, 32);
        if (before.recipient.role !== 2 && before.recipient.role !== 8) errors.push('Nieobsługiwana rola odbiorcy przed korektą');
      }
      if (!buyerPartyDataChanged(data) && !recipientPartyDataChanged(data)) {
        errors.push('Korekta danych: dane nabywcy i odbiorcy przed i po korekcie są identyczne');
      }
    }
    if ([data.invoice.totalNet, data.invoice.totalVat, data.invoice.totalGross, Number(data.invoice.paidAmount ?? 0), Number(data.invoice.orderTotalGross ?? 0)]
      .some((value) => value !== 0)) {
      errors.push('Korekta danych stron nie może zmieniać kwot faktury ani zawierać kwoty zapłaty; różnica netto, VAT i brutto musi wynosić zero');
    }
    if (data.invoice.items.length || data.invoice.orderItems.length || data.invoice.vatSummary.length) {
      errors.push('Korekta danych stron nie może zawierać pozycji kwotowych ani rozliczenia VAT');
    }
    if (data.invoice.isFinalInvoice || data.invoice.settledInvoices.length || data.invoice.settlementSummary) {
      errors.push('Korekta danych stron nie może ponownie rozliczać zaliczek');
    }
    if (['partially_paid', 'refund_due', 'partially_refunded', 'refunded'].includes(data.invoice.paymentStatus || '')) {
      errors.push('Korekta danych stron nie może tworzyć zapłaty częściowej ani zwrotu');
    }
  } else if (data.invoice.correction?.partyDataBefore) {
    errors.push('Zapis danych sprzed korekty jest przeznaczony wyłącznie dla korekty danych stron');
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
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
      ${data.buyer.nip ? `<NIP>${escapeXml(data.buyer.nip)}</NIP>` : '<BrakID>1</BrakID>'}
      <Nazwa>${escapeXml(data.buyer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${escapeXml(data.buyer.countryCode)}</KodKraju>
      <AdresL1>${escapeXml(data.buyer.street)}</AdresL1>
      <AdresL2>${escapeXml(data.buyer.postalCode)} ${escapeXml(data.buyer.city)}</AdresL2>
    </Adres>${podmiot2Extra}
  </Podmiot2>`;

  void podmiot2Xml;
}

function buildDaneFaKorygowanejXml(data: FA3PreparedInvoice): string {
  const correction = data.invoice.correction;
  if (!correction) return '';

  const chunks: string[] = [];

  chunks.push(`<DaneFaKorygowanej>`);
  chunks.push(
    `  <DataWystFaKorygowanej>${formatDate(correction.correctedInvoiceIssueDate)}</DataWystFaKorygowanej>`,
  );
  chunks.push(`  <NrFaKorygowanej>${escapeXml(correction.correctedInvoiceNumber)}</NrFaKorygowanej>`);

  if (correction.correctedInvoiceWasInKsef && correction.correctedInvoiceKsefNumber) {
    chunks.push(`  <NrKSeF>1</NrKSeF>`);
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

function buildTypKorektyXml(data: FA3PreparedInvoice): string {
  const isCorrectiveType = ['KOR', 'KOR_ZAL', 'KOR_ROZ'].includes(data.invoice.type);
  if (!isCorrectiveType || data.invoice.correction?.kind === 'party_data') return '';

  return data.invoice.correction?.correctionType
    ? `<TypKorekty>${data.invoice.correction.correctionType}</TypKorekty>`
    : '';
}

function samePartyAddress(
  before: Pick<FA3Recipient, 'name' | 'nip' | 'street' | 'postalCode' | 'city' | 'countryCode'>,
  after: Pick<FA3Recipient, 'name' | 'nip' | 'street' | 'postalCode' | 'city' | 'countryCode'>,
): boolean {
  const comparableText = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();
  return (['name', 'nip', 'street', 'postalCode', 'city', 'countryCode'] as const)
    .every((key) => comparableText(before[key]) === comparableText(after[key]));
}

function buyerPartyDataChanged(data: FA3PreparedInvoice): boolean {
  const before = data.invoice.correction?.partyDataBefore?.buyer;
  return !!before && !samePartyAddress(before, data.buyer);
}

function recipientPartyDataChanged(data: FA3PreparedInvoice): boolean {
  const before = data.invoice.correction?.partyDataBefore?.recipient ?? null;
  const after = data.recipient ?? null;
  if (!before || !after) return before !== after;
  return !samePartyAddress(before, after) || (before.internalId || '').trim() !== (after.internalId || '').trim() || before.role !== after.role;
}

function buildPodmiot2KXml(data: FA3PreparedInvoice): string {
  if (data.invoice.correction?.kind !== 'party_data' || !buyerPartyDataChanged(data)) return '';
  const before = data.invoice.correction.partyDataBefore!.buyer;
  // FA(3): Podmiot2K zawiera poprzednie dane nabywcy. IDNabywcy nie jest
  // wymagane przy jednym nabywcy; nie zastępujemy go długą nazwą organizacji.
  return `<Podmiot2K>
      <DaneIdentyfikacyjne>
        <NIP>${escapeXml(before.nip)}</NIP>
        <Nazwa>${escapeXml(before.name)}</Nazwa>
      </DaneIdentyfikacyjne>
      <Adres>
        <KodKraju>${escapeXml(before.countryCode)}</KodKraju>
        <AdresL1>${escapeXml(before.street)}</AdresL1>
        <AdresL2>${escapeXml(before.postalCode)} ${escapeXml(before.city)}</AdresL2>
      </Adres>
    </Podmiot2K>`;
}

function buildP15ZKXml(data: FA3PreparedInvoice): string {
  if (!['KOR_ZAL', 'KOR_ROZ'].includes(data.invoice.type)) return '';
  const amount = data.invoice.correction?.amountBeforeCorrection;
  return amount == null ? '' : `<P_15ZK>${formatDecimal(amount)}</P_15ZK>`;
}

function buildFinalInvoiceSettlementXml(data: FA3PreparedInvoice): string {
  if (!data.invoice.isFinalInvoice) return '';
  if (!data.invoice.settledInvoices.length) return '';

  return data.invoice.settledInvoices
    .map((inv) => {
      if (inv.ksefReferenceNumber) {
        return `
    <FakturaZaliczkowa>
      <NrKSeFFaZaliczkowej>${escapeXml(inv.ksefReferenceNumber)}</NrKSeFFaZaliczkowej>
    </FakturaZaliczkowa>`;
      }

      return `
    <FakturaZaliczkowa>
      <NrKSeFZN>1</NrKSeFZN>
      <NrFaZaliczkowej>${escapeXml(inv.invoiceNumber)}</NrFaZaliczkowej>
    </FakturaZaliczkowa>`;
    })
    .join('');
}

function buildFinalInvoiceItems(
  data: FA3PreparedInvoice,
): FA3PreparedInvoice['invoice']['items'] {
  if (
    data.invoice.type !== 'ROZ' ||
    !data.invoice.settlementSummary
  ) {
    return data.invoice.items;
  }

  const originalNet = data.invoice.totalNet;
  const remainingNet = data.invoice.settlementSummary.remainingNet;

  if (originalNet <= 0) {
    return data.invoice.items;
  }

  const ratio = remainingNet / originalNet;

  return data.invoice.items.map((item) => {
    const valueNet = Number((item.valueNet * ratio).toFixed(2));
    const vatAmount = Number((item.vatAmount * ratio).toFixed(2));
    const valueGross = Number((item.valueGross * ratio).toFixed(2));
  
    return {
      ...item,
      name: `${item.name} - rozliczenie końcowe po zaliczkach`,
      priceNet: Number((item.priceNet * ratio).toFixed(2)),
      valueNet,
      vatAmount,
      valueGross,
    };
  });
}

function getEffectiveVatSummary(data: FA3PreparedInvoice): FA3VatSummary[] {
  const summary = new Map<FA3VatCode, FA3VatSummary>();
  data.invoice.vatSummary.forEach((entry) => summary.set(entry.vatCode, { ...entry }));

  if (data.invoice.type !== 'ROZ') return Array.from(summary.values());

  const fullCodes = Array.from(summary.keys());
  data.invoice.settledInvoices.forEach((settled) => {
    let breakdown = settled.vatBreakdown || [];
    if (!breakdown.length && fullCodes.length === 1) {
      breakdown = [{
        vatCode: fullCodes[0],
        net: settled.totalNet,
        vat: settled.totalVat,
        gross: settled.totalGross,
      }];
    }

    breakdown.forEach((entry) => {
      const bucket = summary.get(entry.vatCode) ?? {
        vatCode: entry.vatCode,
        net: 0,
        vat: 0,
        gross: 0,
      };
      bucket.net = Number((bucket.net - entry.net).toFixed(2));
      bucket.vat = Number((bucket.vat - entry.vat).toFixed(2));
      bucket.gross = Number((bucket.gross - entry.gross).toFixed(2));
      summary.set(entry.vatCode, bucket);
    });
  });

  return Array.from(summary.values()).filter(
    (entry) => Math.abs(entry.net) >= 0.005 || Math.abs(entry.vat) >= 0.005,
  );
}

function buildVatSummaryXml(data: FA3PreparedInvoice): string {
  const entries = new Map(getEffectiveVatSummary(data).map((entry) => [entry.vatCode, entry]));
  const chunks: string[] = [];
  const taxable: Array<[FA3VatCode, string, string]> = [
    ['23', 'P_13_1', 'P_14_1'],
    ['8', 'P_13_2', 'P_14_2'],
    ['5', 'P_13_3', 'P_14_3'],
  ];

  taxable.forEach(([code, netField, vatField]) => {
    const entry = entries.get(code);
    if (!entry) return;
    chunks.push(`<${netField}>${formatDecimal(entry.net)}</${netField}>`);
    chunks.push(`<${vatField}>${formatDecimal(entry.vat)}</${vatField}>`);
  });

  const zeroDomestic = entries.get('0 KR');
  const zeroEu = entries.get('0 WDT');
  const zeroExport = entries.get('0 EX');
  const exempt = entries.get('zw');
  const notSubjectDomestic = entries.get('np I');
  const notSubjectForeign = entries.get('np II');
  const reverseCharge = entries.get('oo');
  if (zeroDomestic) chunks.push(`<P_13_6_1>${formatDecimal(zeroDomestic.net)}</P_13_6_1>`);
  if (zeroEu) chunks.push(`<P_13_6_2>${formatDecimal(zeroEu.net)}</P_13_6_2>`);
  if (zeroExport) chunks.push(`<P_13_6_3>${formatDecimal(zeroExport.net)}</P_13_6_3>`);
  if (exempt) chunks.push(`<P_13_7>${formatDecimal(exempt.net)}</P_13_7>`);
  if (notSubjectDomestic) chunks.push(`<P_13_8>${formatDecimal(notSubjectDomestic.net)}</P_13_8>`);
  if (notSubjectForeign) chunks.push(`<P_13_9>${formatDecimal(notSubjectForeign.net)}</P_13_9>`);
  if (reverseCharge) chunks.push(`<P_13_10>${formatDecimal(reverseCharge.net)}</P_13_10>`);
  return chunks.join('\n    ');
}

function buildAdditionalDescriptionChunks(key: string, value: string): string[] {
  // Wartosc ma w FA(3) limit 256 znaków, również gdy źródłowa adnotacja jest
  // dłuższa. Zachowujemy całość w kolejnych elementach zamiast obcinać tekst.
  const characters = Array.from(value);
  const count = Math.ceil(characters.length / 256);
  const chunks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = count > 1 ? `${key} (${index + 1}/${count})` : key;
    chunks.push(`
    <DodatkowyOpis>
      <Klucz>${escapeXml(label)}</Klucz>
      <Wartosc>${escapeXml(characters.slice(index * 256, (index + 1) * 256).join(''))}</Wartosc>
    </DodatkowyOpis>`);
  }
  return chunks;
}

function buildDodatkowyOpisXml(data: FA3PreparedInvoice): string {
  const chunks: string[] = [];
  const currencyCode = data.invoice.currencyCode;
  const isPartyDataCorrection = data.invoice.correction?.kind === 'party_data';

  if (isPartyDataCorrection) {
    chunks.push(...buildAdditionalDescriptionChunks('Zakres korekty', 'Wyłącznie dane nabywcy lub odbiorcy. Kwoty, pozycje i rozliczenie płatności faktury korygowanej pozostają bez zmian.'));
    if (recipientPartyDataChanged(data)) {
      const describeRecipient = (recipient?: FA3Recipient | null) => recipient
        ? `${recipient.name}; ${recipient.street}; ${recipient.postalCode} ${recipient.city}; ${recipient.countryCode}${recipient.nip ? `; NIP: ${recipient.nip}` : ''}${recipient.internalId ? `; IDWew: ${recipient.internalId}` : ''}; rola: ${recipient.role === 8 ? 'jednostka podrzędna JST – odbiorca' : 'odbiorca'}`
        : 'Jak nabywca — bez odrębnego odbiorcy.';
      // FA(3) nie zawiera Podmiot3K dla odbiorcy (rola 2). Nowe dane są
      // w Podmiot3, a pełny stan przed/po zachowujemy bez obcinania w opisie.
      chunks.push(...buildAdditionalDescriptionChunks('Odbiorca przed korektą', describeRecipient(data.invoice.correction?.partyDataBefore?.recipient)));
      chunks.push(...buildAdditionalDescriptionChunks('Odbiorca po korekcie', describeRecipient(data.recipient)));
    }
  }

  if (data.invoice.footerNote) {
    chunks.push(...buildAdditionalDescriptionChunks('Adnotacje', data.invoice.footerNote));
  }

  if (!isPartyDataCorrection && data.invoice.paymentStatus === 'paid') {
    const paymentDate = data.invoice.paymentDate
      ? formatDate(data.invoice.paymentDate)
      : undefined;

    const paidAmount =
      Number(data.invoice.paidAmount ?? 0) > 0
        ? Number(data.invoice.paidAmount)
        : Number(data.invoice.totalGross ?? 0);

    chunks.push(...buildAdditionalDescriptionChunks('Status płatności',
        `Opłacono${paymentDate ? ` dnia ${paymentDate}` : ''}, kwota ${formatDecimal(
          paidAmount,
        )} ${currencyCode}`,
      ));
  }

  if (
    data.invoice.type === 'ROZ' &&
    data.invoice.settlementSummary &&
    data.invoice.settledInvoices.length
  ) {
    const advanceText = data.invoice.settledInvoices
      .map(
        (inv) =>
          `${inv.invoiceNumber} (${formatDecimal(inv.totalGross)} ${currencyCode} brutto)`,
      )
      .join(', ');

    const value = `Rozliczono faktury zaliczkowe: ${advanceText}. Do dopłaty: ${formatDecimal(
      data.invoice.settlementSummary.remainingGross,
    )} ${currencyCode} brutto.`;

    chunks.push(...buildAdditionalDescriptionChunks('Rozliczenie zaliczek', value));
  }

  if (chunks.length > 10000) throw new Error('Adnotacje przekraczają limit 10 000 dodatkowych opisów FA(3). Treść nie została skrócona.');
  return chunks.join('');
}



export function generateFA3XML(
  data: FA3PreparedInvoice,
  options: GenerateFA3XMLOptions = {},
): string {
  const validation = validatePreparedFA3Invoice(data);
  if (!validation.valid) throw new Error(`Nie można przygotować faktury do KSeF: ${validation.errors.join('; ')}`);
  const currentDateTime = new Date().toISOString();
  const podmiot1Extra = buildPodmiot1Extra(data);
  const podmiot2Extra = buildPodmiot2Extra(data);
  const podmiot2Jst = buildPodmiot2Jst(data);
  const podmiot3Xml = buildPodmiot3Xml(data.recipient);
  const adnotacjeXml = buildAdnotacjeXml(data);
  const paymentXml = buildPaymentXml(data);
  const rodzajFaktury = data.invoice.type;
  const isCorrectiveType = ['KOR', 'KOR_ZAL', 'KOR_ROZ'].includes(rodzajFaktury);
  const daneFaKorygowanejXml = isCorrectiveType ? buildDaneFaKorygowanejXml(data) : '';
  const przyczynaKorektyXml = isCorrectiveType ? buildPrzyczynaKorektyXml(data) : '';
  const typKorektyXml = buildTypKorektyXml(data);
  const podmiot2KXml = buildPodmiot2KXml(data);
  const p15zkXml = buildP15ZKXml(data);
  const finalInvoiceSettlementXml = buildFinalInvoiceSettlementXml(data);

  const isFinalSettlementInvoice =
  data.invoice.type === 'ROZ' && !!data.invoice.settlementSummary;

const faTotalNet = isFinalSettlementInvoice
  ? data.invoice.settlementSummary!.remainingNet
  : data.invoice.totalNet;

const faTotalVat = isFinalSettlementInvoice
  ? data.invoice.settlementSummary!.remainingVat
  : data.invoice.totalVat;

const faTotalGross = isFinalSettlementInvoice
  ? data.invoice.settlementSummary!.remainingGross
  : data.invoice.totalGross;

const invoiceItemsForXml = data.invoice.items;

const isAdvanceInvoice = data.invoice.type === 'ZAL';

const zamowienieXml = isAdvanceInvoice
  ? `
    <Zamowienie>
      <WartoscZamowienia>${formatDecimal(data.invoice.orderTotalGross ?? 0)}</WartoscZamowienia>
      ${data.invoice.orderItems
        .map(
          (item, index) => `
      <ZamowienieWiersz>
        <NrWierszaZam>${index + 1}</NrWierszaZam>
        <P_7Z>${escapeXml(item.name)}</P_7Z>
        <P_8AZ>${escapeXml(item.unit)}</P_8AZ>
        <P_8BZ>${formatPreciseDecimal(item.quantity, 6)}</P_8BZ>
        <P_9AZ>${formatPreciseDecimal(item.priceNet, 8)}</P_9AZ>
        <P_11NettoZ>${formatDecimal(item.valueNet)}</P_11NettoZ>
        <P_11VatZ>${formatDecimal(item.vatAmount)}</P_11VatZ>
        <P_12Z>${getVatRateCode(item.vatCode)}</P_12Z>
      </ZamowienieWiersz>`,
        )
        .join('')}
    </Zamowienie>`
  : '';

const dodatkowyOpisXml = buildDodatkowyOpisXml(data);
  const vatSummaryXml = buildVatSummaryXml(data);
  const invoiceRowsXml = invoiceItemsForXml
  .map(
    (item, index) => `
    <FaWiersz>
      <NrWierszaFa>${index + 1}</NrWierszaFa>
      <P_7>${escapeXml(item.name)}</P_7>
      <P_8A>${escapeXml(item.unit)}</P_8A>
      <P_8B>${formatPreciseDecimal(item.quantity, 6)}</P_8B>
      <P_9A>${formatPreciseDecimal(item.priceNet, 8)}</P_9A>
      <P_11>${formatDecimal(item.valueNet)}</P_11>
      <P_12>${getVatRateCode(item.vatCode)}</P_12>${item.stanPrzed ? '\n      <StanPrzed>1</StanPrzed>' : ''}
    </FaWiersz>`,
  )
  .join('\n');

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
    </Adres>${podmiot1Extra}
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      ${data.buyer.nip ? `<NIP>${escapeXml(data.buyer.nip)}</NIP>` : '<BrakID>1</BrakID>'}
      <Nazwa>${escapeXml(data.buyer.name)}</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>${escapeXml(data.buyer.countryCode)}</KodKraju>
      <AdresL1>${escapeXml(data.buyer.street)}</AdresL1>
      <AdresL2>${escapeXml(data.buyer.postalCode)} ${escapeXml(data.buyer.city)}</AdresL2>
    </Adres>${podmiot2Extra}${podmiot2Jst}
  </Podmiot2>${podmiot3Xml}
  <Fa>
    <KodWaluty>${escapeXml(data.invoice.currencyCode)}</KodWaluty>
    <P_1>${formatDate(data.invoice.issueDate)}</P_1>
    <P_1M>${escapeXml(data.seller.city)}</P_1M>
    <P_2>${escapeXml(data.invoice.number)}</P_2>
    <P_6>${formatDate(data.invoice.saleDate)}</P_6>
    ${vatSummaryXml}
    <P_15>${formatDecimal(faTotalGross)}</P_15>
    ${adnotacjeXml}
    <RodzajFaktury>${rodzajFaktury}</RodzajFaktury>
    ${przyczynaKorektyXml}
    ${typKorektyXml}
    ${daneFaKorygowanejXml}
    ${podmiot2KXml}
    ${p15zkXml}
    ${dodatkowyOpisXml}
    ${finalInvoiceSettlementXml}
    ${invoiceRowsXml}
    ${paymentXml}
    ${zamowienieXml}
  </Fa>
</Faktura>`;

  if (options.debug) {
    console.log(xml);
  }

  return xml;
}
