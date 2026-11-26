/*
 * Czat spotkania (`docs/meeting-chat.md`): rozmowa w Komunikatorze przypięta do spotkania — organizator i zaproszeni
 * pracownicy, także przed odpowiedzią na zaproszenie. Dane z bazy: `meeting_chat(id, utwórz)` — identyfikator rozmowy,
 * liczba wiadomości, nieprzeczytane i pliki (np. agenda) z czatu. Wspólne dla strony Spotkań, szczegółów spotkania
 * i natywnego API (Mac, `/bridge/native/v1/meetings`).
 */

export type MeetingChatFile = {
  id: string;
  name: string;
  url: string;
  size: number | null;
  type: string;
  createdAt: string;
  sender: string | null;
};

export type MeetingChatInfo = {
  /** Rozmowa (pusta — nikt jeszcze nie otworzył czatu). */
  conversationId: string | null;
  /** Bieżący pracownik jest w rozmowie (dopiero wtedy liczby i pliki). */
  member: boolean;
  messages: number;
  unread: number;
  files: MeetingChatFile[];
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

/** Odpowiedź `meeting_chat` → dane czatu (odporne na brak pól). */
export function parseMeetingChat(raw: unknown): MeetingChatInfo {
  const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const files = Array.isArray(row.files) ? row.files : [];
  return {
    conversationId: text(row.conversation_id) || null,
    member: row.member === true,
    messages: count(row.messages),
    unread: count(row.unread),
    files: files
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => Boolean(item && text(item.url)))
      .map((item) => ({
        id: text(item.id) || text(item.url),
        name: text(item.name) || 'Plik',
        url: text(item.url),
        size: typeof item.size === 'number' ? item.size : null,
        type: text(item.type) || 'file',
        createdAt: text(item.created_at),
        sender: text(item.sender) || null,
      })),
  };
}

/** „1 wiadomość”, „3 wiadomości”, „5 wiadomości”. */
export function meetingChatMessagesLabel(messages: number): string {
  return messages === 1 ? '1 wiadomość' : `${messages} wiadomości`;
}

/** „1 nowa”, „3 nowe”, „5 nowych”. */
export function meetingChatUnreadLabel(unread: number): string {
  const tens = unread % 100;
  const ones = unread % 10;
  if (unread === 1) return '1 nowa';
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return `${unread} nowe`;
  return `${unread} nowych`;
}

/** Rozmiar pliku: „12 KB”, „3,4 MB”. */
export function meetingChatFileSize(size: number | null): string {
  if (size === null || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
