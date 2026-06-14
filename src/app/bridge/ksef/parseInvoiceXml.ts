/**
 * Parser FA3 invoice XML from KSeF into structured data
 * Schema: https://crd.gov.pl/wzor/2025/06/25/13775/
 */

export interface ParsedInvoiceXml {
  seller_name: string | null;
  seller_nip: string | null;
  seller_address: string | null;
  buyer_name: string | null;
  buyer_nip: string | null;
  buyer_address: string | null;
  invoice_number: string | null;
  issue_date: string | null;
  sale_date: string | null;
  currency: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  payment_method: string | null;
  payment_due_date: string | null;
  payment_date: string | null;
  payment_info: string | null;
  bank_account_number: string | null;
  bank_swift: string | null;
  bank_name: string | null;
  invoice_items: ParsedInvoiceItem[];
}

export interface ParsedInvoiceItem {
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number | null;
  value_net: number | null;
  vat_rate: string | null;
  value_gross: number | null;
}

function getTag(src: string, tag: string): string | null {
  const m = src.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`));
  return m ? m[1].trim() : null;
}

function getTagContent(src: string, tag: string): string | null {
  const m = src.match(new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 's'));
  return m ? m[1] : null;
}

function getAllBlocks(src: string, tag: string): string[] {
  const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}>`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(src)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function buildAddress(block: string): string | null {
  // FA3 address structure: KodKraju, AdresPol or AdresZagr
  const adresPol = getTagContent(block, 'AdresPol') || getTagContent(block, 'AdresZagr') || block;

  const kodPocztowy = getTag(adresPol, 'KodPocztowy');
  const miejscowosc = getTag(adresPol, 'Miejscowosc');
  const ulica = getTag(adresPol, 'Ulica');
  const nrDomu = getTag(adresPol, 'NrDomu');
  const nrLokalu = getTag(adresPol, 'NrLokalu');
  const kraj = getTag(adresPol, 'KodKraju') || getTag(block, 'KodKraju');
  const wojewodztwo = getTag(adresPol, 'Wojewodztwo');
  const powiat = getTag(adresPol, 'Powiat');
  const gmina = getTag(adresPol, 'Gmina');

  const streetParts: string[] = [];
  if (ulica) {
    streetParts.push(ulica);
    if (nrDomu) {
      streetParts.push(nrDomu);
      if (nrLokalu) streetParts.push(`Lok. ${nrLokalu}`);
    }
  } else if (nrDomu) {
    streetParts.push(nrDomu);
    if (nrLokalu) streetParts.push(`Lok. ${nrLokalu}`);
  }

  const parts: string[] = [];
  if (kodPocztowy || miejscowosc) {
    parts.push([kodPocztowy, miejscowosc].filter(Boolean).join(','));
  }
  if (streetParts.length > 0) {
    parts.push(streetParts.join(' '));
  }
  if (kraj && kraj !== 'PL') parts.push(kraj);

  return parts.length > 0 ? parts.join(', ') : null;
}

const PAYMENT_METHOD_MAP: Record<string, string> = {
  '1': '1', // Gotówka
  '2': '2', // Karta
  '3': '3', // Bon
  '4': '4', // Czek
  '5': '5', // Kredyt
  '6': '6', // Przelew
  '7': '7', // Inne
};

export function parseFA3InvoiceXml(xml: string): ParsedInvoiceXml | null {
  if (!xml || typeof xml !== 'string' || xml.length < 50) return null;

  try {
    // Seller (Podmiot1 / Sprzedawca)
    const podmiot1 = getTagContent(xml, 'Podmiot1') || '';
    const sellerNip = getTag(podmiot1, 'NIP') || getTag(podmiot1, 'Nip');
    const sellerName =
      getTag(podmiot1, 'Nazwa') ||
      getTag(podmiot1, 'NazwaHandlowa') ||
      getTag(podmiot1, 'PelnaNazwa');
    const sellerAddress = buildAddress(podmiot1);

    // Buyer (Podmiot2 / Nabywca)
    const podmiot2 = getTagContent(xml, 'Podmiot2') || '';
    const buyerNip = getTag(podmiot2, 'NIP') || getTag(podmiot2, 'Nip');
    const buyerName =
      getTag(podmiot2, 'Nazwa') ||
      getTag(podmiot2, 'NazwaHandlowa') ||
      getTag(podmiot2, 'PelnaNazwa');
    const buyerAddress = buildAddress(podmiot2);

    // Invoice header (Fa)
    const fa = getTagContent(xml, 'Fa') || xml;
    const invoiceNumber =
      getTag(fa, 'P_2') || getTag(xml, 'P_2');
    const issueDate = getTag(fa, 'P_1') || getTag(xml, 'P_1');
    const saleDate = getTag(fa, 'P_6') || getTag(xml, 'P_6');
    const currency = getTag(fa, 'KodWaluty') || getTag(xml, 'KodWaluty') || 'PLN';

    // Totals
    const netAmountRaw = getTag(fa, 'P_13_1') || getTag(fa, 'P_13_2') || getTag(fa, 'P_13_3') || getTag(fa, 'P_13_6');
    const vatAmountRaw = getTag(fa, 'P_14_1') || getTag(fa, 'P_14_2') || getTag(fa, 'P_14_3');
    const grossAmountRaw = getTag(fa, 'P_15') || getTag(xml, 'P_15');

    // Line items (FaWiersz)
    const itemBlocks = getAllBlocks(xml, 'FaWiersz');
    const invoiceItems: ParsedInvoiceItem[] = itemBlocks.map((block, idx) => {
      const nrWiersza = getTag(block, 'NrWierszaFa');
      const name = getTag(block, 'P_7') || getTag(block, 'P_7A') || 'Pozycja';
      const unit = getTag(block, 'P_8A') || 'szt.';
      const qty = getTag(block, 'P_8B');
      const unitNet = getTag(block, 'P_9A');
      const net = getTag(block, 'P_11');
      const vatRate = getTag(block, 'P_12');
      const gross = getTag(block, 'P_11A');

      return {
        position_number: nrWiersza ? Number(nrWiersza) : idx + 1,
        name,
        unit,
        quantity: qty != null ? Number(qty) : 1,
        price_net: unitNet != null ? Number(unitNet) : null,
        value_net: net != null ? Number(net) : null,
        vat_rate: vatRate,
        value_gross: gross != null ? Number(gross) : null,
      };
    });

    // Payment (Platnosc) - FA3: located under Fa/Platnosc
    const platnosc = getTagContent(fa, 'Platnosc') || getTagContent(xml, 'Platnosc') || '';
    const formaPlatnosci = getTag(platnosc, 'FormaPlatnosci');

    // TerminPlatnosci can be a simple date or contain a <Termin> child
    const terminPlatnosciRaw = getTag(platnosc, 'TerminPlatnosci');
    const terminPlatnosci = terminPlatnosciRaw
      ? (getTag(terminPlatnosciRaw, 'Termin') || terminPlatnosciRaw.replace(/<[^>]+>/g, '').trim())
      : null;

    const zaplacono = getTag(platnosc, 'Zaplacono');
    const znacznikZaplacono = getTag(platnosc, 'ZnacznikZaplatyCzesciowej');

    // Payment info text
    let paymentInfo: string | null = null;
    if (zaplacono === '1' || zaplacono?.toLowerCase() === 'tak') {
      paymentInfo = 'Zapłacono';
    } else if (znacznikZaplacono === '1') {
      paymentInfo = 'Zapłata częściowa';
    } else {
      paymentInfo = 'Brak zapłaty';
    }

    // Bank account - FA3: located under Fa/Platnosc/RachunekBankowy
    const rachunek = getTagContent(platnosc, 'RachunekBankowy') || getTagContent(fa, 'RachunekBankowy') || getTagContent(xml, 'RachunekBankowy') || '';
    const bankAccountNumber = getTag(rachunek, 'NrRB') || getTag(rachunek, 'NrRachunku');
    const bankSwift = getTag(rachunek, 'SWIFT') || getTag(rachunek, 'KodSWIFT');
    const bankName = getTag(rachunek, 'NazwaBanku') || getTag(rachunek, 'OpisRachunku') || getTag(rachunek, 'RachunekWlasnyBanku');

    return {
      seller_name: sellerName || null,
      seller_nip: sellerNip || null,
      seller_address: sellerAddress,
      buyer_name: buyerName || null,
      buyer_nip: buyerNip || null,
      buyer_address: buyerAddress,
      invoice_number: invoiceNumber || null,
      issue_date: issueDate || null,
      sale_date: saleDate || null,
      currency,
      net_amount: netAmountRaw ? Number(netAmountRaw) : null,
      vat_amount: vatAmountRaw ? Number(vatAmountRaw) : null,
      gross_amount: grossAmountRaw ? Number(grossAmountRaw) : null,
      payment_method: formaPlatnosci || null,
      payment_due_date: terminPlatnosci || null,
      payment_date: zaplacono === '1' || zaplacono?.toLowerCase() === 'tak' ? issueDate : null,
      payment_info: paymentInfo,
      bank_account_number: bankAccountNumber || null,
      bank_swift: bankSwift || null,
      bank_name: bankName || null,
      invoice_items: invoiceItems,
    };
  } catch (e) {
    console.error('[parseFA3InvoiceXml] error:', e);
    return null;
  }
}
