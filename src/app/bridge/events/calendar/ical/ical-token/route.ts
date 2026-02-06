import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function newToken() {
  // 48 hex chars
  return crypto.randomBytes(24).toString('hex');
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!jwt) return new NextResponse('Unauthorized', { status: 401 });

    // allow rotation with /ical-token?rotate=1
    const url = new URL(req.url);
    const rotate = url.searchParams.get('rotate') === '1';

    // 1) verify user
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return new NextResponse('Unauthorized', { status: 401 });

    const userId = userData.user.id;

    // 2) map auth user -> employee
    // U Ciebie employees.id == auth.users.id (bo user_id nie istnieje) — więc:
    const { data: emp, error: empErr } = await admin
      .from('employees')
      .select('id, is_active')
      .eq('id', userId)
      .maybeSingle();

    if (empErr) throw empErr;
    if (!emp?.id) return new NextResponse('Employee not found', { status: 404 });
    if (emp.is_active === false) return new NextResponse('Employee inactive', { status: 403 });

    const employeeId = emp.id as string;

    // 3) if not rotating: return existing token (if any)
    if (!rotate) {
      const { data: existing, error: exErr } = await admin
        .from('calendar_feed_tokens')
        .select('token')
        .eq('employee_id', employeeId)
        .maybeSingle();

      if (exErr) throw exErr;

      if (existing?.token) {
        return NextResponse.json({ token: existing.token });
      }
    }

    // 4) create new token (insert or update)
    const token = newToken();

    // Jeśli masz UNIQUE na employee_id (masz), to robimy update-or-insert:
    // najpierw próbujemy UPDATE, a jeśli nic nie zaktualizowano -> INSERT
    const { data: updated, error: upErr } = await admin
      .from('calendar_feed_tokens')
      .update({ token, last_used_at: null })
      .eq('employee_id', employeeId)
      .select('token');

    if (upErr) throw upErr;

    if (updated && updated.length > 0) {
      return NextResponse.json({ token: updated[0].token });
    }

    const { error: insErr } = await admin.from('calendar_feed_tokens').insert({
      employee_id: employeeId,
      token,
      last_used_at: null,
    });

    if (insErr) throw insErr;

    return NextResponse.json({ token });
  } catch (e: any) {
    console.error('ical-token error:', e);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}