'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Zapis ustawień zalogowanego pracownika (`employees.preferences`) — wyłącznie własny wiersz, jego sesją (RLS: pracownik
 * zmienia swój profil), nigdy kluczem serwisowym dla identyfikatora podanego z przeglądarki.
 * `sections` — zmienione sekcje ustawień. Scalane z zapisem w bazie (sekcja z sekcją), więc ustawienie zmienione na Macu, iPadzie
 * albo w innej karcie (np. tryb rabatu w ofercie — `offerWizard.discountMode`) nie znika po zapisie innej sekcji w CRM.
 */
export async function updateEmployeePreferences(employeeId: string, sections: Record<string, unknown>) {
  if (!isRecord(sections)) throw new Error('Nieprawidłowe ustawienia.');
  const supabase = createSupabaseServerClient(await cookies());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Sesja wygasła — zaloguj się ponownie.');

  const { data: employee, error } = await supabase
    .from('employees')
    .select('id, preferences')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();
  if (error || !employee || employee.id !== employeeId) throw new Error('Nie można zapisać ustawień tego pracownika.');

  const current: Record<string, unknown> = isRecord(employee.preferences) ? employee.preferences : {};
  const next: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(sections)) {
    const existing = current[key];
    next[key] = isRecord(value) && isRecord(existing) ? { ...existing, ...value } : value;
  }

  const { data: saved, error: saveError } = await supabase
    .from('employees')
    .update({ preferences: next })
    .eq('id', employee.id)
    .select('id')
    .maybeSingle();
  if (saveError || !saved) throw new Error('Nie udało się zapisać ustawień.');

  return { ok: true };
}
