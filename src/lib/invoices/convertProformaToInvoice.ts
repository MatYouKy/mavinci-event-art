/**
 * Konwersja faktury proforma na fakturę VAT
 */

import { supabase } from '@/lib/supabase/browser';

interface ConvertResult {
  success: boolean;
  invoiceId?: string;
  error?: string;
}

export interface ConvertProformaOptions {
  targetType?: 'vat' | 'advance';
  customNumber?: string;
  issueDate?: string;
  saleDate?: string;
  paymentDueDate?: string;
  advancePercent?: number;
  buyerData?: {
    buyer_name?: string;
    buyer_nip?: string | null;
    buyer_email?: string | null;
    buyer_street?: string;
    buyer_postal_code?: string;
    buyer_city?: string;
  };
}

const round2 = (value: number) => Number(value.toFixed(2));

type PreparedInvoiceLine = {
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  vat_code: string;
  vat_exemption_reason: string | null;
  value_net: number;
  vat_amount: number;
  value_gross: number;
};

/**
 * Konwertuje proformę na fakturę VAT lub zaliczkową
 */
export async function convertProformaToInvoice(
  proformaId: string,
  options: ConvertProformaOptions = {},
): Promise<ConvertResult> {

  const targetType = options.targetType ?? 'vat';

  try {
    // 1. Pobierz proformę z pozycjami
    const { data: proforma, error: proformaError } = await supabase
      .from('invoices')
      .select('*, invoice_items(*)')
      .eq('id', proformaId)
      .single();

    if (proformaError || !proforma) {
      return { success: false, error: 'Nie znaleziono proformy' };
    }

    // 2. Walidacja - czy to proforma
    if (!proforma.is_proforma) {
      return { success: false, error: 'To nie jest faktura proforma' };
    }

    // 3. Sprawdź czy nie została już przekonwertowana
    if (targetType === 'vat' && proforma.proforma_converted_to_invoice_id) {
      return {
        success: false,
        error: 'Faktura VAT została już wystawiona dla tej proformy',
      };
    }

    // 4. Numer faktury - wlasny lub generowany
    const useAutoNumber = !options.customNumber?.trim();
    let invoiceNumber = '';
    if (options.customNumber && options.customNumber.trim()) {
      const trimmed = options.customNumber.trim();
      const { data: existing } = await supabase
        .from('invoices')
        .select('id')
        .eq('invoice_number', trimmed)
        .eq('my_company_id', proforma.my_company_id)
        .maybeSingle();
      if (existing) {
        return { success: false, error: 'Faktura o tym numerze juz istnieje' };
      }
      invoiceNumber = trimmed;
    }

    // 5. Pobierz aktualnego użytkownika
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: employee } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user?.email)
      .maybeSingle();

    // 6. Przygotuj pełny snapshot dokumentu i — dla zaliczki — osobny snapshot zamówienia.
    const today = new Date().toISOString().split('T')[0];
    const defaultDue = new Date();
    defaultDue.setDate(defaultDue.getDate() + 14);

    if (!Array.isArray(proforma.invoice_items) || proforma.invoice_items.length === 0) {
      return { success: false, error: 'Proforma nie zawiera pozycji' };
    }

    const advancePercent = options.advancePercent ?? 30;
    if (targetType === 'advance' && (advancePercent <= 0 || advancePercent > 100)) {
      return { success: false, error: 'Zaliczka musi być większa od 0% i nie może przekraczać 100%' };
    }

    const orderItems: PreparedInvoiceLine[] = proforma.invoice_items.map(
      (item: any, index: number) => {
      const quantity = Number(item.quantity ?? 0);
      const priceNet = Number(item.price_net ?? 0);
      const vatRate = Number(item.vat_rate ?? 0);
      const valueNet = round2(quantity * priceNet);
      const vatAmount = round2((valueNet * vatRate) / 100);
      return {
        position_number: Number(item.position_number ?? index + 1),
        name: item.name,
        unit: item.unit || 'szt.',
        quantity,
        price_net: priceNet,
        vat_rate: vatRate,
        vat_code: item.vat_code || String(vatRate),
        vat_exemption_reason: item.vat_exemption_reason || null,
        value_net: valueNet,
        vat_amount: vatAmount,
        value_gross: round2(valueNet + vatAmount),
      };
      },
    );

    const ratio = targetType === 'advance' ? advancePercent / 100 : 1;
    const documentItems = orderItems.map((item) => {
      const priceNet = round2(item.price_net * ratio);
      const valueNet = round2(item.quantity * priceNet);
      const vatAmount = round2((valueNet * item.vat_rate) / 100);
      return {
        ...item,
        price_net: priceNet,
        value_net: valueNet,
        vat_amount: vatAmount,
        value_gross: round2(valueNet + vatAmount),
      };
    });

    const orderTotals = orderItems.reduce(
      (sum: { net: number; vat: number; gross: number }, item: PreparedInvoiceLine) => ({
        net: round2(sum.net + item.value_net),
        vat: round2(sum.vat + item.vat_amount),
        gross: round2(sum.gross + item.value_gross),
      }),
      { net: 0, vat: 0, gross: 0 },
    );

    const invoiceData = {
      invoice_number: invoiceNumber,
      auto_number: useAutoNumber,
      is_proforma: false,
      status: 'draft',
      payment_status: 'unpaid',
      paid_amount: 0,
      related_invoice_id: proformaId,
      issue_date: options.issueDate || today,
      sale_date: options.saleDate || today,
      payment_due_date: options.paymentDueDate || defaultDue.toISOString().split('T')[0],
      created_by: employee?.id,
      invoice_type: targetType,
      my_company_id: proforma.my_company_id,
      event_id: proforma.event_id,
      organization_id: proforma.organization_id,
      contact_person_id: proforma.contact_person_id,
      buyer_is_private_person: proforma.buyer_is_private_person ?? false,
      buyer_contact_id: proforma.buyer_contact_id || null,
      billing_arrangement: proforma.billing_arrangement || 'direct',
      service_recipient_organization_id: proforma.service_recipient_organization_id || null,
      service_recipient_contact_id: proforma.service_recipient_contact_id || null,
      seller_name: proforma.seller_name,
      seller_nip: proforma.seller_nip,
      seller_street: proforma.seller_street,
      seller_postal_code: proforma.seller_postal_code,
      seller_city: proforma.seller_city,
      seller_country: proforma.seller_country,
      seller_email: proforma.seller_email,
      seller_phone: proforma.seller_phone,
      buyer_name: options.buyerData?.buyer_name ?? proforma.buyer_name,
      buyer_nip: options.buyerData?.buyer_nip ?? proforma.buyer_nip,
      buyer_street: options.buyerData?.buyer_street ?? proforma.buyer_street,
      buyer_postal_code:
        options.buyerData?.buyer_postal_code ?? proforma.buyer_postal_code,
      buyer_city: options.buyerData?.buyer_city ?? proforma.buyer_city,
      buyer_country: proforma.buyer_country,
      buyer_email: options.buyerData?.buyer_email ?? proforma.buyer_email,
      buyer_phone: proforma.buyer_phone,
      buyer_contact_person: proforma.buyer_contact_person,
      payment_method: proforma.payment_method,
      bank_account: proforma.bank_account,
      bank_name: proforma.bank_name,
      bank_swift_code: proforma.bank_swift_code,
      issue_place: proforma.issue_place,
      company_logo_url: proforma.company_logo_url || null,
      footer_note: proforma.footer_note,
      signature_name: proforma.signature_name,
      website: proforma.website,
      currency_code: proforma.currency_code || 'PLN',
      order_total_net: targetType === 'advance' ? orderTotals.net : null,
      order_total_vat: targetType === 'advance' ? orderTotals.vat : null,
      order_total_gross: targetType === 'advance' ? orderTotals.gross : null,
      notes: proforma.notes,
      internal_notes: proforma.internal_notes
        ? `${proforma.internal_notes}\n\nWystawiona na podstawie proformy ${proforma.invoice_number}`
        : `Wystawiona na podstawie proformy ${proforma.invoice_number}`,
    };

    const { data: invoiceId, error: conversionError } = await supabase.rpc(
      'convert_proforma_atomic',
      {
        p_proforma_id: proformaId,
        p_invoice: invoiceData,
        p_items: documentItems,
        p_order_items: targetType === 'advance' ? orderItems : [],
      },
    );

    if (conversionError || !invoiceId) {
      console.error('Error converting proforma atomically:', conversionError);
      return {
        success: false,
        error: conversionError?.message || 'Błąd podczas tworzenia dokumentu z proformy',
      };
    }

    return {
      success: true,
      invoiceId: invoiceId as string,
    };
  } catch (error: any) {
    console.error('Error converting proforma to invoice:', error);
    return {
      success: false,
      error: error.message || 'Nieznany błąd podczas konwersji',
    };
  }
}
