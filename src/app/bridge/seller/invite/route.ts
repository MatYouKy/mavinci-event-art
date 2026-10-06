import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { sendSellerAccessEmail } from '@/lib/seller/accessEmail.server';
import { passwordAccessUrl } from '@/lib/passwordAccess';

export const runtime = 'nodejs';

const hasPermission = (employee: any) => {
  const permissions = Array.isArray(employee?.permissions) ? employee.permissions : [];
  return employee?.role === 'admin'
    || employee?.access_level === 'admin'
    || permissions.includes('admin')
    || permissions.includes('contacts_manage')
    || permissions.includes('finances_manage');
};

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return NextResponse.json({ error: 'Sesja wygasła' }, { status: 401 });

    const { data: employee } = await admin
      .from('employees')
      .select('id,role,access_level,permissions')
      .or(`id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id}`)
      .eq('is_active', true)
      .maybeSingle();
    if (!hasPermission(employee)) return NextResponse.json({ error: 'Brak uprawnień do zapraszania sprzedawców' }, { status: 403 });

    const { salesPartnerId, forceEmail = false } = await request.json();
    if (!salesPartnerId) return NextResponse.json({ error: 'Nie wskazano sprzedawcy' }, { status: 400 });

    // Respect caller RLS before using service-role access to create/link accounts.
    const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await user
      .from('sales_partner_profiles')
      .select('id,partner_type,status,portal_enabled,portal_auth_user_id,contact:contacts!contact_id(email,full_name)')
      .eq('id', salesPartnerId)
      .maybeSingle();
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Brak dostępu do wskazanego sprzedawcy' }, { status: 403 });
    }
    const contact = Array.isArray((profile as any)?.contact) ? (profile as any).contact[0] : (profile as any)?.contact;
    if (!profile.portal_enabled || profile.status !== 'active' || !contact) {
      return NextResponse.json({ error: 'Profil nie jest aktywnym sprzedawcą zewnętrznym z włączonym portalem' }, { status: 400 });
    }
    if (!contact?.email) return NextResponse.json({ error: 'Kontakt nie ma adresu e-mail' }, { status: 400 });

    let linkedUser: any = null;
    const alreadyLinked = Boolean(profile.portal_auth_user_id);
    let foundExistingUser = false;
    if (profile.portal_auth_user_id) {
      const { data, error } = await admin.auth.admin.getUserById(profile.portal_auth_user_id);
      if (error || !data.user) {
        return NextResponse.json({ error: 'Powiązane konto logowania już nie istnieje' }, { status: 409 });
      }
      linkedUser = data.user;
    } else {
      for (let page = 1; page <= 10 && !linkedUser; page += 1) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        linkedUser = data?.users?.find((user) => user.email?.toLocaleLowerCase() === contact.email.toLocaleLowerCase());
        if (!data?.users || data.users.length < 100) break;
      }
      foundExistingUser = Boolean(linkedUser);
    }

    let invited = false;
    let linkToken: string | null = null;
    let linkType: 'invite' | 'recovery' | null = null;
    if (!linkedUser) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'invite',
        email: contact.email,
        options: {
          redirectTo: passwordAccessUrl('seller'),
          data: { portal: 'seller', sales_partner_id: profile.id, full_name: contact.full_name },
        },
      });
      if (error || !data.user || !data.properties?.hashed_token) {
        return NextResponse.json({ error: error?.message || 'Nie udało się przygotować zaproszenia' }, { status: 400 });
      }
      linkedUser = data.user;
      linkToken = data.properties.hashed_token;
      linkType = 'invite';
      invited = true;
    }

    const { data: crmEmployee } = await admin
      .from('employees')
      .select('id')
      .eq('auth_user_id', linkedUser.id)
      .maybeSingle();
    if (crmEmployee) {
      return NextResponse.json({
        error: 'Ten adres e-mail należy już do pracownika CRM. Użyj innego adresu dla konta sprzedawcy.',
      }, { status: 409 });
    }

    const { data: otherProfile } = await admin
      .from('sales_partner_profiles')
      .select('id')
      .eq('portal_auth_user_id', linkedUser.id)
      .neq('id', profile.id)
      .maybeSingle();
    if (otherProfile) {
      return NextResponse.json({
        error: 'Ten adres e-mail jest już powiązany z innym sprzedawcą.',
      }, { status: 409 });
    }

    const { error: metadataError } = await admin.auth.admin.updateUserById(linkedUser.id, {
      user_metadata: {
        ...(linkedUser.user_metadata || {}),
        portal: 'seller',
        sales_partner_id: profile.id,
        full_name: contact.full_name,
      },
    });
    if (metadataError) {
      return NextResponse.json({ error: metadataError.message }, { status: 400 });
    }

    if (!alreadyLinked) {
      const { error: linkError } = await admin
        .from('sales_partner_profiles')
        .update({ portal_auth_user_id: linkedUser.id })
        .eq('id', profile.id)
        .is('portal_auth_user_id', null);
      if (linkError) return NextResponse.json({ error: linkError.message }, { status: 400 });
    }

    const shouldSendEmail = invited || foundExistingUser || forceEmail;
    if (!invited && shouldSendEmail) {
      const accountEmail = linkedUser.email || contact.email;
      const { data, error: recoveryError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: accountEmail,
        options: { redirectTo: passwordAccessUrl('seller') },
      });
      if (recoveryError || !data.properties?.hashed_token) {
        return NextResponse.json({ error: recoveryError?.message || 'Nie udało się przygotować linku do ustawienia hasła' }, { status: 400 });
      }
      linkToken = data.properties.hashed_token;
      linkType = 'recovery';
    }

    let emailSent = false;
    if (shouldSendEmail && linkToken && linkType) {
      const accountEmail = linkedUser.email || contact.email;
      const actionUrl = passwordAccessUrl('seller', linkToken, linkType);
      await sendSellerAccessEmail({
        to: accountEmail,
        recipientName: contact.full_name,
        actionUrl,
        isNewAccount: linkType === 'invite',
      });
      emailSent = true;
    }

    return NextResponse.json({
      success: true,
      invited,
      alreadyLinked,
      emailSent,
      email: linkedUser.email || contact.email,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Nie udało się przygotować dostępu do portalu' }, { status: 500 });
  }
}
