/**
 * Tworzenie faktury końcowej rozliczającej zaliczki/proformy
 */

import { supabase } from '@/lib/supabase/browser';

export interface FinalInvoiceItemInput {
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
}

export interface SettledInvoiceRef {
  id: string;
  invoice_number: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  invoice_type: string;
}

export interface CreateFinalInvoiceOptions {
  eventId?: string | null;
  organizationId?: string | null;
  myCompanyId?: string | null;
  customNumber?: string;
  issueDate?: string;
  saleDate?: string;
  paymentDueDate?: string;
  items: FinalInvoiceItemInput[];
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
  issuePlace?: string | null;
  notes?: string | null;
}

interface CreateResult {
  success: boolean;
  invoiceId?: string;
  error?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createFinalInvoice(opts: CreateFinalInvoiceOptions): Promise<CreateResult> {
  try {
    if (!opts.items.length) {
      return { success: false, error: 'Faktura koncowa musi miec co najmniej jedna pozycje' };
    }

    let invoiceNumber: string;
    if (opts.customNumber && opts.customNumber.trim()) {
      const trimmed = opts.customNumber.trim();
      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('invoice_number', trimmed)
        .maybeSingle();
      if (existing) {
        return { success: false, error: 'Faktura o tym numerze juz istnieje' };
      }
      invoiceNumber = trimmed;
    } else {
      const { data: generated, error: genErr } = await supabase.rpc('generate_invoice_number', {
        p_invoice_type: 'final',
        p_my_company_id: opts.myCompanyId ?? null,
      });
      if (genErr || !generated) {
        console.error('generate_invoice_number error:', genErr);
        return {
          success: false,
          error: genErr?.message || 'Blad generowania numeru faktury',
        };
      }
      invoiceNumber = generated as string;
    }

    const today = new Date().toISOString().split('T')[0];
    const defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 14);

    const computedItems = opts.items.map((it, idx) => {
      const valueNet = round2(it.quantity * it.price_net);
      const vatAmount = round2((valueNet * it.vat_rate) / 100);
      const valueGross = round2(valueNet + vatAmount);
      return {
        position_number: idx + 1,
        name: it.name,
        unit: it.unit,
        quantity: it.quantity,
        price_net: it.price_net,
        vat_rate: it.vat_rate,
        value_net: valueNet,
        vat_amount: vatAmount,
        value_gross: valueGross,
      };
    });

    const totalNet = round2(computedItems.reduce((s, i) => s + i.value_net, 0));
    const totalVat = round2(computedItems.reduce((s, i) => s + i.vat_amount, 0));
    const totalGross = round2(computedItems.reduce((s, i) => s + i.value_gross, 0));

    const settledNet = round2(opts.settledInvoices.reduce((s, i) => s + Number(i.total_net), 0));
    const settledVat = round2(opts.settledInvoices.reduce((s, i) => s + Number(i.total_vat), 0));
    const settledGross = round2(opts.settledInvoices.reduce((s, i) => s + Number(i.total_gross), 0));
    const remainingGross = round2(totalGross - settledGross);

    const settlementLines = opts.settledInvoices
      .map(
        (i) =>
          `- ${i.invoice_number} (${i.invoice_type}): ${Number(i.total_gross).toFixed(2)} PLN brutto`,
      )
      .join('\n');

    const settlementText = opts.settledInvoices.length
      ? `Rozliczone wpłaty / zaliczki:\n${settlementLines}\nSuma rozliczonych: ${settledGross.toFixed(2)} PLN brutto.\nDo dopłaty: ${remainingGross.toFixed(2)} PLN brutto.`
      : '';

    const finalNotes = [opts.notes, settlementText].filter(Boolean).join('\n\n');

    const internalMarker = JSON.stringify({
      kind: 'final_invoice',
      settled: opts.settledInvoices.map((i) => ({
        id: i.id,
        invoice_number: i.invoice_number,
        total_gross: Number(i.total_gross),
      })),
      total_settled_gross: settledGross,
      remaining_gross: remainingGross,
    });

    const { data: { user } } = await supabase.auth.getUser();
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user?.email)
      .maybeSingle();

    const insertPayload: Record<string, any> = {
      invoice_number: invoiceNumber,
      invoice_type: 'vat',
      status: 'draft',
      is_proforma: false,
      issue_date: opts.issueDate || today,
      sale_date: opts.saleDate || today,
      payment_due_date: opts.paymentDueDate || defaultDue.toISOString().split('T')[0],
      event_id: opts.eventId || null,
      organization_id: opts.organizationId || null,
      my_company_id: opts.myCompanyId || null,
      created_by: employee?.id ?? null,
      total_net: totalNet,
      total_vat: totalVat,
      total_gross: totalGross,
      payment_method: opts.paymentMethod ?? null,
      bank_account: opts.bankAccount ?? null,
      issue_place: opts.issuePlace ?? null,
      notes: finalNotes || null,
      internal_notes: internalMarker,
      ...opts.buyerData,
    };

    if (opts.sellerData) {
      Object.assign(insertPayload, opts.sellerData);
    }

    if (opts.settledInvoices[0]?.id) {
      insertPayload.related_invoice_id = opts.settledInvoices[0].id;
    }

    const { data: created, error: insertErr } = await supabase
      .from('invoices')
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr || !created) {
      console.error('Error creating final invoice:', insertErr);
      return { success: false, error: insertErr?.message || 'Blad tworzenia faktury' };
    }

    const itemsToInsert = computedItems.map((it) => ({ ...it, invoice_id: created.id }));
    const { error: itemsErr } = await supabase.from('invoice_items').insert(itemsToInsert);
    if (itemsErr) {
      await supabase.from('invoices').delete().eq('id', created.id);
      return { success: false, error: 'Blad zapisu pozycji faktury' };
    }

    await supabase.from('invoice_history').insert({
      invoice_id: created.id,
      action: 'final_invoice_created',
      changed_by: employee?.id ?? null,
      changes: {
        settled_invoice_ids: opts.settledInvoices.map((i) => i.id),
        settled_gross: settledGross,
        settled_vat: settledVat,
        settled_net: settledNet,
        remaining_gross: remainingGross,
      },
    });

    return { success: true, invoiceId: created.id };
  } catch (err: any) {
    console.error('createFinalInvoice error:', err);
    return { success: false, error: err.message || 'Nieznany blad' };
  }
}
