import 'server-only';
import type { NativeContext } from './auth';
import { registerEventTab } from './eventTabs';
import { imageCrop } from './team';

/**
 * Zakładka „Historia” (`useEventAuditLog` + widok historii w `EventDetailPageClient`): 100 ostatnich wpisów
 * `event_audit_log` (RLS obszaru „oferta, umowa i formalności”), z tymi samymi etykietami akcji, kolorami, opisami pól
 * i wartościami „Przed / Po” (`formatAuditValue`). Czas względny i grupowanie po dniach liczy aplikacja.
 */

type Action =
  | 'create' | 'update' | 'delete' | 'status_changed' | 'vehicle_assigned' | 'vehicle_pickup' | 'vehicle_return'
  | 'equipment_added' | 'equipment_updated' | 'equipment_removed' | 'employee_added' | 'employee_removed'
  | 'offer_created' | 'offer_updated' | 'phase_created' | 'phase_updated' | 'phase_deleted'
  | 'file_uploaded' | 'file_deleted' | 'contract_generated' | 'other';

function normalize(action: string): Action {
  const a = action.toLowerCase().trim();
  if (['create', 'created'].includes(a)) return 'create';
  if (['update', 'updated'].includes(a)) return 'update';
  if (['delete', 'deleted'].includes(a)) return 'delete';
  if (a === 'status_changed') return 'status_changed';
  for (const key of ['vehicle_assigned', 'vehicle_pickup', 'vehicle_return', 'equipment_added', 'equipment_updated', 'equipment_removed',
    'employee_added', 'employee_removed', 'offer_created', 'offer_updated'] as const) if (a.includes(key)) return key;
  if (a.includes('phase')) {
    if (a.includes('created')) return 'phase_created';
    if (a.includes('updated')) return 'phase_updated';
    if (a.includes('deleted')) return 'phase_deleted';
  }
  for (const key of ['file_uploaded', 'file_deleted', 'contract_generated'] as const) if (a.includes(key)) return key;
  return 'other';
}

const ENTITY: Record<string, string> = {
  events: 'Wydarzenie', tasks: 'Zadanie', employee_assignments: 'Przypisanie pracownika', event_vehicles: 'Pojazd',
  vehicle_handovers: 'Przekazanie pojazdu', event_agendas: 'Agenda', event_agenda_items: 'Pozycja agendy', event_agenda_notes: 'Notatka agendy',
  event_equipment: 'Sprzęt', event_files: 'Plik', contracts: 'Umowa', offers: 'Oferta', event_phases: 'Faza wydarzenia',
};
const LABEL: Record<Action, string> = {
  create: 'Utworzono', update: 'Zaktualizowano', delete: 'Usunięto', status_changed: 'Zmieniono status', vehicle_assigned: 'Przypisano pojazd',
  vehicle_pickup: 'Odbiór pojazdu', vehicle_return: 'Zwrot pojazdu', equipment_added: 'Dodano sprzęt', equipment_updated: 'Zaktualizowano sprzęt',
  equipment_removed: 'Usunięto sprzęt', employee_added: 'Dodano pracownika', employee_removed: 'Usunięto pracownika', offer_created: 'Utworzono ofertę',
  offer_updated: 'Zaktualizowano ofertę', phase_created: 'Utworzono fazę', phase_updated: 'Zaktualizowano fazę', phase_deleted: 'Usunięto fazę',
  file_uploaded: 'Dodano plik', file_deleted: 'Usunięto plik', contract_generated: 'Wygenerowano umowę', other: 'Inna akcja',
};
const COLOR: Record<string, string> = {
  status_changed: 'purple', vehicle_assigned: 'cyan', vehicle_pickup: 'teal', vehicle_return: 'teal', employee_removed: 'orange', contract_generated: 'purple',
};
const ICON: Record<string, string> = {
  status_changed: 'arrow.triangle.2.circlepath', vehicle_assigned: 'truck.box', vehicle_pickup: 'arrow.down.to.line', vehicle_return: 'arrow.up.to.line',
  equipment_updated: 'shippingbox', offer_created: 'doc.text', offer_updated: 'doc.badge.gearshape', phase_created: 'calendar',
  phase_updated: 'calendar.badge.clock', phase_deleted: 'calendar.badge.minus', file_uploaded: 'square.and.arrow.up', file_deleted: 'doc.badge.minus',
  contract_generated: 'signature',
};

/** `getActionColor` / `getActionIcon`: najpierw dopasowanie do utworzenia, aktualizacji i usunięcia. */
const color = (a: Action) => (a.includes('create') || a.includes('added') ? 'green' : a.includes('update') ? 'blue' : a.includes('delete') || a.includes('removed') ? 'red' : COLOR[a] || 'gray');
const icon = (a: Action) => (a.includes('create') || a.includes('added') ? 'plus' : a.includes('update') ? 'pencil' : a.includes('delete') || a.includes('removed') ? 'trash' : ICON[a] || 'waveform.path.ecg');

const FIELD: Record<string, string> = {
  name: 'Nazwa', title: 'Tytuł', description: 'Opis', event_date: 'Data wydarzenia', location: 'Lokalizacja', status: 'Status', budget: 'Budżet',
  notes: 'Notatki', client_type: 'Typ klienta', requires_subcontractors: 'Wymaga podwykonawców',
};

/** `formatValue` z hooka (opis zmiany pola). */
function plain(value: unknown): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

const warsaw = (value: string, options: Intl.DateTimeFormatOptions) => new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', ...options });

/** `formatAuditValue`: z obiektu tylko czytelna wartość (treść, tytuł, nazwa, termin), inne obiekty — „-”. */
function shown(value: any): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (typeof value === 'object') {
    if (value.content) return String(value.content);
    if (value.title) return String(value.title);
    if (value.name) return String(value.name);
    if (value.text) return String(value.text);
    if (value.event_date || value.event_end_date) {
      const start = value.event_date ? warsaw(value.event_date, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
      const startTime = value.event_date ? warsaw(value.event_date, { hour: '2-digit', minute: '2-digit' }) : '';
      const endTime = value.event_end_date ? warsaw(value.event_end_date, { hour: '2-digit', minute: '2-digit' }) : '';
      return startTime && endTime ? `${start} godz. ${startTime} - ${endTime}` : start;
    }
    return '-';
  }
  return String(value);
}

async function historyTab(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('event_audit_log')
    .select('*, employee:employees!event_audit_log_employee_id_fkey(id,name,surname,nickname,avatar_url,avatar_metadata,occupation,email)')
    .eq('event_id', eventId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return {
    entries: (data || []).map((entry: any) => {
      const action = normalize(String(entry.action || ''));
      const employee = Array.isArray(entry.employee) ? entry.employee[0] : entry.employee;
      const user = employee
        ? `${employee.name ?? ''} ${employee.surname ?? ''}${employee.nickname ? ` (${employee.nickname})` : ''}`.trim()
        : entry.user_name || 'System';
      let description = entry.description || '';
      if (!description && entry.field_name) {
        description = `Zmieniono ${FIELD[entry.field_name] || entry.field_name}`;
        if (entry.old_value !== null && entry.new_value !== null) description += `: ${plain(entry.old_value)} → ${plain(entry.new_value)}`;
      }
      const hasChanges = entry.old_value !== null || entry.new_value !== null;
      return {
        id: entry.id, action, label: LABEL[action] || 'Zmiana', color: color(action), icon: icon(action),
        entity: entry.entity_type ? ENTITY[entry.entity_type] || entry.entity_type : null, user, userKey: entry.employee_id || entry.user_id || user,
        employee: employee
          ? { id: employee.id, name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(), occupation: employee.occupation ?? null, email: employee.email ?? null,
              avatarUrl: employee.avatar_url ?? null, avatar: imageCrop(employee.avatar_metadata) }
          : null,
        description, createdAt: entry.created_at,
        showChanges: hasChanges && entry.action !== 'created' && entry.action !== 'deleted',
        before: entry.old_value !== null && entry.old_value !== undefined ? shown(entry.old_value) : null,
        after: entry.new_value !== null && entry.new_value !== undefined ? shown(entry.new_value) : null,
      };
    }),
  };
}

registerEventTab('history', historyTab);
