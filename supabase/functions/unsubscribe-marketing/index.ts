import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const html = (title: string, message: string, formToken: string | null = null, status = 200) => new Response(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#0f1119;color:#e5e4e2;font-family:Arial,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:32px;border:1px solid rgba(211,187,115,.25);border-radius:16px;background:#1c1f33"><h1 style="font-size:24px;font-weight:400;color:#d3bb73">${title}</h1><p style="line-height:1.6;color:rgba(229,228,226,.75)">${message}</p>${formToken ? `<form method="post"><input type="hidden" name="token" value="${escapeHtml(formToken)}"><button type="submit" style="border:0;border-radius:9px;background:#d3bb73;color:#1c1f33;padding:12px 20px;font-weight:700;cursor:pointer">Potwierdzam wypisanie</button></form>` : ''}</main></body></html>`, {
  status,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
});

Deno.serve(async (request) => {
  if (!['GET', 'POST'].includes(request.method)) return html('Nieobsługiwana metoda', 'Użyj linku otrzymanego w wiadomości.', null, 405);
  const url = new URL(request.url);
  let postedToken = '';
  if (request.method === 'POST') {
    if ((request.headers.get('Content-Type') || '').includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      postedToken = String(body.token || '');
    } else {
      const form = await request.formData().catch(() => null);
      postedToken = String(form?.get('token') || '');
    }
  }
  const token = String(url.searchParams.get('token') || postedToken);
  if (!uuidPattern.test(token)) return html('Nieprawidłowy link', 'Link rezygnacji jest nieprawidłowy lub niekompletny.', null, 400);

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: recipient } = await service.from('mailing_recipients')
    .select('id, campaign_id, profile_id, email, status').eq('unsubscribe_token', token).maybeSingle();
  if (!recipient) return html('Link wygasł', 'Nie znaleziono aktywnego odbiorcy dla tego linku.', null, 404);

  if (request.method === 'GET') {
    if (recipient.status === 'unsubscribed') return html('Komunikacja wyłączona', 'Ten adres jest już wypisany z komunikacji marketingowej.');
    return html('Rezygnacja z komunikacji', `Czy na pewno chcesz wyłączyć komunikację marketingową dla adresu <strong>${escapeHtml(String(recipient.email || ''))}</strong>?`, token);
  }

  const timestamp = new Date().toISOString();
  await service.from('mailing_recipients').update({ status: 'unsubscribed', exclusion_reason: 'unsubscribed', unsubscribed_at: timestamp, updated_at: timestamp }).eq('id', recipient.id);
  if (recipient.profile_id) await service.from('customer_marketing_profiles').update({
    marketing_status: 'unsubscribed', consent_withdrawn_at: timestamp, updated_at: timestamp,
  }).eq('id', recipient.profile_id);

  if (recipient.email) {
    const normalizedEmail = String(recipient.email).trim().toLowerCase();
    const { data: existing } = await service.from('marketing_suppression_list').select('id')
      .eq('email', normalizedEmail).is('revoked_at', null).maybeSingle();
    if (!existing) await service.from('marketing_suppression_list').insert({
      email: normalizedEmail, reason: 'unsubscribe',
      source: 'campaign_link', notes: `Kampania ${recipient.campaign_id}`,
    });
  }
  await service.from('mailing_campaign_events').insert({
    campaign_id: recipient.campaign_id, recipient_id: recipient.id, event_type: 'unsubscribed',
  });
  await service.rpc('finalize_mailing_campaign_batch', { p_campaign_id: recipient.campaign_id });
  return html('Komunikacja wyłączona', 'Adres został wypisany. Nie będziemy wysyłać na niego kolejnych kampanii marketingowych.');
});
