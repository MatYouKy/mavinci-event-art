import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_SIZE = 20 * 1024 * 1024;
const BUCKET = 'signed-contracts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = 'id, original_name, file_size, mime_type, created_at';
const reply = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function context(request: Request, manage: boolean) {
  const contractId = new URL(request.url).searchParams.get('contractId') || '';
  if (!uuid.test(contractId)) throw new RequestError('Nieprawidłowy identyfikator umowy.', 400);
  const userClient = createSupabaseServerClient(cookies());
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) throw new RequestError('Zaloguj się ponownie.', 401);
  const admin = createSupabaseAdminClient();
  const { data: contract, error } = await userClient.from('contracts')
    .select('id, event_id, status, company_signed_at').eq('id', contractId).maybeSingle();
  if (error) throw error;
  if (!contract?.event_id) throw new RequestError('Nie znaleziono umowy wydarzenia.', 404);
  const { data: allowed, error: permissionError } = await userClient.rpc('can_view_event_commercials', {
    p_event_id: contract.event_id, p_manage: manage,
  });
  if (permissionError || !allowed) throw new RequestError('Nie masz uprawnień do tych dokumentów.', 403);
  if (manage) {
    const { data: contractManage, error: scopeError } = await userClient.rpc('crm_contract_permission', { p_action: 'manage' });
    if (scopeError || !contractManage) throw new RequestError('Nie masz uprawnień do zmiany tej umowy.', 403);
  }
  return { admin, userClient, user: auth.user, contract };
}

function failure(error: unknown) {
  if (error instanceof RequestError) return reply({ error: error.message }, error.status);
  const code = (error as { code?: string })?.code;
  if (code && ['42P01', 'PGRST205'].includes(code)) {
    return reply({ error: 'Załączanie podpisanej umowy wymaga migracji signed_contract_attachments w bazie danych.' }, 503);
  }
  return reply({ error: 'Nie udało się obsłużyć plików umowy. Spróbuj ponownie.' }, 500);
}

export async function GET(request: Request) {
  try {
    const { admin, userClient, contract } = await context(request, false);
    const params = new URL(request.url).searchParams;
    const fileId = params.get('fileId');
    if (fileId) {
      if (!uuid.test(fileId)) throw new RequestError('Nieprawidłowy identyfikator pliku.', 400);
      const { data: file, error } = await admin.from('contract_signed_files')
        .select('storage_path, original_name').eq('contract_id', contract.id).eq('id', fileId).maybeSingle();
      if (error) throw error;
      if (!file) throw new RequestError('Nie znaleziono załącznika.', 404);
      const { data: link, error: linkError } = await admin.storage.from(BUCKET).createSignedUrl(
        file.storage_path, 60,
        params.get('download') === '1' ? { download: file.original_name } : undefined,
      );
      if (linkError || !link?.signedUrl) throw new RequestError('Nie udało się otworzyć pliku.', 500);
      return new NextResponse(null, { status: 303, headers: {
        Location: link.signedUrl, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      } });
    }
    const { data: files, error } = await admin.from('contract_signed_files')
      .select(columns).eq('contract_id', contract.id).order('created_at', { ascending: false });
    if (error) throw error;
    const { data: canManage, error: manageError } = await userClient.rpc('can_view_event_commercials', {
      p_event_id: contract.event_id, p_manage: true,
    });
    return reply({ files: files || [], canUpload: !manageError && Boolean(canManage) &&
      ['signed_by_client', 'signed_returned'].includes(contract.status) && Boolean(contract.company_signed_at) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) {
      throw new RequestError('Nieprawidłowe źródło żądania.', 403);
    }
    const { admin, user, contract } = await context(request, true);
    if (!['signed_by_client', 'signed_returned'].includes(contract.status) || !contract.company_signed_at) {
      throw new RequestError('Najpierw potwierdź podpisy obu stron umowy.', 409);
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_SIZE + 65536) {
      throw new RequestError('Plik może mieć maksymalnie 20 MB.', 413);
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || !file.size || file.size > MAX_SIZE) {
      throw new RequestError('Wybierz niepusty plik PDF, JPG lub PNG o rozmiarze do 20 MB.', 400);
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    let mime = '';
    let extension = '';
    if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') { mime = 'application/pdf'; extension = 'pdf'; }
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) { mime = 'image/jpeg'; extension = 'jpg'; }
    else if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) { mime = 'image/png'; extension = 'png'; }
    if (!mime || !/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      throw new RequestError('Plik musi być dokumentem PDF lub skanem JPG/PNG.', 400);
    }
    const { data: employee, error: employeeError } = await admin.from('employees')
      .select('id').or(`id.eq.${user.id},auth_user_id.eq.${user.id}`).eq('is_active', true).maybeSingle();
    if (employeeError || !employee) throw new RequestError('Nie znaleziono aktywnego pracownika.', 403);
    // Check the schema before uploading, so a missing migration cannot leave orphan files.
    const { error: schemaError } = await admin.from('contract_signed_files').select('id').limit(0);
    if (schemaError) throw schemaError;
    const id = crypto.randomUUID();
    const path = `${contract.event_id}/${contract.id}/${id}.${extension}`;
    const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 200);
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, {
      contentType: mime, upsert: false,
    });
    if (uploadError) throw new RequestError('Nie udało się zapisać pliku. Sprawdź, czy zastosowano migrację magazynu podpisanych umów.', 500);
    const { data: saved, error: insertError } = await admin.from('contract_signed_files').insert({
      id, contract_id: contract.id, storage_path: path, original_name: name,
      file_size: bytes.length, mime_type: mime, uploaded_by: employee.id,
    }).select(columns).single();
    if (insertError) {
      // Only the new, unlinked upload is removed. Existing originals are never overwritten.
      await admin.storage.from(BUCKET).remove([path]);
      if (insertError.code === '23514') throw new RequestError('Status umowy zmienił się. Odśwież widok przed załączeniem pliku.', 409);
      throw insertError;
    }
    return reply({ file: saved }, 201);
  } catch (error) { return failure(error); }
}
