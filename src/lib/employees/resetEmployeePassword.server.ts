import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

/**
 * Zmiana hasła pracownika przez osobę z `employees_manage` (CRM: `/bridge/reset-employee-password`, aplikacja na Maca:
 * `/bridge/native/v1/employees`). Hasło administratora może zmienić tylko administrator. Wykonujący wynika z sesji.
 */
export async function resetEmployeePassword(
  requester: { isAdmin: boolean; canManage: boolean },
  employeeId: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (newPassword.length < 8) return { ok: false, status: 400, error: 'Hasło musi mieć co najmniej 8 znaków.' };
  if (!requester.canManage) return { ok: false, status: 403, error: 'Brak uprawnień do resetowania hasła' };

  const supabaseAdmin = createSupabaseAdminClient();
  const { data: target } = await supabaseAdmin
    .from('employees')
    .select('id, auth_user_id, role, access_level, permissions')
    .eq('id', employeeId)
    .maybeSingle();
  if (!target) return { ok: false, status: 404, error: 'Nie znaleziono pracownika.' };

  const targetIsAdmin =
    target.role === 'admin' ||
    target.access_level === 'admin' ||
    (Array.isArray(target.permissions) && target.permissions.includes('admin'));
  if (targetIsAdmin && !requester.isAdmin) {
    return { ok: false, status: 403, error: 'Hasło administratora może zmienić tylko administrator.' };
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id || target.id, { password: newPassword });
  if (error) {
    console.error('Error updating password:', error.message);
    return { ok: false, status: 500, error: 'Błąd podczas resetowania hasła' };
  }
  return { ok: true };
}
