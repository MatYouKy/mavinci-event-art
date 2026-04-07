export interface ParsedPdfBankTransaction {
  transactionDate: string;
  postingDate?: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';
  counterpartyName?: string;
  counterpartyAccount?: string;
  title?: string;
  referenceNumber?: string;
}

export interface ParsedPdfBankStatement {
  accountNumber?: string;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  transactions: ParsedPdfBankTransaction[];
  rawText?: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function parsePKOBankPdf(file: File): Promise<ParsedPdfBankStatement> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;

  let rawText = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item: any) => {
        if (item && typeof item === 'object' && 'str' in item) {
          return item.str || '';
        }
        return '';
      })
      .join(' ');

    rawText += `${pageText}\n`;
  }

  rawText = normalizeWhitespace(rawText);

  return {
    accountNumber: undefined,
    openingBalance: undefined,
    closingBalance: undefined,
    currency: 'PLN',
    transactions: [],
    rawText,
  };
}