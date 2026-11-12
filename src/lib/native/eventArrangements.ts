import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventTab } from './eventTabs';

/**
 * Ustalenia sprzedawcy dla zespołu realizacji (karta „Ustalenia” w Przeglądzie i paski w zakładkach Harmonogram, Agenda,
 * Sprzęt, Logistyka, Zespół): ustalenia ofert powiązanych z wydarzeniem bez kwot (`get_event_arrangements`) i potwierdzenie
 * zapoznania się z nimi (`acknowledge_event_arrangements`, z rewizją ustaleń). Kierownik realizacji z
 * `get_event_realization_assignment`. Bez migracji 20261111220000_event_arrangements_handoff.sql — komunikat zamiast danych.
 */

const MIGRATION = 'Ustalenia w karcie wydarzenia wymagają migracji 20261111220000_event_arrangements_handoff.sql (uruchom ją w Supabase).';

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function shape(ctx: NativeContext, data: any, leadership: any) {
  const offers = (Array.isArray(data?.offers) ? data.offers : []).map((o: any) => ({
    offerId: String(o.offer_id), number: text(o.offer_number), title: text(o.title), status: text(o.status),
    revision: Number(o.revision || 0), updatedAt: text(o.updated_at), updatedBy: text(o.updated_by_name),
    room: text(o.room), participants: o.participant_count == null ? null : Number(o.participant_count),
    setupAt: text(o.setup_at), startsAt: text(o.starts_at), endsAt: text(o.ends_at), teardownAt: text(o.teardown_at),
    materialsDue: text(o.materials_due_date), technical: text(o.technical_requirements), logistics: text(o.logistics_requirements),
    contacts: (Array.isArray(o.contacts) ? o.contacts : []).map((c: any) => ({
      name: text(c?.name), role: text(c?.role), phone: text(c?.phone), email: text(c?.email),
    })).filter((c: any) => c.name || c.phone || c.email),
    days: (Array.isArray(o.event_days) ? o.event_days : []).map((d: any) => ({ date: text(d?.date), start: text(d?.start_time), end: text(d?.end_time) }))
      .filter((d: any) => d.date),
    venue: o.venue ? {
      name: text(o.venue.location_name) || text(o.venue.organization_name), room: text(o.venue.room), technical: text(o.venue.technical_details),
    } : null,
    acknowledgements: (Array.isArray(o.acknowledgements) ? o.acknowledgements : []).map((a: any) => ({
      employeeId: String(a.employee_id), name: text(a.name), revision: Number(a.revision || 0), at: text(a.acknowledged_at),
    })),
  }));
  const managerId = text(leadership?.realization?.manager_id);
  return { available: true, message: null, offers, managerId, me: ctx.employee.id };
}

async function arrangementsTab(ctx: NativeContext, eventId: string) {
  const [result, leadership] = await Promise.all([
    ctx.supabase.rpc('get_event_arrangements', { p_event: eventId }),
    ctx.supabase.rpc('get_event_realization_assignment', { p_event_id: eventId }),
  ]);
  if (result.error) {
    const missing = result.error.code === 'PGRST202' || result.error.code === '42883' || /get_event_arrangements/.test(result.error.message || '');
    return { available: false, message: missing ? MIGRATION : result.error.message || 'Nie udało się wczytać ustaleń.', offers: [], managerId: null, me: ctx.employee.id };
  }
  return shape(ctx, result.data, leadership.error ? null : leadership.data);
}

registerEventTab('arrangements', arrangementsTab);

async function acknowledge(ctx: NativeContext, eventId: string) {
  const { error } = await ctx.supabase.rpc('acknowledge_event_arrangements', { p_event: eventId });
  if (error) throw new Error(error.code === 'PGRST202' ? MIGRATION : error.message || 'Nie udało się potwierdzić ustaleń.');
  return { ok: true };
}

registerEventActions('arrangements', { acknowledge });
