import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { demoAdmin, isDemoUuid } from '@/lib/seller/demo.server';
import { BrochureRequestError, requireBrochureEmployeeAccess } from '@/lib/brochures/access.server';
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
    if (input.action === 'prepare') {
      if (!isDemoUuid(input.generationId) || !isDemoUuid(input.batchId)) return json({ error: 'Nieprawidłowa wersja broszury.' }, 400);
      const email = String(input.recipient?.email || '').trim().toLowerCase();
      const subject = String(input.subject || '').trim();
      const html = String(input.bodyHtml || '');
      if (!validEmail(email) || !subject || subject.length > 250 || /[\r\n]/.test(subject) || !html.trim() || html.length > 2000000) return json({ error: 'Sprawdź adres odbiorcy, temat i treść.' }, 400);
      const { data: source, error } = await userClient.from('sales_brochure_generations').select('id,brochure_id,created_by,snapshot').eq('id', input.generationId).maybeSingle();
      if (error || !source || source.created_by !== employeeId) return json({ error: 'Możesz wysłać wyłącznie wersję wygenerowaną przez siebie.' }, 403);
      const sourceEmail = String(source.snapshot?.recipientEmail || source.snapshot?.demoAttribution?.recipientEmail || '').trim().toLowerCase();
      if (email !== sourceEmail) return json({ error: 'PDF został przygotowany dla innego adresu. Wygeneruj wersję dla tego odbiorcy.' }, 409);
      const contactId = input.recipient?.contactId || null;
      const organizationId = input.recipient?.organizationId || null;
      let name = email;
      if (contactId) {
        if (!isDemoUuid(contactId)) return json({ error: 'Nieprawidłowy kontakt.' }, 400);
        const { data: c } = await userClient.from('contacts').select('id,full_name,email').eq('id', contactId).maybeSingle();
        if (!c || (input.recipient?.manualAddress !== true && String(c.email || '').trim().toLowerCase() !== email)) return json({ error: 'Adres kontaktu zmienił się lub kontakt jest niedostępny. Wybierz go ponownie.' }, 409);
        name = c.full_name || email;
      }
      if (organizationId) {
        if (!isDemoUuid(organizationId)) return json({ error: 'Nieprawidłowa organizacja.' }, 400);
        const { data: o } = await userClient.from('organizations').select('id,name,email').eq('id', organizationId).maybeSingle();
        if (!o) return json({ error: 'Brak dostępu do organizacji.' }, 403);
        if (contactId) {
          const { data: relation } = await userClient.from('contact_organizations').select('contact_id').eq('organization_id', organizationId).eq('contact_id', contactId).eq('is_current', true).limit(1).maybeSingle();
          if (!relation) return json({ error: 'Kontakt nie jest już powiązany z organizacją.' }, 409);
        } else {
          if (input.recipient?.manualAddress !== true && String(o.email || '').trim().toLowerCase() !== email) return json({ error: 'Adres organizacji zmienił się. Wybierz ją ponownie.' }, 409);
          name = o.name;
        }
      }
      await assertMailbox(input.emailAccountId);
      // Upsert must never overwrite a prepared message or reset its delivery status.
      const { data: existing } = await userClient.from('sales_brochure_deliveries').select('*').eq('batch_id', input.batchId).eq('recipient_email', email).maybeSingle();
      if (existing) return existing.employee_id === employeeId ? json({ delivery: existing }) : json({ error: 'Nieprawidłowa wysyłka.' }, 403);
      const { data, error: insertError } = await admin.from('sales_brochure_deliveries').insert({ batch_id: input.batchId, generation_id: source.id, brochure_id: source.brochure_id, employee_id: employeeId, contact_id: contactId, organization_id: organizationId, recipient_email: email, recipient_name: name, email_account_id: input.emailAccountId, subject, body_html: html }).select('*').single();
      if (insertError) return json({ error: 'Nie udało się zapisać przygotowanej wiadomości. Odśwież historię przed ponowieniem.' }, 409);
      return json({ delivery: data });
    }
    if (input.action !== 'send' || !isDemoUuid(input.deliveryId)) return json({ error: 'Nieprawidłowe żądanie.' }, 400);
    const { data: delivery } = await userClient.from('sales_brochure_deliveries').select('*').eq('id', input.deliveryId).maybeSingle();
    if (!delivery || delivery.employee_id !== employeeId) return json({ error: 'Możesz wysyłać tylko własne przygotowane wiadomości.' }, 403);
    if (delivery.status === 'sent') return json({ delivery });
    if (!['prepared', 'failed'].includes(delivery.status)) return json({ error: 'Wysyłka trwa lub jej wynik jest niepewny. Sprawdź folder Wysłane; ponowienie jest zablokowane, aby uniknąć duplikatu.' }, 409);
    let pdf: Blob;
    let fileName: string;
    let token: string;
    try {
      await assertMailbox(delivery.email_account_id);
      const { data: source } = await userClient.from('sales_brochure_generations').select('pdf_path,file_name,created_by').eq('id', delivery.generation_id).maybeSingle();
      if (!source || source.created_by !== employeeId) throw new Error('Brak dostępu do załączonego PDF.');
      const downloaded = await admin.storage.from('generated-brochures').download(source.pdf_path);
      if (downloaded.error || !downloaded.data) throw new Error('Nie udało się pobrać załącznika. Możesz ponowić wysyłkę.');
      pdf = downloaded.data; fileName = source.file_name;
      const { data: { session } } = await userClient.auth.getSession();
      if (!session) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
      token = session.access_token;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Nie udało się przygotować wysyłki.';
      await admin.from('sales_brochure_deliveries').update({ status: 'failed', error_message: message }).eq('id', delivery.id).in('status', ['prepared', 'failed']);
      return json({ error: message }, 422);
    }
    const attachment = Buffer.from(await pdf.arrayBuffer()).toString('base64');
    const { data: claimed, error: claimError } = await admin.from('sales_brochure_deliveries').update({ status: 'sending', attempted_at: new Date().toISOString(), error_message: null }).eq('id', delivery.id).in('status', ['prepared', 'failed']).select('id').maybeSingle();
    if (claimError || !claimed) return json({ error: 'Ta wiadomość została już uruchomiona. Odśwież historię.' }, 409);
    // After this point a timeout/error cannot prove SMTP did not accept the message.
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ emailAccountId: delivery.email_account_id, to: delivery.recipient_email, subject: delivery.subject, body: delivery.body_html, attachments: [{ filename: fileName, content: attachment, contentType: 'application/pdf', contentDisposition: 'attachment' }] }), signal: AbortSignal.timeout(90000) });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error('Brak jednoznacznego potwierdzenia wysyłki.');
      const { data: sent, error: saveError } = await admin.from('sales_brochure_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), message_id: result.messageId || null, sent_email_id: result.sentEmailId || null }).eq('id', delivery.id).eq('status', 'sending').select('*').single();
      if (saveError) return json({ error: 'Serwer pocztowy przyjął wiadomość, ale zapis potwierdzenia nie powiódł się. Nie wysyłaj ponownie; sprawdź folder Wysłane.' }, 503);
      return json({ delivery: sent });
    } catch {
      const message = 'Wynik wysyłki jest niepewny. Sprawdź folder Wysłane; automatyczne ponowienie jest zablokowane.';
      await admin.from('sales_brochure_deliveries').update({ status: 'uncertain', error_message: message }).eq('id', delivery.id).eq('status', 'sending');
      return json({ error: message }, 502);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Nie udało się obsłużyć wysyłki.' }, e instanceof BrochureRequestError ? e.status : 400);
  }
}
