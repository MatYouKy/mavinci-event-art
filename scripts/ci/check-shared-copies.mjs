#!/usr/bin/env node
/**
 * Kod współdzielony przez CRM i aplikację mobilną (Metro nie importuje plików spoza mobile/).
 * Każda para musi być identyczna — zmiana w jednym miejscu bez drugiego zatrzymuje CI.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAIRS = [
  ['src/lib/CRM/messages/salesContext.ts', 'mobile/src/lib/messageSalesContext.ts'],
  ['src/lib/CRM/refreshQueue.ts', 'mobile/src/lib/refreshQueue.ts'],
  ['src/lib/CRM/messages/unreadCounts.ts', 'mobile/src/lib/unreadCounts.ts'],
  ['src/lib/CRM/notifications/notificationFeed.ts', 'mobile/src/lib/notificationFeed.ts'],
  ['src/lib/CRM/messages/attachmentPreview.ts', 'mobile/src/lib/attachmentPreview.ts'],
  ['src/lib/CRM/messages/mailboxPreferences.ts', 'mobile/src/lib/mailboxPreferences.ts'],
  ['src/lib/CRM/chat/chatReadState.ts', 'mobile/src/lib/chatReadState.ts'],
  ['src/lib/CRM/calendar/publicHolidays.ts', 'mobile/src/lib/publicHolidays.ts'],
  ['src/lib/events/steps/eventSteps.ts', 'mobile/src/lib/eventSteps.ts'],
  ['src/lib/events/access/eventAccess.ts', 'mobile/src/lib/eventAccess.ts'],
  ['src/lib/events/settlement/eventSettlement.ts', 'mobile/src/lib/eventSettlement.ts'],
];

let failed = false;
for (const [crm, mobile] of PAIRS) {
  const a = readFileSync(join(root, crm), 'utf8');
  const b = readFileSync(join(root, mobile), 'utf8');
  if (a !== b) {
    failed = true;
    console.error(`::error file=${mobile}::Kopia różni się od ${crm}. Skopiuj zmianę do obu plików (cp ${crm} ${mobile}).`);
  }
}
console.log(failed ? 'Wspólny kod CRM i mobile: rozbieżność.' : `Wspólny kod CRM i mobile: ${PAIRS.length} par zgodnych.`);
process.exit(failed ? 1 : 0);
