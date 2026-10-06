import { systemEmailThemeHead, gmailWhiteText } from '../_shared/emailTheme.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Szablon korzysta ze wspólnego emailTheme.ts — wdrażaj przez Supabase CLI.
const EMAIL_BRAND = {
  background: '#1b0710',
  surface: '#351020',
  panel: '#46172b',
  gold: '#d3bb73',
  text: '#f3e9ed',
  cream: '#faf6f7',
} as const;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization') || '';
    const auth = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: authData } = await auth.auth.getUser();
    if (!authData.user) return json({ error: 'Unauthorized' }, 401);

    const service = createClient(url, serviceKey);
    const { data: employee } = await service
      .from('employees')
      .select('id, role, access_level, permissions')
      .eq('is_active', true)
      .or(`auth_user_id.eq.${authData.user.id},id.eq.${authData.user.id}`)
      .limit(1)
      .maybeSingle();
    const permissions: string[] = Array.isArray(employee?.permissions) ? employee.permissions : [];
    const mayManage =
      employee &&
      (employee.role === 'admin' ||
        employee.access_level === 'admin' ||
        permissions.includes('events_manage') ||
        permissions.includes('subcontractors_manage'));
    if (!mayManage) return json({ error: 'Forbidden' }, 403);

    const { taskId } = await request.json();
    if (!taskId) return json({ error: 'taskId is required' }, 400);
    const { data: task, error } = await service
      .from('subcontractor_tasks')
      .select(
        `
      id, updated_at, task_name, scope_of_work, description, deliverables, guidelines,
      scheduled_start, scheduled_end, contact_name_snapshot, contact_email_snapshot,
      subcontractors(company_name, contact_person, email),
      events(id, name, event_date, event_end_date, my_company_id, location_room_ids, stage_room_id, location:locations!location_id(name, formatted_address, rooms))
    `,
      )
      .eq('id', taskId)
      .maybeSingle();
    if (error || !task) return json({ error: 'Subcontractor order not found' }, 404);

    const provider = Array.isArray(task.subcontractors)
      ? task.subcontractors[0]
      : task.subcontractors;
    const event = Array.isArray(task.events) ? task.events[0] : task.events;
    const location = Array.isArray(event?.location) ? event.location[0] : event?.location;
    const selectedRooms = (location?.rooms || []).filter((room: any) =>
      (event?.location_room_ids || []).includes(room.id),
    );
    const roomDescription = selectedRooms
      .map(
        (room: any) =>
          `${room.name}${room.id === event?.stage_room_id ? ' — scena / DJ' : ''}${room.notes ? ` (${room.notes})` : ''}`,
      )
      .join('; ');
    const locationDescription = [location?.name, location?.formatted_address]
      .filter(Boolean)
      .join(' · ');
    const recipient = task.contact_email_snapshot || provider?.email;
    if (!recipient) return json({ error: 'Subcontractor email is missing' }, 400);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
      return json({ error: 'Uzupełnij prawidłowy adres e-mail podwykonawcy' }, 400);
    if (!task.scope_of_work?.trim() && !task.description?.trim())
      return json({ error: 'Uzupełnij zakres obowiązków przed wysłaniem' }, 400);
    const token = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    const appUrl = (Deno.env.get('PUBLIC_APP_URL') || 'https://mavinci.pl').replace(/\/$/, '');
    const confirmationUrl = `${appUrl}/subcontractor-confirmation?token=${encodeURIComponent(token)}`;
    const format = (value?: string | null) =>
      value
        ? new Date(value).toLocaleString('pl-PL', {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: 'Europe/Warsaw',
          })
        : 'do ustalenia';
    const startsAt = task.scheduled_start || event?.event_date;
    const endsAt = task.scheduled_end || event?.event_end_date;
    let companyQuery = service
      .from('my_companies')
      .select('id, legal_name, logo_url, phone, email')
      .eq('is_active', true);
    companyQuery = event?.my_company_id
      ? companyQuery.eq('id', event.my_company_id)
      : companyQuery.order('is_default', { ascending: false });
    const { data: company, error: companyError } = await companyQuery.limit(1).maybeSingle();
    if (companyError) throw companyError;
    let logoUrl = '';
    let accent: string = EMAIL_BRAND.gold;
    if (company) {
      const [logosResult, colorsResult] = await Promise.all([
        service
          .from('company_brandbook_logos')
          .select('url,label,variant,order_index')
          .eq('company_id', company.id)
          .order('order_index'),
        service.from('company_brandbook_colors').select('hex,role').eq('company_id', company.id),
      ]);
      if (logosResult.error) throw logosResult.error;
      if (colorsResult.error) throw colorsResult.error;
      const normalize = (value?: string) =>
        (value || '')
          .trim()
          .toLowerCase()
          .replace(/\.(svg|png|webp|jpe?g)$/i, '')
          .replace(/[\s_]+/g, '-');
      const logos = logosResult.data || [];
      const logo =
        logos.find(
          (entry) =>
            normalize(entry.label) === 'primary-black' ||
            normalize(entry.variant) === 'primary-black',
        ) ||
        logos.find(
          (entry) => normalize(entry.label) === 'primary' || normalize(entry.variant) === 'primary',
        );
      const rawLogo = logo?.url || company.logo_url || '';
      logoUrl = /^https:\/\//i.test(rawLogo)
        ? rawLogo
        : rawLogo && !rawLogo.includes(':')
          ? service.storage.from('company-logos').getPublicUrl(rawLogo.replace(/^\/+/, '')).data
              .publicUrl
          : '';
      const color = (role: string, fallback: string) => {
        const value = colorsResult.data?.find((entry) => entry.role === role)?.hex;
        return /^#[0-9a-f]{6}$/i.test(value || '') ? value! : fallback;
      };
      accent = color('accent', color('secondary', accent));
    }
    const detailRow = (label: string, value: string) =>
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-bottom:1px solid #ede9df"><tr><td class="email-label" width="140" valign="top" style="padding:8px 12px 8px 0;font-size:12px;color:#76616a">${escapeHtml(label)}</td><td valign="top" style="padding:8px 0;font-size:14px;color:#333;font-weight:500">${escapeHtml(value)}</td></tr></table>`;
    const section = (title: string, content: string) =>
      `<div class="email-section" style="margin-top:24px"><div class="email-heading" style="font-size:14px;font-weight:600;color:#651b38;margin-bottom:12px">${escapeHtml(title)}</div><div class="email-panel" style="background:${EMAIL_BRAND.cream};border:1px solid #e8e4d9;border-radius:8px;padding:16px;font-size:14px;line-height:1.6;color:#333;overflow-wrap:anywhere">${escapeHtml(content).replace(/\r?\n/g, '<br>')}</div></div>`;
    const body = `<!DOCTYPE html>
<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
@media only screen and (max-width: 600px) {
  .email-shell { padding: 12px 6px !important; }
  .email-header { padding: 20px 16px !important; }
  .email-content { padding: 20px 12px !important; }
  .email-panel { padding: 12px !important; }
  .email-event { padding: 16px 12px !important; margin-bottom: 16px !important; }
  .email-footer { padding: 16px 12px !important; }
  .email-gap { margin-bottom: 16px !important; }
  .email-section { margin-top: 16px !important; }
  .email-label { width: 100px !important; padding-right: 8px !important; }
  .email-content td { overflow-wrap: anywhere; word-break: break-word; }
}
</style>
${systemEmailThemeHead}
</head>
<body class="mavinci-email" style="margin:0;padding:0;background:${EMAIL_BRAND.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div class="email-shell" style="max-width:600px;margin:0 auto;padding:40px 20px">
    <div class="email-card" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06)">
      <div class="email-header" style="background:${EMAIL_BRAND.surface};background-image:linear-gradient(${EMAIL_BRAND.surface},${EMAIL_BRAND.surface});padding:32px 40px;text-align:center">
        ${logoUrl ? `<div style="display:inline-block;background:${EMAIL_BRAND.surface};background-image:linear-gradient(${EMAIL_BRAND.surface},${EMAIL_BRAND.surface});border-radius:8px;padding:12px 20px;margin-bottom:16px"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(company?.legal_name || 'MAVINCI')}" width="140" style="display:block;width:140px;max-width:100%;height:auto;border:0"></div>` : `<div style="font-size:20px;font-weight:700;color:${accent};margin-bottom:8px">${gmailWhiteText(escapeHtml(company?.legal_name || 'MAVINCI'))}</div>`}
        <div style="font-size:13px;color:${EMAIL_BRAND.text};letter-spacing:1px;text-transform:uppercase">${gmailWhiteText('Wytyczne realizacji')}</div>
      </div>
      <div class="email-content" style="padding:40px">
        <div class="email-gap" style="font-size:15px;color:#333;line-height:1.6;margin-bottom:24px">Dzień dobry, <strong>${escapeHtml(task.contact_name_snapshot || provider?.contact_person || provider?.company_name || '')}</strong>,</div>
        <div class="email-gap" style="font-size:15px;color:#333;line-height:1.6;margin-bottom:24px">prosimy o zapoznanie się z wytycznymi i potwierdzenie ich przyjęcia do realizacji wydarzenia:</div>
        <div class="email-event email-gap" style="background:${EMAIL_BRAND.cream};border-radius:10px;padding:24px;margin-bottom:24px"><div class="email-heading" style="font-size:18px;font-weight:600;color:#651b38">${escapeHtml(event?.name || '')}</div></div>
        <div class="email-gap" style="margin-bottom:24px"><div class="email-heading" style="font-size:14px;font-weight:600;color:#651b38;margin-bottom:12px">Szczegóły zlecenia</div><div class="email-panel" style="background:${EMAIL_BRAND.cream};border:1px solid #e8e4d9;border-radius:8px;padding:16px">
          ${locationDescription ? detailRow('Miejsce', locationDescription) : ''}${roomDescription ? detailRow('Sale realizacji', roomDescription) : ''}${detailRow('Zlecenie', task.task_name)}${detailRow('Od', format(startsAt))}${detailRow('Do', format(endsAt))}
        </div></div>
        ${section('Zakres obowiązków', task.scope_of_work || task.description || 'Brak dodatkowego opisu')}
        ${task.deliverables ? section('Oczekiwany rezultat', task.deliverables) : ''}
        ${task.guidelines ? section('Wytyczne organizacyjne', task.guidelines) : ''}
        <div style="text-align:center;margin:32px 0 16px"><a class="email-cta" href="${escapeHtml(confirmationUrl)}" style="display:inline-block;background:${accent};color:${EMAIL_BRAND.surface};text-decoration:none;padding:14px 24px;border-radius:8px;font-size:14px;line-height:1.5;font-weight:600">Zapoznałem się i zaakceptowałem</a></div>
        <p style="font-size:12px;line-height:1.6;color:#76616a;text-align:center">Przycisk otworzy wytyczne. Po ich przeczytaniu potwierdź akceptację imieniem i nazwiskiem. Opiekun otrzyma powiadomienie. Link jest ważny przez 30 dni.</p>
        <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e8e4d9;font-size:14px;color:#555;line-height:1.6">W razie pytań lub zmian prosimy o kontakt${company?.phone ? ` pod numerem <strong>${escapeHtml(company.phone)}</strong>` : ''}${company?.email ? ` lub mailowo: <strong>${escapeHtml(company.email)}</strong>` : ''}.</div>
        <div class="email-section" style="margin-top:24px;font-size:14px;color:#333">Z poważaniem,<br><strong>Zespół ${escapeHtml(company?.legal_name || 'Mavinci')}</strong></div>
      </div>
      <div class="email-footer" style="background:${EMAIL_BRAND.cream};padding:20px 40px;text-align:center;font-size:11px;color:#999">Ta wiadomość została wygenerowana automatycznie. Prosimy nie odpowiadać na ten adres.</div>
    </div>
  </div>
</body></html>`;

    const { data: account } = await service
      .from('employee_email_accounts')
      .select('id')
      .eq('is_system_account', true)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!account) return json({ error: 'System email account is not configured' }, 409);
    // Separate repeat notifications into their own Gmail conversation.
    const deliveryStamp = new Date().toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const tokenHash = await hash(token);
    const snapshot = {
      taskName: task.task_name,
      locationDescription,
      roomDescription,
      eventName: event?.name,
      providerName: provider?.company_name,
      startsAt,
      endsAt,
      scopeOfWork: task.scope_of_work || task.description,
      deliverables: task.deliverables,
      guidelines: task.guidelines,
    };
    const { data: prepared, error: updateError } = await service
      .from('subcontractor_tasks')
      .update({
        confirmation_token_hash: tokenHash,
        confirmation_expires_at: expiresAt.toISOString(),
        guidelines_status: 'sent',
        guidelines_sent_at: new Date().toISOString(),
        guidelines_sent_by: authData.user.id,
        guidelines_snapshot: snapshot,
        confirmed_at: null,
        confirmed_by_name: null,
        declined_at: null,
        response_note: null,
        reminder_week_sent_at: null,
        reminder_day_sent_at: null,
      })
      .eq('id', taskId)
      .eq('updated_at', task.updated_at)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!prepared)
      return json(
        { error: 'Zlecenie zmieniło się podczas wysyłania. Odśwież je i spróbuj ponownie.' },
        409,
      );
    try {
      const relay = await fetch(`${url}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          to: recipient,
          subject: `Wytyczne: ${task.task_name} · ${event?.name || 'wydarzenie'} · ${deliveryStamp}`,
          body,
          emailAccountId: account.id,
        }),
      });
      const relayResult = await relay.json().catch(() => null);
      if (!relay.ok || relayResult?.error || relayResult?.success === false) {
        throw new Error('Nie udało się wysłać wiadomości. Spróbuj ponownie.');
      }
    } catch (sendError) {
      await service
        .from('subcontractor_tasks')
        .update({
          guidelines_status: 'draft',
          confirmation_token_hash: null,
          confirmation_expires_at: null,
          guidelines_sent_at: null,
          guidelines_sent_by: null,
          guidelines_snapshot: null,
        })
        .eq('id', taskId)
        .eq('confirmation_token_hash', tokenHash)
        .eq('guidelines_status', 'sent');
      throw sendError;
    }

    return json({ success: true });
  } catch (error) {
    console.error('send-subcontractor-assignment', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
