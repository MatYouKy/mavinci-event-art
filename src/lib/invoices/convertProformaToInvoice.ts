/**
 * Konwersja faktury proforma na fakturę VAT
 */

import { supabase } from '@/lib/supabase/browser';

interface ConvertResult {
  success: boolean;
  invoiceId?: string;
  error?: string;
}

/**
 * Konwertuje proformę na fakturę VAT
 */
export async function convertProformaToInvoice(proformaId: string): Promise<ConvertResult> {

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
    if (proforma.proforma_converted_to_invoice_id) {
      return {
        success: false,
        error: 'Faktura VAT została już wystawiona dla tej proformy',
      };
    }

    // 4. Generuj nowy numer faktury VAT
    const { data: invoiceNumber, error: numberError } = await supabase.rpc(
      'generate_invoice_number',
      {
        p_invoice_type: 'vat',
      }
    );

    if (numberError || !invoiceNumber) {
      return { success: false, error: 'Błąd generowania numeru faktury' };
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

    // 6. Przygotuj dane faktury VAT
    const today = new Date().toISOString().split('T')[0];
    const paymentDueDate = new Date();
    paymentDueDate.setDate(paymentDueDate.getDate() + 14);

    const invoiceData = {
      // Nowe dane
      invoice_number: invoiceNumber,
      is_proforma: false,
      status: 'draft', // Faktura w szkicu, gotowa do wysłania do KSeF
      related_invoice_id: proformaId,
      issue_date: today,
      sale_date: today,
      payment_due_date: paymentDueDate.toISOString().split('T')[0],
      created_by: employee?.id,

      // Dane skopiowane z proformy
      invoice_type: 'vat',
      my_company_id: proforma.my_company_id,
      event_id: proforma.event_id,
      organization_id: proforma.organization_id,
      contact_person_id: proforma.contact_person_id,

      // Dane sprzedawcy
      seller_name: proforma.seller_name,
      seller_nip: proforma.seller_nip,
      seller_street: proforma.seller_street,
      seller_postal_code: proforma.seller_postal_code,
      seller_city: proforma.seller_city,
      seller_country: proforma.seller_country,

      // Dane nabywcy
      buyer_name: proforma.buyer_name,
      buyer_nip: proforma.buyer_nip,
      buyer_street: proforma.buyer_street,
      buyer_postal_code: proforma.buyer_postal_code,
      buyer_city: proforma.buyer_city,
      buyer_country: proforma.buyer_country,
      buyer_email: proforma.buyer_email,
      buyer_phone: proforma.buyer_phone,
      buyer_contact_person: proforma.buyer_contact_person,

      // Dane płatności
      payment_method: proforma.payment_method,
      bank_account: proforma.bank_account,
      issue_place: proforma.issue_place,
      company_logo_url: proforma.company_logo_url || null,

      // Kwoty
      total_net: proforma.total_net,
      total_vat: proforma.total_vat,
      total_gross: proforma.total_gross,

      // Notatki
      notes: proforma.notes,
      internal_notes: proforma.internal_notes
        ? `${proforma.internal_notes}\n\nWystawiona na podstawie proformy ${proforma.invoice_number}`
        : `Wystawiona na podstawie proformy ${proforma.invoice_number}`,
    };

    // 7. Utwórz fakturę VAT
    const { data: vatInvoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert(invoiceData)
      .select()
      .single();

    if (invoiceError || !vatInvoice) {
      console.error('Error creating VAT invoice:', invoiceError);
      return { success: false, error: 'Błąd podczas tworzenia faktury VAT' };
    }

    // 8. Skopiuj pozycje faktury
    const itemsToInsert = proforma.invoice_items.map((item: any) => ({
      invoice_id: vatInvoice.id,
      position_number: item.position_number,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      price_net: item.price_net,
      vat_rate: item.vat_rate,
      value_net: item.value_net,
      vat_amount: item.vat_amount,
      value_gross: item.value_gross,
    }));

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(itemsToInsert);

    if (itemsError) {
      console.error('Error creating invoice items:', itemsError);
      // Usuń fakturę jeśli nie udało się dodać pozycji
      await supabase.from('invoices').delete().eq('id', vatInvoice.id);
      return { success: false, error: 'Błąd podczas kopiowania pozycji faktury' };
    }

    // 9. Zaktualizuj proformę - dodaj link do faktury VAT
    const { error: updateError } = await supabase
      .from('invoices')
      .update({ proforma_converted_to_invoice_id: vatInvoice.id })
      .eq('id', proformaId);

    if (updateError) {
      console.error('Error updating proforma:', updateError);
      // Nie przerywamy - faktura została utworzona
    }

    // 10. Dodaj do historii
    await supabase.from('invoice_history').insert({
      invoice_id: vatInvoice.id,
      action: 'created_from_proforma',
      changed_by: employee?.id,
      changes: {
        source_proforma_id: proformaId,
        source_proforma_number: proforma.invoice_number,
      },
    });

    return {
      success: true,
      invoiceId: vatInvoice.id,
    };
  } catch (error: any) {
    console.error('Error converting proforma to invoice:', error);
    return {
      success: false,
      error: error.message || 'Nieznany błąd podczas konwersji',
    };
  }
}
