import { can, nativeContext, nativeJson, nativeUnauthorized, readJson, type NativeContext } from '@/lib/native/auth';
import { contactsItems, contactsState, invalidateContacts } from '@/lib/native/contacts';
import { organizationFormPayload, validateOrganizationForm } from '@/components/crm/contacts/organization/organizationValidation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Kontakty dla aplikacji na Maca — lista jak `/crm/contacts`, zapisy jak karta kontaktu i organizacji
 * (`/crm/contacts/[id]`: `handleSaveContact`, `handleSave` z `validateOrganizationForm` i `organizationFormPayload`, usuwanie).
 * Tokenem pracownika — RLS jak w przeglądarce.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400, fieldErrors?: Record<string, string>) =>
  nativeJson({ error: message, ...(fieldErrors ? { fieldErrors } : {}) }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const allowed = (ctx: NativeContext) => can(ctx.employee, 'contacts_view') || can(ctx.employee, 'contacts_manage');

/** Pola karty kontaktu edytowane w CRM (zakładka „Dane kontaktowe”). */
const CONTACT_KEYS = ['first_name', 'last_name', 'email', 'phone', 'mobile', 'position', 'business_phone', 'city', 'postal_code',
  'address', 'nip', 'alternative_contact_name', 'event_type', 'event_details', 'notes'];
/** Pola organizacji edytowane w aplikacji — reszta (reprezentacja, nabywca faktur, lokalizacja…) zostaje bez zmian. */
const ORG_KEYS = ['name', 'alias', 'business_type', 'legal_form', 'nip', 'krs', 'regon', 'email', 'phone', 'website', 'address', 'city',
  'postal_code', 'country', 'rating', 'status'];

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!allowed(ctx)) return failure('Nie masz dostępu do kontaktów.', 403);
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('op') !== 'state') return failure('Nieznana operacja.');
    return nativeJson({
      ...(await contactsState(ctx, url.searchParams.get('hash') || undefined)),
      access: {
        canManage: can(ctx.employee, 'contacts_manage'),
        canCreate: can(ctx.employee, 'contacts_manage') || can(ctx.employee, 'contacts_create'),
        isAdmin: ctx.employee.isAdmin,
      },
    });
  } catch (error) {
    console.error('[native-contacts]', error);
    return failure(errorText(error, 'Nie udało się pobrać kontaktów.'), 500);
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
        if (organization) {
          const { data: current, error: readError } = await ctx.supabase.from('organizations').select('*').eq('id', id).maybeSingle();
          if (readError) throw readError;
          if (!current) return failure('Nie znaleziono organizacji lub nie masz do niej dostępu.', 404);
          const edits = Object.fromEntries(ORG_KEYS.filter((key) => key in data).map((key) => [key, data[key] === '' ? null : data[key]]));
          const { isValid, validatedData, errors } = await validateOrganizationForm({ ...current, ...edits } as never);
          if (!isValid || !validatedData) return failure('Popraw wymagane pola formularza', 400, errors as Record<string, string>);
          const { data: saved, error } = await ctx.supabase.from('organizations')
            .update({ ...organizationFormPayload(validatedData), updated_at: new Date().toISOString() } as never)
            .eq('id', id).select('id');
          if (error) return failure(errorText(error, 'Błąd podczas zapisywania'));
          if (!saved?.length) return failure('Nie masz uprawnień do zmiany tej organizacji.', 403);
          invalidateContacts();
          return nativeJson({ ok: true });
        }
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
        else delete update.alternative_contact_name;
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

      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-contacts]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
