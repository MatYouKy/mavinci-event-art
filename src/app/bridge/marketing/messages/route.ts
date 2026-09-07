import { NextRequest, NextResponse } from 'next/server';
import { canAccessMarketingCompany, getMarketingAccess } from '@/lib/marketing/auth.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export async function PATCH(request: NextRequest) {
  try {
    const access = await getMarketingAccess('view');
    if (!access.allowed) {
      return NextResponse.json({ error: 'Brak dostępu do wiadomości.' }, { status: 403 });
    }
    const body = await request.json();
    const companyId = String(body?.companyId || '');
    const messageId = String(body?.messageId || '');
    if (!companyId || !messageId || !canAccessMarketingCompany(access, companyId)) {
      return NextResponse.json({ error: 'Nieprawidłowa wiadomość.' }, { status: 400 });
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('marketing_messages')
      .update({ is_read: body?.isRead !== false })
      .eq('id', messageId)
      .eq('company_id', companyId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Nie udało się zaktualizować wiadomości.' },
      { status: 500 },
    );
  }
}
