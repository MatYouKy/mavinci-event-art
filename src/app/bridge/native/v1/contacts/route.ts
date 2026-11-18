import { can, nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { contactsItems, contactsState, invalidateContacts } from '@/lib/native/contacts';
import {
  CardFailure, contactCard, createEntity, createSegment, decisionMaker, invoiceBuyers, linkContact, linkNewContact, mergeContacts,
  organizationNote, quickContact, saveDomains, saveOwnership, saveSegmentation, searchLocations, unlinkContact, updateOrganization,
} from '@/lib/native/contactCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Kontakty dla aplikacji na Maca — lista jak `/crm/contacts`, karta i zapisy jak `/crm/contacts/[id]` i `/crm/contacts/new`
 * (`src/lib/native/contactCard.ts`: dane karty, osoby kontaktowe, reprezentanci, notatki, dane do faktury, lokalizacja,
 * opiekun, segmentacja, domeny, scalanie, dodawanie). Tokenem pracownika — RLS i wyzwalacze jak w przeglądarce.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400, fieldErrors?: Record<string, string>, extra?: Record<string, unknown>) =>
  nativeJson({ error: message, ...(fieldErrors ? { fieldErrors } : {}), ...(extra || {}) }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const allowed = (ctx: NativeContext) => can(ctx.employee, 'contacts_view') || can(ctx.employee, 'contacts_manage');
const handled = (error: unknown, op: string, fallback: string) => {
  if (error instanceof CardFailure) return failure(error.message, error.status, error.fieldErrors, error.extra);
  console.error('[native-contacts]', op, error);
  return failure(errorText(error, fallback), 500);
};

/** Pola karty kontaktu edytowane w CRM (zakładka „Dane kontaktowe”); PESEL i numer dowodu — osoba prywatna. */
const CONTACT_KEYS = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'position', 'business_phone', 'city', 'postal_code',
  'address', 'nip', 'alternative_contact_name', 'event_type', 'event_details', 'notes', 'pesel', 'id_number'];

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do kontaktów.', 403);
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || '';
  try {
    switch (op) {
      case 'state':
        return nativeJson({
          ...(await contactsState(ctx, url.searchParams.get('hash') || undefined)),
          access: {
            canManage: can(ctx.employee, 'contacts_manage'),
            // Jak „Nowy kontakt” i „Edytuj” w CRM: każdy z dostępem do kontaktów; zapis rozstrzyga baza (RLS).
            canCreate: true,
            canEdit: true,
            isAdmin: ctx.employee.isAdmin,
          },
        });
      case 'card':
        return nativeJson(await contactCard(ctx, url.searchParams.get('kind') || '', url.searchParams.get('id') || ''));
      case 'buyers':
        return nativeJson(await invoiceBuyers(ctx));
      case 'locations':
        return nativeJson(await searchLocations(ctx, url.searchParams.get('q') || ''));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    return handled(error, op, 'Nie udało się pobrać kontaktów.');
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do kontaktów.', 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const id = String(body.id || '');
  const organization = body.kind === 'organization';
  try {
    switch (op) {
      case 'items':
        return nativeJson(await contactsItems(ctx, Array.isArray(body.buckets) ? body.buckets : []));

      case 'update': {
        if (!uuid.test(id)) return failure('Nieprawidłowy kontakt.');
        const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
        if (organization) return nativeJson(await updateOrganization(ctx, id, data));
        const { data: current, error: readError } = await ctx.supabase.from('contacts').select('id,contact_type').eq('id', id).maybeSingle();
        if (readError) throw readError;
        if (!current) return failure('Nie znaleziono kontaktu lub nie masz do niego dostępu.', 404);
        const update: Record<string, unknown> = Object.fromEntries(
          CONTACT_KEYS.filter((key) => key in data).map((key) => {
            const value = typeof data[key] === 'string' ? (data[key] as string).trim() : data[key];
            return [key, value === '' ? null : value];
          }),
        );
        if (!update.first_name && !update.last_name && ('first_name' in update || 'last_name' in update)) return failure('Wpisz imię lub nazwisko.', 400, { first_name: 'Wpisz imię lub nazwisko.' });
        if (typeof update.email === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)) return failure('Wpisz poprawny adres e-mail.', 400, { email: 'Wpisz poprawny adres e-mail.' });
        if (current.contact_type === 'individual') { update.nip = null; update.position = null; update.business_phone = null; }
        else { delete update.alternative_contact_name; delete update.pesel; delete update.id_number; }
        const { data: saved, error } = await ctx.supabase.from('contacts')
          .update({ ...update, updated_at: new Date().toISOString() }).eq('id', id).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas zapisywania'));
        if (!saved?.length) return failure('Nie masz uprawnień do zmiany tego kontaktu.', 403);
        invalidateContacts();
        return nativeJson({ ok: true });
      }

      case 'delete': {
        if (!uuid.test(id)) return failure('Nieprawidłowy kontakt.');
        const { data: removed, error } = await ctx.supabase.from(organization ? 'organizations' : 'contacts').delete().eq('id', id).select('id');
        if (error) return failure(error.code === '23503'
          ? `Nie można usunąć — ${organization ? 'organizacja' : 'kontakt'} ma powiązane dokumenty, zapytania lub realizacje.`
          : errorText(error, 'Błąd podczas usuwania'));
        if (!removed?.length) return failure('Nie masz uprawnień do usunięcia.', 403);
        invalidateContacts();
        return nativeJson({ ok: true });
      }

      case 'create':
        return nativeJson(await createEntity(ctx, body));
      case 'quickContact':
        return nativeJson(await quickContact(ctx, body.data && typeof body.data === 'object' ? body.data : {}));
      case 'link':
        return nativeJson(await linkContact(ctx, body));
      case 'linkNew':
        return nativeJson(await linkNewContact(ctx, body));
      case 'unlink':
        return nativeJson(await unlinkContact(ctx, String(body.relationId || '')));
      case 'decisionMaker':
        return nativeJson(await decisionMaker(ctx, body));
      case 'note':
        return nativeJson(await organizationNote(ctx, body));
      case 'ownership':
        return nativeJson(await saveOwnership(ctx, body));
      case 'domains':
        return nativeJson(await saveDomains(ctx, body));
      case 'segmentation':
        return nativeJson(await saveSegmentation(ctx, body));
      case 'segmentCreate':
        return nativeJson(await createSegment(ctx, body));
      case 'mergePreview':
        return nativeJson(await mergeContacts(ctx, body, true));
      case 'merge':
        return nativeJson(await mergeContacts(ctx, body, false));

      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    return handled(error, op, 'Serwer nie wykonał operacji.');
  }
}
