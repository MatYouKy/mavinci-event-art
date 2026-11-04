import type { SupabaseClient } from '@supabase/supabase-js';
import { pickPrintLogo, PRINT_LOGO_MISSING_MESSAGE, type BrandbookLogoRow } from '@/lib/brandbook/printLogo';

/** Chwilowy błąd odczytu brandbooka (np. baza nie odpowiada) — w odróżnieniu od braku logo do druku. */
export class PrintLogoLookupError extends Error {}

/**
 * Źródło logo do druku faktury: logo zaznaczone w brandbooku jako „Logo do druku”
 * (a do czasu zaznaczenia — primary-black). Zwraca ścieżkę w magazynie `company-logos` albo data URI.
 */
export async function resolveInvoicePrintLogoSource(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
): Promise<string> {
  if (!companyId) {
    throw new Error('Przypisz firmę wystawiającą do faktury, aby pobrać jej logo do druku z brandbooka.');
  }

  // `*` — działa przed i po migracji z kolumną use_for_print.
  const { data: logos, error } = await supabase
    .from('company_brandbook_logos')
    .select('*')
    .eq('company_id', companyId)
    .order('is_default', { ascending: false })
    .order('order_index', { ascending: true });

  if (error) {
    throw new PrintLogoLookupError('Nie udało się odczytać logo z brandbooka firmy. Spróbuj ponownie.');
  }

  const logo = pickPrintLogo(logos as BrandbookLogoRow[] | null);
  const source = String(logo?.url ?? '').trim();
  if (!source) throw new Error(PRINT_LOGO_MISSING_MESSAGE);
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) return source;

  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    const allowedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
    const storagePrefix = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/company-logos\//;
    if (url.origin !== allowedOrigin || !storagePrefix.test(url.pathname)) {
      throw new Error('Wgraj logo do druku do brandbooka firmy — plik musi znajdować się w magazynie logo CRM.');
    }
    return decodeURIComponent(url.pathname.replace(storagePrefix, ''));
  }
  return source.replace(/^\/+/, '');
}

/** Pobiera logo ze stałego magazynu `company-logos` (nigdy z dowolnego adresu z danych faktury) jako data URI. */
export async function downloadInvoicePrintLogo(supabase: SupabaseClient, source: string): Promise<string> {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) return source;
  const { data: image, error: downloadError } = await supabase.storage
    .from('company-logos')
    .download(source);
  if (downloadError || !image) {
    throw new Error('Nie udało się pobrać logo do druku. Sprawdź plik w brandbooku firmy.');
  }
  if (!image.type.startsWith('image/') || !image.size) {
    throw new Error('Plik logo do druku nie jest poprawnym obrazem.');
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  return `data:${image.type};base64,${bytes.toString('base64')}`;
}

/** Embed the issuing company's print logo before PDF networking is disabled. */
export async function resolveInvoicePrintLogo(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
): Promise<string> {
  return downloadInvoicePrintLogo(supabase, await resolveInvoicePrintLogoSource(supabase, companyId));
}
