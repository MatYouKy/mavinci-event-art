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

export function parseMT940(content: string): BankStatement {
  const transactions: BankTransaction[] = [];
  let accountNumber: string | undefined;
  let openingBalance: number | undefined;
  let closingBalance: number | undefined;
  let currency = 'PLN';

  const lines = content.split('\n');
  let currentTransaction: Partial<BankTransaction> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    // :25: - numer konta
    if (trimmed.startsWith(':25:')) {
      accountNumber = trimmed.substring(4).trim();
    }

    // :60F: - saldo początkowe (Opening Balance)
    // Format: C/D YYMMDD CUR AMOUNT
    if (trimmed.startsWith(':60F:')) {
      const match = trimmed.match(/:60F:([CD])(\d{6})(\w{3})([\d,]+)/);
      if (match) {
        currency = match[3];
        openingBalance = parseFloat(match[4].replace(',', '.'));
        if (match[1] === 'D') openingBalance *= -1;
      }
    }

    // :62F: - saldo końcowe (Closing Balance)
    if (trimmed.startsWith(':62F:')) {
      const match = trimmed.match(/:62F:([CD])(\d{6})(\w{3})([\d,]+)/);
      if (match) {
        closingBalance = parseFloat(match[4].replace(',', '.'));
        if (match[1] === 'D') closingBalance *= -1;
      }
    }

    // :61: - szczegóły transakcji
    // Format: YYMMDD MMDD [C/D] AMOUNT
    if (trimmed.startsWith(':61:')) {
      // Zapisz poprzednią transakcję
      if (currentTransaction.amount !== undefined) {
        transactions.push(currentTransaction as BankTransaction);
      }

      currentTransaction = {};

      const match = trimmed.match(/:61:(\d{6})(\d{4})?([CD])([\d,]+)/);
      if (match) {
        const dateStr = match[1];
        const year = parseInt('20' + dateStr.substring(0, 2));
        const month = dateStr.substring(2, 4);
        const day = dateStr.substring(4, 6);

        currentTransaction.transactionDate = `${year}-${month}-${day}`;

        // Jeśli jest data księgowania (MMDD)
        if (match[2]) {
          const postMonth = match[2].substring(0, 2);
          const postDay = match[2].substring(2, 4);
          currentTransaction.postingDate = `${year}-${postMonth}-${postDay}`;
        }

        currentTransaction.type = match[3] === 'C' ? 'credit' : 'debit';
        currentTransaction.amount = parseFloat(match[4].replace(',', '.'));
        currentTransaction.currency = currency;
      }
    }

    // :86: - opis transakcji (format PKO BP z separatorem ~)
    if (trimmed.startsWith(':86:')) {
      const fullDescription = trimmed.substring(4).trim();

      // Podziel po separatorze ~ (tilde)
      const parts = fullDescription.split('~');

      let titleParts: string[] = [];

      for (const part of parts) {
        const cleanPart = part.trim();
        if (!cleanPart) continue;

        // ~20 - tytuł płatności (pole 20-25)
        if (cleanPart.match(/^2[0-5]/)) {
          const titleText = cleanPart.substring(2).trim();
          if (titleText && titleText !== '0' && titleText !== '�') {
            titleParts.push(titleText);
          }
        }

        // ~32 lub ~33 - nazwa kontrahenta
        if (cleanPart.startsWith('32') || cleanPart.startsWith('33')) {
          const name = cleanPart.substring(2).trim();
          if (name && name !== '�') {
            if (!currentTransaction.counterpartyName) {
              currentTransaction.counterpartyName = name;
            } else {
              currentTransaction.counterpartyName += ' ' + name;
            }
          }
        }

        // ~38 - numer konta kontrahenta (IBAN)
        if (cleanPart.startsWith('38')) {
          const account = cleanPart.substring(2).trim();
          if (account && account !== '�') {
            currentTransaction.counterpartyAccount = account;
          }
        }

        // ~60 - data waluty
        if (cleanPart.startsWith('60')) {
          const valueDate = cleanPart.substring(2).trim();
          if (valueDate && valueDate.length === 8) {
            const vYear = valueDate.substring(0, 4);
            const vMonth = valueDate.substring(4, 6);
            const vDay = valueDate.substring(6, 8);
            if (!currentTransaction.postingDate) {
              currentTransaction.postingDate = `${vYear}-${vMonth}-${vDay}`;
            }
          }
        }
      }

      // Ustaw tytuł płatności
      if (titleParts.length > 0) {
        currentTransaction.title = titleParts.join(' ').trim();
      }

      // Fallback - jeśli nie udało się sparsować, użyj całego opisu
      if (!currentTransaction.title && fullDescription && fullDescription !== '�') {
        currentTransaction.title = fullDescription.replace(/~/g, ' ').trim();
      }
    }
  }

  // Dodaj ostatnią transakcję
  if (currentTransaction.amount !== undefined) {
    transactions.push(currentTransaction as BankTransaction);
  }

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
    // Proste parsowanie XML - w produkcji użyj DOMParser
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

    // Sprawdź błędy parsowania
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Błąd parsowania XML');
    }

    // Pobierz numer konta
    const accountElement = xmlDoc.querySelector('NrRachunku');
    if (accountElement) {
      accountNumber = accountElement.textContent || undefined;
    }

    // Pobierz salda
    const openingElement = xmlDoc.querySelector('SaldoPoczatkowe');
    if (openingElement) {
      openingBalance = parseFloat(openingElement.textContent || '0');
    }

    const closingElement = xmlDoc.querySelector('SaldoKoncowe');
    if (closingElement) {
      closingBalance = parseFloat(closingElement.textContent || '0');
    }

    // Pobierz transakcje
    const transactionElements = xmlDoc.querySelectorAll('WyciagWiersz');

    transactionElements.forEach((element) => {
      const dateElement = element.querySelector('DataOperacji');
      const amountElement = element.querySelector('KwotaOperacji');
      const titleElement = element.querySelector('OpisOperacji');
      const nameElement = element.querySelector('NazwaKontrahenta');
      const accountElement = element.querySelector('NrKontrahenta');

      if (dateElement && amountElement) {
        const amount = parseFloat(amountElement.textContent || '0');

        transactions.push({
          transactionDate: dateElement.textContent || '',
          amount: Math.abs(amount),
          currency: 'PLN',
          type: amount >= 0 ? 'credit' : 'debit',
          counterpartyName: nameElement?.textContent || undefined,
          counterpartyAccount: accountElement?.textContent || undefined,
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

  // Pobierz wszystkie nieopłacone faktury KSeF
  const { data: invoices, error } = await supabase
    .from('ksef_invoices')
    .select('*')
    .in('payment_status', ['unpaid', 'overdue'])
    .order('issue_date', { ascending: false })
    .limit(100);

  if (error || !invoices) {
    console.error('Error fetching invoices:', error);
    return candidates;
  }

  for (const invoice of invoices) {
    const matchReasons: string[] = [];
    let confidence = 0;

    const invoiceAmount = parseFloat(invoice.gross_amount || '0');
    const transactionAmount = transaction.amount;

    // 1. Dokładne dopasowanie kwoty (90% confidence)
    if (Math.abs(invoiceAmount - transactionAmount) < 0.01) {
      matchReasons.push('Dokładna kwota');
      confidence += 0.9;
    }
    // 2. Bardzo bliska kwota (różnica < 1 PLN) - 60%
    else if (Math.abs(invoiceAmount - transactionAmount) < 1) {
      matchReasons.push('Podobna kwota');
      confidence += 0.6;
    }
    // 3. Bliska kwota (różnica < 5%) - 40%
    else if (Math.abs(invoiceAmount - transactionAmount) / invoiceAmount < 0.05) {
      matchReasons.push('Zbliżona kwota');
      confidence += 0.4;
    }

    // 4. Numer faktury w tytule płatności (+30%)
    if (transaction.title && invoice.invoice_number) {
      const invoiceNumberClean = invoice.invoice_number.replace(/[\/\-\s]/g, '');
      const titleClean = transaction.title.replace(/[\/\-\s]/g, '').toUpperCase();

      if (titleClean.includes(invoiceNumberClean)) {
        matchReasons.push('Numer faktury w tytule');
        confidence += 0.3;
      }
    }

    // 5. Numer referencyjny KSeF w tytule (+40%)
    if (transaction.title && invoice.ksef_reference_number) {
      const refClean = invoice.ksef_reference_number.replace(/[\/\-\s]/g, '');
      const titleClean = transaction.title.replace(/[\/\-\s]/g, '').toUpperCase();

      if (titleClean.includes(refClean)) {
        matchReasons.push('Numer referencyjny KSeF');
        confidence += 0.4;
      }
    }

    // 6. Nazwa kontrahenta (+20%)
    if (transaction.counterpartyName && invoice.buyer_name) {
      const buyerClean = invoice.buyer_name.toLowerCase().replace(/\s+/g, '');
      const counterpartyClean = transaction.counterpartyName.toLowerCase().replace(/\s+/g, '');

      if (buyerClean.includes(counterpartyClean) || counterpartyClean.includes(buyerClean)) {
        matchReasons.push('Nazwa kontrahenta');
        confidence += 0.2;
      }
    }

    // 7. Data płatności bliska terminie (+10%)
    if (invoice.payment_due_date) {
      const dueDate = new Date(invoice.payment_due_date);
      const transDate = new Date(transaction.transactionDate);
      const daysDiff = Math.abs((transDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff <= 7) {
        matchReasons.push('Data bliska terminowi');
        confidence += 0.1;
      }
    }

    // Dodaj tylko jeśli confidence > 30%
    if (confidence >= 0.3) {
      candidates.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number || invoice.ksef_reference_number,
        amount: invoiceAmount,
        dueDate: invoice.payment_due_date || invoice.issue_date || '',
        buyerName: invoice.buyer_name || '',
        confidence: Math.min(confidence, 1.0),
        matchReason: matchReasons,
      });
    }
  }

  // Sortuj po confidence (najlepsze dopasowania pierwsze)
  return candidates.sort((a, b) => b.confidence - a.confidence);
}
