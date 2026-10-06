import { PERMISSION_SCOPE_GROUPS } from './permissionCatalog';

const definitions = [
  ['contracts', 'Umowy z klientami', ['/crm/contracts', '/crm/contract-templates']],
  ['events', 'Wydarzenia', ['/crm/events']],
  ['event_categories', 'Kategorie wydarzeń', ['/crm/event-categories']],
  ['calendar', 'Kalendarz i spotkania', ['/crm/calendar', '/crm/meetings']],
  ['tasks', 'Zadania firmowe', ['/crm/tasks']],
  ['offers', 'Oferty i produkty', ['/crm/offers', '/crm/brochures']],
  ['inquiries', 'Zapytania', ['/crm/inquiries']],
  ['clients', 'Klienci', ['/crm/clients']],
  ['contacts', 'Kontakty i organizacje', ['/crm/contacts', '/crm/organizations']],
  ['equipment', 'Magazyn', ['/crm/equipment']],
  ['fleet', 'Flota', ['/crm/fleet']],
  ['locations', 'Lokalizacje', ['/crm/locations']],
  ['subcontractors', 'Podwykonawcy', ['/crm/subcontractors']],
  ['employees', 'Pracownicy', ['/crm/employees']],
  ['personnel', 'Umowy i wynagrodzenia zespołu', ['/crm/employees/contracts', '/crm/employees/collaborators']],
  ['time_tracking', 'Czas pracy', ['/crm/time-tracking']],
  ['invoices', 'Faktury', ['/crm/invoices']],
  ['finances', 'Finanse', ['/crm/finances']],
  ['messages', 'Wiadomości', ['/crm/messages']],
  ['chat', 'Komunikator', ['/crm/chat']],
  ['marketing_campaigns', 'Marketing', ['/crm/campaigns', '/crm/mailing']],
  ['webhooks', 'Webhooki', ['/crm/settings/webhooks']],
  ['databases', 'Bazy danych', ['/crm/databases']],
  ['tenders', 'Przetargi', ['/crm/tenders']],
  ['mavinci_live', 'Mavinci LIVE', ['/crm/mavinci-live']],
  ['attractions', 'Atrakcje', ['/crm/attractions']],
  ['page', 'Panel strony WWW', ['/crm/page']],
  ['website', 'Edycja strony WWW', ['/crm/website']],
] as const;

const catalogPages: string[] = ["/crm", "/crm/admin/dashboard", "/crm/admin/login", "/crm/admin/site-images", "/crm/brochures", "/crm/brochures/[id]", "/crm/calendar", "/crm/calendar/meeting/[id]", "/crm/calendar/meetings", "/crm/campaigns", "/crm/clients", "/crm/clients/[id]", "/crm/contacts", "/crm/contacts/[id]", "/crm/contacts/new", "/crm/contract-templates", "/crm/contract-templates/[id]", "/crm/contract-templates/[id]/edit", "/crm/contract-templates/[id]/edit-wysiwyg", "/crm/contracts", "/crm/contracts/[id]", "/crm/contracts/[id]/edit", "/crm/contracts/create", "/crm/databases", "/crm/databases/[id]", "/crm/email", "/crm/employees", "/crm/employees/[id]", "/crm/employees/collaborators", "/crm/employees/collaborators/[id]", "/crm/employees/contracts", "/crm/employees/signature", "/crm/equipment", "/crm/equipment/[id]", "/crm/equipment/cables", "/crm/equipment/cables/[id]", "/crm/equipment/cables/new", "/crm/equipment/categories", "/crm/equipment/connectors", "/crm/equipment/kits", "/crm/equipment/locations", "/crm/equipment/new", "/crm/equipment/rental", "/crm/event-categories", "/crm/events", "/crm/events/[id]", "/crm/events/invitation/accept", "/crm/events/invitation/reject", "/crm/fleet", "/crm/fleet/[id]", "/crm/fleet/[id]/edit", "/crm/fleet/new", "/crm/inquiries", "/crm/inquiries/[id]", "/crm/invoices", "/crm/invoices/[id]", "/crm/invoices/[id]/edit", "/crm/invoices/new", "/crm/locations", "/crm/locations/[id]", "/crm/mailing", "/crm/mavinci-live", "/crm/meetings", "/crm/messages", "/crm/messages/[id]", "/crm/offers", "/crm/offers/[id]", "/crm/offers/categories", "/crm/offers/products/[id]", "/crm/page", "/crm/page/analytics", "/crm/page/schema-org", "/crm/salespeople", "/crm/salespeople/[id]/pricing", "/crm/settings", "/crm/settings/access-levels", "/crm/settings/compensation", "/crm/settings/email-accounts", "/crm/settings/email-signature", "/crm/settings/email-template", "/crm/settings/ksef", "/crm/settings/my-companies", "/crm/settings/my-companies/[id]/brandbook", "/crm/settings/my-companies/[id]/marketing", "/crm/settings/phase-types", "/crm/settings/scanners", "/crm/settings/skills", "/crm/settings/storage", "/crm/settings/system-health", "/crm/settings/webhooks", "/crm/settings/workflows", "/crm/subcontractors", "/crm/subcontractors/[id]", "/crm/subcontractors/new", "/crm/subcontractors/rental/[id]", "/crm/subcontractors/service/[id]", "/crm/tasks", "/crm/tasks/[id]", "/crm/tasks/mine", "/crm/tenders", "/crm/tenders/config", "/crm/time-tracking", "/crm/time-tracking/[employeeId]"];

const scopes = PERMISSION_SCOPE_GROUPS.flatMap(group => group.scopes);
export const ACCESS_SECTIONS = definitions.map(([key, label, paths]) => ({
  key, label, paths: catalogPages.filter(path => paths.some(root => path === root || path.startsWith(root + '/')) && !definitions.some(([otherKey, , otherPaths]) => otherKey !== key && otherPaths.some(other => paths.some(root => other.startsWith(root + '/')) && (path === other || path.startsWith(other + '/'))))),
  scopes: scopes.filter(scope => scope.key.startsWith(`${key}_`)),
}));

export function sectionPermissions(permissions: string[] | null, module: string): string[] {
  return (permissions || []).filter(scope => scope.startsWith(`${module}_`)).sort();
}
