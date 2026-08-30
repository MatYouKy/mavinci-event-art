import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

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
  periodFrom?: string;
  periodTo?: string;
  parserVersion: number;
  integrity: {
    checkedTransitions: number;
    failedTransitions: number;
  };
}

type PdfCell = { page: number; x: number; y: number; text: string };
type PdfRow = { page: number; y: number; cells: PdfCell[] };

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

function parsePKOPdfRows(rows: PdfRow[]): BankStatement {
  const lines = rows.map((row) => sanitizeText(row.cells.map((cell) => cell.text).join(' '))).filter(Boolean);
  const rawText = lines.join('\n');
  const transactions: BankTransaction[] = [];
  const transactionRows: Array<{ rowIndex: number; date: string; amountRaw: string; amount: number; balance: number }> = [];

  rows.forEach((row, rowIndex) => {
    const dateCell = row.cells.find((cell) => cell.x < 6 && /^\d{2}\.\d{2}\.\d{4}$/.test(cell.text.trim()));
    const moneyCells = row.cells
      .filter((cell) => cell.x > 20 && /^-?[\d\s]+,\d{2}$/.test(cell.text.trim()))
      .sort((a, b) => a.x - b.x);

    // PKO umieszcza kwotę operacji przed saldem. Bez obu kolumn rekord jest odrzucany.
    if (!dateCell || moneyCells.length < 2) return;
    const amountCell = moneyCells[0];
    const balanceCell = moneyCells[moneyCells.length - 1];
    const date = formatIsoDateFromPolish(dateCell.text);
    const amount = parsePolishAmount(amountCell.text);
    const balance = parsePolishAmount(balanceCell.text);
    if (!date || amount == null || balance == null) return;
    transactionRows.push({ rowIndex, date, amountRaw: amountCell.text, amount, balance });
  });

  let previousBalance: number | null = null;
  let checkedTransitions = 0;
  let failedTransitions = 0;

  transactionRows.forEach((transactionRow, index) => {
    const nextRowIndex = transactionRows[index + 1]?.rowIndex ?? rows.length;
    const detailCells = rows
      .slice(transactionRow.rowIndex + 1, nextRowIndex)
      .flatMap((row) => row.cells)
      .filter((cell) => cell.x < 26);
    const details = sanitizeText(detailCells.map((cell) => cell.text).join(' '));
    const combined = sanitizeText(`${transactionRow.date} ${details}`);
    const postingDateCell = detailCells.find((cell) => cell.x < 6 && /^\d{2}\.\d{2}\.\d{4}$/.test(cell.text.trim()));
    const original = extractOriginalAmountAndCurrency(combined);
    const transactionKind = detectTransactionKind(combined);
    const rawCounterparty = extractCounterpartyName(combined);
    const type = transactionRow.amountRaw.trim().startsWith('-') ? ('debit' as const) : ('credit' as const);
    const absoluteAmount = Math.abs(transactionRow.amount);

    if (previousBalance !== null) {
      checkedTransitions += 1;
      const expectedBalance = previousBalance + (type === 'credit' ? absoluteAmount : -absoluteAmount);
      if (Math.abs(expectedBalance - transactionRow.balance) > 0.02) failedTransitions += 1;
    }
    previousBalance = transactionRow.balance;

    transactions.push({
      transactionDate: transactionRow.date,
      postingDate: postingDateCell ? formatIsoDateFromPolish(postingDateCell.text) || undefined : undefined,
      amount: absoluteAmount,
      currency: 'PLN',
      type,
      counterpartyName: cleanupCounterpartyName(rawCounterparty || combined),
      counterpartyAccount: extractAccountNumber(combined),
      title: cleanupTransactionTitle(details || transactionRow.date),
      referenceNumber: extractReferenceNumber(combined),
      transactionKind,
      originalAmount: original.originalAmount,
      originalCurrency: original.originalCurrency,
      exchangeDate: extractExchangeDate(combined),
      nip: extractNip(combined),
      cardMasked: extractMaskedCard(combined),
      splitPayment: transactionKind === 'split_payment',
      taxOffice: /URZAD SKARBOWY|US VAT|PODATEK/i.test(combined),
      zusPayment: /ZUS/i.test(combined),
      salaryPayment: /WYNAGRODZEN/i.test(combined),
    });
  });

  if (!transactions.length) throw new Error('Nie znaleziono poprawnych operacji w tabeli wyciągu PKO');
  if (checkedTransitions > 0 && failedTransitions > 0) {
    throw new Error('Kontrola ciągłości salda nie powiodła się. Plik nie został zaimportowany.');
  }

  const periodMatch = rawText.match(/WYCIĄG\s+za\s+okres\s+(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})/i);
  const firstSignedAmount = transactions[0].type === 'credit' ? transactions[0].amount : -transactions[0].amount;

  return {
    openingBalance: transactionRows[0] ? transactionRows[0].balance - firstSignedAmount : undefined,
    closingBalance: transactionRows.at(-1)?.balance,
    currency: 'PLN',
    transactions,
    rawText,
    lines,
    periodFrom: periodMatch ? formatIsoDateFromPolish(periodMatch[1]) || undefined : undefined,
    periodTo: periodMatch ? formatIsoDateFromPolish(periodMatch[2]) || undefined : undefined,
    parserVersion: 2,
    integrity: { checkedTransitions, failedTransitions },
  };
}

function extractPdfRows(buffer: Buffer): Promise<PdfRow[]> {
  return (async () => {
    const rows = new Map<string, PdfCell[]>();
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      disableFontFace: true,
    });
    const document = await loadingTask.promise;

    try {
      if (document.numPages > 100) {
        throw new Error('Wyciąg ma zbyt wiele stron. Maksymalna liczba stron to 100.');
      }

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();

        for (const item of content.items) {
          if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim()) continue;

          // pdfreader używał siatki czterech jednostek na cal. Zachowujemy tę samą
          // skalę, aby istniejący, zweryfikowany parser kolumn PKO działał identycznie.
          const x = Number(item.transform[4]) / 12 - 0.25;
          const y = (viewport.height - Number(item.transform[5])) / 12 - 0.75;
          const key = `${pageNumber}:${Math.round(y * 100)}`;
          const row = rows.get(key) || [];
          row.push({ page: pageNumber, x, y, text: item.str });
          rows.set(key, row);
        }

        page.cleanup();
      }
    } finally {
      await document.destroy();
    }

    return Array.from(rows.values())
      .map((cells: PdfCell[]) => ({
        page: cells[0].page,
        y: cells[0].y,
        cells: cells.sort((a, b) => a.x - b.x),
      }))
      .sort((a, b) => a.page - b.page || a.y - b.y);
  })();
}

export async function POST(req: Request) {
  try {
    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: 'Wymagane logowanie.' }, { status: 401 });
    }

    const { data: canManageInvoices, error: permissionError } = await userClient.rpc(
      'can_manage_invoices',
    );
    if (permissionError || !canManageInvoices) {
      return NextResponse.json(
        { success: false, error: 'Brak uprawnień do importu wyciągów.' },
        { status: 403 },
      );
    }

    const formData = await req.formData();
    const file = (formData as any).get('file');

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

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Plik PDF jest zbyt duży. Maksymalny rozmiar to 10 MB.' },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const rows = await extractPdfRows(Buffer.from(arrayBuffer));
    const parsed = parsePKOPdfRows(rows);

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
