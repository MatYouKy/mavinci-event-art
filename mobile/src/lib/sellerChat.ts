import { supabase } from './supabase';

export type SellerConversation = {
  id: string;
  title: string;
  brand_name: string;
  offer_id: string | null;
  offer_title?: string | null;
  has_event?: boolean;
  event_id?: string | null;
  event_name?: string | null;
  can_view_event?: boolean;
  last_message: string | null;
  last_at: string | null;
  unread: number;
  can_send: boolean;
};

export function sellerConversationLabel(conversation: SellerConversation) {
  return conversation.has_event ? 'Rozmowa o wydarzeniu'
    : conversation.offer_id ? 'Rozmowa o ofercie' : 'Rozmowa ze sprzedawcą';
}

export async function getSellerConversation(id: string): Promise<SellerConversation> {
  const { data, error } = await supabase.rpc('seller_conversation_summary', { p_conversation: id });
  if (error) throw error;
  if (!data) throw new Error('Rozmowa jest niedostępna lub nie masz do niej uprawnień.');
  return data as SellerConversation;
}

export async function listSellerConversations(): Promise<SellerConversation[]> {
  // RLS limits the partner IDs; the RPC independently checks access to each thread.
  const { data, error } = await supabase.from('seller_conversations').select('sales_partner_id');
  if (error) throw error;
  const partners = [...new Set((data || []).map(row => row.sales_partner_id))];
  const groups = await Promise.all(partners.map(async partner => {
    const { data: rows, error: listError } = await supabase.rpc('list_seller_conversations', { p_partner: partner });
    if (listError) throw listError;
    return (rows || []) as SellerConversation[];
  }));
  return groups.flat();
}
