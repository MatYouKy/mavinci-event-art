import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { bankStatementPdfErrorMessage, parseBankStatementPdf } from '@/lib/bank/pdfStatementParser.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Parser wyciągu PDF jest w `src/lib/bank/pdfStatementParser.server.ts` (wspólny z importem wyciągu w aplikacji na Maca).

export async function POST(req: Request) {
  try {
    const userClient = createSupabaseServerClient(cookies());
    const { data: authData } = await userClient.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: 'Wymagane logowanie.' }, { status: 401 });
    }

    const { data: canManageInvoices, error: permissionError } = await userClient.rpc(
      'finance_can_manage',
    );
    if (permissionError || !canManageInvoices) {
      return NextResponse.json(
        { success: false, error: 'Brak uprawnień do importu wyciągów.' },
        { status: 403 },
      );
    }

    const formData = await req.formData();
    const file = (formData as any).get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'Nie przesłano pliku' },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json(
        { success: false, error: 'Dozwolony jest tylko plik PDF' },
        { status: 400 },
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Plik PDF jest zbyt duży. Maksymalny rozmiar to 10 MB.' },
        { status: 413 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json(
        { success: false, error: 'Plik nie ma prawidłowego nagłówka PDF.' },
        { status: 400 },
      );
    }
    const parsed = await parseBankStatementPdf(buffer);

    return NextResponse.json({
      success: true,
      data: parsed,
    });
  } catch (error: any) {
    console.error('[BANK_PARSE_PDF_ROUTE] error', error);
    const publicMessage = bankStatementPdfErrorMessage(error);

    return NextResponse.json(
      {
        success: false,
        error: publicMessage,
      },
      { status: 500 },
    );
  }
}
