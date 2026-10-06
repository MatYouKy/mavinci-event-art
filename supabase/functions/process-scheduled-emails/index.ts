import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Apikey, X-Scheduled-Email-Worker-Secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const formatWarsawDateTime = (value: string | Date): string =>
  new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(value));

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const suppliedSecret = request.headers.get('X-Scheduled-Email-Worker-Secret') || '';
  if (!suppliedSecret) {
    return json({ error: 'Brak autoryzacji workera' }, 401);
  }

  const { data: isAuthorized, error: authorizationError } = await service.rpc(
    'verify_scheduled_email_worker_secret',
    { p_secret: suppliedSecret },
  );
  if (authorizationError || !isAuthorized) {
    return json({ error: 'Brak autoryzacji workera' }, 401);
  }

  const { data: jobs, error: claimError } = await service.rpc('claim_due_scheduled_emails', {
    p_limit: 5,
  });
  if (claimError) return json({ error: claimError.message }, 500);
  if (!jobs?.length) return json({ status: 'idle', processed: 0 });

  let sent = 0;
  let retried = 0;
  let failed = 0;

  const notifyScheduler = async ({
    job,
    status,
    errorMessage,
  }: {
    job: {
      id: string;
      created_by: string;
      employee_id?: string | null;
      payload?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    };
    status: 'sent' | 'failed';
    errorMessage?: string;
  }) => {
    if (!job.employee_id) return;

    try {
      const payload = job.payload || {};
      const metadata = job.metadata || {};
      const subject = String(payload.subject || '(bez tematu)');
      const recipient = String(payload.to || 'odbiorcy');
      const actionUrl =
        typeof metadata.actionUrl === 'string' && metadata.actionUrl
          ? metadata.actionUrl
          : '/crm/messages';
      const title =
        status === 'sent'
          ? 'Zaplanowany e-mail został wysłany'
          : 'Nie udało się wysłać zaplanowanego e-maila';
      const message =
        status === 'sent'
          ? `Wiadomość „${subject}” do ${recipient} została wysłana ${formatWarsawDateTime(new Date())}.`
          : `Wiadomość „${subject}” do ${recipient} nie została wysłana po 3 próbach. ${errorMessage || 'Sprawdź konfigurację skrzynki i spróbuj ponownie.'}`;

      const { data: notification, error: notificationError } = await service
        .from('notifications')
        .insert({
          title,
          message,
          type: status === 'sent' ? 'success' : 'error',
          category: 'system',
          action_url: actionUrl,
          created_by: job.created_by,
          metadata: {
            kind: 'scheduled_email_delivery',
            scheduled_email_id: job.id,
            delivery_status: status,
            email_subject: subject,
            email_recipient: recipient,
            entity_type: metadata.entityType || null,
            entity_id: metadata.entityId || null,
          },
        })
        .select('id')
        .single();

      if (notificationError || !notification) {
        throw notificationError || new Error('Nie udało się utworzyć powiadomienia');
      }

      const { error: recipientError } = await service.from('notification_recipients').insert({
        notification_id: notification.id,
        user_id: job.employee_id,
        is_read: false,
      });
      if (recipientError) throw recipientError;
    } catch (notificationError) {
      // Powiadomienie nie może zmienić poprawnie wysłanego e-maila w błąd.
      console.error('[process-scheduled-emails] result notification failed', notificationError);
    }
  };

  for (const job of jobs) {
    const storagePaths: string[] = [];
    try {
      const payload = structuredClone(job.payload || {}) as Record<string, unknown>;
      const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
      const hydrated = [];
      for (const item of attachments as Array<Record<string, unknown>>) {
        const storage = item.scheduledStorage as { bucket?: string; path?: string } | undefined;
        if (!storage?.bucket || !storage.path) {
          hydrated.push(item);
          continue;
        }
        const { data: file, error: downloadError } = await service.storage
          .from(storage.bucket)
          .download(storage.path);
        if (downloadError || !file)
          throw downloadError || new Error('Nie udało się pobrać załącznika');
        storagePaths.push(storage.path);
        hydrated.push({
          filename: item.filename,
          contentType: item.contentType,
          contentDisposition: item.contentDisposition,
          cid: item.cid,
          content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
        });
      }
      if (attachments.length) payload.attachments = hydrated;
      payload._scheduledDispatch = {
        requestedByUserId: job.created_by,
        scheduledEmailId: job.id,
      };

      const documentKind = job.metadata?.entityType;
      if (['offer', 'calculation', 'inquiry'].includes(documentKind)) {
        const documentId = job.metadata?.entityId || job.metadata?.inquiryId;
        const { data: allowed, error } = await service.rpc('sales_actor_can_manage', { p_kind: documentKind, p_document: documentId, p_user: job.created_by });
        if (error || !allowed) throw new Error('Nadawca nie ma już uprawnień do zapytania lub dokumentu.');
      }
      const response = await fetch(`${supabaseUrl}/functions/v1/${job.function_name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || result?.message || 'Błąd funkcji wysyłającej');
      }

      const metadata = (job.metadata || {}) as Record<string, unknown>;
      if (metadata.markEntitySent && metadata.entityType === 'offer' && metadata.entityId) {
        const { error: activityError } = await service.rpc('record_sales_delivery', { p_kind: 'offer', p_document: metadata.entityId, p_delivery_key: `scheduled:${job.id}`, p_storage_path: payload.documentPath || null, p_recipient: payload.to });
        if (activityError) console.error('Offer sent; delivery activity failed', activityError.code);
      }
      if (
        metadata.markEntitySent &&
        metadata.entityType === 'contract' &&
        metadata.entityId &&
        !metadata.draft
      ) {
        await service
          .from('contracts')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', metadata.entityId);
      }
      if (metadata.inquiryId && metadata.entityType === 'inquiry') {
        const { error: activityError } = await service.rpc('record_inquiry_delivery', { p_inquiry: metadata.inquiryId, p_delivery_key: `scheduled:${job.id}`, p_recipient: payload.to });
        if (activityError) console.error('Inquiry email sent; activity failed', activityError.code);
      }

      await service
        .from('scheduled_emails')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          claimed_at: null,
          next_attempt_at: null,
          last_error: null,
          provider_message_id: result?.messageId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (storagePaths.length) {
        await service.storage.from('email-attachments').remove(storagePaths);
      }
      await notifyScheduler({ job, status: 'sent' });
      sent += 1;
    } catch (error) {
      const shouldRetry = Number(job.attempt_count || 1) < 3;
      const retryDelayMinutes = Math.min(60, 2 ** Math.max(0, Number(job.attempt_count || 1) - 1));
      await service
        .from('scheduled_emails')
        .update({
          status: shouldRetry ? 'retry' : 'failed',
          claimed_at: null,
          next_attempt_at: shouldRetry
            ? new Date(Date.now() + retryDelayMinutes * 60_000).toISOString()
            : null,
          last_error:
            error instanceof Error ? error.message.slice(0, 1000) : 'Nieznany błąd wysyłki',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (shouldRetry) {
        retried += 1;
      } else {
        failed += 1;
        await notifyScheduler({
          job,
          status: 'failed',
          errorMessage: error instanceof Error ? error.message.slice(0, 400) : undefined,
        });
      }
      console.error('[process-scheduled-emails]', job.id, error);
    }
  }

  return json({ status: 'processed', processed: jobs.length, sent, retried, failed });
});
