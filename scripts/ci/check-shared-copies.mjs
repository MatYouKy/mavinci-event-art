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
  ['src/lib/CRM/calendar/calendarDays.ts', 'mobile/src/lib/calendarDays.ts'],
  ['src/lib/events/steps/eventSteps.ts', 'mobile/src/lib/eventSteps.ts'],
  ['src/lib/events/access/eventAccess.ts', 'mobile/src/lib/eventAccess.ts'],
  ['src/lib/events/settlement/eventSettlement.ts', 'mobile/src/lib/eventSettlement.ts'],
  ['src/lib/seller/sellerCockpit.ts', 'mobile/src/lib/sellerCockpit.ts'],
  ['src/lib/seller/offerJourney.ts', 'mobile/src/lib/offerJourney.ts'],
  ['src/lib/seller/readiness.ts', 'mobile/src/lib/sellerReadiness.ts'],
  ['src/lib/help/helpTypes.ts', 'mobile/src/lib/helpTypes.ts'],
  ['src/lib/help/managerHelp.ts', 'mobile/src/lib/managerHelp.ts'],
  ['src/lib/help/presentationsHelp.ts', 'mobile/src/lib/presentationsHelp.ts'],
  ['src/lib/events/equipment/equipmentChecklist.ts', 'mobile/src/lib/equipmentChecklist.ts'],
  ['src/lib/CRM/meetings/meetingStatus.ts', 'mobile/src/lib/meetingStatus.ts'],
  ['src/lib/social/socialShared.ts', 'mobile/src/lib/socialShared.ts'],
  ['src/lib/portfolio/portfolioShared.ts', 'mobile/src/lib/portfolioShared.ts'],
  ['src/lib/showcase/showcaseShared.ts', 'mobile/src/lib/showcaseShared.ts'],
  ['src/lib/materials/materialsShared.ts', 'mobile/src/lib/materialsShared.ts'],
  ['src/lib/CRM/theme/crmThemePalette.ts', 'mobile/src/theme/crmThemePalette.ts'],
  ['src/lib/drive/driveShared.ts', 'mobile/src/lib/driveShared.ts'],
  ['src/lib/CRM/events/teamTransport.ts', 'mobile/src/lib/teamTransport.ts'],
  ['src/lib/CRM/Offers/eventAssumptions.ts', 'mobile/src/lib/eventAssumptions.ts'],
  ['src/lib/CRM/tasks/taskDue.ts', 'mobile/src/lib/taskDue.ts'],
  ['src/lib/CRM/messages/recipientSuggestions.ts', 'mobile/src/lib/recipientSuggestions.ts'],
  ['src/lib/tenders/tenderFilterConfig.ts', 'mobile/src/lib/tenderFilterConfig.ts'],
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
