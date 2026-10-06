import { supabase } from '@/lib/supabase/browser';

const normalizeLogoKey = (value: string | null | undefined) =>
  (value || '').trim().toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/i, '').replace(/[\s_]+/g, '-');

/** The same primary-black variant used by the event equipment printout. */
export async function resolveCalculationPrintCompany<T extends { id: string; logo_url?: string | null }>(company: T | null): Promise<T | null> {
  if (!company) return null;
  const { data: logos, error } = await supabase.from('company_brandbook_logos')
    .select('url,label,variant,is_default,order_index').eq('company_id', company.id)
    .order('is_default', { ascending: false }).order('order_index', { ascending: true });
  if (error) throw new Error('Nie udało się odczytać logo z brandbooka firmy. Spróbuj ponownie.');
  const logo = logos?.find((entry) => normalizeLogoKey(entry.label) === 'primary-black')
    || logos?.find((entry) => normalizeLogoKey(entry.variant) === 'primary-black');
  if (!logo?.url) throw new Error('W brandbooku firmy dodaj logo primary-black z czarnym napisem do wydruków.');
  let image = logo.url as string;
  if (!image.startsWith('data:')) {
    if (!/^https?:\/\//i.test(image)) {
      image = supabase.storage.from('company-logos').getPublicUrl(image.replace(/^\/+/, '')).data.publicUrl;
    }
    const response = await fetch(image, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Nie udało się pobrać logo primary-black. Sprawdź plik w brandbooku.');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || !blob.size) throw new Error('Plik logo primary-black nie jest poprawnym obrazem.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    image = `data:${blob.type};base64,${btoa(chunks.join(''))}`;
  }
  return { ...company, logo_url: image };
}
