import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export async function POST(request: NextRequest) {
  try {
    const { employeeId, newPassword, requesterId } = await request.json();

    if (!employeeId || !newPassword || !requesterId) {
      return NextResponse.json(
        { error: 'Brak wymaganych parametrów' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: requester, error: requesterError } = await supabaseAdmin
      .from('employees')
      .select('permissions, access_level')
      .eq('id', requesterId)
      .maybeSingle();

    if (requesterError || !requester) {
      return NextResponse.json(
        { error: 'Nie znaleziono użytkownika wykonującego operację' },
        { status: 403 }
      );
    }

    const hasPermission =
      requester.access_level === 'admin' ||
      requester.permissions?.includes('employees_manage') ||
      requester.permissions?.includes('admin');

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Brak uprawnień do resetowania hasła' },
        { status: 403 }
      );
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      employeeId,
      {
        password: newPassword,
      }
    );

    if (error) {
      console.error('Error updating password:', error);
      return NextResponse.json(
        { error: error.message || 'Błąd podczas resetowania hasła' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Hasło zostało zmienione pomyślnie',
    });
  } catch (error: any) {
    console.error('Error in reset-employee-password:', error);
    return NextResponse.json(
      { error: error.message || 'Wystąpił nieoczekiwany błąd' },
      { status: 500 }
    );
  }
}
