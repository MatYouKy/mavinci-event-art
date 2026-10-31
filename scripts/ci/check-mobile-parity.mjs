#!/usr/bin/env node
/**
 * Parytet CRM ↔ aplikacja mobilna (zasada z AGENTS.md).
 * Gdy zmiana dotyczy modułu CRM, który ma odpowiednik w aplikacji mobilnej, a w mobile/ nic się nie zmieniło:
 *  - w pull requeście CI zatrzymuje się, chyba że opis zawiera „Mobile: nie dotyczy” z powodem,
 *  - przy bezpośrednim pushu wypisuje ostrzeżenie.
 * Mapa modułów: docs/mobile-parity.md.
 */
import { execSync } from 'node:child_process';

const AREAS = [
  { name: 'Wiadomości e-mail', crm: ['src/app/(crm)/crm/messages/', 'src/store/api/messagesApi.ts', 'src/lib/CRM/messages/'],
    mobile: ['mobile/src/screens/MessagesScreen.tsx', 'mobile/src/screens/EmailMessageDetailScreen.tsx', 'mobile/src/screens/ContactMessageDetailScreen.tsx', 'mobile/src/lib/mailboxPreferences.ts'] },
  { name: 'Zapytania', crm: ['src/app/(crm)/crm/inquiries/', 'src/lib/CRM/inquiries/'],
    mobile: ['mobile/src/screens/InquiriesScreen.tsx', 'mobile/src/screens/NewInquiryModal.tsx', 'mobile/src/screens/TaskDetailScreen.tsx'] },
  { name: 'Przetargi', crm: ['src/app/(crm)/crm/tenders/'], mobile: ['mobile/src/screens/TendersScreen.tsx'] },
  { name: 'Wydarzenia', crm: ['src/app/(crm)/crm/events/'],
    mobile: ['mobile/src/screens/EventsScreen.tsx', 'mobile/src/screens/EventDetailScreen.tsx', 'mobile/src/components/Events/'] },
  { name: 'Zadania', crm: ['src/app/(crm)/crm/tasks/'], mobile: ['mobile/src/screens/TasksScreen.tsx', 'mobile/src/screens/TaskDetailScreen.tsx'] },
  { name: 'Kalendarz i spotkania', crm: ['src/app/(crm)/crm/calendar/', 'src/app/(crm)/crm/meetings/'],
    mobile: ['mobile/src/screens/CalendarScreen.tsx', 'mobile/src/screens/MeetingsScreen.tsx', 'mobile/src/components/Meetings/'] },
  { name: 'Czas pracy', crm: ['src/app/(crm)/crm/time-tracking/'], mobile: ['mobile/src/screens/TimeTrackingScreen.tsx', 'mobile/src/components/OwnTimeEntries.tsx', 'mobile/src/components/TimeEntryDiscussions.tsx'] },
  { name: 'Sprzęt', crm: ['src/app/(crm)/crm/equipment/'], mobile: ['mobile/src/screens/EquipmentScreen.tsx', 'mobile/src/screens/EquipmentDetailScreen.tsx'] },
  { name: 'Flota', crm: ['src/app/(crm)/crm/fleet/'], mobile: ['mobile/src/screens/FleetScreen.tsx', 'mobile/src/components/Fleet/'] },
  { name: 'Kontakty i klienci', crm: ['src/app/(crm)/crm/contacts/', 'src/app/(crm)/crm/clients/'],
    mobile: ['mobile/src/screens/ClientsScreen.tsx', 'mobile/src/components/Client360Modal.tsx'] },
  { name: 'Pracownicy', crm: ['src/app/(crm)/crm/employees/'], mobile: ['mobile/src/screens/EmployeesScreen.tsx'] },
  { name: 'Komunikator', crm: ['src/components/crm/chat/', 'src/lib/CRM/chat/'],
    mobile: ['mobile/src/screens/ChatScreen.tsx', 'mobile/src/screens/ChatListScreen.tsx', 'mobile/src/screens/SellerChatScreen.tsx', 'mobile/src/lib/chatReadState.ts', 'mobile/src/services/unreadChat.ts', 'mobile/src/services/chatNotifications.ts'] },
  { name: 'Dashboard', crm: ['src/app/(crm)/crm/CRMDashboard.tsx', 'src/components/crm/dashboard/'],
    mobile: ['mobile/src/screens/DashboardScreen.tsx', 'mobile/src/components/SalesDaySection.tsx'] },
  { name: 'Uprawnienia', crm: ['src/lib/permissions.ts'], mobile: ['mobile/src/lib/permissions.ts'] },
  { name: 'Ustawienia użytkownika', crm: ['src/app/(crm)/crm/settings/page.tsx'],
    mobile: ['mobile/src/screens/SettingsScreen.tsx', 'mobile/src/components/MailboxPreferencesSection.tsx'] },
];

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const zero = /^0+$/;
let base = process.env.BASE_SHA && !zero.test(process.env.BASE_SHA) ? process.env.BASE_SHA : '';
if (!base) {
  try { base = sh('git merge-base origin/main HEAD'); } catch { try { base = sh('git rev-parse HEAD~1'); } catch { base = ''; } }
}
if (!base) { console.log('Parytet mobile: brak punktu odniesienia, pomijam.'); process.exit(0); }

let changed = [];
try { changed = sh(`git diff --name-only ${base}...HEAD`).split('\n').filter(Boolean); } catch {
  try { changed = sh(`git diff --name-only ${base} HEAD`).split('\n').filter(Boolean); } catch { changed = []; }
}
const touches = (prefixes) => changed.some((file) => prefixes.some((prefix) => file === prefix || file.startsWith(prefix)));
const mobileChanged = changed.some((file) => file.startsWith('mobile/'));
const missing = AREAS.filter((area) => touches(area.crm) && !touches(area.mobile));

if (missing.length === 0) {
  console.log('Parytet mobile: zmiany CRM mają odpowiednik w aplikacji mobilnej (albo nie dotyczą modułów mobilnych).');
  process.exit(0);
}

const optOut = /mobile:\s*nie dotyczy/i.test(process.env.PR_BODY || '');
const list = missing.map((area) => area.name).join(', ');
const message = `Zmieniono moduły CRM dostępne w aplikacji mobilnej (${list}), ${mobileChanged ? 'ale nie odpowiadające im ekrany' : 'bez zmian w mobile/'}. `
  + 'Zaktualizuj aplikację (docs/mobile-parity.md) albo wpisz w opisie PR „Mobile: nie dotyczy — powód”.';

if (optOut) {
  console.log(`Parytet mobile: ${list} — oznaczone w opisie PR jako „Mobile: nie dotyczy”.`);
  process.exit(0);
}
if (process.env.IS_PR === 'true') {
  console.error(`::error title=Parytet CRM ↔ mobile::${message}`);
  process.exit(1);
}
console.log(`::warning title=Parytet CRM ↔ mobile::${message}`);
process.exit(0);
