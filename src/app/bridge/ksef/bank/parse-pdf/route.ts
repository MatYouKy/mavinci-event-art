import { NextResponse } from 'next/server';
import { PdfReader } from 'pdfreader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface BankTransaction {
  transactionDate: string;
  postingDate?: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';

  counterpartyName?: string;
  counterpartyAccount?: string;
  title?: string;
  referenceNumber?: string;

  transactionKind?:
    | 'transfer'
    | 'split_payment'
    | 'blik'
    | 'card'
    | 'salary'
    | 'tax'
    | 'us'
    | 'zus'
    | 'cash'
    | 'unknown';

  originalAmount?: number;
  originalCurrency?: string;
  exchangeDate?: string;

  nip?: string;
  cardMasked?: string;
  blikReference?: string;

  taxOffice?: boolean;
  zusPayment?: boolean;
  salaryPayment?: boolean;
  splitPayment?: boolean;
}

interface BankStatement {
  accountNumber?: string;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  transactions: BankTransaction[];
  rawText?: string;
  lines?: string[];
}

function sanitizeText(value?: string | null): string {
  return (value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOriginalAmountAndCurrency(text?: string | null): {
  originalAmount?: number;
  originalCurrency?: string;
} {
  if (!text) return {};

  const match = text.match(/Kwota oryg\.:\s*([\d\s.,]+)\s*([A-Z]{3})/i);
  if (!match) return {};

  const amount = parsePolishAmount(match[1]);
  return {
    originalAmount: amount ?? undefined,
    originalCurrency: match[2]?.toUpperCase(),
  };
}

function extractExchangeDate(text?: string | null): string | undefined {
  if (!text) return undefined;

  const match = text.match(/Data przetw\.:\s*(\d{2}\.\d{2}\.\d{4})/i);
  if (!match) return undefined;

  return formatIsoDateFromPolish(match[1]) || undefined;
}

function extractNip(text?: string | null): string | undefined {
  if (!text) return undefined;

  const match = text.match(/\bNIP[: ]?\s*(\d{10})\b/i) || text.match(/\b(\d{10})\b/);
  return match?.[1];
}

function extractMaskedCard(text?: string | null): string | undefined {
  if (!text) return undefined;

  const match = text.match(/Karta[: ]?([0-9*]{4,}[0-9*]*)/i);
  return match?.[1];
}

function detectTransactionKind(text?: string | null): BankTransaction['transactionKind'] {
  const upper = sanitizeText(text).toUpperCase();

  if (upper.includes('SPLIT PAYMENT')) return 'split_payment';
  if (upper.includes('BLIK')) return 'blik';
  if (upper.includes('KARTA') || upper.includes('CARD')) return 'card';
  if (upper.includes('WYNAGRODZEN')) return 'salary';
  if (upper.includes('ZUS')) return 'zus';
  if (upper.includes('URZAD SKARBOWY') || upper.includes('US VAT') || upper.includes('PODATEK')) return 'tax';
  if (upper.includes('PRZELEW')) return 'transfer';

  return 'unknown';
}

function cleanupCounterpartyName(text?: string | null): string | undefined {
  if (!text) return undefined;

  return sanitizeText(text)
    .replace(/Kwota oryg\.:.*$/i, ' ')
    .replace(/Data przetw\.:.*$/i, ' ')
    .replace(/Karta[: ].*$/i, ' ')
    .replace(/NIP[: ]?\d{10}/gi, ' ')
    .replace(/\b\d{10}\b/g, ' ')
    .replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, ' ')
    .replace(/\b[A-Z]{2,}\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function cleanupTransactionTitle(text?: string | null): string | undefined {
  if (!text) return undefined;

  return sanitizeText(text)
    .replace(/Kwota oryg\.:.*$/i, ' ')
    .replace(/Data przetw\.:.*$/i, ' ')
    .replace(/Karta[: ].*$/i, ' ')
    .replace(/Nazwisko i imię[: ].*$/i, ' ')
    .replace(/Lokalizacja[: ].*$/i, ' ')
    .replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, ' ')
    .replace(/\b\d{10,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function parsePolishAmount(value: string): number | null {
  const cleaned = value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatIsoDateFromPolish(value: string): string | null {
  const match = value.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function extractAccountNumber(text: string): string | undefined {
  const iban = text.match(/\bPL\d{26}\b/i);
  if (iban) return iban[0].toUpperCase();

  const compact = text.replace(/\s/g, '');
  const plain = compact.match(/\b\d{26}\b/);
  if (plain) return plain[0];

  return undefined;
}

function extractReferenceNumber(text: string): string | undefined {
  const nonRef = text.match(/NONREF\/\/([A-Z0-9/.\-]+)/i);
  if (nonRef?.[1]) return nonRef[1];

  const ref = text.match(/(?:NR\s*REF[: ]|REF[: ])\s*([A-Z0-9/.\-]+)/i);
  if (ref?.[1]) return ref[1];

  return undefined;
}

function cleanupTitle(text: string): string {
  return sanitizeText(text)
    .replace(/\bPL\d{26}\b/gi, ' ')
    .replace(/\b\d{26}\b/g, ' ')
    .replace(/\b\d{10,}\b/g, ' ')
    .replace(/NONREF\/\/[A-Z0-9/.\-]+/gi, ' ')
    .replace(/\bV\d+\b/gi, ' ')
    .replace(/\bJ\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCounterpartyName(block: string): string | undefined {
  const text = sanitizeText(block);
  if (!text) return undefined;

  const patterns = [
    /CASTORAMA[ A-Z0-9.\-]*/i,
    /ALLEGRO[ A-Z0-9.\-]*/i,
    /APPLE\.COM\/BILL[ A-Z0-9.\-]*/i,
    /INTER CHIP[ A-Z0-9.\-]*/i,
    /CIRCLE K[ A-Z0-9.\-]*/i,
    /MILEWSCY[ A-Z0-9.\-]*/i,
    /ORANGE POLSKA[ A-Z0-9.\-]*/i,
    /AGMAR[ A-Z0-9.\-]*/i,
    /STREFA INSPIRACJI[ A-Z0-9.\-]*/i,
    /URZAD[ A-Z0-9.\-]*/i,
    /URZĄD[ A-Z0-9.\-]*/i,
    /SKARBOWY[ A-Z0-9.\-]*/i,
    /PKO ?BP[ A-Z0-9.\-]*/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return sanitizeText(match[0]);
  }

  const cleaned = text
    .replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, ' ')
    .replace(/\bPL\d{26}\b/gi, ' ')
    .replace(/\b\d{26}\b/g, ' ')
    .replace(/\b\d{10,}\b/g, ' ')
    .replace(/NONREF\/\/[A-Z0-9/.\-]+/gi, ' ')
    .replace(/\bV\d+\b/gi, ' ')
    .replace(/\bJ\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || undefined;
}

function isTransactionHeaderLine(line: string): boolean {
  const normalized = sanitizeText(line);
  return /\b\d{2}\.\d{2}\.\d{4}\b/.test(normalized) && /-?\d[\d\s]*,\d{2}\b/.test(normalized);
}

function extractTransactionHeaderData(line: string) {
  const clean = sanitizeText(line);

  const dates = [...clean.matchAll(/\b\d{2}\.\d{2}\.\d{4}\b/g)].map((m) => m[0]);
  const amounts = [...clean.matchAll(/(-?\d[\d\s]*,\d{2})/g)].map((m) => m[1]);

  if (!dates.length || !amounts.length) return null;

  const transactionDate = formatIsoDateFromPolish(dates[0]);
  const postingDate = dates[1] ? formatIsoDateFromPolish(dates[1]) || undefined : undefined;
  const amountRaw = amounts[amounts.length - 1];
  const amount = parsePolishAmount(amountRaw);

  if (!transactionDate || amount == null) return null;

  return {
    transactionDate,
    postingDate,
    amount: Math.abs(amount),
    type: amountRaw.trim().startsWith('-') ? ('debit' as const) : ('credit' as const),
  };
}

function parsePKOPdfText(rawText: string): BankStatement {
  const lines = rawText
    .split('\n')
    .map((line) => sanitizeText(line))
    .filter(Boolean);

  const transactions: BankTransaction[] = [];
  let currentBlock: string[] = [];

  const flushBlock = () => {
    if (!currentBlock.length) return;

    const header = currentBlock[0];
    const details = currentBlock.slice(1).join(' ');
    const headerData = extractTransactionHeaderData(header);

    if (!headerData) {
      currentBlock = [];
      return;
    }

    const combined = sanitizeText(`${header} ${details}`);

    const original = extractOriginalAmountAndCurrency(combined);
    const exchangeDate = extractExchangeDate(combined);
    const nip = extractNip(combined);
    const cardMasked = extractMaskedCard(combined);
    const transactionKind = detectTransactionKind(combined);
    
    const rawCounterparty = extractCounterpartyName(combined);
    const rawTitle = details || header;
    
    transactions.push({
      transactionDate: headerData.transactionDate,
      postingDate: headerData.postingDate,
      amount: headerData.amount,
      currency: 'PLN',
      type: headerData.type,
    
      counterpartyName: cleanupCounterpartyName(rawCounterparty || combined),
      counterpartyAccount: extractAccountNumber(combined),
      title: cleanupTransactionTitle(rawTitle),
      referenceNumber: extractReferenceNumber(combined),
    
      transactionKind,
      originalAmount: original.originalAmount,
      originalCurrency: original.originalCurrency,
      exchangeDate,
    
      nip,
      cardMasked,
      splitPayment: transactionKind === 'split_payment',
      taxOffice: /URZAD SKARBOWY|US VAT|PODATEK/i.test(combined),
      zusPayment: /ZUS/i.test(combined),
      salaryPayment: /WYNAGRODZEN/i.test(combined),
    });

    currentBlock = [];
  };

  for (const line of lines) {
    const upper = line.toUpperCase();

    if (
      upper.includes('HISTORIA OPERACJI') ||
      upper.includes('SALDO POCZATKOWE') ||
      upper.includes('SALDO KOŃCOWE') ||
      upper.includes('SALDO KONCOWE') ||
      upper.includes('STRONA ') ||
      upper.includes('DATA OPERACJI') ||
      upper.includes('DATA KSIEGOWANIA') ||
      upper.includes('OPIS OPERACJI')
    ) {
      continue;
    }

    if (isTransactionHeaderLine(line)) {
      flushBlock();
      currentBlock = [line];
      continue;
    }

    if (currentBlock.length) {
      currentBlock.push(line);
    }
  }

  flushBlock();

  return {
    currency: 'PLN',
    transactions,
    rawText,
    lines,
  };
}

function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const rows = new Map<number, string[]>();

    new PdfReader().parseBuffer(buffer, (err, item) => {
      if (err) {
        reject(err);
        return;
      }

      if (!item) {
        const text = [...rows.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, parts]) => parts.join(' '))
          .join('\n');

        resolve(text);
        return;
      }

      if ('text' in item && typeof item.text === 'string') {
        const y = Math.round(Number(item.y) * 100);
        const row = rows.get(y) || [];
        row.push(item.text);
        rows.set(y, row);
      }
    });
  });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Nie przesłano pliku' },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json(
        { success: false, error: 'Dozwolony jest tylko plik PDF' },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const rawText = await extractTextFromPdfBuffer(Buffer.from(arrayBuffer));
    const parsed = parsePKOPdfText(rawText);

    return NextResponse.json({
      success: true,
      data: parsed,
    });
  } catch (error: any) {
    console.error('[BANK_PARSE_PDF_ROUTE] error', error);

    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Błąd parsowania PDF',
      },
      { status: 500 },
    );
  }
}