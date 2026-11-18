import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { InvoicePrintError } from '@/lib/invoices/print/renderInvoicePdf.server';
import { generateStoredInvoicePdf, StoredInvoicePdfError } from '@/lib/invoices/print/storeInvoicePdf.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  fileName?: string;
  invoiceId?: string;
};

const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { fileName, invoiceId } = body;

    if (!invoiceId) {
      return NextResponse.json({ error: 'Brak danych faktury do wygenerowania PDF' }, { status: 400 });
    }

    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ error: 'Wymagane logowanie.' }, { status: 401 });
    }

    const { data: canManage, error: permissionError } = await userClient.rpc(
      'can_manage_invoice',
      { p_invoice_id: invoiceId },
    );
    if (permissionError || !canManage) {
      return NextResponse.json(
        { error: 'Nie masz uprawnień do generowania faktur.' },
        { status: 403 },
      );
    }

    const { data: employeeByAuth } = await userClient
      .from('employees')
      .select('id')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();
    const { data: employeeByEmail } = employeeByAuth || !authData.user.email
      ? { data: null }
      : await userClient
          .from('employees')
          .select('id')
          .eq('email', authData.user.email)
          .maybeSingle();
    const employee = employeeByAuth ?? employeeByEmail;
    const createdBy = employee?.id ?? null;

    const supabase = getSupabaseAdmin();
    // Wydruk, zapis w magazynie i w dokumentach wydarzenia — wspólne z aplikacją na Maca.
    const result = await generateStoredInvoicePdf(supabase, { invoiceId, fileName, createdBy });

    return NextResponse.json({
      ok: true,
      base64: result.base64,
      filename: result.filename,
      contentType: 'application/pdf',
      storagePath: result.storagePath,
    });
  } catch (e: any) {
    if (e instanceof InvoicePrintError || e instanceof StoredInvoicePdfError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('Invoice PDF generate API error:', e);
    return NextResponse.json({ error: e?.message || 'Błąd generowania PDF' }, { status: 500 });
  }
}
