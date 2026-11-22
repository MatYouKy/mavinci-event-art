import 'server-only';
import { generateKsefInvoiceQrDataUrl } from '@/lib/ksef/qr';
import { escapeHtml, loadPrintFontCss, renderHtmlToPdf } from '@/lib/print/pdfRenderer.server';
import { decodeTextEntities } from '@/lib/textEncoding';

/*
 * Wizualizacja faktury z KSeF jako PDF (Dysk → Finanse → Sprzedaż / Koszty): dane z zapisanego XML (FA(2)/FA(3)) — strony,
 * daty, pozycje, podsumowanie stawek VAT, płatność; bez XML (pobrane same dane nagłówka) — z kolumn `ksef_invoices`. Neutralny
 * wygląd (to dokument kontrahenta, nie wydruk marki), kod QR weryfikacji KSeF, gdy jest XML. Dokumentem jest faktura w KSeF —
 * mówi o tym stopka. Render: wspólny renderer wydruków na serwerze Next (Chromium, bez sieci, osadzony font). Zmiana szablonu —
 * podnieś `KSEF_VISUALIZATION_VERSION` w `drive.server.ts` (klucz kopii w magazynie i wersja pliku w Finderze).
 */

type Row = Record<string, any>;

type Party = { name: string; nip: string; address: string };
type Item = { name: string; unit: string; quantity: number | null; unitNet: number | null; net: number | null; gross: number | null; rate: string };
type RateTotal = { label: string; net: number; vat: number };

export type KsefVisualization = {
  kind: string;
  number: string;
  ksefNumber: string;
  issueDate: string;
  saleDate: string;
  currency: string;
  seller: Party;
  buyer: Party;
  items: Item[];
  rates: RateTotal[];
  net: number | null;
  vat: number | null;
  gross: number | null;
  payment: { method: string; due: string; paid: string; account: string; bank: string };
  correction: { of: string; reason: string } | null;
  notes: string[];
  fromXml: boolean;
};

const KINDS: Record<string, string> = {
  VAT: 'Faktura VAT', KOR: 'Faktura korygująca', ZAL: 'Faktura zaliczkowa', ROZ: 'Faktura rozliczeniowa', UPR: 'Faktura uproszczona',
  KOR_ZAL: 'Faktura korygująca fakturę zaliczkową', KOR_ROZ: 'Faktura korygująca fakturę rozliczeniową',
};

const PAYMENT_METHODS: Record<string, string> = {
  '1': 'Gotówka', '2': 'Karta', '3': 'Bon', '4': 'Czek', '5': 'Kredyt', '6': 'Przelew', '7': 'Płatność mobilna',
  cash: 'Gotówka', card: 'Karta', transfer: 'Przelew', bank_transfer: 'Przelew',
};

/** Pola P_13_x / P_14_x podsumowania faktury → opis stawki (jak w wizualizacji KSeF). */
const RATE_FIELDS: Array<{ net: string; vat: string | null; label: string }> = [
  { net: 'P_13_1', vat: 'P_14_1', label: '23% lub 22%' },
  { net: 'P_13_2', vat: 'P_14_2', label: '8% lub 7%' },
  { net: 'P_13_3', vat: 'P_14_3', label: '5%' },
  { net: 'P_13_4', vat: 'P_14_4', label: '4% lub 3% (ryczałt taksówkowy)' },
  { net: 'P_13_5', vat: 'P_14_5', label: 'Procedura OSS' },
  { net: 'P_13_6_1', vat: null, label: '0% (sprzedaż krajowa)' },
  { net: 'P_13_6_2', vat: null, label: '0% (WDT)' },
  { net: 'P_13_6_3', vat: null, label: '0% (eksport)' },
  { net: 'P_13_7', vat: null, label: 'Zwolnione' },
  { net: 'P_13_8', vat: null, label: 'Poza krajem' },
  { net: 'P_13_9', vat: null, label: 'Świadczenie usług art. 100' },
  { net: 'P_13_10', vat: null, label: 'Odwrotne obciążenie' },
  { net: 'P_13_11', vat: null, label: 'Procedura marży' },
];

const tagPattern = (tag: string, flags = '') =>
  new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, flags);

function tag(source: string, name: string): string {
  const match = tagPattern(name).exec(source);
  return match ? decodeTextEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : '';
}

function block(source: string, name: string): string {
  return tagPattern(name).exec(source)?.[1] || '';
}

function blocks(source: string, name: string): string[] {
  return Array.from(source.matchAll(tagPattern(name, 'g')), (match) => match[1]);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function address(source: string): string {
  const own = block(source, 'Adres') || source;
  const lines = [tag(own, 'AdresL1'), tag(own, 'AdresL2')].filter(Boolean);
  if (lines.length) return [...lines, tag(own, 'KodKraju') && tag(own, 'KodKraju') !== 'PL' ? tag(own, 'KodKraju') : ''].filter(Boolean).join(', ');
  const old = block(source, 'AdresPol') || block(source, 'AdresZagr') || source;
  const street = [tag(old, 'Ulica'), tag(old, 'NrDomu'), tag(old, 'NrLokalu') ? `lok. ${tag(old, 'NrLokalu')}` : ''].filter(Boolean).join(' ');
  const city = [tag(old, 'KodPocztowy'), tag(old, 'Miejscowosc')].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}

function party(source: string): Party {
  return {
    name: tag(source, 'Nazwa') || tag(source, 'NazwaHandlowa') || [tag(source, 'ImiePierwsze'), tag(source, 'Nazwisko')].filter(Boolean).join(' '),
    nip: tag(source, 'NIP') || (tag(source, 'NrVatUE') ? `${tag(source, 'KodUE')}${tag(source, 'NrVatUE')}` : '') || tag(source, 'NrID'),
    address: address(source),
  };
}

const rateLabel = (value: string) => {
  const clean = value.trim();
  if (!clean) return '';
  if (/^\d+(\.\d+)?$/.test(clean)) return `${clean}%`;
  if (clean === 'zw') return 'zw.';
  if (clean === 'oo') return 'odwrotne obciążenie';
  if (clean.startsWith('np')) return 'np.';
  return clean;
};

/** Dane do wizualizacji: XML (gdy zapisany), uzupełnione kolumnami wiersza `ksef_invoices`. */
export function ksefVisualizationData(row: Row): KsefVisualization {
  const xml = typeof row.xml_content === 'string' && row.xml_content.length > 100 ? row.xml_content : '';
  const columnsItems = Array.isArray(row.invoice_items) ? row.invoice_items as Row[] : [];
  const fromColumns = (): Item[] => columnsItems.map((item) => ({
    name: String(item.name || 'Pozycja'), unit: String(item.unit || ''), quantity: num(item.quantity), unitNet: num(item.price_net),
    net: num(item.value_net), gross: num(item.value_gross), rate: rateLabel(String(item.vat_rate ?? '')),
  }));
  const fallback: KsefVisualization = {
    kind: KINDS[String(row.invoice_kind || '')] || 'Faktura',
    number: String(row.invoice_number || ''),
    ksefNumber: String(row.ksef_reference_number || ''),
    issueDate: String(row.issue_date || '').slice(0, 10),
    saleDate: '',
    currency: String(row.currency || 'PLN'),
    seller: { name: String(row.seller_name || ''), nip: String(row.seller_nip || ''), address: String(row.seller_address || '') },
    buyer: { name: String(row.buyer_name || ''), nip: String(row.buyer_nip || ''), address: String(row.buyer_address || '') },
    items: fromColumns(),
    rates: [],
    net: num(row.net_amount),
    vat: num(row.vat_amount),
    gross: num(row.gross_amount),
    payment: {
      method: PAYMENT_METHODS[String(row.payment_method || '').toLowerCase()] || String(row.payment_method || ''),
      due: String(row.payment_due_date || '').slice(0, 10), paid: '', account: String(row.bank_account_number || ''), bank: '',
    },
    correction: null,
    notes: [],
    fromXml: false,
  };
  if (!xml) {
    if (fallback.net !== null || fallback.vat !== null) {
      fallback.rates = [{ label: rateLabel(String(row.vat_rate || '')) || 'Razem', net: fallback.net || 0, vat: fallback.vat || 0 }];
    }
    return fallback;
  }

  const fa = block(xml, 'Fa') || xml;
  const items: Item[] = blocks(xml, 'FaWiersz').map((line) => {
    const quantity = num(tag(line, 'P_8B'));
    const unitNet = num(tag(line, 'P_9A'));
    const unitGross = num(tag(line, 'P_9B'));
    const net = num(tag(line, 'P_11'));
    const gross = num(tag(line, 'P_11A'));
    return {
      name: tag(line, 'P_7') || 'Pozycja', unit: tag(line, 'P_8A'), quantity, unitNet,
      net: net ?? (unitNet !== null && quantity !== null ? Math.round(unitNet * quantity * 100) / 100 : null),
      gross: gross ?? (unitGross !== null && quantity !== null ? Math.round(unitGross * quantity * 100) / 100 : null),
      rate: rateLabel(tag(line, 'P_12')),
    };
  });
  const rates = RATE_FIELDS
    .map((field) => ({ label: field.label, net: num(tag(fa, field.net)), vat: field.vat ? num(tag(fa, field.vat)) : 0 }))
    .filter((entry): entry is { label: string; net: number; vat: number | null } => entry.net !== null)
    .map((entry) => ({ label: entry.label, net: entry.net, vat: entry.vat ?? 0 }));
  const payment = block(fa, 'Platnosc');
  const due = block(payment, 'TerminPlatnosci');
  const account = block(payment, 'RachunekBankowy');
  const paidFlag = tag(payment, 'Zaplacono');
  const correctionOf = tag(block(fa, 'DaneFaKorygowanej'), 'NrFaKorygowanej');
  const notes = [
    ...blocks(fa, 'DodatkowyOpis').map((entry) => [tag(entry, 'Klucz'), tag(entry, 'Wartosc')].filter(Boolean).join(': ')),
    tag(block(xml, 'Stopka'), 'StopkaFaktury'),
  ].filter(Boolean).slice(0, 12);
  return {
    kind: KINDS[tag(fa, 'RodzajFaktury')] || 'Faktura',
    number: tag(fa, 'P_2') || fallback.number,
    ksefNumber: fallback.ksefNumber,
    issueDate: tag(fa, 'P_1') || fallback.issueDate,
    saleDate: tag(fa, 'P_6'),
    currency: tag(fa, 'KodWaluty') || fallback.currency,
    seller: { ...fallback.seller, ...nonEmpty(party(block(xml, 'Podmiot1'))) },
    buyer: { ...fallback.buyer, ...nonEmpty(party(block(xml, 'Podmiot2'))) },
    items: items.length ? items : fallback.items,
    rates,
    net: rates.length ? Math.round(rates.reduce((sum, entry) => sum + entry.net, 0) * 100) / 100 : fallback.net,
    vat: rates.length ? Math.round(rates.reduce((sum, entry) => sum + entry.vat, 0) * 100) / 100 : fallback.vat,
    gross: num(tag(fa, 'P_15')) ?? fallback.gross,
    payment: {
      method: PAYMENT_METHODS[tag(payment, 'FormaPlatnosci')] || tag(payment, 'OpisPlatnosci') || fallback.payment.method,
      due: (tag(due, 'Termin') || tag(payment, 'TerminPlatnosci')).slice(0, 10) || fallback.payment.due,
      paid: paidFlag === '1' ? `Zapłacono${tag(payment, 'DataZaplaty') ? ` ${tag(payment, 'DataZaplaty')}` : ''}` : tag(payment, 'ZnacznikZaplatyCzesciowej') === '1' ? 'Zapłata częściowa' : '',
      account: tag(account, 'NrRB') || fallback.payment.account,
      bank: tag(account, 'NazwaBanku'),
    },
    correction: correctionOf || tag(fa, 'PrzyczynaKorekty') ? { of: correctionOf, reason: tag(fa, 'PrzyczynaKorekty') } : null,
    notes,
    fromXml: true,
  };
}

function nonEmpty(value: Party): Partial<Party> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry)) as Partial<Party>;
}

const moneyFormat = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number | null) => (value === null ? '—' : moneyFormat.format(value));
const quantityFormat = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 4 });
const plDate = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10).split('-').reverse().join('.') : value);
const account = (value: string) => {
  const digits = value.replace(/\s+/g, '');
  return digits.length === 26 ? `${digits.slice(0, 2)} ${digits.slice(2).replace(/(.{4})/g, '$1 ').trim()}` : digits.replace(/(.{4})/g, '$1 ').trim();
};

function partyHtml(title: string, value: Party) {
  return `<div class="party"><h3>${escapeHtml(title)}</h3>
    <p class="name">${escapeHtml(value.name || '—')}</p>
    ${value.nip ? `<p>NIP: ${escapeHtml(value.nip)}</p>` : ''}
    ${value.address ? `<p>${escapeHtml(value.address)}</p>` : ''}</div>`;
}

/** HTML wizualizacji (A4) z kodem QR weryfikacji KSeF, gdy jest. */
export function ksefVisualizationHtml(data: KsefVisualization, fontCss: string, qr: { dataUrl: string; verificationUrl: string } | null) {
  const meta = [
    ['Data wystawienia', plDate(data.issueDate)],
    ['Data sprzedaży', plDate(data.saleDate)],
    ['Termin płatności', plDate(data.payment.due)],
    ['Waluta', data.currency],
  ].filter(([, value]) => value);
  // Kolumna brutto tylko, gdy faktura ją podaje (faktura liczona od netto ma w XML same wartości netto — nic nie dopisujemy).
  const withGross = data.items.some((item) => item.gross !== null);
  const rows = data.items.map((item, index) => `<tr>
      <td class="c">${index + 1}</td><td>${escapeHtml(item.name)}</td>
      <td class="r">${item.quantity === null ? '' : escapeHtml(quantityFormat.format(item.quantity))}</td><td>${escapeHtml(item.unit)}</td>
      <td class="r">${money(item.unitNet)}</td><td class="r">${money(item.net)}</td><td class="c">${escapeHtml(item.rate)}</td>${withGross ? `<td class="r">${money(item.gross)}</td>` : ''}
    </tr>`).join('');
  const rates = data.rates.map((entry) => `<tr><td>${escapeHtml(entry.label)}</td><td class="r">${money(entry.net)}</td><td class="r">${money(entry.vat)}</td>
      <td class="r">${money(Math.round((entry.net + entry.vat) * 100) / 100)}</td></tr>`).join('');
  const payment = [
    data.payment.method ? `Forma płatności: ${data.payment.method}` : '',
    data.payment.paid,
    data.payment.account ? `Rachunek: ${account(data.payment.account)}${data.payment.bank ? ` (${data.payment.bank})` : ''}` : '',
  ].filter(Boolean);
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>${fontCss}
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box}
    body{font-family:'Inter',Helvetica,Arial,sans-serif;font-size:9.5px;color:#111827;margin:0}
    h1{font-size:18px;margin:0 0 2px;font-weight:700}
    h3{font-size:8.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:0 0 4px;font-weight:600}
    p{margin:1px 0}
    .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;border-bottom:1px solid #d1d5db;padding-bottom:10px;margin-bottom:10px}
    .ksef{font-size:9px;color:#374151}
    .qr{text-align:center;font-size:7.5px;color:#6b7280}
    .qr img{width:92px;height:92px;display:block;margin:0 auto 2px}
    .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px}
    .meta div{border:1px solid #e5e7eb;border-radius:4px;padding:5px 6px}
    .meta span{display:block;color:#6b7280;font-size:7.5px;text-transform:uppercase;letter-spacing:.05em}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
    .party{border:1px solid #e5e7eb;border-radius:4px;padding:8px}
    .party .name{font-weight:600;font-size:10.5px}
    table{width:100%;border-collapse:collapse;margin-bottom:10px}
    th{background:#f3f4f6;font-weight:600;font-size:8px;text-transform:uppercase;letter-spacing:.04em;color:#374151;text-align:left;padding:5px 4px;border-bottom:1px solid #d1d5db}
    td{padding:4px;border-bottom:1px solid #eef0f3;vertical-align:top}
    .r{text-align:right;white-space:nowrap}.c{text-align:center}
    .sum{display:flex;justify-content:flex-end;gap:16px;align-items:flex-start}
    .sum table{width:60%}
    .total{font-size:13px;font-weight:700;text-align:right;margin:4px 0 12px}
    .box{border:1px solid #e5e7eb;border-radius:4px;padding:8px;margin-bottom:8px}
    .note{color:#6b7280;font-size:8px;margin-top:10px;border-top:1px solid #e5e7eb;padding-top:6px}
  </style></head><body>
    <div class="top">
      <div>
        <h1>${escapeHtml(data.kind)} nr ${escapeHtml(data.number || '—')}</h1>
        ${data.ksefNumber ? `<p class="ksef">Numer KSeF: <strong>${escapeHtml(data.ksefNumber)}</strong></p>` : ''}
        ${data.correction ? `<p class="ksef">${data.correction.of ? `Koryguje fakturę nr ${escapeHtml(data.correction.of)}. ` : ''}${data.correction.reason ? `Przyczyna: ${escapeHtml(data.correction.reason)}` : ''}</p>` : ''}
      </div>
      ${qr ? `<div class="qr"><img src="${qr.dataUrl}" alt="Kod QR KSeF"/>Weryfikacja w KSeF</div>` : ''}
    </div>
    ${meta.length ? `<div class="meta">${meta.map(([label, value]) => `<div><span>${escapeHtml(label)}</span>${escapeHtml(value)}</div>`).join('')}</div>` : ''}
    <div class="parties">${partyHtml('Sprzedawca', data.seller)}${partyHtml('Nabywca', data.buyer)}</div>
    ${data.items.length ? `<table><thead><tr><th class="c">Lp.</th><th>Nazwa</th><th class="r">Ilość</th><th>J.m.</th><th class="r">Cena netto</th>
      <th class="r">Wartość netto</th><th class="c">VAT</th>${withGross ? '<th class="r">Wartość brutto</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="box">Pozycji faktury nie ma w zapisanych danych (bez pobranego XML z KSeF). Pełną treść zawiera faktura w KSeF.</p>'}
    <div class="sum">${rates ? `<table><thead><tr><th>Stawka</th><th class="r">Netto</th><th class="r">VAT</th><th class="r">Brutto</th></tr></thead><tbody>${rates}</tbody></table>` : ''}</div>
    <p class="total">Do zapłaty: ${money(data.gross)} ${escapeHtml(data.currency)}</p>
    ${payment.length ? `<div class="box"><h3>Płatność</h3>${payment.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : ''}
    ${data.notes.length ? `<div class="box"><h3>Informacje dodatkowe</h3>${data.notes.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : ''}
    <p class="note">Wizualizacja faktury z Krajowego Systemu e-Faktur${data.fromXml ? ' wygenerowana z zapisanego XML' : ' z zapisanych danych faktury'}.
      Dokumentem jest faktura w KSeF${data.ksefNumber ? ` o numerze ${escapeHtml(data.ksefNumber)}` : ''}.</p>
  </body></html>`;
}

/** PDF wizualizacji; `environment` — środowisko KSeF firmy (kod QR liczy się tylko z oryginalnego XML). */
export async function renderKsefVisualizationPdf(row: Row, environment: 'test' | 'production'): Promise<Buffer> {
  const data = ksefVisualizationData(row);
  let qr: { dataUrl: string; verificationUrl: string } | null = null;
  if (data.fromXml && data.seller.nip && data.issueDate) {
    qr = await generateKsefInvoiceQrDataUrl({
      sellerNip: data.seller.nip, issueDate: data.issueDate, xmlContent: String(row.xml_content), environment,
    }).catch(() => null);
  }
  const html = ksefVisualizationHtml(data, await loadPrintFontCss(), qr);
  const { pdf } = await renderHtmlToPdf({
    html,
    footer: { left: `${data.kind} ${data.number}${data.ksefNumber ? ` · KSeF ${data.ksefNumber}` : ''}`, right: '' },
  });
  return pdf;
}
