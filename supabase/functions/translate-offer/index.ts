import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EnglishTranslator } from '../_shared/englishTranslation.ts';
import { loadOfferTranslationSource, readOfferTranslation } from '../_shared/loadOfferTranslation.ts';
import { offerCopySignature, offerTranslationLimits } from '../_shared/productTranslation.ts';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return json({ error: 'Niedozwolona metoda.' }, 405);
  try {
    const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return json({ error: 'Zaloguj się ponownie.' }, 401);
    const { offerId, action } = await req.json();
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(offerId || '') || !['read','generate'].includes(action)) return json({ error: 'Nieprawidłowe żądanie.' }, 400);
    const { data: permitted, error: permissionError } = await caller.rpc('sales_can_manage_offer', { p_offer: offerId });
    if (permissionError || !permitted) return json({ error: 'Brak uprawnień do tej oferty.' }, 403);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const offer = await loadOfferTranslationSource(client, offerId);
    if (offer.sales_channel === 'seller_portal') return json({ error: 'Wersja EN jest dostępna w ofertach CRM.' }, 400);
    const state = await readOfferTranslation(client, offer);
    if (action === 'generate' && !state.ready) {
      if (state.sources.length > 2500 || state.sources.reduce((sum,text) => sum + text.length,0) > 250000) throw new Error('Oferta jest zbyt obszerna do jednorazowego tłumaczenia. Przygotuj najpierw teksty EN produktów.');
      const translator = new EnglishTranslator(); translator.importMemory(state.memory);
      const targets = await translator.translate(state.sources, offerTranslationLimits(offer));
      state.memory = Object.fromEntries(state.sources.map((text,index) => [text,targets[index]]));
      const current = await loadOfferTranslationSource(client, offerId);
      if (await offerCopySignature(current) !== state.signature) return json({ error: 'Treść oferty zmieniła się podczas tłumaczenia. Ponów przygotowanie EN.' }, 409);
      const { error } = await client.from('offer_english_content').upsert({ offer_id: offerId, source_signature: state.signature, memory: state.memory, updated_at: new Date().toISOString() });
      if (error) throw new Error('Nie udało się zapisać tłumaczenia oferty. Spróbuj ponownie.');
      state.ready = true;
    }
    return json({ memory: state.memory, ready: state.ready, signature: state.signature, packages: offer.packages || [], requirements: offer.resolved_requirements });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Nie udało się przygotować EN.' }, 500); }
});
