type SellerChatTarget = {
  type?: string;
  workflow?: string;
  conversation_id?: string;
  action_url?: string;
  metadata?: Record<string, unknown> | null;
};

/** Seller conversations have their own IDs and must never open employee chat. */
export function getSellerChatTarget(target: SellerChatTarget): string | null {
  const workflow = target.workflow || target.metadata?.workflow;
  const id = target.conversation_id || target.metadata?.conversation_id;
  if ((workflow === 'seller_chat' || target.type === 'seller_chat' || target.type === 'seller_message')
    && typeof id === 'string' && id) return id;
  const url = target.action_url || '';
  if (!/\/(?:crm\/(?:contacts|salespeople|offers|events)|seller\/(?:messages|offers|realizations))(?:[/?#]|$)/i.test(url)) return null;
  return url.match(/[?&]conversation=([0-9a-f-]{36})(?=&|#|$)/i)?.[1] || null;
}
