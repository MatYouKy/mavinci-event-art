import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { currentEnglishFields } from '../_shared/productTranslation.ts';
import { ensureProductEnglish } from '../_shared/englishTranslation.ts';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'Niedozwolona metoda.' }, 405);
  try {
    const authorization = req.headers.get('Authorization') || '';
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: 'Zaloguj się ponownie.' }, 401);
    const body = await req.json();
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.productId || '') || !['read', 'generate', 'save'].includes(body.action)) return json({ error: 'Nieprawidłowe żądanie.' }, 400);
    const { data: employee } = await client.from('employees').select('id,role,access_level,permissions').or(`id.eq.${user.id},auth_user_id.eq.${user.id}`).eq('is_active', true).maybeSingle();
    if (!employee) return json({ error: 'Brak aktywnego profilu pracownika.' }, 403);
    const canEdit = employee.role === 'admin' || employee.access_level === 'admin' || employee.permissions?.includes('offers_manage');
    let offerTranslation = false;
    if (body.action === 'generate' && body.offerId) {
      const { data: permitted } = await client.rpc('sales_can_manage_offer', { p_offer: body.offerId });
      const { data: linked } = await client.from('offer_items').select('id').eq('offer_id', body.offerId).eq('product_id', body.productId).limit(1).maybeSingle();
      offerTranslation = Boolean(permitted && linked);
      if (!offerTranslation) return json({ error: 'Produkt nie należy do oferty albo brakuje uprawnień.' }, 403);
    }
    if (body.action !== 'read' && !canEdit && !offerTranslation) return json({ error: 'Brak uprawnień do edycji produktów.' }, 403);
    // All reads/writes use the caller's JWT and existing product RLS policies.
    const { data: product, error } = await client.from('offer_products').select('*, variants:offer_product_variants(*)').eq('id', body.productId).single();
    if (error || !product) return json({ error: 'Brak dostępu do produktu.' }, 403);
    if (body.action === 'generate') {
      const writer = offerTranslation ? createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }) : client;
      product.english_content = await ensureProductEnglish(writer, product);
      // Reload version after the optimistic write, including any concurrent change.
      const { data, error: reloadError } = await client.from('offer_products').select('*, variants:offer_product_variants(*)').eq('id', body.productId).single();
      if (reloadError) throw reloadError;
      return json({ fields: currentEnglishFields(data), revision: data.translation_revision, version: data.english_version });
    }
    const fields = currentEnglishFields(product);
    if (body.action === 'save') {
      if (body.revision !== product.translation_revision || body.version !== product.english_version) return json({ error: 'Produkt lub wersja EN zostały zmienione. Odśwież treść przed zapisaniem.' }, 409);
      const entries: Record<string, { source: string; target: string }> = {};
      for (const field of fields) {
        const target = body.targets?.[field.key];
        if (target === '' || target == null) continue;
        if (typeof target !== 'string' || !target.trim() || target.length > (field.limit || 24000)) return json({ error: `Uzupełnij lub skróć: ${field.label}${field.limit ? ` (maks. ${field.limit} znaków)` : ''}.` }, 400);
        entries[field.key] = { source: field.source, target: target.trim() };
      }
      const { data: saved, error: saveError } = await client.from('offer_products').update({ english_content: entries, english_source_revision: Object.keys(entries).length === fields.length ? body.revision : null, english_version: Number(body.version) + 1, english_updated_at: new Date().toISOString() })
        .eq('id', product.id).eq('translation_revision', body.revision).eq('english_version', body.version).select('id').maybeSingle();
      if (saveError || !saved) return json({ error: 'Nie udało się zapisać EN. Sprawdź uprawnienia i odśwież produkt.' }, 409);
      return json({ fields: fields.map(field => ({ ...field, target: entries[field.key]?.target || '' })), revision: body.revision, version: Number(body.version) + 1 });
    }
    return json({ fields, revision: product.translation_revision, version: product.english_version });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Nie udało się przygotować wersji EN.' }, 500);
  }
});
