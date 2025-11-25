import { cookies } from 'next/headers';
import { supabaseServer } from './supabaseServer';

export async function getUserPermissions() {
  try {
    const cookieStore = cookies();

    // Szukaj różnych wariantów cookie Supabase
    const possibleCookieNames = [
      'sb-fuuljhhuhfojtmmfmskq-auth-token',
      'sb-fuuljhhuhfojtmmfmskq-auth-token-code-verifier',
      'supabase-auth-token'
    ];

    let userId: string | null = null;

    for (const cookieName of possibleCookieNames) {
      const authCookie = cookieStore.get(cookieName);

      if (authCookie) {
        try {
          const authData = JSON.parse(authCookie.value);

          // Próbuj różne ścieżki do userId
          userId = authData?.user?.id ||
                   authData?.id ||
                   authData?.access_token && extractUserIdFromJWT(authData.access_token);

          if (userId) break;
        } catch {
          continue;
        }
      }
    }

    if (!userId) {
      return { isAdmin: false, permissions: [], hasWebsiteEdit: false };
    }

    const { data: employee } = await supabaseServer
      .from('employees')
      .select('permissions, is_active')
      .eq('id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!employee) {
      return { isAdmin: false, permissions: [], hasWebsiteEdit: false };
    }

    const permissions = employee.permissions || [];
    const hasWebsiteEdit = permissions.includes('website_edit');
    const isAdmin = permissions.includes('admin') || hasWebsiteEdit;

    return {
      isAdmin,
      permissions,
      hasWebsiteEdit
    };
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return { isAdmin: false, permissions: [], hasWebsiteEdit: false };
  }
}

function extractUserIdFromJWT(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded.sub || null;
  } catch {
    return null;
  }
}
