import { randomUUID } from 'node:crypto';
import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { invalidateTeam, teamAccess } from '@/lib/native/team';
import {
  emailAccounts, employeePermissions, qualifications, saveCertification, saveLicense, savePermissions, savePersonalAccount, saveSkill,
} from '@/lib/native/teamProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Zakładki karty pracownika w aplikacji na Maca: Kwalifikacje, Konta Email, Uprawnienia (`src/lib/native/teamProfile.ts`).
 * Zapisy jak w CRM, tokenem pracownika (RLS). Kwalifikacje zmienia `employees_manage`, konta e-mail i uprawnienia — administrator.
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = teamAccess(ctx);
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const id = url.searchParams.get('id') || '';
  if (!uuid.test(id)) return failure('Nieprawidłowy pracownik.');
  try {
    if (op === 'qualifications') {
      if (!access.canView && id !== ctx.employee.id) return failure('Nie masz uprawnień do kwalifikacji tego pracownika.', 403);
      return nativeJson(await qualifications(ctx, id));
    }
    if (op === 'emails') {
      if (!access.isAdmin) return failure('Tylko administrator może zarządzać kontami email pracownika.', 403);
      return nativeJson(await emailAccounts(ctx, id));
    }
    if (op === 'permissions') {
      if (!access.isAdmin) return failure('Tylko administrator może zarządzać uprawnieniami.', 403);
      const data = await employeePermissions(ctx, id);
      return data ? nativeJson(data) : failure('Nie znaleziono pracownika.', 404);
    }
    return failure('Nieznana operacja.');
  } catch (error) {
    console.error('[native-employee-profile]', op, error);
    return failure(errorText(error, 'Nie udało się pobrać danych pracownika.'), 500);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const access = teamAccess(ctx);
  const url = new URL(request.url);

  // Miniatura do stopki e-mail: multipart (`?op=signature&id=…`, pole „file”) → magazyn `site-images` jak w CRM.
  if (url.searchParams.get('op') === 'signature') {
    const id = url.searchParams.get('id') || '';
    if (!uuid.test(id)) return failure('Nieprawidłowy pracownik.');
    if (!access.isAdmin) return failure('Tylko administrator może zmienić miniaturkę.', 403);
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return failure('Brak pliku.');
      if (!(file.type || '').startsWith('image/')) return failure('Plik musi być obrazem');
      if (file.size > 4 * 1024 * 1024) return failure('Zdjęcie jest większe niż 4 MB.');
      const path = `employee-avatars/${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const upload = await ctx.supabase.storage.from('site-images').upload(path, bytes, { contentType: file.type || 'image/jpeg', cacheControl: '3600', upsert: false });
      if (upload.error) return failure(`Błąd podczas wgrywania zdjęcia: ${upload.error.message}`);
      const { data: { publicUrl } } = ctx.supabase.storage.from('site-images').getPublicUrl(path);
      const { error } = await ctx.supabase.from('employees').update({ signature_thumb: publicUrl }).eq('id', id);
      if (error) return failure(errorText(error, 'Nie udało się zapisać miniaturki.'));
      return nativeJson({ ok: true, url: publicUrl });
    } catch (error) {
      console.error('[native-employee-profile] signature', error);
      return failure(errorText(error, 'Nie udało się przesłać zdjęcia.'), 500);
    }
  }

  let body: Record<string, any>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  const employeeId = String(body.employeeId || '');
  const id = typeof body.id === 'string' && uuid.test(body.id) ? body.id : null;
  const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
  if (!uuid.test(employeeId)) return failure('Nieprawidłowy pracownik.');
  const done = (error: string | null) => (error ? failure(error) : nativeJson({ ok: true }));
  try {
    switch (op) {
      // Kwalifikacje
      case 'certification':
        if (!access.canManage) return failure('Nie masz uprawnień do zmiany kwalifikacji.', 403);
        return done(await saveCertification(ctx, employeeId, id, data));
      case 'skill':
        if (!access.canManage) return failure('Nie masz uprawnień do zmiany kwalifikacji.', 403);
        return done(await saveSkill(ctx, employeeId, id, data));
      case 'license':
        if (!access.canManage) return failure('Nie masz uprawnień do zmiany kwalifikacji.', 403);
        return done(await saveLicense(ctx, employeeId, id, data));
      case 'certificationDelete':
      case 'skillDelete':
      case 'licenseDelete': {
        if (!access.canManage) return failure('Nie masz uprawnień do zmiany kwalifikacji.', 403);
        if (!id) return failure('Nieprawidłowy wpis.');
        const table = op === 'certificationDelete' ? 'employee_certifications' : op === 'skillDelete' ? 'employee_skills' : 'employee_driving_licenses';
        const { data: removed, error } = await ctx.supabase.from(table).delete().eq('id', id).eq('employee_id', employeeId).select('id');
        if (error) return failure(errorText(error, 'Błąd podczas usuwania'));
        if (!removed?.length) return failure('Nie masz uprawnień do usunięcia tego wpisu.', 403);
        return nativeJson({ ok: true });
      }

      // Konta e-mail (administrator)
      case 'emailAssignment': {
        if (!access.isAdmin) return failure('Tylko administrator może zarządzać przypisaniami kont email', 403);
        const accountId = String(body.accountId || '');
        if (!uuid.test(accountId)) return failure('Nieprawidłowe konto.');
        if (body.assign === true) {
          const { data: account } = await ctx.supabase.from('employee_email_accounts').select('account_type').eq('id', accountId).maybeSingle();
          if (account?.account_type === 'personal') return failure('Konta osobiste są automatycznie przypisane do właściciela');
          const { error } = await ctx.supabase.from('employee_email_account_assignments').insert({
            email_account_id: accountId, employee_id: employeeId, can_send: true, can_receive: true, can_receive_contact_forms: false,
            assigned_by: ctx.employee.authUserId,
          });
          if (error) return failure(`Błąd podczas zarządzania przypisaniem: ${error.message}`);
        } else {
          const { error } = await ctx.supabase.from('employee_email_account_assignments').delete().eq('email_account_id', accountId).eq('employee_id', employeeId);
          if (error) return failure(`Błąd podczas zarządzania przypisaniem: ${error.message}`);
        }
        return nativeJson({ ok: true });
      }
      case 'contactForms': {
        if (!access.isAdmin) return failure('Tylko administrator może zarządzać dostępem.', 403);
        const { error } = await ctx.supabase.from('employees').update({ can_receive_contact_forms: body.enabled === true }).eq('id', employeeId);
        if (error) return failure(`Błąd podczas zmiany dostępu do formularza: ${error.message}`);
        return nativeJson({ ok: true });
      }
      case 'personalEmail': {
        if (!access.isAdmin) return failure('Tylko administrator może edytować email osobisty', 403);
        const value = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null;
        const preference = ['work', 'personal', 'both', 'none'].includes(String(body.preference)) ? String(body.preference) : 'work';
        if ((preference === 'personal' || preference === 'both') && !value) return failure('Email osobisty jest wymagany gdy preferencja powiadomień to „Tylko osobisty” lub „Oba”');
        if (value && !email.test(value)) return failure('Wpisz poprawny adres e-mail.');
        const { error } = await ctx.supabase.from('employees').update({ personal_email: value, notification_email_preference: preference }).eq('id', employeeId);
        if (error) return failure(`Błąd podczas aktualizacji: ${error.message}`);
        invalidateTeam();
        return nativeJson({ ok: true });
      }
      case 'signatureRemove': {
        if (!access.isAdmin) return failure('Tylko administrator może zmienić miniaturkę.', 403);
        const { error } = await ctx.supabase.from('employees').update({ signature_thumb: null }).eq('id', employeeId);
        if (error) return failure(errorText(error, 'Nie udało się usunąć miniaturki.'));
        return nativeJson({ ok: true });
      }
      case 'personalAccount':
        if (!access.isAdmin) return failure('Tylko administrator może zarządzać kontami osobistymi', 403);
        return done(await savePersonalAccount(ctx, employeeId, data));

      // Uprawnienia (administrator)
      case 'permissions': {
        if (!access.isAdmin) return failure('Nie masz uprawnień do edycji', 403);
        const result = await savePermissions(ctx, employeeId, data);
        invalidateTeam();
        if (result.error) return nativeJson({ error: result.error, updatedAt: result.updatedAt || null }, 400);
        return nativeJson({ ok: true, updatedAt: result.updatedAt });
      }

      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    console.error('[native-employee-profile]', op, error);
    return failure(errorText(error, 'Serwer nie wykonał operacji.'), 500);
  }
}
