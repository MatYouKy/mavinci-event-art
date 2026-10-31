// Polskie etykiety ról — ten sam słownik co src/lib/ui/systemLabels.ts (role) w CRM.
// Nie wyświetlamy surowych kodów z bazy (zasada z AGENTS.md).
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator', administrator: 'Administrator', manager: 'Menedżer', event_manager: 'Kierownik wydarzenia',
  sales: 'Sprzedaż', salesperson: 'Sprzedawca', seller: 'Sprzedawca', sales_manager: 'Kierownik sprzedaży',
  logistics: 'Logistyka', technician: 'Technik', support: 'Wsparcie', freelancer: 'Współpracownik',
  dj: 'DJ', mc: 'Konferansjer', host: 'Prowadzący', assistant: 'Asystent', unassigned: 'Nieprzypisany',
  driver: 'Kierowca', coordinator: 'Koordynator', organizer: 'Organizator', owner: 'Opiekun',
  employee: 'Pracownik', staff: 'Obsługa', subcontractor: 'Podwykonawca', operator: 'Operator',
  sound_engineer: 'Realizator dźwięku', lighting_technician: 'Technik oświetlenia',
  sound_technician: 'Technik dźwięku', photographer: 'Fotograf', videographer: 'Operator kamery',
  instructor: 'Instruktor', animator: 'Animator', security: 'Ochrona', other: 'Inna rola',
};

export const roleLabel = (code: string | null | undefined) => (code ? ROLE_LABELS[code] || 'Inna rola' : '');
