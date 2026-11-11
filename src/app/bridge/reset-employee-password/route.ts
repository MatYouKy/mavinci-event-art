import { NextRequest, NextResponse } from 'next/server';
import { resetEmployeePassword } from '@/lib/employees/resetEmployeePassword.server';
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
    const result = await resetEmployeePassword(
      { isAdmin: access.employee.isAdmin, canManage: employeeHasAny(access.employee, 'employees_manage') },
      employeeId,
      newPassword,
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({ success: true, message: 'Hasło zostało zmienione pomyślnie' });
  } catch (error) {
    console.error('Error in reset-employee-password:', error);
    return NextResponse.json({ error: 'Wystąpił nieoczekiwany błąd' }, { status: 500 });
  }
}
