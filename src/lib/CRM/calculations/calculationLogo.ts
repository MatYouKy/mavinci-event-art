import { supabase } from '@/lib/supabase/browser';
import { pickPrintLogo, PRINT_LOGO_MISSING_MESSAGE, type BrandbookLogoRow } from '@/lib/brandbook/printLogo';

/** Logo do druku z brandbooka (to samo co na fakturach; do czasu zaznaczenia — primary-black). */
export async function resolveCalculationPrintCompany<T extends { id: string; logo_url?: string | null }>(company: T | null): Promise<T | null> {
  if (!company) return null;
  const { data: logos, error } = await supabase.from('company_brandbook_logos')
    .select('*').eq('company_id', company.id)
    .order('is_default', { ascending: false }).order('order_index', { ascending: true });
  if (error) throw new Error('Nie udało się odczytać logo z brandbooka firmy. Spróbuj ponownie.');
  const logo = pickPrintLogo(logos as BrandbookLogoRow[] | null);
  if (!logo?.url) throw new Error(PRINT_LOGO_MISSING_MESSAGE);
  let image = logo.url as string;
  if (!image.startsWith('data:')) {
    if (!/^https?:\/\//i.test(image)) {
      image = supabase.storage.from('company-logos').getPublicUrl(image.replace(/^\/+/, '')).data.publicUrl;
    }
    const response = await fetch(image, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Nie udało się pobrać logo do druku. Sprawdź plik w brandbooku.');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || !blob.size) throw new Error('Plik logo do druku nie jest poprawnym obrazem.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    image = `data:${blob.type};base64,${btoa(chunks.join(''))}`;
  }
  return { ...company, logo_url: image };
}
