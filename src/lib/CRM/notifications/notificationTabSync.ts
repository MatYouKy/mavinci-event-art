/*
 * Powiadomienia w wielu kartach CRM jednej przeglądarki: baner i dźwięk pojawiają się raz — w karcie, w której pracujesz.
 * Pokazane, zamknięte i przeczytane powiadomienia są zapisywane we wspólnym rejestrze karty (localStorage) i ogłaszane
 * pozostałym kartom (BroadcastChannel), żeby nie pokazały tego samego jeszcze raz i od razu schowały otwarty baner.
 * Odczytanie w innym miejscu (aplikacja na Maca, telefon) przychodzi z bazy przez Realtime — `is_read` jest źródłem prawdy.
 */

export type NotificationTabMessage = { type: 'announced' | 'dismissed' | 'read'; userId: string; ids: string[] };

const CHANNEL = 'mavinci-crm-notifications';
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const LIMIT = 500;
const storageKey = (userId: string) => `mavinci:notifications:announced:${userId}`;

function readRegistry(userId: string): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(userId: string, registry: Record<string, number>) {
  try {
    const now = Date.now();
    const entries = Object.entries(registry)
      .filter(([, at]) => typeof at === 'number' && now - at < RETENTION_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, LIMIT);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Prywatne okno lub zablokowana pamięć — zostaje koordynacja przez BroadcastChannel.
  }
}

/** Czy to powiadomienie zostało już pokazane (lub zamknięte / przeczytane) w którejś karcie tej przeglądarki. */
export function wasAnnouncedInBrowser(userId: string, notificationId: string): boolean {
  return Boolean(readRegistry(userId)[notificationId]);
}

/** Zapis w rejestrze kart i powiadomienie pozostałych kart. */
export function shareNotificationEvent(type: NotificationTabMessage['type'], userId: string, ids: string[]) {
  if (!ids.length || typeof window === 'undefined') return;
  const registry = readRegistry(userId);
  const now = Date.now();
  for (const id of ids) registry[id] = now;
  writeRegistry(userId, registry);
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type, userId, ids } satisfies NotificationTabMessage);
    channel.close();
  } catch {
    // Starsza przeglądarka — pozostałe karty i tak sprawdzą rejestr przed pokazaniem banera.
  }
}

/** Wiadomości z innych kart tej przeglądarki (tego samego pracownika). */
export function subscribeNotificationTabs(userId: string, handler: (message: NotificationTabMessage) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<NotificationTabMessage>) => {
    const message = event.data;
    if (message?.userId === userId && Array.isArray(message.ids)) handler(message);
  };
  return () => channel.close();
}
