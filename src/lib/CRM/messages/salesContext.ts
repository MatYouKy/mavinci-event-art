export type MessageOwnerAvatarMetadata = {
  desktop?: { src?: string; position?: { posX: number; posY: number; scale: number }; objectFit?: string };
  mobile?: { src?: string; position?: { posX: number; posY: number; scale: number }; objectFit?: string };
};

export type MessageSalesContext = {
  inquiries: Array<{ id: string; stage: string | null; ownerId: string | null; ownerName: string | null; ownerAvatarUrl?: string | null; ownerAvatarMetadata?: MessageOwnerAvatarMetadata | null; archived: boolean }>;
  aiStatus: string | null;
  aiIntent: string | null;
  available: boolean;
};

// A missing/failed lookup is not a sales assignment. Show badges only for confirmed links.
export const hasMessageInquiry = (sales?: MessageSalesContext): boolean =>
  Boolean(sales?.available && sales.inquiries.length > 0);

export const salesAiLabel = (status: string | null) => ({
  pending: 'AI: oczekuje', processing: 'AI: analizuje', classified: 'AI: przeanalizowano',
  manual_review: 'AI: wymaga sprawdzenia', failed: 'AI: analiza nieudana',
  skipped_continuation: 'Kontynuacja / istniejące zapytanie',
}[status || ''] || '');

// Only metadata for the requested page; no message bodies or per-row requests.
export async function readMessageSalesContext(client: any, messages: Array<{ id: string; type: string }>): Promise<Record<string, MessageSalesContext>> {
  const input = messages.filter(m => ['received', 'sent', 'contact_form'].includes(m.type)).slice(0, 100).map(({ id, type }) => ({ id, type }));
  if (!input.length) return {};
  const result: Record<string, MessageSalesContext> = {};
  for (const m of input) result[`${m.type}:${m.id}`] = { inquiries: [], aiStatus: null, aiIntent: null, available: false };
  try {
    const { data, error } = await client.rpc('crm_message_sales_context', { p_messages: input });
    if (error) return result;
    for (const row of data || []) result[`${row.message_type}:${row.message_id}`] = {
      inquiries: row.inquiries || [], aiStatus: row.ai_status, aiIntent: row.ai_intent, available: true,
    };
  } catch { /* Unavailable metadata must never be shown as an unclaimed inquiry. */ }
  return result;
}

export async function withMessageSalesContext<T extends { id: string; type: string }>(client: any, messages: T[]): Promise<Array<T & { sales?: MessageSalesContext }>> {
  const context = await readMessageSalesContext(client, messages);
  return messages.map(m => ({ ...m, sales: context[`${m.type}:${m.id}`] }));
}

// A confirmed, open pool inquiry can be claimed without creating another inquiry.
export const canClaimMessageInquiry = (sales?: MessageSalesContext): boolean => {
  const inquiry = sales?.inquiries[0];
  return Boolean(hasMessageInquiry(sales) && sales?.inquiries.length === 1 && inquiry &&
    !inquiry.ownerId && !inquiry.archived && !['won', 'lost'].includes(inquiry.stage || ''));
};

export function messageInquirySaveFeedback(result: { ownerId?: string | null; created?: boolean }, expectedOwner: string): string {
  if (result.ownerId === expectedOwner) return result.created ? 'Utworzono i przypisano zapytanie.' : 'Zapytanie jest przypisane do wybranego pracownika.';
  return result.ownerId ? 'Zapytanie ma już innego opiekuna. Zachowano istniejące przypisanie.' : 'Zapytanie jest w lejku, ale serwer nie potwierdził przypisania opiekuna.';
}
