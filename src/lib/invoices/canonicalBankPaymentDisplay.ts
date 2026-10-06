import { supabase } from '@/lib/supabase/browser';

type LocalInvoiceIdentity = {
  id: string;
  my_company_id: string | null;
  currency_code?: string | null;
  ksef_reference_number?: string | null;
};

export type CanonicalBankPaymentDisplay = {
  amount: number;
  currency: string;
  latestPaymentDate: string;
  matchCount: number;
};

// Read model only: never merge these fields into an invoice update or PDF payload.
// Manual payment flags and direct CRM matches are intentionally not added here.
export async function loadCanonicalBankPaymentDisplay(
  invoices: readonly LocalInvoiceIdentity[],
): Promise<Record<string, CanonicalBankPaymentDisplay>> {
  const result: Record<string, CanonicalBankPaymentDisplay> = {};
  const locals = new Map(invoices.filter((invoice) => invoice.my_company_id).map((invoice) => [invoice.id, invoice]));
  const ids = Array.from(locals.keys());
  const pageSize = 500;

  for (let offset = 0; offset < ids.length; offset += 80) {
    const linked: any[] = [];
    for (let page = 0; ; page += pageSize) {
      const { data, error } = await supabase
        .from('ksef_invoices')
        .select('id, invoice_id, my_company_id, currency, ksef_reference_number, sync_status')
        .in('invoice_id', ids.slice(offset, offset + 80))
        .not('ksef_reference_number', 'is', null)
        .order('id')
        .range(page, page + pageSize - 1);
      if (error) throw error;
      linked.push(...(data || []));
      if ((data || []).length < pageSize) break;
    }

    const eligible = linked.filter((row) => {
      const local = locals.get(row.invoice_id);
      return local && row.my_company_id === local.my_company_id
        && row.ksef_reference_number?.trim() && row.sync_status !== 'error'
        && String(row.currency || 'PLN').toUpperCase() === String(local.currency_code || 'PLN').toUpperCase()
        && (!local.ksef_reference_number || local.ksef_reference_number === row.ksef_reference_number);
    });
    // Multiple official documents linked to one local invoice need separate review.
    const linkCounts = new Map<string, number>();
    for (const row of eligible) linkCounts.set(row.invoice_id, (linkCounts.get(row.invoice_id) || 0) + 1);
    const documents = new Map(eligible.filter((row) => linkCounts.get(row.invoice_id) === 1).map((row) => [row.id, row]));
    const documentIds = Array.from(documents.keys());
    const seenMatches = new Set<string>();

    for (let batch = 0; batch < documentIds.length; batch += 80) {
      for (let page = 0; ; page += pageSize) {
        const { data, error } = await supabase
          .from('bank_transaction_invoice_matches')
          .select('id, ksef_invoice_id, amount, currency, document_amount, document_currency, bank_transactions!inner(transaction_date, bank_statements!inner(my_company_id))')
          .in('ksef_invoice_id', documentIds.slice(batch, batch + 80))
          .order('id')
          .range(page, page + pageSize - 1);
        if (error) throw error;
        for (const match of (data || []) as any[]) {
          const document = documents.get(match.ksef_invoice_id);
          const transaction = Array.isArray(match.bank_transactions) ? match.bank_transactions[0] : match.bank_transactions;
          const statement = Array.isArray(transaction?.bank_statements) ? transaction.bank_statements[0] : transaction?.bank_statements;
          const currency = String(match.document_currency || match.currency || '').toUpperCase();
          const amount = Number(match.document_amount ?? match.amount);
          const date = transaction?.transaction_date;
          if (!document || seenMatches.has(match.id) || statement?.my_company_id !== document.my_company_id
            || currency !== String(document.currency || 'PLN').toUpperCase()
            || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;
          seenMatches.add(match.id);
          const previous = result[document.invoice_id];
          result[document.invoice_id] = {
            amount: Math.round(((previous?.amount || 0) + amount) * 100) / 100,
            currency,
            latestPaymentDate: previous && previous.latestPaymentDate > date ? previous.latestPaymentDate : date,
            matchCount: (previous?.matchCount || 0) + 1,
          };
        }
        if ((data || []).length < pageSize) break;
      }
    }
  }
  return result;
}

export function formatCanonicalBankPayment(payment: CanonicalBankPaymentDisplay): string {
  const amount = payment.amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = payment.latestPaymentDate.split('-').reverse().join('.');
  return `Z wyciągu (KSeF): ${amount} ${payment.currency} · ${payment.matchCount > 1 ? 'ostatnia płatność ' : ''}${date}`;
}
