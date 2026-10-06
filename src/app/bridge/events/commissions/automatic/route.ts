import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { canManage } from '@/lib/permissions';
import { loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';
import { getCommissionAmounts, type CommissionPaymentMethod } from '@/lib/CRM/events/eventCommission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] || null : value;
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const pending = (reason: string, message: string) => NextResponse.json({ created: false, reason, message });

// Jedno automatyczne naliczenie na sprzedawcę i wydarzenie, także przy
// równoczesnym otwarciu kilku kart. ON CONFLICT nigdy nie nadpisuje edycji.
function commissionId(eventId: string, partnerId: string) {
  const hash = createHash('sha256').update(`mavinci:event-commission:${eventId}:${partnerId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!isUuid(body.eventId) || (body.salesPartnerId != null && !isUuid(body.salesPartnerId))) {
      return fail('Nieprawidłowe wydarzenie lub sprzedawca.');
    }
    const eventId = body.eventId as string;
    const selectedPartnerId = body.salesPartnerId as string | undefined;
    const user = createSupabaseServerClient(cookies());
    const { data: auth, error: authError } = await user.auth.getUser();
    if (authError || !auth.user) return fail('Zaloguj się ponownie.', 401);
    const financeAccess = await loadInvoiceFinanceAccess(user);
    if (!financeAccess.canManageCompanyFinance) {
      return fail('Nie masz uprawnień do automatycznego naliczania prowizji firmy.', 403);
    }
    const [employeeResult, eventAccess, companyAccess, portalSession] = await Promise.all([
      user.from('employees').select('id,role,access_level,permissions').eq('is_active', true)
        .or(`id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`).limit(1).maybeSingle(),
      user.rpc('current_employee_can_view_event', { p_event_id: eventId }),
      user.rpc('current_employee_can_access_event_company', { p_event_id: eventId }),
      user.rpc('current_session_is_seller_portal'),
    ]);
    if (employeeResult.error || eventAccess.error || companyAccess.error || portalSession.error ||
      portalSession.data !== false || !canManage(employeeResult.data, 'finances') ||
      eventAccess.data !== true || companyAccess.data !== true) {
      return fail('Nie masz uprawnień do naliczania prowizji dla tego wydarzenia.', 403);
    }

    const admin = createSupabaseAdminClient();
    const billingSync = await admin.rpc('sync_event_billing_seller_commissions', { p_event_id: eventId });
    if (billingSync.error) {
      if (['PGRST202', '42883', '42703'].includes(billingSync.error.code)) {
        return fail('Automatyczne prowizje sprzedawców wskazanych przy wydarzeniu wymagają aktualizacji schematu bazy.', 503);
      }
      throw billingSync.error;
    }
    const [eventResult, offerResult, existingResult] = await Promise.all([
      admin.from('events').select('id,my_company_id,contact_person_id,referring_sales_partner_id').eq('id', eventId).single(),
      admin.from('offers').select('id,my_company_id,sales_partner_id,sales_channel,commercial_model,partner_commission_rate,subtotal,discount_amount,discount_percent,tax_amount,tax_percent,total_amount')
        .eq('event_id', eventId).eq('status', 'accepted').order('created_at', { ascending: false }).order('id').limit(1).maybeSingle(),
      admin.from('event_commissions').select('id,sales_partner_id,employee_id,contact_id,status,automatic_source').eq('event_id', eventId),
    ]);
    let event = eventResult.data;
    let eventError = eventResult.error;
    if (eventError && ['42703', 'PGRST204'].includes(eventError.code) &&
      [eventError.message, eventError.details, eventError.hint].join(' ').includes('referring_sales_partner_id')) {
      const originalEventResult = await admin.from('events')
        .select('id,my_company_id,contact_person_id').eq('id', eventId).single();
      eventError = originalEventResult.error;
      event = originalEventResult.data
        ? { ...originalEventResult.data, referring_sales_partner_id: null }
        : null;
    }
    for (const result of [offerResult, existingResult]) if (result.error) throw result.error;
    if (eventError) throw eventError;
    if (!event) throw new Error('Nie znaleziono wydarzenia.');
    if (!event.my_company_id) return pending('missing_company', 'Wybierz markę wydarzenia, aby pobrać właściwe warunki sprzedawcy.');
    const offer = offerResult.data;
    if (!selectedPartnerId && (event.referring_sales_partner_id || !offer?.sales_partner_id) && Number(billingSync.data?.matched) > 0) {
      const summary = billingSync.data;
      return NextResponse.json({
        created: Number(summary.created) > 0, reason: 'event_sellers',
        message: Number(summary.waiting) > 0
          ? 'Sprzedawcy wskazani przy wydarzeniu są dodani ze swoimi stawkami. Kwota oczekuje na zaakceptowaną ofertę z właściwej marki.'
          : Number(summary.eligible) === 0
            ? 'Przypisani sprzedawcy nie mają aktywnych warunków prowizyjnych dla tej marki albo rozliczają ofertę przez narzut. Nie naliczono dodatkowej prowizji.'
            : 'Prowizje sprzedawców wskazanych przy wydarzeniu są zapisane. Źródło polecenia lub kontakt rozliczeniowy są widoczne przy naliczeniu. Istniejące naliczenia pozostają bez zmian.',
      });
    }
    if (!offer) return pending('missing_offer', 'Prowizja zostanie uzupełniona po zaakceptowaniu oferty.');
    if (offer.my_company_id && offer.my_company_id !== event.my_company_id) {
      return pending('different_company', 'Marka zaakceptowanej oferty jest inna niż marka wydarzenia. Uzgodnij je przed naliczeniem prowizji.');
    }
    const partnerId = selectedPartnerId || event.referring_sales_partner_id || offer.sales_partner_id;
    const sellerOwnsOffer = Boolean(offer.sales_partner_id && partnerId === offer.sales_partner_id);
    if (sellerOwnsOffer && offer.commercial_model === 'markup') {
      return pending('markup', 'Ta oferta rozlicza sprzedawcę przez narzut. Dodatkowa prowizja nie jest naliczana.');
    }
    let partnerQuery = admin.from('sales_partner_profiles')
      .select('id,employee_id,contact_id,organization_id,partner_type,status,employee:employees!employee_id(name,surname),contact:contacts!contact_id(full_name)');
    if (partnerId) partnerQuery = partnerQuery.eq('id', partnerId);
    else if (event.contact_person_id) partnerQuery = partnerQuery.eq('contact_id', event.contact_person_id);
    else return pending('missing_seller', 'Wybierz sprzedawcę z kartoteki. Jego warunki uzupełnią się automatycznie.');
    const partnerResult = await partnerQuery.maybeSingle();
    if (partnerResult.error) throw partnerResult.error;
    const partner = partnerResult.data;
    if (!partner) return pending('missing_seller', 'Osoba kontaktowa wydarzenia nie ma profilu sprzedawcy. Możesz wybrać sprzedawcę z kartoteki.');

    if (offer.sales_channel === 'seller_portal' && partner.employee_id) {
      const manager = await admin.rpc('seller_partner_manager_id', { p_partner: offer.sales_partner_id, p_company: event.my_company_id });
      // Never fall back to revenue if manager resolution failed.
      if (manager.error) throw manager.error;
      if (manager.data === partner.employee_id) return pending('owner_profit',
        'Prowizję opiekuna nalicz w panelu Rentowność i prowizja opiekuna przy ofercie. Podstawą jest zysk po kosztach, nie wartość oferty.');
    }

    // Także wpis anulowany blokuje ponowne naliczenie. Dawne wpisy bez
    // sales_partner_id rozpoznajemy po ID osoby, nigdy po samym nazwisku.
    const existing = existingResult.data?.find((row) => row.sales_partner_id === partner.id ||
      (partner.employee_id && row.employee_id === partner.employee_id) ||
      (partner.contact_id && row.contact_id === partner.contact_id));
    if (existing) return NextResponse.json({ created: false, commissionId: existing.id, reason: 'existing' });
    const previousAutomatic = existingResult.data?.find((row) => row.sales_partner_id &&
      row.automatic_source !== 'billing_contact' && row.automatic_source !== 'event_referral' &&
      row.id === commissionId(eventId, row.sales_partner_id));
    if (!selectedPartnerId && previousAutomatic) {
      return pending('seller_changed', 'Sprzedawca wskazany w źródle wydarzenia zmienił się. Edytuj zapisane naliczenie, aby zastosować tę zmianę.');
    }
    if (partner.status !== 'active') return pending('inactive_seller', 'Profil sprzedawcy jest nieaktywny. Prowizja nie została naliczona.');
    const termResult = await admin.from('sales_partner_brand_terms')
      .select('default_commission_rate,default_payment_method,dividend_tax_rate,commission_enabled,is_active')
      .eq('sales_partner_id', partner.id).eq('my_company_id', event.my_company_id).maybeSingle();
    if (termResult.error) throw termResult.error;
    const term = termResult.data;
    if (!term?.is_active || !term.commission_enabled) {
      return pending('missing_terms', 'Sprzedawca nie ma aktywnych warunków prowizyjnych dla marki wydarzenia. Uzupełnij je w kartotece sprzedawców.');
    }
    const net = getOfferTotals(offer).net;
    // Przyjęta oferta sprzedawcy zachowuje indywidualnie uzgodniony procent.
    const rate = sellerOwnsOffer && offer.commercial_model === 'commission'
      ? Number(offer.partner_commission_rate) : Number(term.default_commission_rate);
    if (!Number.isFinite(rate) || rate <= 0 || net <= 0) {
      return pending('missing_base_or_rate', 'Do naliczenia potrzebna jest dodatnia wartość netto oferty i stawka prowizji.');
    }
    const employee = one(partner.employee);
    const contact = one(partner.contact);
    const name = employee ? [employee.name, employee.surname].filter(Boolean).join(' ') : contact?.full_name;
    if (!name) return pending('missing_name', 'Uzupełnij dane osoby w kartotece sprzedawcy.');
    const paymentMethod = term.default_payment_method as CommissionPaymentMethod;
    const amounts = getCommissionAmounts({calculationType: 'percent', baseAmount: net, rate, fixedAmount: 0,
      paymentMethod, dividendTaxRate: Number(term.dividend_tax_rate)});
    const id = commissionId(eventId, partner.id);
    const saved = await admin.from('event_commissions').upsert({
      id, event_id: eventId, sales_partner_id: partner.id,
      beneficiary_type: partner.partner_type === 'internal_employee' ? 'employee' : 'salesperson',
      beneficiary_name: name, employee_id: partner.employee_id, contact_id: partner.contact_id,
      organization_id: partner.organization_id, calculation_type: 'percent', rate, base_amount: net,
      base_description: 'Wartość netto zaakceptowanej oferty', amount: amounts.nominalAmount,
      payment_method: paymentMethod, dividend_tax_rate: Number(term.dividend_tax_rate),
      company_cost_amount: amounts.companyCostAmount, status: 'planned', created_by: employeeResult.data!.id,
    }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (saved.error) throw saved.error;
    return NextResponse.json({ created: Boolean(saved.data?.length), commissionId: id, reason: 'ready' });
  } catch (error) {
    console.error('Automatic event commission:', error);
    return fail('Nie udało się automatycznie uzupełnić prowizji. Spróbuj ponownie.', 500);
  }
}
