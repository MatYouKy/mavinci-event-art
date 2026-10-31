import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { employeeHasAny, isUuid, requireSessionEmployee } from '@/lib/auth/requireEmployee.server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // Wykonujący operację wynika z sesji, nigdy z treści żądania.
    const access = await requireSessionEmployee(request);
    if (!access.ok) return access.response;

    const { employeeId, newPassword } = await request.json();

    if (!isUuid(employeeId) || typeof newPassword !== 'string') {
      return NextResponse.json({ error: 'Brak wymaganych parametrów' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Hasło musi mieć co najmniej 8 znaków.' }, { status: 400 });
    }

    if (!employeeHasAny(access.employee, 'employees_manage')) {
      return NextResponse.json({ error: 'Brak uprawnień do resetowania hasła' }, { status: 403 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: target } = await supabaseAdmin
      .from('employees')
      .select('id, auth_user_id, role, access_level, permissions')
      .eq('id', employeeId)
      .maybeSingle();

    if (!target) {
      return NextResponse.json({ error: 'Nie znaleziono pracownika.' }, { status: 404 });
    }

    const targetIsAdmin =
      target.role === 'admin' ||
      target.access_level === 'admin' ||
      (Array.isArray(target.permissions) && target.permissions.includes('admin'));
    if (targetIsAdmin && !access.employee.isAdmin) {
      return NextResponse.json(
        { error: 'Hasło administratora może zmienić tylko administrator.' },
        { status: 403 },
      );
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.auth_user_id || target.id, {
      password: newPassword,
    });

    if (error) {
      console.error('Error updating password:', error.message);
      return NextResponse.json({ error: 'Błąd podczas resetowania hasła' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Hasło zostało zmienione pomyślnie' });
  } catch (error) {
    console.error('Error in reset-employee-password:', error);
    return NextResponse.json({ error: 'Wystąpił nieoczekiwany błąd' }, { status: 500 });
  }
}
