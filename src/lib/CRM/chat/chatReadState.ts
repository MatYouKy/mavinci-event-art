/**
 * Stan odczytu komunikatora — wspólny dla CRM i aplikacji mobilnej (kopia: mobile/src/lib/chatReadState.ts).
 * Zasady jak w Messengerze:
 *  - licznik liczy tylko wiadomości od innych osób, nowsze niż mój znacznik odczytu (get_chat_unread_counts),
 *    więc własna wiadomość, której ktoś jeszcze nie przeczytał, nie zwiększa mojego licznika,
 *  - „przeczytane” zapisujemy tylko wtedy, gdy rozmowa jest na ekranie, a okno lub aplikacja jest aktywne (mark_chat_read),
 *  - „dostarczone”, gdy aplikacja odebrała wiadomość, ale jej nie pokazała (mark_chat_delivered),
 *  - wysłanie wiadomości oznacza przeczytanie rozmowy (wyzwalacz w bazie),
 *  - znaczniki zapisuje serwer w swoim czasie, więc zegar urządzenia nie ma znaczenia.
 */

type RpcClient = { rpc: (fn: string, args?: any) => any };

export interface ChatReadMarker {
  last_read_at: string | null;
  last_delivered_at: string | null;
}

export type ChatReceiptStatus = 'sent' | 'delivered' | 'read';

/** Wpisywanie tekstu: kanał Realtime (broadcast) wspólny dla CRM i aplikacji. */
export const chatTypingTopic = (conversationId: string) => `chat_typing:${conversationId}`;
export const CHAT_TYPING_EVENT = 'typing';
/** Jak często wysyłać sygnał „pisze…” podczas pisania. */
export const CHAT_TYPING_SEND_INTERVAL_MS = 2000;
/** Jak długo pokazywać „pisze…” po ostatnim sygnale. */
export const CHAT_TYPING_VISIBLE_MS = 4500;

const time = (value: string | null | undefined) => (value ? Date.parse(value) : Number.NaN);

/** Nieprzeczytane wiadomości od innych osób, według rozmowy. */
export async function fetchChatUnreadCounts(client: RpcClient): Promise<Map<string, number>> {
  const { data, error } = await client.rpc('get_chat_unread_counts');
  if (error) throw error;
  const rows = (data ?? []) as { conversation_id: string; unread_count: number | string }[];
  return new Map(rows.map((row) => [row.conversation_id, Number(row.unread_count) || 0]));
}

export const sumChatUnread = (counts: Map<string, number>) =>
  Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

/** Rozmowa jest na ekranie i użytkownik ją widzi. Bez nowych wiadomości serwer nic nie zapisuje. */
export async function markChatRead(client: RpcClient, conversationId: string): Promise<void> {
  const { error } = await client.rpc('mark_chat_read', { p_conversation_id: conversationId });
  if (error) console.warn('[chat] mark_chat_read:', error.message ?? error);
}

/** Aplikacja odebrała wiadomości (jednej rozmowy albo wszystkich), ale ich nie pokazała. */
export async function markChatDelivered(client: RpcClient, conversationId?: string): Promise<void> {
  const { error } = await client.rpc(
    'mark_chat_delivered',
    conversationId ? { p_conversation_id: conversationId } : {},
  );
  if (error) console.warn('[chat] mark_chat_delivered:', error.message ?? error);
}

/**
 * Reakcja na wiadomość (własną lub cudzą) — przez serwer, bo RLS pozwala edytować tylko własne wiadomości.
 * emoji = null usuwa moją reakcję. Zwraca zapisaną reakcję albo null.
 */
export async function setChatMessageReaction(
  client: RpcClient,
  messageId: string,
  emoji: string | null,
): Promise<{ emoji: string; user_id: string } | null> {
  const { data, error } = await client.rpc('set_chat_message_reaction', { p_message_id: messageId, p_emoji: emoji });
  if (error) throw error;
  return data && typeof data === 'object' && 'emoji' in data ? (data as { emoji: string; user_id: string }) : null;
}

/** Pozostali uczestnicy, którzy przeczytali wiadomość wysłaną o createdAt. */
export function chatReadersOf(
  createdAt: string,
  markers: Map<string, ChatReadMarker>,
  currentEmployeeId: string,
): string[] {
  const created = time(createdAt);
  return Array.from(markers.entries())
    .filter(([employeeId, marker]) => employeeId !== currentEmployeeId && time(marker.last_read_at) >= created)
    .map(([employeeId]) => employeeId);
}

/** Status własnej wiadomości: wysłana, dostarczona (odebrana przez aplikację odbiorcy) albo wyświetlona. */
export function chatReceiptStatus(
  createdAt: string,
  markers: Map<string, ChatReadMarker>,
  currentEmployeeId: string,
): ChatReceiptStatus {
  const created = time(createdAt);
  let delivered = false;
  for (const [employeeId, marker] of Array.from(markers.entries())) {
    if (employeeId === currentEmployeeId) continue;
    if (time(marker.last_read_at) >= created) return 'read';
    if (time(marker.last_delivered_at) >= created) delivered = true;
  }
  return delivered ? 'delivered' : 'sent';
}

/**
 * Jak w Messengerze: miniatura osoby pod ostatnią wiadomością, którą przeczytała.
 * Nie pod własną wiadomością tej osoby — jej odpowiedź sama pokazuje, że przeczytała rozmowę.
 * Zwraca: id wiadomości → id osób.
 */
export function chatSeenHeads(
  messages: { id: string; sender_id: string; created_at: string }[],
  markers: Map<string, ChatReadMarker>,
  currentEmployeeId: string,
): Map<string, string[]> {
  const heads = new Map<string, string[]>();
  for (const [employeeId, marker] of Array.from(markers.entries())) {
    if (employeeId === currentEmployeeId) continue;
    const readAt = time(marker.last_read_at);
    if (!Number.isFinite(readAt)) continue;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (time(message.created_at) > readAt) continue;
      if (message.sender_id !== employeeId) heads.set(message.id, [...(heads.get(message.id) ?? []), employeeId]);
      break;
    }
  }
  return heads;
}

/** Przedrostek podglądu ostatniej wiadomości na liście rozmów: „Ty: …”, a w grupie „Anna: …”. */
export function chatPreviewPrefix(
  conversation: { is_group: boolean; last_message_sender_id?: string | null },
  currentEmployeeId: string,
  senderName: (employeeId: string) => string | null | undefined,
): string {
  const senderId = conversation.last_message_sender_id;
  if (!senderId) return '';
  if (senderId === currentEmployeeId) return 'Ty: ';
  if (!conversation.is_group) return '';
  const name = senderName(senderId);
  return name ? `${name}: ` : '';
}

/** Opis „pisze…” dla nagłówka rozmowy. */
export function chatTypingLabel(names: string[], isGroup: boolean): string {
  if (names.length === 0) return '';
  if (!isGroup) return 'pisze…';
  if (names.length === 1) return `${names[0]} pisze…`;
  return `${names.slice(0, 2).join(', ')}${names.length > 2 ? ' i inni' : ''} piszą…`;
}
