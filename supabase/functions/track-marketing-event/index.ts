import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const pixel = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='), (char) => char.charCodeAt(0));
const pixelResponse = () => new Response(pixel, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, max-age=0' } });

Deno.serve(async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const eventType = url.searchParams.get('type') === 'click' ? 'clicked' : 'opened';
  const target = url.searchParams.get('url') || '';
  const safeTarget = (() => {
    try {
      const parsed = new URL(target);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
    } catch { return null; }
  })();

  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: recipient } = await service.from('mailing_recipients')
    .select('id, campaign_id, status, opened_at, clicked_at').eq('unsubscribe_token', token).maybeSingle();

  if (recipient) {
    const timestamp = new Date().toISOString();
    if (eventType === 'opened') {
      await service.from('mailing_recipients').update({
        opened_at: recipient.opened_at || timestamp,
        status: ['sent', 'delivered', 'opened'].includes(recipient.status) ? 'opened' : recipient.status,
        updated_at: timestamp,
      }).eq('id', recipient.id);
      await service.from('mailing_campaign_events').insert({ campaign_id: recipient.campaign_id, recipient_id: recipient.id, event_type: 'opened' });
    } else {
      await service.from('mailing_recipients').update({
        clicked_at: recipient.clicked_at || timestamp,
        opened_at: recipient.opened_at || timestamp,
        status: ['replied', 'unsubscribed'].includes(recipient.status) ? recipient.status : 'clicked',
        updated_at: timestamp,
      }).eq('id', recipient.id);
      await service.from('mailing_campaign_events').insert({
        campaign_id: recipient.campaign_id, recipient_id: recipient.id, event_type: 'clicked',
        metadata: { url: safeTarget },
      });
    }
    await service.rpc('finalize_mailing_campaign_batch', { p_campaign_id: recipient.campaign_id });
  }

  if (eventType === 'clicked' && safeTarget) return Response.redirect(safeTarget, 302);
  return pixelResponse();
});
