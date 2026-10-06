import type { SupabaseClient } from '@supabase/supabase-js';

type InvoiceIssuerSource = {
  signature_name?: string | null;
  created_by?: string | null;
};

/** Keep the issuer recorded on the invoice, even when someone else opens its PDF. */
export async function resolveInvoiceIssuerName(
  supabase: SupabaseClient,
  invoice: InvoiceIssuerSource,
): Promise<string | null> {
  const recordedName = invoice.signature_name?.trim();
  if (recordedName) return recordedName;

  const createdBy = invoice.created_by?.trim();
  if (!createdBy) return null;

  const { data: issuer, error } = await supabase
    .from('employees')
    .select('name,surname')
    .or(`id.eq.${createdBy},auth_user_id.eq.${createdBy}`)
    .maybeSingle();

  if (error) {
    throw new Error('Nie udało się odczytać danych osoby wystawiającej fakturę. Spróbuj ponownie.');
  }

  const name = issuer?.name?.trim();
  const surname = issuer?.surname?.trim();
  return name && surname ? `${name} ${surname}` : null;
}
