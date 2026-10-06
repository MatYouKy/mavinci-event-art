/**
 * Tworzenie faktury końcowej na całość zamówienia, rozliczającej opłacone zaliczki.
 */

import { supabase } from '@/lib/supabase/browser';
import { calculateFinalInvoice } from './finalInvoiceCalculation';
import { DEFAULT_INVOICE_PAYMENT_TERM_DAYS, getInvoicePaymentDueDate } from './paymentTerm';
import { getCurrentInvoiceIssuer } from './currentInvoiceIssuer';

export interface FinalInvoiceItemInput {
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  vat_code?: '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
  vat_exemption_reason?: string | null;
}

export interface SettledInvoiceRef {
  id: string;
  invoice_number: string;
  issue_date?: string | null;
  total_net: number;
  total_vat: number;
  total_gross: number;
  invoice_type: string;
}

export interface CreateFinalInvoiceOptions {
  eventId?: string | null;
  organizationId?: string | null;
  billingArrangement?: 'direct' | 'hotel' | 'agency' | 'other';
  serviceRecipientOrganizationId?: string | null;
  serviceRecipientContactId?: string | null;
  myCompanyId?: string | null;
  customNumber?: string;
  issueDate?: string;
  saleDate?: string;
  paymentDueDate?: string;
  items: FinalInvoiceItemInput[];
  bankName?: string | null;
  settledInvoices: SettledInvoiceRef[];
  buyerData: {
    buyer_name: string;
    buyer_nip?: string | null;
    buyer_street?: string | null;
    buyer_postal_code?: string | null;
    buyer_city?: string | null;
    buyer_country?: string | null;
    buyer_email?: string | null;
    buyer_phone?: string | null;
    buyer_contact_person?: string | null;
  };
  sellerData?: Record<string, any> | null;
  paymentMethod?: string | null;
  bankAccount?: string | null;
  bankSwiftCode?: string | null;
  issuePlace?: string | null;
  notes?: string | null;
  currencyCode?: string;
}

interface CreateResult {
  success: boolean;
  invoiceId?: string;
  error?: string;
}

export async function createFinalInvoice(opts: CreateFinalInvoiceOptions): Promise<CreateResult> {
  try {
    if (!opts.items.length) {
      return { success: false, error: 'Faktura koncowa musi miec co najmniej jedna pozycje' };
    }

    if (!opts.settledInvoices.length) {
      return { success: false, error: 'Faktura koncowa musi rozliczac co najmniej jedna fakture' };
    }

    if (new Set(opts.settledInvoices.map((invoice) => invoice.id)).size !== opts.settledInvoices.length) {
      return { success: false, error: 'Ta sama zaliczka została wybrana więcej niż raz' };
    }

    if (opts.settledInvoices.some((invoice) => invoice.invoice_type !== 'advance')) {
      return { success: false, error: 'Faktura końcowa może rozliczać tylko faktury zaliczkowe' };
    }

    if (opts.items.some((item) =>
      !item.name.trim() ||
      !Number.isFinite(item.quantity) || item.quantity <= 0 ||
      !Number.isFinite(item.price_net) || item.price_net < 0 ||
      !Number.isFinite(item.vat_rate) || item.vat_rate < 0
    )) {
      return { success: false, error: 'Pozycje faktury zawierają nieprawidłowe wartości' };
    }

    if (opts.items.some((item) => item.vat_code === 'zw' && !item.vat_exemption_reason?.trim())) {
      return { success: false, error: 'Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT' };
    }

    if (opts.items.some((item) => item.vat_code === '0' || item.vat_code === 'np')) {
      return { success: false, error: 'Uzupełnij klasyfikację pozycji 0% lub niepodlegających VAT przed utworzeniem faktury końcowej' };
    }

    const useAutoNumber = !opts.customNumber?.trim();
    let invoiceNumber = '';

    if (opts.customNumber && opts.customNumber.trim()) {
      const trimmed = opts.customNumber.trim();

      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('invoice_number', trimmed)
        .eq('my_company_id', opts.myCompanyId ?? null)
        .maybeSingle();

      if (existing) {
        return { success: false, error: 'Faktura o tym numerze juz istnieje' };
      }

      invoiceNumber = trimmed;
    }

    const today = new Date().toISOString().split('T')[0];
    const defaultDue = getInvoicePaymentDueDate(opts.issueDate || today, DEFAULT_INVOICE_PAYMENT_TERM_DAYS);

    const calculation = calculateFinalInvoice(opts.items, opts.settledInvoices);
    const computedItems = calculation.items;
    const { net: totalNet, vat: totalVat, gross: totalGross } = calculation.totals;
    const { net: settledNet, vat: settledVat, gross: settledGross } = calculation.settled;
    const { net: remainingNet, vat: remainingVat, gross: remainingGross } = calculation.remaining;

    if (remainingGross < -0.01) {
      return {
        success: false,
        error: 'Suma zaliczek przekracza wartość faktury końcowej. Wprowadź pozycje całego zamówienia.',
      };
    }

    const settledInvoicesJson = opts.settledInvoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      invoiceType: i.invoice_type,
      issueDate: i.issue_date ?? null,
      totalNet: Number(i.total_net ?? 0),
      totalVat: Number(i.total_vat ?? 0),
      totalGross: Number(i.total_gross ?? 0),
    }));

    const settlementSummaryJson = {
      invoiceTotalNet: totalNet,
      invoiceTotalVat: totalVat,
      invoiceTotalGross: totalGross,
      settledNet,
      settledVat,
      settledGross,
      remainingNet,
      remainingVat,
      remainingGross,
    };

    const currency = opts.currencyCode || 'PLN';
    const settlementLines = opts.settledInvoices
      .map(
        (i) =>
          `- ${i.invoice_number} (zaliczkowa): ${Number(i.total_gross).toFixed(2)} ${currency} brutto`,
      )
      .join('\n');

    const settlementText = opts.settledInvoices.length
      ? `Rozliczone wpłaty / zaliczki:\n${settlementLines}\nSuma rozliczonych: ${settledGross.toFixed(
          2,
        )} ${currency} brutto.\nDo dopłaty: ${remainingGross.toFixed(2)} ${currency} brutto.`
      : '';

    const finalNotes = [opts.notes, settlementText].filter(Boolean).join('\n\n');

    const internalMarker = JSON.stringify({
      kind: 'final_invoice',
      settled: settledInvoicesJson,
      settlementSummary: settlementSummaryJson,
    });

    const issuer = await getCurrentInvoiceIssuer();

    const insertPayload: Record<string, any> = {
      invoice_number: invoiceNumber,
      auto_number: useAutoNumber,

      // WAŻNE: to musi być final, nie vat
      invoice_type: 'final',

      status: 'draft',
      is_proforma: false,
      issue_date: opts.issueDate || today,
      sale_date: opts.saleDate || today,
      payment_due_date: opts.paymentDueDate || defaultDue,
      event_id: opts.eventId || null,
      organization_id: opts.organizationId || null,
      billing_arrangement: opts.billingArrangement || 'direct',
      service_recipient_organization_id: opts.serviceRecipientOrganizationId || null,
      service_recipient_contact_id: opts.serviceRecipientContactId || null,
      my_company_id: opts.myCompanyId || null,
      created_by: issuer.employeeId,

      total_net: totalNet,
      total_vat: totalVat,
      total_gross: totalGross,
      currency_code: opts.currencyCode || 'PLN',

      payment_method: opts.paymentMethod ?? null,
      bank_account: opts.bankAccount ?? null,
      bank_name: opts.bankName ?? null,
      bank_swift_code: opts.bankSwiftCode ?? null,
      issue_place: opts.issuePlace ?? null,
      notes: finalNotes || null,
      internal_notes: internalMarker,

      // WAŻNE: snapshot rozliczenia dla PDF/KSeF
      settled_invoices: settledInvoicesJson,
      settlement_summary: settlementSummaryJson,

      // pierwsza zaliczka jako główne powiązanie
      related_invoice_id: opts.settledInvoices[0]?.id ?? null,

      ...opts.buyerData,
    };

    if (opts.sellerData) {
      Object.assign(insertPayload, opts.sellerData);
    }
    // Seller/source snapshots must not replace the authenticated issuer.
    insertPayload.created_by = issuer.employeeId;
    insertPayload.signature_name = issuer.signatureName;

    const { data: createdId, error: createError } = await supabase.rpc(
      'create_paid_final_invoice_atomic',
      {
        p_invoice: insertPayload,
        p_items: computedItems,
        p_advance_ids: opts.settledInvoices.map((invoice) => invoice.id),
      },
    );

    if (createError || !createdId) {
      console.error('Error creating final invoice atomically:', createError);
      return {
        success: false,
        error: createError?.code === 'PGRST202'
          ? 'Wystawianie faktur końcowych wymaga aktualizacji systemu. Skontaktuj się z administratorem.'
          : createError?.message || 'Nie udało się utworzyć faktury końcowej',
      };
    }

    return { success: true, invoiceId: createdId as string };
  } catch (err: any) {
    console.error('createFinalInvoice error:', err);
    return { success: false, error: err.message || 'Nieznany blad' };
  }
}
