import type { SupabaseClient } from '@supabase/supabase-js';

const normalizeLogoKey = (value: string | null | undefined) =>
  (value || '').trim().toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/i, '').replace(/[\s_]+/g, '-');

/** Embed the issuing company's black brandbook logo before PDF networking is disabled. */
export async function resolveInvoicePrintLogo(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
): Promise<string> {
  if (!companyId) {
    throw new Error('Przypisz firmę wystawiającą do faktury, aby pobrać jej czarny logotyp z brandbooka.');
  }

  const { data: logos, error } = await supabase
    .from('company_brandbook_logos')
    .select('url,label,variant,is_default,order_index')
    .eq('company_id', companyId)
    .order('is_default', { ascending: false })
    .order('order_index', { ascending: true });

  if (error) {
    throw new Error('Nie udało się odczytać logo z brandbooka firmy. Spróbuj ponownie.');
  }

  const logo = logos?.find((entry) => normalizeLogoKey(entry.label) === 'primary-black')
    || logos?.find((entry) => normalizeLogoKey(entry.variant) === 'primary-black');
  const source = String(logo?.url ?? '').trim();
  if (!source) {
    throw new Error('W brandbooku firmy dodaj logo primary-black z czarnym napisem do wydruków.');
  }
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) return source;

  let storagePath = source.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    const allowedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
    const storagePrefix = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/company-logos\//;
    if (url.origin !== allowedOrigin || !storagePrefix.test(url.pathname)) {
      throw new Error('Wgraj czarny logotyp do brandbooka firmy — plik musi znajdować się w magazynie logo CRM.');
    }
    storagePath = decodeURIComponent(url.pathname.replace(storagePrefix, ''));
  }

  // Read from the fixed logo bucket, never fetch an arbitrary URL from invoice data.
  const { data: image, error: downloadError } = await supabase.storage
    .from('company-logos')
    .download(storagePath);
  if (downloadError || !image) {
    throw new Error('Nie udało się pobrać logo primary-black. Sprawdź plik w brandbooku firmy.');
  }
  if (!image.type.startsWith('image/') || !image.size) {
    throw new Error('Plik logo primary-black nie jest poprawnym obrazem.');
  }

  const bytes = Buffer.from(await image.arrayBuffer());
  return `data:${image.type};base64,${bytes.toString('base64')}`;
}
