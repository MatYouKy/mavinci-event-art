import { Linking } from 'react-native';
import {
  navigateFromMenu,
  navigateToCalendarTab,
  navigateToClients,
  navigateToEvent,
  navigateToEventsList,
  navigateToInquiry,
  navigateToMeeting,
  navigateToTask,
  navigationRef,
} from '../navigation/navigationRef';

/*
 * Widżety Mavinci na iPhonie i iPadzie (kod `desktop/mac/Sources/MavinciWidgets`, cel `MavinciWidgets` —
 * `plugins/withMavinciWidgets.js`) otwierają aplikację adresem `mavinci-crm://…` — ten sam zestaw co `mavinci://…` na Macu:
 *  - cały widżet: `tasks` (Moje zadania), `calendar` (Kalendarz), `meetings` (Spotkania), `events` (Wydarzenia — lista eventów),
 *  - pozycja: `task/<id>`, `event/<id>`, `meeting/<id>`, `inquiry/<id>`, `contact/<id>` (kontakt — lista Klientów).
 * Adres z uruchomienia aplikacji (`getInitialURL`) i adresy przy działającej aplikacji (zdarzenie `url`).
 */

const SCHEME = 'mavinci-crm';
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const SECTIONS = new Set(['tasks', 'calendar', 'meetings', 'events']);
const RECORDS = new Set(['task', 'event', 'meeting', 'inquiry', 'contact']);

export type WidgetLink = { host: string; id: string | null };

/** Adres widżetu → sekcja albo rekord; `null` — inny adres. */
export function parseWidgetUrl(url: string | null | undefined): WidgetLink | null {
  const match = new RegExp(`^${SCHEME}://([a-z]+)(?:/([^/?#]+))?/?(?:[?#].*)?$`, 'i').exec((url || '').trim());
  if (!match) return null;
  const host = match[1].toLowerCase();
  const id = match[2] ? decodeURIComponent(match[2]) : null;
  if (id) return RECORDS.has(host) && UUID.test(id) ? { host, id: id.toLowerCase() } : null;
  return SECTIONS.has(host) ? { host, id: null } : null;
}

/** Otwiera cel adresu widżetu; `false` — to nie adres widżetu albo nawigacja nie jest jeszcze gotowa. */
export function openWidgetUrl(url: string | null | undefined): boolean {
  const link = parseWidgetUrl(url);
  if (!link || !navigationRef.isReady()) return false;
  if (link.id) {
    switch (link.host) {
      case 'task': navigateToTask(link.id); return true;
      case 'event': navigateToEvent(link.id); return true;
      case 'meeting': navigateToMeeting(link.id); return true;
      case 'inquiry': navigateToInquiry(link.id); return true;
      case 'contact': navigateToClients(); return true;
      default: return false;
    }
  }
  switch (link.host) {
    case 'tasks': navigateFromMenu('Tasks'); return true;
    case 'calendar': navigateToCalendarTab(); return true;
    case 'meetings': navigateFromMenu('Meetings'); return true;
    case 'events': navigateToEventsList(); return true;
    default: return false;
  }
}

/** Adres, którym uruchomiono aplikację — obsłużony raz (ponowne zalogowanie nie otwiera go drugi raz). */
let initialHandled: string | null = null;

/**
 * Nasłuch adresów widżetów (po zalogowaniu, w głównej nawigacji): adres z uruchomienia aplikacji i każdy kolejny. Nawigacja
 * mogła jeszcze nie być gotowa — kolejne próby co 200 ms przez 3 s. Zwraca funkcję kończącą nasłuch.
 */
export function listenWidgetLinks(): () => void {
  let cancelled = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (work: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!cancelled) work();
    }, delay);
    timers.add(timer);
  };
  const open = (url: string, attempt = 0) => {
    if (cancelled || !parseWidgetUrl(url)) return;
    if (openWidgetUrl(url)) return;
    if (attempt < 15) later(() => open(url, attempt + 1), 200);
  };
  void Linking.getInitialURL()
    .then((url) => {
      if (cancelled || !url || url === initialHandled || !parseWidgetUrl(url)) return;
      initialHandled = url;
      later(() => open(url), 400);
    })
    .catch(() => undefined);
  const subscription = Linking.addEventListener('url', ({ url }) => open(url));
  return () => {
    cancelled = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    subscription.remove();
  };
}
