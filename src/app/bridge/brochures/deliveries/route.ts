import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { demoAdmin, isDemoUuid } from '@/lib/seller/demo.server';
import { BrochureRequestError, requireBrochureEmployeeAccess } from '@/lib/brochures/access.server';
import { randomUUID } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const validEmail = (s: string) => s.length <= 200 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || new URL(origin).host !== request.headers.get('host')) return json({ error: 'Nieprawidłowe źródło żądania.' }, 403);
    const userClient = createSupabaseServerClient(cookies());
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Wymagane logowanie.' }, 401);
    const employeeId = await requireBrochureEmployeeAccess(userClient);
    const input = await request.json();
    const admin = demoAdmin();
    const assertMailbox = async (id: string) => {
      if (!isDemoUuid(id)) throw new Error('Wybierz skrzynkę nadawcy.');
      const { data: account } = await admin.from('employee_email_accounts').select('employee_id,is_active,account_type').eq('id', id).maybeSingle();
      if (!account?.is_active || account.account_type === 'system') throw new Error('Skrzynka nadawcy nie jest aktywna.');
      if (account.employee_id !== employeeId) {
        const { data: assignment } = await admin.from('employee_email_account_assignments').select('id').eq('employee_id', employeeId).eq('email_account_id', id).eq('can_send', true).maybeSingle();
        if (!assignment) throw new Error('Brak uprawnień do wysyłania z tej skrzynki.');
      }
    };
    if (input.action === 'prepare' || input.action === 'prepare_saved') {
      const savedVersion = input.action === 'prepare_saved';
      if (!isDemoUuid(input.generationId) || !isDemoUuid(input.batchId)) return json({ error: 'Nieprawidłowa wersja broszury.' }, 400);
      const email = String(input.recipient?.email || '').trim().toLowerCase();
      const subject = String(input.subject || '').trim();
      const html = String(input.bodyHtml || '');
      if (!validEmail(email) || !subject || subject.length > 250 || /[\r\n]/.test(subject) || !html.trim() || html.length > 2000000) return json({ error: 'Sprawdź adres odbiorcy, temat i treść.' }, 400);
      const { data: source, error } = await userClient.from('sales_brochure_generations').select('id,brochure_id,created_by,snapshot,recipient_contact_id,recipient_organization_id,recipient_email,recipient_name').eq('id', input.generationId).maybeSingle();
      if (error || !source || source.created_by !== employeeId) return json({ error: 'Możesz wysłać wyłącznie wersję wygenerowaną przez siebie.' }, 403);
      const sourceEmail = String(source.recipient_email || source.snapshot?.recipientEmail || source.snapshot?.demoAttribution?.recipientEmail || '').trim().toLowerCase();
      if (email !== sourceEmail && (!savedVersion || sourceEmail)) return json({ error: 'PDF został przygotowany dla innego adresu. Wygeneruj wersję dla tego odbiorcy.' }, 409);
      if (source.snapshot?.demoAttribution?.campaignId) return json({ error: 'Wersję kampanijną wyślij z poziomu jej kampanii.' }, 409);
      // Saved PDFs keep the original client, regardless of posted form fields.
      const contactId = savedVersion ? source.recipient_contact_id : input.recipient?.contactId || null;
      const organizationId = savedVersion ? source.recipient_organization_id : input.recipient?.organizationId || null;
      let name = savedVersion ? source.recipient_name || email : email;
      if (contactId) {
        if (!isDemoUuid(contactId)) return json({ error: 'Nieprawidłowy kontakt.' }, 400);
        const { data: c } = await userClient.from('contacts').select('id,full_name,email').eq('id', contactId).maybeSingle();
        if (!c || (!savedVersion && input.recipient?.manualAddress !== true && String(c.email || '').trim().toLowerCase() !== email)) return json({ error: 'Adres kontaktu zmienił się lub kontakt jest niedostępny. Wybierz go ponownie.' }, 409);
        name = c.full_name || email;
      }
      if (organizationId) {
        if (!isDemoUuid(organizationId)) return json({ error: 'Nieprawidłowa organizacja.' }, 400);
        const { data: o } = await userClient.from('organizations').select('id,name,email').eq('id', organizationId).maybeSingle();
        if (!o) return json({ error: 'Brak dostępu do organizacji.' }, 403);
        if (contactId && !savedVersion) {
          const { data: relation } = await userClient.from('contact_organizations').select('contact_id').eq('organization_id', organizationId).eq('contact_id', contactId).eq('is_current', true).limit(1).maybeSingle();
          if (!relation) return json({ error: 'Kontakt nie jest już powiązany z organizacją.' }, 409);
        } else if (!contactId) {
          if (!savedVersion && input.recipient?.manualAddress !== true && String(o.email || '').trim().toLowerCase() !== email) return json({ error: 'Adres organizacji zmienił się. Wybierz ją ponownie.' }, 409);
          name = o.name;
        }
      }
      await assertMailbox(input.emailAccountId);
      const previousDeliveryId = savedVersion && input.confirmResend === true && isDemoUuid(input.previousDeliveryId)
        ? input.previousDeliveryId : null;
      const { data, error: insertError } = await admin.rpc('prepare_saved_brochure_delivery', {
        p_batch_id: input.batchId, p_generation_id: source.id, p_employee_id: employeeId,
        p_contact_id: contactId, p_organization_id: organizationId, p_recipient_email: email,
        p_recipient_name: name, p_email_account_id: input.emailAccountId,
        p_subject: subject, p_body_html: html, p_previous_delivery_id: previousDeliveryId,
      });
      if (insertError) return json({ error: ['PGRST202', '42883'].includes(insertError.code)
        ? 'Najpierw wdróż migrację 20261020170000_send_saved_brochure_versions.sql. Wiadomość nie została wysłana.'
        : insertError.code === 'P0001' ? insertError.message
          : 'Nie udało się zapisać przygotowanej wiadomości. Odśwież historię przed ponowieniem.' }, 409);
      return json({ delivery: data });
    }
    if (!['send', 'update_saved', 'retry_uncertain'].includes(input.action) || !isDemoUuid(input.deliveryId)) return json({ error: 'Nieprawidłowe żądanie.' }, 400);
    const { data: delivery } = await userClient.from('sales_brochure_deliveries').select('*').eq('id', input.deliveryId).maybeSingle();
    if (!delivery || delivery.employee_id !== employeeId) return json({ error: 'Możesz wysyłać tylko własne przygotowane wiadomości.' }, 403);
    if (input.action === 'retry_uncertain') {
      if (input.acceptDuplicateRisk !== true) return json({
        error: 'Potwierdź, że poprzednia wiadomość mogła dotrzeć i ponowienie może spowodować duplikat.',
      }, 400);
      const { data: source } = await userClient.from('sales_brochure_generations')
        .select('created_by,snapshot').eq('id', delivery.generation_id).maybeSingle();
      if (!source || source.created_by !== employeeId) return json({ error: 'Brak dostępu do zapisanej wersji PDF.' }, 403);
      if (source.snapshot?.demoAttribution?.campaignId) return json({ error: 'Wersję kampanijną obsłuż z poziomu jej kampanii.' }, 409);
      await assertMailbox(delivery.email_account_id);
      // The database locks both the PDF version and the original attempt, copies
      // saved content and records consent as a new, linked draft. No SMTP call.
      const { data, error: retryError } = await admin.rpc('retry_uncertain_brochure_delivery', {
        p_delivery_id: delivery.id, p_employee_id: employeeId, p_accept_duplicate_risk: true,
      });
      if (retryError) return json({ error: ['PGRST202', '42883'].includes(retryError.code)
        ? 'Najpierw wdróż migrację 20261020200000_retry_uncertain_brochure_delivery.sql. Niczego nie wysłano.'
        : retryError.code === 'P0001' ? retryError.message
          : 'Nie udało się przygotować ponowienia. Odśwież stan przed następną próbą. Niczego nie wysłano.' }, 409);
      return json({ delivery: data });
    }
    if (input.action === 'send' && delivery.status === 'sent') return json({ delivery });
    if (!('superseded_at' in delivery)) return json({
      error: 'Najpierw wdróż migrację 20261020200000_retry_uncertain_brochure_delivery.sql. Niczego nie wysłano ani nie zmieniono.',
    }, 503);
    // A late transport reply can change an old uncertain attempt to failed.
    // Its replacement must remain the only draft that may be edited or sent.
    if (delivery.superseded_at) return json({
      error: 'Dla tej próby przygotowano już ponowienie. Odśwież stan i użyj najnowszej wiadomości.',
    }, 409);
    if (!Number.isInteger(delivery.draft_revision)) return json({
      error: 'Najpierw wdróż migrację 20261020180000_edit_prepared_brochure_deliveries.sql. Niczego nie wysłano ani nie zmieniono.',
    }, 503);
    if (!['prepared', 'failed'].includes(delivery.status)) return json({ error: delivery.status === 'uncertain'
      ? 'Wynik jest niepewny. Sprawdź folder Wysłane, a następnie użyj „Przygotuj ponowną wysyłkę” i potwierdź ryzyko duplikatu.'
      : 'Wysyłka jeszcze trwa. Odśwież stan przed kolejną próbą.' }, 409);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) return json({
      error: 'Odśwież formularz, aby odczytać aktualną wersję wiadomości przed zapisem lub wysyłką.',
    }, 409);
    if (input.action === 'update_saved') {
      const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
      const html = typeof input.bodyHtml === 'string' ? input.bodyHtml : '';
      if (!subject || subject.length > 250 || /[\r\n]/.test(subject) || !html.trim() || html.length > 2000000) {
        return json({ error: 'Uzupełnij temat (do 250 znaków) i treść wiadomości.' }, 400);
      }
      await assertMailbox(input.emailAccountId);
      const { data: source } = await userClient.from('sales_brochure_generations')
        .select('created_by,snapshot').eq('id', delivery.generation_id).maybeSingle();
      if (!source || source.created_by !== employeeId) return json({ error: 'Brak dostępu do zapisanej wersji PDF.' }, 403);
      if (source.snapshot?.demoAttribution?.campaignId) return json({ error: 'Wersję kampanijną obsłuż z poziomu jej kampanii.' }, 409);
      // An identical retry after losing the response is safe; an older editor
      // must never overwrite another tab's changes.
      if (delivery.draft_revision !== input.expectedRevision) {
        if (delivery.subject === subject && delivery.body_html === html && delivery.email_account_id === input.emailAccountId) {
          return json({ delivery });
        }
        return json({ error: 'Wiadomość zmieniła się w innym oknie. Twoje poprawki pozostają w edytorze. Sprawdź aktualny stan przed ponownym zapisem.' }, 409);
      }
      const { data: updated, error: updateError } = await admin.from('sales_brochure_deliveries')
        .update({ subject, body_html: html, email_account_id: input.emailAccountId, status: 'prepared', error_message: null })
        .eq('id', delivery.id).eq('employee_id', employeeId).eq('draft_revision', input.expectedRevision)
        .is('superseded_at', null).in('status', ['prepared', 'failed']).select('*').maybeSingle();
      if (updateError) return json({ error: 'Nie udało się zapisać poprawek. Treść pozostaje w edytorze; niczego nie wysłano.' }, 503);
      if (!updated) return json({ error: 'Stan wiadomości zmienił się podczas edycji. Nie zapisano poprawek ani nie uruchomiono wysyłki.' }, 409);
      // Recipient, generation, client associations and delivery history stay intact.
      return json({ delivery: updated });
    }
    if (delivery.draft_revision !== input.expectedRevision) return json({
      error: 'Treść wiadomości zmieniła się od ostatniego podglądu. Sprawdź aktualną wersję i dopiero zatwierdź wysyłkę. Niczego nie wysłano.',
    }, 409);
    if (!('dispatch_token' in delivery) || !('transport_started_at' in delivery)) return json({
      error: 'Najpierw wdróż migrację 20261020190000_stream_brochure_email_attachments.sql. Niczego nie wysłano.',
    }, 503);
    let token: string;
    try {
      await assertMailbox(delivery.email_account_id);
      const { data: source } = await userClient.from('sales_brochure_generations').select('pdf_path,file_size,created_by').eq('id', delivery.generation_id).maybeSingle();
      if (!source?.pdf_path || source.created_by !== employeeId) throw new Error('Brak dostępu do załączonego PDF.');
      if (!Number.isSafeInteger(source.file_size) || source.file_size <= 0 || source.file_size > 30_000_000) {
        throw new Error('Zapisany PDF przekracza limit 30 MB lub ma nieprawidłowy rozmiar. Wygeneruj broszurę ponownie, aby skompresować zdjęcia.');
      }
      const { data: { session } } = await userClient.auth.getSession();
      if (!session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
      token = session.access_token;
      // No message fields in this probe: an older deployment cannot accidentally
      // send a message without its attachment. Never fall back to base64.
      const probe = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'brochure_transport_capabilities' }),
        signal: AbortSignal.timeout(20000),
      });
      const capabilities = await probe.json().catch(() => null);
      if (!probe.ok || capabilities?.brochureTransportVersion !== 1) {
        throw new Error(capabilities?.deliveryState === 'not_sent' && typeof capabilities.error === 'string'
          ? capabilities.error
          : 'Zaktualizuj funkcję send-email oraz SMTP Relay Worker do wysyłki zapisanych broszur. Niczego nie wysłano.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Nie udało się przygotować wysyłki.';
      await admin.from('sales_brochure_deliveries').update({ status: 'failed', error_message: message }).eq('id', delivery.id).eq('draft_revision', input.expectedRevision).is('superseded_at', null).in('status', ['prepared', 'failed']);
      return json({ error: message }, 422);
    }
    const dispatchToken = randomUUID();
    const { data: claimed, error: claimError } = await admin.from('sales_brochure_deliveries').update({
      status: 'sending', attempted_at: new Date().toISOString(), error_message: null,
      dispatch_token: dispatchToken, transport_started_at: null,
    }).eq('id', delivery.id).eq('draft_revision', input.expectedRevision).is('superseded_at', null).in('status', ['prepared', 'failed']).select('*').maybeSingle();
    if (claimError || !claimed) return json({ error: 'Wiadomość zmieniła się lub jej wysyłka została już uruchomiona. Odśwież stan i sprawdź treść.' }, 409);
    // After this point a timeout/error cannot prove SMTP did not accept the message.
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailAccountId: claimed.email_account_id, to: claimed.recipient_email,
          subject: claimed.subject, body: claimed.body_html,
          brochureDeliveryId: claimed.id, brochureDispatchToken: dispatchToken,
        }), signal: AbortSignal.timeout(90000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        const detail = typeof result?.error === 'string' ? result.error.slice(0, 1500)
          : result?.code === 'WORKER_LIMIT'
            ? 'Usługa pocztowa przekroczyła limit zasobów.'
            : `Usługa pocztowa nie potwierdziła wysyłki (HTTP ${response.status}).`;
        console.error('Brochure transport failed:', { deliveryId: delivery.id, status: response.status, code: result?.code });
        if (result?.deliveryState === 'not_sent') {
          await admin.from('sales_brochure_deliveries')
            .update({ status: 'failed', error_message: detail })
            .eq('id', delivery.id).eq('dispatch_token', dispatchToken).in('status', ['sending', 'uncertain']);
          return json({ error: detail }, 422);
        }
        throw new Error(detail);
      }
      const { data: alreadySent } = await admin.from('sales_brochure_deliveries').select('*')
        .eq('id', delivery.id).eq('dispatch_token', dispatchToken).eq('status', 'sent').maybeSingle();
      if (alreadySent) return json({ delivery: alreadySent });
      const { data: sent, error: saveError } = await admin.from('sales_brochure_deliveries').update({
        status: 'sent', sent_at: new Date().toISOString(), message_id: result.messageId || null,
        sent_email_id: result.sentEmailId || null, error_message: null,
      }).eq('id', delivery.id).eq('dispatch_token', dispatchToken).in('status', ['sending', 'uncertain']).select('*').single();
      if (saveError) return json({ error: 'Serwer pocztowy przyjął wiadomość, ale zapis potwierdzenia nie powiódł się. Nie wysyłaj ponownie; sprawdź folder Wysłane.' }, 503);
      return json({ delivery: sent });
    } catch (error) {
      // The Edge Function may already have saved acceptance despite a lost
      // response. Never downgrade sent/failed or overwrite a newer attempt.
      const { data: current } = await admin.from('sales_brochure_deliveries').select('*')
        .eq('id', delivery.id).eq('dispatch_token', dispatchToken).maybeSingle();
      if (current?.status === 'sent') return json({ delivery: current });
      if (current?.status === 'failed') return json({ error: current.error_message || 'Wiadomość nie została wysłana.' }, 422);
      const reason = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'Przekroczono czas oczekiwania na potwierdzenie.'
        : error instanceof Error ? error.message : 'Utracono połączenie z usługą pocztową.';
      const message = current?.status === 'uncertain' && current.error_message ? current.error_message
        : `${reason} Wynik wysyłki jest niepewny. Odśwież stan i sprawdź folder Wysłane; automatyczne ponowienie jest zablokowane.`;
      await admin.from('sales_brochure_deliveries').update({ status: 'uncertain', error_message: message })
        .eq('id', delivery.id).eq('dispatch_token', dispatchToken).eq('status', 'sending');
      return json({ error: message }, 502);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Nie udało się obsłużyć wysyłki.' }, e instanceof BrochureRequestError ? e.status : 400);
  }
}
