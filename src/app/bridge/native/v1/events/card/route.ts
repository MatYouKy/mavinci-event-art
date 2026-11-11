import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { invalidateEvents } from '@/lib/native/events';
import { eventsAccess } from '@/lib/native/events';
import {
  EVENT_CARD_RPCS, addTeamMember, duplicateEvent, eventTeamCandidates, eventTeamWithHash, saveTeamPermissions, sendTeamInvitation, equipmentChecklistUrl, eventCardDetailsWithHash, eventCardOverviewWithHash, eventCardPageWithHash, eventConfirmationPreview,
  eventLocations, realizationAssetUrls, realizationCompanies, realizationFileUrl, sendEventConfirmation,
} from '@/lib/native/eventCard';
import { EVENT_STEPS_HELP, EVENT_STEPS_RULES } from '@/lib/events/steps/eventSteps';
import { applyTravelTimes, eventMutate, eventTabAction, eventTabQuery, eventTabWithHash, isEventTab, phaseOptions, vehicleConflicts } from '@/lib/native/eventTabs';
// Moduły zakładek rejestrują swoje dane, zapisy i odczyty w `eventTabs.ts` przy imporcie.
import { uploadReturnPhoto } from '@/lib/native/eventEquipment';
import '@/lib/native/eventLogistics';
import '@/lib/native/eventAgenda';
import '@/lib/native/eventWedding';
import '@/lib/native/eventFiles';
import '@/lib/native/eventSubcontractors';
import '@/lib/native/eventOffer';
import '@/lib/native/eventHistory';
import '@/lib/native/eventSettlement';
import '@/lib/native/eventFinances';
import '@/lib/native/eventSeller';
import '@/lib/native/eventCalculations';
import '@/lib/native/eventContract';
import '@/lib/native/eventClientLocation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Karta wydarzenia dla aplikacji na Maca: `GET ?id=<uuid>&hash=<skrót u Maca>` — dane jak strona `/crm/events/[id]`
 * (`src/lib/native/eventCard.ts`), tokenem pracownika (RLS jak w przeglądarce).
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!eventsAccess(ctx).canView) return nativeJson({ error: 'Nie masz dostępu do wydarzeń.' }, 403);
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!uuid.test(id)) return nativeJson({ error: 'Nieprawidłowe wydarzenie.' }, 400);
  try {
    if (url.searchParams.get('op') === 'stepsHelp') return nativeJson({ help: EVENT_STEPS_HELP, rules: EVENT_STEPS_RULES });
    if (url.searchParams.get('op') === 'overview') {
      const result = await eventCardOverviewWithHash(ctx, id, url.searchParams.get('hash'), {
        canManage: url.searchParams.get('manage') === '1', canSeeOnsite: url.searchParams.get('onsite') === '1',
      });
      return nativeJson(result);
    }
    switch (url.searchParams.get('op')) {
      case 'details': {
        const result = await eventCardDetailsWithHash(ctx, id, url.searchParams.get('hash'), {
          canManageStatus: url.searchParams.get('status') === '1', canEquipment: url.searchParams.get('equipment') === '1',
        });
        return result ? nativeJson(result) : nativeJson({ error: 'Nie znaleziono wydarzenia albo nie masz do niego dostępu.' }, 404);
      }
      case 'companies': return nativeJson({ companies: await realizationCompanies(ctx) });
      case 'locations': return nativeJson({ locations: await eventLocations(ctx) });
      case 'confirmationPreview':
        try {
          return nativeJson({ preview: await eventConfirmationPreview(ctx, id) });
        } catch (error) {
          return nativeJson({ error: (error as Error).message || 'Nie udało się odczytać odbiorcy.' }, 400);
        }
      case 'tabQuery':
        try {
          return nativeJson(await eventTabQuery(ctx, id, url.searchParams));
        } catch (error) {
          return nativeJson({ error: (error as Error).message || 'Nie udało się pobrać danych.' }, 400);
        }
      case 'tab': {
        const tab = url.searchParams.get('tab') || '';
        if (!isEventTab(tab)) return nativeJson({ error: 'Nieznana zakładka.' }, 400);
        return nativeJson(await eventTabWithHash(ctx, id, tab, url.searchParams.get('hash')));
      }
      case 'phaseOptions':
        return nativeJson(await phaseOptions(ctx, id, url.searchParams.get('kind') === 'vehicles' ? 'vehicles' : 'employees'));
      case 'vehicleConflicts':
        return nativeJson({ conflicts: await vehicleConflicts(ctx, id, url.searchParams.get('vehicleId') || '', url.searchParams.get('start') || '', url.searchParams.get('end') || '') });
      case 'team': return nativeJson(await eventTeamWithHash(ctx, id, url.searchParams.get('hash')));
      case 'teamCandidates': return nativeJson(await eventTeamCandidates(ctx, id));
      case 'realizationAssets': return nativeJson({ urls: (await realizationAssetUrls(ctx, id)) ?? {} });
      case 'realizationFile': {
        try {
          const file = await realizationFileUrl(ctx, id, url.searchParams.get('fileId') || '');
          if (!file) return nativeJson({ error: 'Nie znaleziono pliku.' }, 404);
          return file.url ? nativeJson(file) : nativeJson({ error: 'Brak adresu pliku.' }, 404);
        } catch (error) {
          return nativeJson({ error: (error as Error).message || 'Nie udało się otworzyć pliku.' }, 400);
        }
      }
      case 'checklist': {
        const file = await equipmentChecklistUrl(ctx, id);
        return file?.url ? nativeJson(file) : nativeJson({ error: 'Brak checklisty sprzętu do wydruku' }, 404);
      }
    }
    const result = await eventCardPageWithHash(ctx, id, url.searchParams.get('hash'));
    return result ? nativeJson(result) : nativeJson({ error: 'Nie znaleziono wydarzenia albo nie masz do niego dostępu.' }, 404);
  } catch (error) {
    console.error('[native-event-card]', error);
    return nativeJson({ error: (error as { message?: string })?.message || 'Nie udało się pobrać wydarzenia.' }, 500);
  }
}

/** Pola wydarzenia zmieniane z karty (zakładka Szczegóły: termin, lokalizacja z salami, opis, notatki, firma realizująca). */
/** Statusy z listy „Status eventu” (`eventStatusLabels`). */
const DETAILS_STATUSES = ['inquiry', 'offer_to_send', 'offer_sent', 'offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'cancelled', 'invoiced', 'settled'];

const EVENT_KEYS = ['event_date', 'event_end_date', 'location_id', 'location', 'location_room_ids', 'stage_room_id', 'description', 'notes', 'my_company_id'];

/**
 * Zapisy z karty jak w CRM: `update` (`useEvent.updateEvent` — `events.update`, RLS), `invitation` (zaproszenie do zespołu:
 * przyjęcie / odrzucenie własnego przypisania w statusie „pending”).
 */
export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!eventsAccess(ctx).canView) return nativeJson({ error: 'Nie masz dostępu do wydarzeń.' }, 403);
  // Zdjęcie zwrotu sprzętu (multipart: `file`, `line`, `ok`, `damaged`, `note`, `photos`) — przed odczytem JSON.
  const query = new URL(request.url).searchParams;
  if (query.get('op') === 'equipmentPhoto') {
    const eventId = query.get('id') || '';
    if (!uuid.test(eventId)) return nativeJson({ error: 'Nieprawidłowe wydarzenie.' }, 400);
    try {
      const result = await uploadReturnPhoto(ctx, eventId, await request.formData());
      invalidateEvents();
      return nativeJson(result);
    } catch (error) {
      return nativeJson({ error: (error as Error).message || 'Nie udało się wysłać zdjęcia.' }, 400);
    }
  }
  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  }
  const id = String(body.id || '');
  // RPC karty (kroki, magazyn, realizacja) — jak `supabase.rpc` w przeglądarce; błąd z bazy wraca z kodem i komunikatem.
  if (body.op === 'rpc') {
    const name = String(body.name || '');
    if (!EVENT_CARD_RPCS.has(name)) return nativeJson({ error: 'Niedozwolona operacja.' }, 400);
    const params = body.params && typeof body.params === 'object' ? body.params : {};
    const { data, error } = await ctx.supabase.rpc(name, params);
    if (error) return nativeJson({ error: error.message || 'Operacja nie powiodła się.', code: error.code ?? null }, 400);
    invalidateEvents();
    return nativeJson({ data: data ?? null });
  }
  if (!uuid.test(id)) return nativeJson({ error: 'Nieprawidłowe wydarzenie.' }, 400);
  try {
    if (body.op === 'update') {
      const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
      const changes = Object.fromEntries(Object.entries(data).filter(([key]) => EVENT_KEYS.includes(key)));
      if (!Object.keys(changes).length) return nativeJson({ error: 'Brak zmian.' }, 400);
      const { data: rows, error } = await ctx.supabase.from('events').update(changes).eq('id', id).select('id');
      if (error) return nativeJson({ error: `Błąd: ${error.message}` }, 400);
      if (!rows?.length) return nativeJson({ error: 'Nie masz uprawnień do zmiany tego wydarzenia.' }, 403);
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    // Szczegóły → Akcje: status (`handleStatusChange` — statusy magazynu ustawia magazyn; „Rozliczony” oznacza faktury jako zapłacone).
    if (body.op === 'detailsStatus') {
      const status = String(body.status || '');
      const previous = String(body.previous || '');
      if (!DETAILS_STATUSES.includes(status)) return nativeJson({ error: 'Nieznany status.' }, 400);
      if (status !== previous && ['in_preparation', 'ready_for_live'].includes(status)) {
        return nativeJson({ error: 'Ten status ustawia magazyn podczas przygotowania realizacji.' }, 400);
      }
      const now = new Date().toISOString();
      const { data: rows, error } = await ctx.supabase.from('events').update({ status, updated_at: now }).eq('id', id).select('id');
      if (error) return nativeJson({ error: error.message || 'Błąd podczas zmiany statusu' }, 400);
      if (!rows?.length) return nativeJson({ error: 'Nie masz uprawnień do zmiany statusu tego wydarzenia.' }, 403);
      if (status === 'settled' && previous !== 'settled') {
        const { error: invoiceError } = await ctx.supabase.from('invoices')
          .update({ status: 'paid', payment_status: 'paid', paid_at: now, updated_at: now })
          .eq('event_id', id).not('status', 'in', '("paid","cancelled")').neq('invoice_type', 'proforma')
          .or('is_proforma.is.null,is_proforma.eq.false');
        if (invoiceError) console.warn('[native-event-card] invoices → paid', invoiceError);
      }
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    if (body.op === 'category') {
      const categoryId = body.categoryId ? String(body.categoryId) : null;
      if (categoryId && !uuid.test(categoryId)) return nativeJson({ error: 'Nieprawidłowa kategoria.' }, 400);
      const { data: rows, error } = await ctx.supabase.from('events')
        .update({ category_id: categoryId, updated_at: new Date().toISOString() }).eq('id', id).select('id');
      if (error) return nativeJson({ error: error.message || 'Błąd podczas zmiany kategorii' }, 400);
      if (!rows?.length) return nativeJson({ error: 'Nie masz uprawnień do zmiany tego wydarzenia.' }, 403);
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    if (body.op === 'company') {
      const companyId = String(body.companyId || '');
      if (!uuid.test(companyId)) return nativeJson({ error: 'Wybierz firmę realizującą.' }, 400);
      const { data: rows, error } = await ctx.supabase.from('events').update({ my_company_id: companyId }).eq('id', id).select('id');
      if (error) return nativeJson({ error: error.message }, 400);
      if (!rows?.length) return nativeJson({ error: 'Nie masz uprawnień do zmiany tego wydarzenia.' }, 403);
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    // Sale wydarzenia (`EventRooms`): zapis tylko, gdy wybór w bazie jest wciąż taki, jak przy otwarciu edycji.
    if (body.op === 'rooms') {
      const locationId = String(body.locationId || '');
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const originalIds = Array.isArray(body.originalIds) ? body.originalIds.map(String) : [];
      const stage = body.stage ? String(body.stage) : null;
      const originalStage = body.originalStage ? String(body.originalStage) : null;
      if (!uuid.test(locationId)) return nativeJson({ error: 'Nieprawidłowa lokalizacja.' }, 400);
      let query = ctx.supabase.from('events').update({ location_room_ids: ids, stage_room_id: stage })
        .eq('id', id).eq('location_id', locationId).eq('location_room_ids', `{${originalIds.join(',')}}`);
      query = originalStage ? query.eq('stage_room_id', originalStage) : query.is('stage_room_id', null);
      const { data, error } = await query.select('id').maybeSingle();
      if (error) return nativeJson({ error: error.message || 'Nie udało się zapisać sal.' }, 400);
      if (!data) return nativeJson({ error: 'Dane wydarzenia zmieniły się lub nie masz uprawnień. Odśwież stronę.' }, 409);
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    if (body.op === 'sendConfirmation') {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
      try {
        const result = await sendEventConfirmation(ctx, token, id, String(body.expectedRecipientEmail || ''));
        return nativeJson(result);
      } catch (error) {
        return nativeJson({ error: (error as Error).message || 'Nie udało się wysłać potwierdzenia' }, 400);
      }
    }
    if (body.op === 'duplicate') {
      try {
        const newId = await duplicateEvent(ctx, id);
        invalidateEvents();
        return nativeJson({ ok: true, id: newId });
      } catch (error) {
        console.error('[native-event-card] duplicate', error);
        return nativeJson({ error: 'Wystąpił błąd podczas duplikowania' }, 400);
      }
    }
    // Zapisy zakładek (lista dozwolonych tabel i kolumn w `eventTabs.ts`) i „Zastosuj czasy przejazdu z logistyki”.
    if (body.op === 'mutate') {
      try {
        const row = await eventMutate(ctx, id, body);
        invalidateEvents();
        return nativeJson({ ok: true, row });
      } catch (error) {
        return nativeJson({ error: (error as Error).message || 'Nie udało się zapisać zmian.' }, 400);
      }
    }
    // Czynności zakładek (`registerEventActions` w modułach zakładek: Sprzęt, Logistyka, …).
    if (body.op === 'tabAction') {
      try {
        const result = await eventTabAction(ctx, id, body);
        invalidateEvents();
        return nativeJson(result ?? { ok: true });
      } catch (error) {
        const fieldErrors = (error as { fieldErrors?: Record<string, string> })?.fieldErrors;
        return nativeJson({
          error: (error as Error).message || (error as { message?: string })?.message || 'Nie udało się zapisać zmian.',
          ...(fieldErrors ? { fieldErrors } : {}),
        }, 400);
      }
    }
    if (body.op === 'applyTravel') {
      try {
        const result = await applyTravelTimes(ctx, id);
        invalidateEvents();
        return nativeJson(result);
      } catch (error) {
        return nativeJson({ error: (error as Error).message || 'Nie udało się zastosować czasów przejazdu.' }, 400);
      }
    }
    // Zespół (`TeamMembersList`, `AddEventEmployeeModal`, usuwanie z karty).
    if (body.op === 'teamAdd') {
      if (!uuid.test(String(body.employeeId || ''))) return nativeJson({ error: 'Wybierz pracownika' }, 400);
      try {
        await addTeamMember(ctx, id, body);
      } catch (error) {
        return nativeJson({ error: `Błąd: ${(error as Error).message}` }, 400);
      }
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    if (['teamUpdate', 'teamPermissions', 'teamRemove', 'teamInvite'].includes(body.op)) {
      const assignmentId = String(body.assignmentId || '');
      if (!uuid.test(assignmentId)) return nativeJson({ error: 'Nieprawidłowe przypisanie.' }, 400);
      if (body.op === 'teamInvite') {
        const mode = body.mode === 'timeline_update' ? 'timeline_update' : 'invitation';
        const result = await sendTeamInvitation(ctx, assignmentId, body.includePhases === true, mode);
        if (!result.ok) {
          return nativeJson({ error: mode === 'timeline_update'
            ? 'Nie wysłano harmonogramu. Sprawdź, czy pracownik ma przypisaną co najmniej jedną fazę.'
            : 'Błąd podczas wysyłania zaproszenia' }, 400);
        }
        invalidateEvents();
        return nativeJson(result);
      }
      if (body.op === 'teamPermissions') {
        try {
          await saveTeamPermissions(ctx, assignmentId, body.permissions && typeof body.permissions === 'object' ? body.permissions : {});
        } catch {
          return nativeJson({ error: 'Błąd podczas aktualizacji uprawnień' }, 400);
        }
        return nativeJson({ ok: true });
      }
      // Jak w CRM: o wyniku decyduje błąd z bazy (RLS), bez dodatkowego odczytu zmienionego wiersza.
      const { error } = body.op === 'teamRemove'
        ? await ctx.supabase.from('employee_assignments').delete().eq('id', assignmentId).eq('event_id', id)
        : await ctx.supabase.from('employee_assignments')
          .update({ role: String(body.role ?? ''), responsibilities: String(body.responsibilities ?? '') })
          .eq('id', assignmentId).eq('event_id', id);
      if (error) return nativeJson({ error: body.op === 'teamRemove' ? 'Błąd podczas usuwania pracownika' : 'Błąd podczas aktualizacji' }, 400);
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    if (body.op === 'invitation') {
      const accept = body.accept === true;
      const { data: rows, error } = await ctx.supabase.from('employee_assignments')
        .update({ status: accept ? 'accepted' : 'rejected', responded_at: new Date().toISOString() })
        .eq('event_id', id).eq('employee_id', ctx.employee.id).eq('status', 'pending').select('id');
      if (error) return nativeJson({ error: error.message }, 400);
      if (!rows?.length) return nativeJson({ error: 'Już odpowiedziałeś na to zaproszenie' }, 409);
      invalidateEvents();
      return nativeJson({ ok: true });
    }
    return nativeJson({ error: 'Nieznana operacja.' }, 400);
  } catch (error) {
    console.error('[native-event-card]', body.op, error);
    return nativeJson({ error: (error as { message?: string })?.message || 'Serwer nie wykonał operacji.' }, 500);
  }
}
