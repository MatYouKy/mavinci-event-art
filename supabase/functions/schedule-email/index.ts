import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ALLOWED_FUNCTIONS = new Set(['send-email', 'send-offer-email', 'send-invoice-email']);

const decodeBase64 = (value: string): Uint8Array => {
  const encoded = value.includes(',') ? value.split(',').pop() || '' : value;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const safeFilename = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'attachment';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const uploadedPaths: string[] = [];

  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await service.auth.getUser(token);
    if (authError || !authData.user) return json({ error: 'Brak autoryzacji' }, 401);

    const body = await request.json();
    let functionName = String(body.functionName || '');
    const payload = { ...(body.payload || {}) } as Record<string, unknown>;
    const metadata = (body.metadata || {}) as Record<string, unknown>;
    const timezone = String(body.timezone || 'Europe/Warsaw');
    const scheduledDate = new Date(String(body.scheduledAt || ''));

    if (!ALLOWED_FUNCTIONS.has(functionName))
      return json({ error: 'Niedozwolony typ wysyłki' }, 400);
    if (!payload.to || !payload.subject || !payload.emailAccountId) {
      return json({ error: 'Brak odbiorcy, tematu lub konta nadawcy' }, 400);
    }
    if ('smtpConfig' in payload)
      return json({ error: 'Bezpośrednia konfiguracja SMTP jest niedozwolona' }, 400);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 20_000) {
      return json({ error: 'Termin wysyłki musi przypadać w przyszłości' }, 400);
    }
    if (scheduledDate.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      return json({ error: 'Wiadomość można zaplanować maksymalnie rok naprzód' }, 400);
    }

    const { data: employee } = await service
      .from('employees')
      .select('id')
      .or(`id.eq.${authData.user.id},auth_user_id.eq.${authData.user.id}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!employee) return json({ error: 'Nie znaleziono aktywnego pracownika' }, 403);

    const accountId = String(payload.emailAccountId);
    const { data: account } = await service
      .from('employee_email_accounts')
      .select('id, employee_id, is_active, account_type')
      .eq('id', accountId)
      .eq('is_active', true)
      .maybeSingle();
    if (!account || account.account_type === 'system') {
      return json({ error: 'Wybrane konto nadawcze jest niedostępne' }, 403);
    }

    let canSend = account.employee_id === employee.id;
    if (!canSend) {
      const { data: assignment } = await service
        .from('employee_email_account_assignments')
        .select('id')
        .eq('email_account_id', accountId)
        .eq('employee_id', employee.id)
        .eq('can_send', true)
        .maybeSingle();
      canSend = Boolean(assignment);
    }
    if (!canSend) return json({ error: 'Nie masz prawa wysyłać z wybranej skrzynki' }, 403);

    const scheduledEmailId = crypto.randomUUID();
    const preparedAttachments = Array.isArray(payload.attachments)
      ? ([...payload.attachments] as Array<Record<string, unknown>>)
      : [];

    // Dokumentowe funkcje wysyłające wymagają sesji pracownika. Przy planowaniu
    // przygotowujemy więc dokument teraz, a do kolejki przekazujemy zamrożoną
    // wiadomość dla zwykłego, wewnętrznego transportu SMTP.
    if (functionName === 'send-offer-email') {
      const offerId = String(payload.offerId || '');
      if (!offerId) return json({ error: 'Brak identyfikatora oferty' }, 400);

      const { data: allowed, error: permissionError } = await service.rpc('sales_actor_can_manage', { p_kind: 'offer', p_document: offerId, p_user: authData.user.id });
      if (permissionError || !allowed) throw new Error('Brak uprawnień do wysyłki oferty');
      const { data: offer, error: offerError } = await service.from('offers').select('generated_pdf_url,modified_after_generation').eq('id', offerId).single();
      if (offerError || !offer?.generated_pdf_url || offer.modified_after_generation || payload.documentPath !== offer.generated_pdf_url) throw new Error('Wygeneruj aktualny PDF przed zaplanowaniem wysyłki.');
      const { data: file } = await service.from('sales_document_files').select('id').eq('offer_id', offerId).eq('storage_path', offer.generated_pdf_url).eq('storage_bucket', 'generated-offers').maybeSingle();
      if (!file) throw new Error('Wygeneruj PDF ponownie, aby zapisać wersję dokumentu.');
      // Keep the document sender and immutable storage path; it rechecks current permissions at dispatch.
    } else if (functionName === 'send-invoice-email') {
      payload.body = String(payload.messageHtml || payload.message || '');
      functionName = 'send-email';
    }

    const attachments = preparedAttachments;
    let totalBytes = 0;
    const storedAttachments = [];

    for (const item of attachments as Array<Record<string, unknown>>) {
      const bytes = decodeBase64(String(item.content || ''));
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > 20 * 1024 * 1024 || totalBytes > 40 * 1024 * 1024) {
        throw new Error('Załączniki do zaplanowanej wiadomości są zbyt duże');
      }
      const filename = String(item.filename || 'attachment');
      const path = `scheduled/${scheduledEmailId}/${crypto.randomUUID()}-${safeFilename(filename)}`;
      const contentType = String(item.contentType || 'application/octet-stream');
      const { error: uploadError } = await service.storage
        .from('email-attachments')
        .upload(path, bytes, { contentType, upsert: false });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);
      storedAttachments.push({
        filename,
        contentType,
        contentDisposition: item.contentDisposition || 'attachment',
        cid: item.cid || undefined,
        scheduledStorage: { bucket: 'email-attachments', path },
      });
    }
    if (attachments.length) payload.attachments = storedAttachments;

    const { error: insertError } = await service.from('scheduled_emails').insert({
      id: scheduledEmailId,
      created_by: authData.user.id,
      employee_id: employee.id,
      email_account_id: accountId,
      function_name: functionName,
      payload,
      metadata,
      timezone,
      scheduled_at: scheduledDate.toISOString(),
      next_attempt_at: scheduledDate.toISOString(),
    });
    if (insertError) throw insertError;

    return json({
      success: true,
      scheduled: true,
      scheduledEmailId,
      scheduledAt: scheduledDate.toISOString(),
    });
  } catch (error) {
    if (uploadedPaths.length) {
      await service.storage.from('email-attachments').remove(uploadedPaths);
    }
    console.error('[schedule-email]', error);
    return json(
      { error: error instanceof Error ? error.message : 'Nie udało się zaplanować wiadomości' },
      400,
    );
  }
});
