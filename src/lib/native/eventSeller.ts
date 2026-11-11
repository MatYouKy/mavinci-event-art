import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';

/**
 * Zakładka „Ustalenia” (`EventSellerCorrespondence`): oferty sprzedawców powiązane z wydarzeniem
 * (`get_event_seller_correspondence`) i rozmowa o realizacji (`get_seller_messages`, `send_seller_message`,
 * `mark_seller_conversation_read`, `open_seller_conversation`) — te same funkcje bazy co CRM i portal sprzedawcy.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  throw new Error(message);
}

async function sellerTab(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_event_seller_correspondence', { p_event: eventId });
  if (error) {
    return { error: 'Nie udało się wczytać ustaleń. Wymagane są uprawnienia do wydarzenia i sprzedawcy oraz migracja rozmów ofert i realizacji.', offers: [] };
  }
  return {
    error: null,
    offers: ((data as any)?.offers || []).map((o: any) => ({
      id: o.id, number: o.offer_number ?? null, title: o.title ?? null, partnerId: o.sales_partner_id, partnerName: o.partner_name || '',
      brandName: o.brand_name || '', companyId: o.my_company_id, canStart: o.can_start === true,
      conversation: o.conversation ? {
        id: o.conversation.id, title: o.conversation.title || '', brandName: o.conversation.brand_name || '', lastMessage: o.conversation.last_message ?? null,
        lastAt: o.conversation.last_at ?? null, unread: Number(o.conversation.unread || 0), canSend: o.conversation.can_send === true,
      } : null,
    })),
  };
}

registerEventTab('seller-arrangements', sellerTab);

async function conversationOfEvent(ctx: NativeContext, eventId: string, conversationId: string) {
  if (!UUID.test(conversationId)) fail('Nieprawidłowa rozmowa.');
  const tab = await sellerTab(ctx, eventId);
  if (!tab.offers.some((offer: any) => offer.conversation?.id === conversationId)) fail('Ta rozmowa nie należy do ofert tego wydarzenia.');
}

async function messages(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const id = params.get('conversationId') || '';
  await conversationOfEvent(ctx, eventId, id);
  const before = Number(params.get('before') || 0);
  const { data, error } = await ctx.supabase.rpc('get_seller_messages', before > 0 ? { p_conversation: id, p_before: before } : { p_conversation: id });
  if (error) fail('Nie udało się wczytać rozmowy. Ponowimy za chwilę.');
  return {
    messages: ((data || []) as any[]).map((m) => ({
      id: m.id, seq: Number(m.seq || 0), crm: m.sender_kind === 'crm', sender: m.sender_name || '', body: m.body || '', createdAt: m.created_at, own: m.own === true,
    })),
  };
}

registerEventQueries('seller-arrangements', { messages });

async function send(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = String(body.conversationId || '');
  await conversationOfEvent(ctx, eventId, id);
  const text = String(body.body || '').trim().slice(0, 10000);
  const messageId = String(body.messageId || '');
  if (!text || !UUID.test(messageId)) fail('Wpisz treść wiadomości.');
  const { error } = await ctx.supabase.rpc('send_seller_message', { p_conversation: id, p_message_id: messageId, p_body: text });
  if (error) fail(error.message || 'Nie potwierdzono wysyłki. Możesz ponowić; wiadomość nie zostanie zdublowana.');
  return { ok: true };
}

async function read(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = String(body.conversationId || '');
  await conversationOfEvent(ctx, eventId, id);
  const { error } = await ctx.supabase.rpc('mark_seller_conversation_read', { p_conversation: id, p_through: Number(body.through || 0) });
  if (error) fail('Nie udało się oznaczyć wiadomości jako przeczytanych.');
  return { ok: true };
}

/** „Rozpocznij rozmowę” — ten sam wątek oferty (także już powiązany z realizacją). */
async function open(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const offerId = String(body.offerId || '');
  const tab = await sellerTab(ctx, eventId);
  const offer = tab.offers.find((item: any) => item.id === offerId);
  if (!offer) fail('Ta oferta nie należy do tego wydarzenia.');
  if (!offer.canStart) fail('Masz dostęp tylko do odczytu. Rozmowę może rozpocząć sprzedawca lub uprawniony opiekun.');
  const { error } = await ctx.supabase.rpc('open_seller_conversation', { p_partner: offer.partnerId, p_company: offer.companyId, p_offer: offer.id });
  if (error) fail('Nie udało się otworzyć rozmowy. Sprawdź uprawnienia do tej marki i spróbuj ponownie.');
  return { ok: true };
}

registerEventActions('seller-arrangements', { send, read, open });
