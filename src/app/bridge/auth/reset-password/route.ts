import { NextRequest, NextResponse } from 'next/server';

import { sendPasswordAccessEmail } from '@/lib/seller/accessEmail.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { passwordAccessUrl } from '@/lib/passwordAccess';

export const runtime = 'nodejs';

const SUCCESS_MESSAGE = 'Jeżeli konto z tym adresem istnieje, wysłaliśmy link do ustawienia nowego hasła.';

const normalizeEmail = (value: unknown) => String(value || '').trim().toLocaleLowerCase();

const findAuthUserByEmail = async (
  admin: ReturnType<typeof createSupabaseAdminClient>,
  email: string,
) => {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;

    const user = data.users.find((item) => item.email?.toLocaleLowerCase() === email);
    if (user) return user;
    if (data.users.length < 100) break;
  }

  return null;
};

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const email = normalizeEmail(payload?.email);

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Podaj prawidłowy adres e-mail.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const authUser = await findAuthUserByEmail(admin, email);

    // Taka sama odpowiedź dla istniejącego i nieistniejącego konta nie ujawnia listy użytkowników.
    if (!authUser) {
      return NextResponse.json({ success: true, message: SUCCESS_MESSAGE });
    }

    const [{ data: sellerProfile }, { data: employee }] = await Promise.all([
      admin
        .from('sales_partner_profiles')
        .select('id,contact:contacts!contact_id(full_name)')
        .eq('portal_auth_user_id', authUser.id)
        .maybeSingle(),
      admin
        .from('employees')
        .select('name,surname')
        .or(`auth_user_id.eq.${authUser.id},id.eq.${authUser.id}`)
        .maybeSingle(),
    ]);

    const sellerContact = Array.isArray((sellerProfile as any)?.contact)
      ? (sellerProfile as any).contact[0]
      : (sellerProfile as any)?.contact;
    const isSeller = Boolean(sellerProfile) || authUser.user_metadata?.portal === 'seller';
    const portal = isSeller ? 'seller' : 'crm';

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: authUser.email || email,
      options: { redirectTo: passwordAccessUrl(portal) },
    });

    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error('Nie udało się przygotować linku resetowania hasła:', linkError);
      return NextResponse.json({ error: 'Nie udało się przygotować linku. Spróbuj ponownie.' }, { status: 500 });
    }

    const employeeName = [employee?.name, employee?.surname].filter(Boolean).join(' ');
    const recipientName = sellerContact?.full_name
      || employeeName
      || authUser.user_metadata?.full_name
      || null;
    const actionUrl = passwordAccessUrl(portal, tokenHash, 'recovery');

    await sendPasswordAccessEmail({
      to: authUser.email || email,
      recipientName,
      actionUrl,
      isNewAccount: false,
      portal: isSeller ? 'seller' : 'crm',
    });

    return NextResponse.json({ success: true, message: SUCCESS_MESSAGE });
  } catch (error: any) {
    console.error('Błąd wysyłki linku resetowania hasła:', error);
    return NextResponse.json(
      { error: error?.message || 'Nie udało się wysłać linku. Spróbuj ponownie.' },
      { status: 500 },
    );
  }
}
