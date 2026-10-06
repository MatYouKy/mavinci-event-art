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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const DEFAULT_COMPANY_ID = 'd4474f90-5e61-4ba4-928e-c25c0f0659b5';
const DEFAULT_EMAIL_LOGO_URL =
  'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/company-logos/brandbook/d4474f90-5e61-4ba4-928e-c25c0f0659b5/1779367661905.png';

const toPublicCompanyLogoUrl = (value: string, supabaseUrl: string): string => {
  if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
  return `${supabaseUrl}/storage/v1/object/public/company-logos/${value.replace(/^\/+/, '')}`;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { eventId } = await req.json();

    if (!eventId) {
      throw new Error('eventId is required');
    }

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(
        `
        id,
        name,
        event_date,
        event_end_date,
        status,
        budget,
        financial_source,
        accepted_calculation_id,
        description,
        notes,
        location_id,
        organization_id,
        contact_person_id,
        category_id,
        my_company_id,
        location_room_ids,
        stage_room_id
      `,
      )
      .eq('id', eventId)
      .maybeSingle();

    if (eventError || !event) {
      throw new Error('Event not found');
    }

    const [
      organizationRes,
      contactRes,
      phasesRes,
      locationRes,
      categoryRes,
      offerRes,
      companyRes,
      brandbookLogoRes,
      calculationRes,
    ] = await Promise.all([
      event.organization_id
        ? supabase
            .from('organizations')
            .select('name, email, phone, nip')
            .eq('id', event.organization_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      event.contact_person_id
        ? supabase
            .from('contacts')
            .select('first_name, last_name, full_name, email, phone, mobile')
            .eq('id', event.contact_person_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('event_phases')
        .select('name, phase_type:event_phase_types(name), start_time, end_time, sequence_order')
        .eq('event_id', eventId)
        .order('sequence_order', { ascending: true }),
      event.location_id
        ? supabase
            .from('locations')
            .select('name, city, address, postal_code, rooms')
            .eq('id', event.location_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      event.category_id
        ? supabase.from('event_categories').select('name').eq('id', event.category_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('offers')
        .select(
          `
          id, offer_number, subtotal, discount_amount, tax_amount, tax_percent, total_amount,
          accepted_package_id, logistics_enabled, logistics_price_net,
          offer_items(name, quantity, unit, total, display_order)
        `,
        )
        .eq('event_id', eventId)
        .eq('status', 'accepted')
        .order('accepted_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      event.my_company_id
        ? supabase
            .from('my_companies')
            .select('legal_name, phone, email, logo_url')
            .eq('id', event.my_company_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      event.my_company_id
        ? supabase
            .from('company_brandbook_logos')
            .select('url')
            .eq('company_id', event.my_company_id)
            .eq('is_default', true)
            .order('order_index', { ascending: true })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('event_calculations')
        .select('id, name, event_calculation_items(quantity, unit_price, days, vat_rate)')
        .eq('event_id', eventId)
        .eq('is_accepted', true)
        .maybeSingle(),
    ]);

    const organization = organizationRes.data;
    const contact = contactRes.data;
    if (phasesRes.error) throw phasesRes.error;
    if (locationRes.error) throw locationRes.error;
    const phases = phasesRes.data || [];
    const location = locationRes.data;
    const category = categoryRes.data;
    if (offerRes.error) throw offerRes.error;
    if (calculationRes.error) throw calculationRes.error;
    const offer = offerRes.data;
    const acceptedCalculation = calculationRes.data;
    let acceptedPackage = null;
    if (offer?.accepted_package_id) {
      const result = await supabase
        .from('offer_packages')
        .select('price_net, list_price_net, discount_amount')
        .eq('id', offer.accepted_package_id)
        .eq('offer_id', offer.id)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Nie znaleziono zaakceptowanego pakietu oferty');
      acceptedPackage = result.data;
    }
    const useCalculation = event.financial_source === 'calculation' || (!offer && Boolean(acceptedCalculation));
    if (useCalculation && (!acceptedCalculation ||
      (event.accepted_calculation_id && acceptedCalculation.id !== event.accepted_calculation_id))) {
      throw new Error('Nie znaleziono zaakceptowanej kalkulacji będącej źródłem budżetu.');
    }
    let budget = useCalculation
      ? calculationConfirmationBudget(acceptedCalculation?.event_calculation_items || [])
      : confirmationBudget(offer, acceptedPackage);

    // Legacy events can be accepted while the linked offer remains a draft.
    // Use that document only when it unambiguously explains the event's saved budget.
    if (!budget && ['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced', 'settled'].includes(event.status)) {
      const { data: linkedOffers, error: linkedError } = await supabase.from('offers')
        .select('id, subtotal, discount_amount, tax_amount, tax_percent, total_amount, package_mode, accepted_package_id')
        .eq('event_id', eventId)
        .limit(2);
      if (linkedError) throw linkedError;
      const candidate = linkedOffers?.length === 1 ? linkedOffers[0] : null;
      const eventGross = event.budget == null ? NaN : Number(event.budget);
      const candidateGross = candidate?.total_amount == null ? NaN : Number(candidate.total_amount);
      if (candidate && !candidate.package_mode && !candidate.accepted_package_id &&
        candidate.tax_percent != null && Number.isFinite(Number(candidate.tax_percent)) &&
        Number.isFinite(eventGross) && eventGross >= 0 && Number.isFinite(candidateGross) &&
        Math.round(eventGross * 100) === Math.round(candidateGross * 100)) {
        budget = confirmationBudget(candidate, null);
      }
      if (!budget) {
        throw new Error('Nie można jednoznacznie ustalić zaakceptowanego budżetu netto i brutto. Zaakceptuj właściwą ofertę lub kalkulację przed wysłaniem potwierdzenia.');
      }
    }
    const company = companyRes.data;
    const brandbookLogo = brandbookLogoRes.data;

    const recipientEmail = contact?.email || organization?.email;

    if (!recipientEmail) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Brak adresu email odbiorcy (brak emaila kontaktu ani organizacji)',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const contactName =
      contact?.full_name ||
      [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') ||
      organization?.name ||
      'Szanowni Państwo';

    const formatDateTime = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    };
    const eventTime = formatDateTime(event.event_date);
    const eventEndTime = formatDateTime(event.event_end_date);

    const locationText = location
      ? [
          location.name,
          location.address,
          [location.postal_code, location.city].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', ')
      : null;

    const realizationPhase = phases.find((p: any) => {
      const type = Array.isArray(p.phase_type) ? p.phase_type[0] : p.phase_type;
      return ['realizacja', 'realization'].includes((type?.name || p.name || '').trim().toLocaleLowerCase('pl-PL'));
    });
    const realizationTime = realizationPhase
      ? { start: formatDateTime(realizationPhase.start_time), end: formatDateTime(realizationPhase.end_time) }
      : null;

    const offerItems = offer?.offer_items
      ? [...offer.offer_items]
          .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map((item: any) => item.name)
          .filter(Boolean)
      : [];

    const companyName = company?.legal_name || 'Mavinci';
    const rawCompanyLogo =
      brandbookLogo?.url ||
      (event.my_company_id === DEFAULT_COMPANY_ID ? DEFAULT_EMAIL_LOGO_URL : company?.logo_url);
    const companyLogo = rawCompanyLogo ? toPublicCompanyLogoUrl(rawCompanyLogo, supabaseUrl) : null;

    const emailBody = buildConfirmationEmailHtml({
      contactName,
      roomDescription:
        (location?.rooms || [])
          .filter((room: any) => (event.location_room_ids || []).includes(room.id))
          .map(
            (room: any) => `${room.name}${room.id === event.stage_room_id ? ' — scena / DJ' : ''}`,
          )
          .join('; ') || null,
      acceptedOfferNumber: !useCalculation ? offer?.offer_number || null : null,
      acceptedCalculationName: useCalculation ? acceptedCalculation?.name || null : null,
      budgetBeforeDiscountNet: budget?.beforeDiscountNet ?? null,
      budgetDiscountNet: budget?.discountNet ?? null,
      budgetNet: budget?.net ?? null,
      budgetGross: budget?.gross ?? null,
      eventName: event.name,
      eventTime,
      eventEndTime,
      realizationTime,
      locationText,
      categoryName: category?.name || null,
      offerItems,
      companyName,
      companyPhone: company?.phone || null,
      companyEmail: company?.email || null,
      companyLogo,
    });

    const { data: systemEmail } = await supabase
      .from('employee_email_accounts')
      .select('id')
      .eq('is_system_account', true)
      .maybeSingle();

    if (!systemEmail) {
      throw new Error('Brak skonfigurowanego konta email systemowego');
    }

    // Separate repeat notifications into their own Gmail conversation.
    const deliveryStamp = new Date().toLocaleString('pl-PL', {
      timeZone: 'Europe/Warsaw',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;
    const sendEmailResponse = await fetch(sendEmailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.get('Authorization') || '',
      },
      body: JSON.stringify({
        to: recipientEmail,
        subject: `Potwierdzenie realizacji: ${event.name} · ${deliveryStamp}`,
        body: emailBody,
        emailAccountId: systemEmail.id,
      }),
    });

    if (!sendEmailResponse.ok) {
      const errorData = await sendEmailResponse.json();
      throw new Error(`Failed to send email: ${errorData.error || 'Unknown error'}`);
    }

    const sentAt = new Date().toISOString();
    const { error: historyError } = await supabase.from('event_audit_log').insert({
      event_id: eventId,
      user_name: 'System',
      action: 'email_sent',
      field_name: 'acceptance_confirmation_email',
      new_value: recipientEmail,
      description: `Wysłano potwierdzenie realizacji do ${recipientEmail}`,
      created_at: sentAt,
    });
    // Delivery already succeeded: never report a send failure that could provoke a duplicate.
    if (historyError) console.error('[send-event-confirmation] Cannot persist delivery history:', historyError);

    return new Response(
      JSON.stringify({
        success: true,
        sentAt,
        historyRecorded: !historyError,
        message: `Confirmation email sent to ${recipientEmail}`,
        recipientEmail,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('[send-event-confirmation] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

interface ConfirmationEmailData {
  contactName: string;
  roomDescription?: string | null;
  acceptedOfferNumber: string | null;
  acceptedCalculationName: string | null;
  budgetBeforeDiscountNet: number | null;
  budgetDiscountNet: number | null;
  budgetNet: number | null;
  budgetGross: number | null;
  locationName?: string | null;
  acceptedByText?: string | null;
  eventName: string;
  eventTime: string | null;
  eventEndTime: string | null;
  realizationTime: { start: string | null; end: string | null } | null;
  locationText: string | null;
  categoryName: string | null;
  offerItems: string[];
  companyName: string;
  companyPhone: string | null;
  companyEmail: string | null;
  companyLogo: string | null;
}

function buildConfirmationEmailHtml(data: ConfirmationEmailData): string {
  const detailRows: string[] = [];

  if (data.acceptedOfferNumber) {
    detailRows.push(buildDetailRow('Zaakceptowana oferta', data.acceptedOfferNumber));
  }
  if (data.acceptedCalculationName) {
    detailRows.push(buildDetailRow('Zaakceptowana kalkulacja', data.acceptedCalculationName));
  }

  if (data.eventTime) {
    detailRows.push(buildDetailRow('Rozpoczęcie wydarzenia', data.eventTime));
  }
  if (data.eventEndTime) {
    detailRows.push(buildDetailRow('Zakończenie wydarzenia', data.eventEndTime));
  }
  if (data.realizationTime?.start && data.realizationTime.start !== data.eventTime) {
    detailRows.push(buildDetailRow('Rozpoczęcie realizacji', data.realizationTime.start));
  }
  if (data.realizationTime?.end && data.realizationTime.end !== data.eventEndTime) {
    detailRows.push(buildDetailRow('Zakończenie realizacji', data.realizationTime.end));
  }

  if (data.locationText) {
    detailRows.push(buildDetailRow('Miejsce', data.locationText));
  }

  if (data.roomDescription)
    detailRows.push(buildDetailRow('Sale realizacji', data.roomDescription));

  if (data.categoryName) {
    detailRows.push(buildDetailRow('Typ wydarzenia', data.categoryName));
  }

  if (data.locationName) {
    detailRows.push(buildDetailRow('Nazwa lokalizacji', data.locationName));
  }

  if (data.acceptedByText) {
    detailRows.push(buildDetailRow('Zaakceptował/a', data.acceptedByText));
  }

  const budgetHtml = data.budgetNet != null && data.budgetGross != null
    ? `<div class="email-gap" style="margin-bottom:24px;">
        <div class="email-heading" style="font-size:14px;font-weight:600;color:#651b38;margin-bottom:12px;">Zaakceptowany budżet za usługę</div>
        <div class="email-panel" style="background:${EMAIL_BRAND.cream};border:1px solid #e8e4d9;border-radius:8px;padding:16px;">
          ${buildDetailRow('Cena netto przed rabatem', (data.budgetBeforeDiscountNet ?? data.budgetNet).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))}
          ${buildDetailRow('Udzielony rabat netto', (data.budgetDiscountNet ?? 0) > 0 ? `−${data.budgetDiscountNet!.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })}` : 'Bez rabatu')}
          ${buildDetailRow('Cena netto po rabacie', data.budgetNet.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))}
          ${buildDetailRow('Cena brutto po rabacie', data.budgetGross.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }))}
        </div>
      </div>`
    : '';

  const scopeHtml =
    data.offerItems.length > 0
      ? `
    <div class="email-section" style="margin-top: 24px;">
      <div class="email-heading" style="font-size: 14px; font-weight: 600; color: #651b38; margin-bottom: 12px;">
        Zakres realizacji
      </div>
      <div class="email-panel" style="background: ${EMAIL_BRAND.cream}; border: 1px solid #e8e4d9; border-radius: 8px; padding: 16px;">
        ${data.offerItems.map((item) => `<div style="padding: 6px 0; border-bottom: 1px solid #ede9df; font-size: 13px; color: #333;">${escapeHtml(item)}</div>`).join('')}
      </div>
    </div>
  `
      : '';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
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
<style>
.email-content .email-event-brand { background-color:#351020 !important; background-image:linear-gradient(#351020,#351020) !important; }
.email-content .email-event-brand div { color:#ffffff !important; }
[data-ogsc] .email-content .email-event-brand { background-color:#351020 !important; }
[data-ogsc] .email-content .email-event-brand div { color:#ffffff !important; }
</style>
</head>
<body class="mavinci-email" style="margin: 0; padding: 0; background: ${EMAIL_BRAND.cream}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div class="email-shell" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div class="email-card" style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">

      <!-- Header -->
      <div class="email-header" style="background: ${EMAIL_BRAND.surface}; background-image:linear-gradient(${EMAIL_BRAND.surface},${EMAIL_BRAND.surface}); padding: 32px 40px; text-align: center;">
        ${data.companyLogo ? `<img src="${data.companyLogo}" alt="${escapeHtml(data.companyName)}" style="height: 36px; margin-bottom: 16px;">` : `<div style="font-size: 20px; font-weight: 700; color: #d3bb73; margin-bottom: 8px;">${gmailWhiteText(escapeHtml(data.companyName))}</div>`}
        <div style="font-size: 13px; color: #ffffff; letter-spacing: 1px; text-transform: uppercase;">
          ${gmailWhiteText('Potwierdzenie realizacji')}
        </div>
      </div>

      <!-- Body -->
      <div class="email-content" style="padding: 40px;">
        <div class="email-gap" style="font-size: 15px; color: #333; line-height: 1.6; margin-bottom: 24px;">
          Dzień dobry, <strong>${escapeHtml(data.contactName)}</strong>,
        </div>

        <div class="email-gap" style="font-size: 15px; color: #333; line-height: 1.6; margin-bottom: 24px;">
          Z przyjemnością potwierdzamy realizację wydarzenia:
        </div>

        <div class="email-event email-gap email-event-brand" style="background: ${EMAIL_BRAND.surface}; background-image:linear-gradient(${EMAIL_BRAND.surface},${EMAIL_BRAND.surface}); border-radius: 10px; padding: 24px; margin-bottom: 24px;">
          <div style="font-size: 18px; font-weight: 600; color: #ffffff; margin-bottom: 4px;">
            ${gmailWhiteText(escapeHtml(data.eventName))}
          </div>
        </div>

        ${
          detailRows.length > 0
            ? `
        <div class="email-gap" style="margin-bottom: 24px;">
          <div class="email-heading" style="font-size: 14px; font-weight: 600; color: #651b38; margin-bottom: 12px;">
            Szczegóły
          </div>
          <div class="email-panel" style="background: ${EMAIL_BRAND.cream}; border: 1px solid #e8e4d9; border-radius: 8px; padding: 16px;">
            ${detailRows.join('')}
          </div>
        </div>
        `
            : ''
        }

        ${budgetHtml}
        ${scopeHtml}

        <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e8e4d9; font-size: 14px; color: #555; line-height: 1.6;">
          W razie pytań lub zmian prosimy o kontakt${data.companyPhone ? ` pod numerem <strong>${escapeHtml(data.companyPhone)}</strong>` : ''}${data.companyEmail ? ` lub mailowo: <strong>${escapeHtml(data.companyEmail)}</strong>` : ''}.
        </div>

        <div class="email-section" style="margin-top: 24px; font-size: 14px; color: #333;">
          Z poważaniem,<br>
          <strong>Zespół ${escapeHtml(data.companyName)}</strong>
        </div>
      </div>

      <!-- Footer -->
      <div class="email-footer" style="background: ${EMAIL_BRAND.cream}; padding: 20px 40px; text-align: center; font-size: 11px; color: #999;">
        Ta wiadomość została wygenerowana automatycznie. Prosimy nie odpowiadać na ten adres.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildDetailRow(label: string, value: string): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-bottom:1px solid #ede9df;">
      <tr>
        <td class="email-label" width="140" valign="top" style="padding:8px 12px 8px 0;font-size:12px;color:#76616a;">${escapeHtml(label)}</td>
        <td valign="top" style="padding:8px 0;font-size:14px;color:#333;font-weight:500;">${escapeHtml(value)}</td>
      </tr>
    </table>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Kwoty pakietu są już po rabacie pakietowym; nie odejmujemy go ponownie.
function confirmationBudget(offer: any, acceptedPackage: { price_net: unknown; list_price_net: unknown; discount_amount: unknown } | null) {
  if (!offer) return null;
  const number = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const rate = number(offer.tax_percent) ?? 23;
  if (acceptedPackage) {
    const packageNet = number(acceptedPackage.price_net);
    if (packageNet === null) throw new Error('Nieprawidłowa cena zaakceptowanego pakietu');
    const net = money(
      packageNet + (offer.logistics_enabled ? (number(offer.logistics_price_net) ?? 0) : 0),
    );
    const packageListNet = number(acceptedPackage.list_price_net);
    const discountNet = money(packageListNet !== null
      ? Math.max(0, packageListNet - packageNet)
      : (number(acceptedPackage.discount_amount) ?? 0));
    return {
      beforeDiscountNet: money(net + discountNet),
      discountNet,
      net,
      gross: money(net + money((net * rate) / 100)),
    };
  }
  const subtotal = number(offer.subtotal);
  const discount = number(offer.discount_amount) ?? 0;
  const storedTax = number(offer.tax_amount);
  const storedGross = number(offer.total_amount);
  if (subtotal === null && storedGross === null)
    throw new Error('Brak końcowej kwoty zaakceptowanej oferty');
  const net = money(
    subtotal !== null
      ? Math.max(0, subtotal - discount)
      : storedTax !== null
        ? Math.max(0, storedGross! - storedTax)
        : storedGross! / (1 + rate / 100),
  );
  const gross = storedGross ?? money(net + (storedTax ?? money((net * rate) / 100)));
  const beforeDiscountNet = money(subtotal ?? net + discount);
  return { beforeDiscountNet, discountNet: money(Math.max(0, beforeDiscountNet - net)), net, gross: money(gross) };
}

// Match calculation totals: round each line net and gross, then sum.
function calculationConfirmationBudget(items: Array<{ quantity: unknown; unit_price: unknown; days: unknown; vat_rate: unknown }>) {
  if (!items.length) throw new Error('Zaakceptowana kalkulacja nie ma pozycji budżetu.');
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  let net = 0;
  let gross = 0;
  for (const item of items) {
    const quantity = Number(item.quantity);
    const price = Number(item.unit_price);
    const days = Number(item.days);
    const rate = Number(item.vat_rate ?? 23);
    if ([item.quantity, item.unit_price, item.days].some((value) => value == null || value === '') ||
      ![quantity, price, days, rate].every((value) => Number.isFinite(value) && value >= 0)) {
      throw new Error('Nieprawidłowe kwoty zaakceptowanej kalkulacji.');
    }
    const lineNet = money(quantity * price * days);
    net += lineNet;
    gross += money(lineNet * (1 + rate / 100));
  }
  return { beforeDiscountNet: money(net), discountNet: 0, net: money(net), gross: money(gross) };
}
