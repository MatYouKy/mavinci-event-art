import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const cookieStore = await cookies();
  const sessionClient = createSupabaseServerClient(cookieStore);
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return null;

  const admin = createSupabaseAdminClient();
  const { data: employee } = await admin
    .from('employees')
    .select('role, permissions')
    .eq('id', user.id)
    .maybeSingle();
  const permissions = employee?.permissions || [];
  return employee?.role === 'admin' || permissions.includes('admin') ? admin : null;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: 'Brak uprawnień administratora' }, { status: 403 });

    const bucket = request.nextUrl.searchParams.get('bucket');
    if (!bucket) {
      const { data, error } = await admin.storage.listBuckets();
      if (error) throw error;
      return NextResponse.json({ buckets: data || [] });
    }

    const path = request.nextUrl.searchParams.get('path') || '';
    const search = request.nextUrl.searchParams.get('search') || undefined;
    const offset = Math.max(0, Number(request.nextUrl.searchParams.get('offset') || 0));
    const limit = 100;
    const { data, error } = await admin.storage.from(bucket).list(path, {
      limit: limit + 1,
      offset,
      search,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;

    const page = (data || []).slice(0, limit);
    const filePaths = page
      .filter((item) => item.id)
      .map((item) => path ? `${path}/${item.name}` : item.name);
    const signedUrls = new Map<string, string>();
    if (filePaths.length > 0) {
      const { data: signed } = await admin.storage.from(bucket).createSignedUrls(filePaths, 600);
      (signed || []).forEach((item) => {
        if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl);
      });
    }

    return NextResponse.json({
      items: page.map((item) => {
        const fullPath = path ? `${path}/${item.name}` : item.name;
        return { ...item, fullPath, isFolder: !item.id, signedUrl: signedUrls.get(fullPath) || null };
      }),
      hasMore: (data || []).length > limit,
      offset,
      limit,
    });
  } catch (error: any) {
    console.error('Admin storage browser error:', error);
    return NextResponse.json({ error: error.message || 'Nie udało się odczytać storage' }, { status: 500 });
  }
}
