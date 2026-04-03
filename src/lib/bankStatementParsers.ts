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
}

export interface BankStatement {
  accountNumber?: string;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  transactions: BankTransaction[];
}

function normalizeText(value?: string | null): string {
  return (value || '')
    .toUpperCase()
    .replace(/[Ą]/g, 'A')
    .replace(/[Ć]/g, 'C')
    .replace(/[Ę]/g, 'E')
    .replace(/[Ł]/g, 'L')
    .replace(/[Ń]/g, 'N')
    .replace(/[Ó]/g, 'O')
    .replace(/[Ś]/g, 'S')
    .replace(/[ŹŻ]/g, 'Z')
    .replace(/[^A-Z0-9]/g, '');
}

function extractNips(text?: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/\b\d{10}\b/g);
  return matches ? [...new Set(matches)] : [];
}

function parse86Segments(description: string): {
  title?: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
  postingDate?: string;
} {
  const parts = description
    .split('~')
    .map((p) => p.trim())
    .filter(Boolean);

  const titleParts: string[] = [];
  const counterpartyParts: string[] = [];
  let counterpartyAccount: string | undefined;
  let postingDate: string | undefined;

  for (const part of parts) {
    const fieldCode = part.substring(0, 2);
    const rawValue = part.substring(2).trim();

    if (!rawValue || rawValue === '0' || rawValue === '�') continue;

    if (/^(20|21|22|23|24|25)$/.test(fieldCode)) {
      titleParts.push(rawValue);
      continue;
    }

    if (/^(32|33)$/.test(fieldCode)) {
      counterpartyParts.push(rawValue);
      continue;
    }

    if (fieldCode === '38') {
      counterpartyAccount = rawValue;
      continue;
    }

    if (fieldCode === '60') {
      if (rawValue.length === 8 && /^\d{8}$/.test(rawValue)) {
        const year = rawValue.substring(0, 4);
        const month = rawValue.substring(4, 6);
        const day = rawValue.substring(6, 8);
        postingDate = `${year}-${month}-${day}`;
      }
      continue;
    }
  }

  const title = titleParts
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^0+\s*/, '')
    .replace(/^\d+\s+[A-Z0-9]+\s*/i, '')
    .trim();

  const counterpartyName = counterpartyParts.join(' ').replace(/\s+/g, ' ').trim();

  return {
    title: title || undefined,
    counterpartyName: counterpartyName || undefined,
    counterpartyAccount,
    postingDate,
  };
}

export function parseMT940(content: string): BankStatement {
  const transactions: BankTransaction[] = [];
  let accountNumber: string | undefined;
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  let currency = 'PLN';

  const lines = content.replace(/\r/g, '').split('\n');
  let currentTransaction: Partial<BankTransaction> = {};
  let current86Buffer = '';

  const flushCurrent86 = () => {
    if (!current86Buffer) return;

    const parsed86 = parse86Segments(current86Buffer);

    if (parsed86.title) {
      currentTransaction.title = parsed86.title;
    }

    if (parsed86.counterpartyName) {
      currentTransaction.counterpartyName = parsed86.counterpartyName;
    }

    if (parsed86.counterpartyAccount) {
      currentTransaction.counterpartyAccount = parsed86.counterpartyAccount;
    }

    if (!currentTransaction.postingDate && parsed86.postingDate) {
      currentTransaction.postingDate = parsed86.postingDate;
    }

    current86Buffer = '';
  };

  const flushCurrentTransaction = () => {
    flushCurrent86();

    if (currentTransaction.amount !== undefined) {
      transactions.push(currentTransaction as BankTransaction);
    }

    currentTransaction = {};
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const isNewTag = /^:\d{2}[A-Z]?:/.test(trimmed);

    if (isNewTag && !trimmed.startsWith(':86:')) {
      flushCurrent86();
    }

    if (trimmed.startsWith(':25:')) {
      accountNumber = trimmed.substring(4).trim();
      continue;
    }

    if (trimmed.startsWith(':60F:')) {
      const match = trimmed.match(/:60F:([CD])(\d{6})([A-Z]{3})([\d,]+)/);
      if (match) {
        currency = match[3];
        openingBalance = parseFloat(match[4].replace(',', '.'));
        if (match[1] === 'D') openingBalance *= -1;
      }
      continue;
    }

    if (trimmed.startsWith(':62F:')) {
      const match = trimmed.match(/:62F:([CD])(\d{6})([A-Z]{3})([\d,]+)/);
      if (match) {
        closingBalance = parseFloat(match[4].replace(',', '.'));
        if (match[1] === 'D') closingBalance *= -1;
      }
      continue;
    }

    if (trimmed.startsWith(':61:')) {
      flushCurrentTransaction();

      const value = trimmed.substring(4).trim();

      const match = value.match(
        /^(\d{6})(\d{4})?([CD])([A-Z])?([\d,]+)([A-Z0-9]{0,4})?(.*)?$/
      );

      if (match) {
        const dateStr = match[1];
        const year = parseInt(`20${dateStr.substring(0, 2)}`, 10);
        const month = dateStr.substring(2, 4);
        const day = dateStr.substring(4, 6);

        currentTransaction.transactionDate = `${year}-${month}-${day}`;

        if (match[2]) {
          const postMonth = match[2].substring(0, 2);
          const postDay = match[2].substring(2, 4);
          currentTransaction.postingDate = `${year}-${postMonth}-${postDay}`;
        }

        currentTransaction.type = match[3] === 'C' ? 'credit' : 'debit';
        currentTransaction.amount = parseFloat(match[5].replace(',', '.'));
        currentTransaction.currency = currency;

        const trailing = (match[7] || '').trim();
        if (trailing) {
          currentTransaction.referenceNumber = trailing.substring(0, 35).trim() || undefined;
        }
      }

      continue;
    }

    if (trimmed.startsWith(':86:')) {
      const value = trimmed.substring(4).trim();
      current86Buffer = value;
      continue;
    }

    if (current86Buffer && !isNewTag) {
      current86Buffer += ` ${trimmed}`;
      continue;
    }
  }

  flushCurrentTransaction();

  return {
    accountNumber,
    openingBalance,
    closingBalance,
    currency,
    transactions,
  };
}

export function parseJPK_WB(xmlContent: string): BankStatement {
  const transactions: BankTransaction[] = [];
  let accountNumber: string | undefined;
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  const currency = 'PLN';

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Błąd parsowania XML');
    }

    const accountElement = xmlDoc.querySelector('NrRachunku');
    if (accountElement) {
      accountNumber = accountElement.textContent || undefined;
    }

    const openingElement = xmlDoc.querySelector('SaldoPoczatkowe');
    if (openingElement) {
      openingBalance = parseFloat(openingElement.textContent || '0');
    }

    const closingElement = xmlDoc.querySelector('SaldoKoncowe');
    if (closingElement) {
      closingBalance = parseFloat(closingElement.textContent || '0');
    }

    const transactionElements = xmlDoc.querySelectorAll('WyciagWiersz');

    transactionElements.forEach((element) => {
      const dateElement = element.querySelector('DataOperacji');
      const amountElement = element.querySelector('KwotaOperacji');
      const titleElement = element.querySelector('OpisOperacji');
      const nameElement = element.querySelector('NazwaKontrahenta');
      const accountElementInner = element.querySelector('NrKontrahenta');

      if (dateElement && amountElement) {
        const amount = parseFloat(amountElement.textContent || '0');

        transactions.push({
          transactionDate: dateElement.textContent || '',
          amount: Math.abs(amount),
          currency: 'PLN',
          type: amount >= 0 ? 'credit' : 'debit',
          counterpartyName: nameElement?.textContent || undefined,
          counterpartyAccount: accountElementInner?.textContent || undefined,
          title: titleElement?.textContent || undefined,
        });
      }
    });
  } catch (error) {
    console.error('Error parsing JPK_WB:', error);
    throw new Error('Nie udało się sparsować pliku JPK_WB');
  }

  return {
    accountNumber,
    openingBalance,
    closingBalance,
    currency,
    transactions,
  };
}

export interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  buyerName: string;
  confidence: number;
  matchReason: string[];
}

export async function findMatchingInvoices(
  transaction: BankTransaction,
  supabase: any
): Promise<MatchCandidate[]> {
  const candidates: MatchCandidate[] = [];

  const { data: invoices, error } = await supabase
    .from('ksef_invoices')
    .select('*')
    .in('payment_status', ['unpaid', 'overdue'])
    .order('issue_date', { ascending: false })
    .limit(300);

  if (error || !invoices) {
    console.error('Error fetching invoices:', error);
    return candidates;
  }

  const transactionTitleNormalized = normalizeText(transaction.title);
  const transactionCounterpartyNormalized = normalizeText(transaction.counterpartyName);
  const transactionNips = [
    ...new Set([
      ...extractNips(transaction.title),
      ...extractNips(transaction.counterpartyName),
    ]),
  ];

  for (const invoice of invoices) {
    const matchReasons: string[] = [];
    let confidence = 0;

    const invoiceAmount = Number(invoice.gross_amount || 0);
    const transactionAmount = Number(transaction.amount || 0);

    if (invoiceAmount <= 0 || transactionAmount <= 0) continue;

    const amountDiff = Math.abs(invoiceAmount - transactionAmount);
    const amountRatioDiff = amountDiff / invoiceAmount;

    if (amountDiff < 0.01) {
      matchReasons.push('Dokładna kwota');
      confidence += 0.55;
    } else if (amountDiff <= 1) {
      matchReasons.push('Bardzo podobna kwota');
      confidence += 0.35;
    } else if (amountRatioDiff <= 0.02) {
      matchReasons.push('Kwota zbliżona do 2%');
      confidence += 0.2;
    } else if (amountRatioDiff <= 0.05) {
      matchReasons.push('Kwota zbliżona do 5%');
      confidence += 0.1;
    }

    const invoiceNumberNormalized = normalizeText(invoice.invoice_number);
    const ksefNumberNormalized = normalizeText(invoice.ksef_reference_number);

    if (transactionTitleNormalized && invoiceNumberNormalized) {
      if (
        transactionTitleNormalized.includes(invoiceNumberNormalized) ||
        invoiceNumberNormalized.includes(transactionTitleNormalized)
      ) {
        matchReasons.push('Numer faktury w tytule');
        confidence += 0.35;
      }
    }

    if (transactionTitleNormalized && ksefNumberNormalized) {
      if (transactionTitleNormalized.includes(ksefNumberNormalized)) {
        matchReasons.push('Numer KSeF w tytule');
        confidence += 0.45;
      }
    }

    const sellerNameNormalized = normalizeText(invoice.seller_name);
    const buyerNameNormalized = normalizeText(invoice.buyer_name);

    if (transactionCounterpartyNormalized) {
      if (
        sellerNameNormalized &&
        (
          transactionCounterpartyNormalized.includes(sellerNameNormalized) ||
          sellerNameNormalized.includes(transactionCounterpartyNormalized) ||
          (transactionCounterpartyNormalized.length > 8 &&
            sellerNameNormalized.length > 8 &&
            (
              transactionCounterpartyNormalized.includes(sellerNameNormalized.substring(0, 10)) ||
              sellerNameNormalized.includes(transactionCounterpartyNormalized.substring(0, 10))
            ))
        )
      ) {
        matchReasons.push('Nazwa sprzedawcy');
        confidence += 0.3;
      }

      if (
        buyerNameNormalized &&
        (
          transactionCounterpartyNormalized.includes(buyerNameNormalized) ||
          buyerNameNormalized.includes(transactionCounterpartyNormalized) ||
          (transactionCounterpartyNormalized.length > 8 &&
            buyerNameNormalized.length > 8 &&
            (
              transactionCounterpartyNormalized.includes(buyerNameNormalized.substring(0, 10)) ||
              buyerNameNormalized.includes(transactionCounterpartyNormalized.substring(0, 10))
            ))
        )
      ) {
        matchReasons.push('Nazwa nabywcy');
        confidence += 0.15;
      }
    }

    const invoiceNips = [
      invoice.seller_nip,
      invoice.buyer_nip,
    ].filter(Boolean);

    for (const nip of invoiceNips) {
      if (transactionNips.includes(String(nip))) {
        matchReasons.push(`NIP ${nip}`);
        confidence += 0.35;
        break;
      }
    }

    if (invoice.payment_due_date) {
      const dueDate = new Date(invoice.payment_due_date);
      const transDate = new Date(transaction.transactionDate);

      dueDate.setHours(0, 0, 0, 0);
      transDate.setHours(0, 0, 0, 0);

      const daysDiff = Math.abs(
        (transDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysDiff <= 3) {
        matchReasons.push('Data bardzo bliska terminowi');
        confidence += 0.15;
      } else if (daysDiff <= 7) {
        matchReasons.push('Data bliska terminowi');
        confidence += 0.08;
      } else if (daysDiff <= 14) {
        matchReasons.push('Data w pobliżu terminu');
        confidence += 0.04;
      }
    }

    if (invoice.issue_date) {
      const issueDate = new Date(invoice.issue_date);
      const transDate = new Date(transaction.transactionDate);

      issueDate.setHours(0, 0, 0, 0);
      transDate.setHours(0, 0, 0, 0);

      const issueDiffDays = Math.abs(
        (transDate.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (issueDiffDays <= 7) {
        matchReasons.push('Data bliska wystawieniu');
        confidence += 0.05;
      }
    }

    const transactionIsIncoming = transaction.type === 'credit';
    const invoiceIsIssued = String(invoice.invoice_type || '').toLowerCase() === 'issued';
    const invoiceIsReceived = String(invoice.invoice_type || '').toLowerCase() === 'received';

    if (transactionIsIncoming && invoiceIsIssued) {
      matchReasons.push('Wpłata do faktury sprzedażowej');
      confidence += 0.08;
    }

    if (!transactionIsIncoming && invoiceIsReceived) {
      matchReasons.push('Wypłata do faktury kosztowej');
      confidence += 0.08;
    }

    confidence = Math.min(confidence, 1);

    if (confidence >= 0.3) {
      candidates.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number || invoice.ksef_reference_number,
        amount: invoiceAmount,
        dueDate: invoice.payment_due_date || invoice.issue_date || '',
        buyerName: invoice.buyer_name || invoice.seller_name || '',
        confidence,
        matchReason: [...new Set(matchReasons)],
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}