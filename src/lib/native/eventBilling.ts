import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { getOfferTotals } from '@/lib/CRM/Offers/offerTotals';
import {
  DEFAULT_DIVIDEND_TAX_RATE, commissionBeneficiaryLabels, commissionPaymentLabels, commissionStatusLabels, getCommissionAmounts,
  type CommissionBeneficiaryType, type CommissionCalculationType, type CommissionPaymentMethod, type CommissionStatus,
} from '@/lib/CRM/events/eventCommission';
import { isAutomaticCommission } from '@/lib/CRM/events/commissionSettlements';
import { COMMISSION_ENTRY_KIND_LABELS, COMMISSION_SOURCE_LABELS, type CommissionEntryKind } from '@/lib/events/settlement/eventSettlement';
import { runAutomaticCommissions } from '@/lib/events/automaticCommissions.server';

/*
 * Rozliczenie i prowizje wydarzenia dla Maca — jak Szczegóły → „Rozliczenie wydarzenia” (`EventBillingContextCard`)
 * i „Sprzedawcy i prowizje” (`EventCommissionsPanel`): kto rozlicza (klient / hotel / agencja / inna organizacja), nabywca
 * z karty klienta (JST), numer PO, opiekunowie rozliczenia, sprzedawca pozyskujący wydarzenie, wspólne rozliczenie kilku
 * wydarzeń, prowizje z podsumowania i ręczne wraz z sumami. Te same zapisy i warunki co w przeglądarce, tokenem pracownika
 * (RLS i funkcje bazy). Zakładka `billing` (dane), odczyty `organizations | contacts | sellers | settlementEvents |
 * commissionOptions`, czynności `saveBilling | saveSettlement | dissolve | commissionPartner | commissionSave |
 * commissionSchedule | commissionStatus | commissionCancel | commissionRestore`.
 */

type Row = Record<string, any>;
type Arrangement = 'direct' | 'hotel' | 'agency' | 'other';
const ARRANGEMENTS: Arrangement[] = ['direct', 'hotel', 'agency', 'other'];
const ARRANGEMENT_LABELS: Record<Arrangement, string> = {
  direct: 'Bezpośrednio przez klienta wydarzenia',
  hotel: 'Przez hotel',
  agency: 'Przez agencję',
  other: 'Przez inną organizację',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COMMISSION_COLUMNS =
  'id,beneficiary_type,beneficiary_name,salesperson_id,sales_partner_id,employee_id,contact_id,organization_id,calculation_type,rate,base_amount,base_description,amount,payment_method,dividend_tax_rate,company_cost_amount,status,due_date,paid_at,notes,created_by,automatic_source,automatic_waiting_for_offer';

function fail(message: string): never {
  throw new Error(message);
}
const str = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const missingColumn = (error: { code?: string } | null | undefined) => ['42703', 'PGRST204'].includes(error?.code || '');
const contactName = (contact: Row | null | undefined) =>
  str(contact?.full_name).trim() || `${str(contact?.first_name)} ${str(contact?.last_name)}`.trim() || 'Kontakt bez nazwy';
const orgLabel = (organization: Row | null | undefined) => str(organization?.alias).trim() || str(organization?.name).trim();

/** „Zarządzanie finansami” albo administrator (`canManageModule('finances')` w panelu prowizji). */
const canManageCommissions = (ctx: NativeContext) => ctx.employee.isAdmin || ctx.employee.permissions.includes('finances_manage');
function requireManage(ctx: NativeContext) {
  if (!canManageCommissions(ctx)) fail('Prowizje zmienia administrator albo osoba z „Zarządzaniem finansami”.');
}

async function pages(makeQuery: () => any, limit = 5000): Promise<Row[]> {
  const result: Row[] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) throw error;
    result.push(...((data || []) as Row[]));
    if ((data || []).length < 1000) break;
  }
  return result;
}

/** Wydarzenie z polami rozliczenia; bez kolumny sprzedawcy pozyskującego (starsza baza) — `referralSchema: false`. */
async function eventBillingRow(ctx: NativeContext, eventId: string) {
  const base = 'id,name,organization_id,contact_person_id,my_company_id,billing_arrangement,billing_organization_id,purchase_order_number';
  const full = await ctx.supabase.from('events').select(`${base},referring_sales_partner_id`).eq('id', eventId).maybeSingle();
  if (!full.error) {
    if (!full.data) fail('Nie znaleziono wydarzenia albo nie masz do niego dostępu.');
    return { event: full.data as Row, referralSchema: true };
  }
  if (!missingColumn(full.error)) throw full.error;
  const fallback = await ctx.supabase.from('events').select(base).eq('id', eventId).maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data) fail('Nie znaleziono wydarzenia albo nie masz do niego dostępu.');
  return { event: fallback.data as Row, referralSchema: false };
}

/** Nabywca faktur z karty klienta (np. szkoła → gmina) — jak `fetchInvoiceBuyerLink`. */
async function invoiceBuyer(ctx: NativeContext, organizationId: string | null) {
  if (!organizationId) return null;
  const unit = await ctx.supabase.from('organizations').select('id,invoice_buyer_organization_id,invoice_recipient_role').eq('id', organizationId).maybeSingle();
  if (unit.error) {
    if (missingColumn(unit.error)) return null;
    throw unit.error;
  }
  const buyerId = str((unit.data as Row | null)?.invoice_buyer_organization_id);
  if (!buyerId) return null;
  const buyer = await ctx.supabase.from('organizations').select('id,name,alias').eq('id', buyerId).maybeSingle();
  if (buyer.error) throw buyer.error;
  if (!buyer.data) return null;
  return { name: orgLabel(buyer.data as Row), role: (unit.data as Row).invoice_recipient_role === 2 ? 2 : 8 };
}

/** Sprzedawca z kartoteki: nazwa osoby, organizacja i opis warunków prowizji dla marki wydarzenia (jak w `EventBillingContextCard`). */
function sellerOption(row: Row, terms: Row[], companyId: string | null) {
  const employee = one(row.employee) as Row | null;
  const contact = one(row.contact) as Row | null;
  const organization = one(row.organization) as Row | null;
  const term = terms.find((item) => item.sales_partner_id === row.id);
  const label = employee ? [employee.name, employee.surname].filter(Boolean).join(' ') : str(contact?.full_name);
  const commissionReady = Boolean(term?.is_active && term.commission_enabled && Number(term.default_commission_rate) > 0);
  const termsLabel = !companyId ? 'Wybierz markę wydarzenia'
    : commissionReady ? `Domyślna prowizja: ${Number(term!.default_commission_rate)}%`
    : 'Warunki prowizji wymagają uzupełnienia';
  return {
    id: str(row.id), label: label || 'Sprzedawca — dane osoby niedostępne',
    description: [orgLabel(organization), row.status === 'active' ? termsLabel : 'Profil nieaktywny — wcześniejsze przypisanie'].filter(Boolean).join(' · '),
    keywords: [employee?.email, contact?.email, organization?.name, organization?.alias].filter(Boolean).join(' '),
    status: str(row.status), commissionReady,
  };
}

const SELLER_SELECT = 'id,organization_id,status,employee:employees!employee_id(name,surname,email),contact:contacts!contact_id(full_name,email),organization:organizations!organization_id(name,alias)';

async function sellerTerms(ctx: NativeContext, companyId: string | null, ids: string[]) {
  if (!companyId || !ids.length) return [] as Row[];
  const { data, error } = await ctx.supabase.from('sales_partner_brand_terms')
    .select('sales_partner_id,is_active,commission_enabled,default_commission_rate')
    .eq('my_company_id', companyId).in('sales_partner_id', ids);
  if (error) throw error;
  return (data || []) as Row[];
}

async function loadCommissions(ctx: NativeContext, eventId: string) {
  const extended = await ctx.supabase.from('event_commissions')
    .select(`${COMMISSION_COLUMNS},entry_kind,rate_reason,auto_cancelled,cancel_reason`)
    .eq('event_id', eventId).order('created_at', { ascending: false });
  if (!extended.error || !missingColumn(extended.error)) return extended;
  return ctx.supabase.from('event_commissions').select(COMMISSION_COLUMNS).eq('event_id', eventId).order('created_at', { ascending: false });
}

/** Zaakceptowana oferta wydarzenia: wartość netto (podstawa prowizji) i stawka sprzedawcy z oferty prowizyjnej. */
async function acceptedOffer(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.from('offers')
    .select('sales_partner_id,commercial_model,partner_commission_rate,subtotal,discount_amount,discount_percent,tax_amount,tax_percent,total_amount')
    .eq('event_id', eventId).eq('status', 'accepted').order('created_at', { ascending: false }).order('id').limit(1).maybeSingle();
  if (error) throw error;
  const offer = data as Row | null;
  return {
    net: offer ? num(getOfferTotals(offer as any).net) : 0,
    commission: offer?.sales_partner_id && offer.commercial_model === 'commission'
      ? { partnerId: str(offer.sales_partner_id), rate: num(offer.partner_commission_rate) }
      : null,
  };
}

// MARK: Dane zakładki

async function billingTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const manage = canManageCommissions(ctx);
  // Jak panel prowizji w CRM: przy otwarciu (finanse / administrator) baza uzupełnia prowizje automatyczne.
  let syncNotice = '';
  if (manage) {
    try {
      const sync = await runAutomaticCommissions(s, ctx.employee.authUserId, eventId, null);
      syncNotice = sync.status === 200 ? str(sync.body.message) : str(sync.body.error) || 'Nie udało się uzupełnić prowizji.';
    } catch {
      syncNotice = 'Nie udało się uzupełnić prowizji. Użyj przycisku „Odśwież”.';
    }
  }
  const { event, referralSchema } = await eventBillingRow(ctx, eventId);
  const arrangement: Arrangement = ARRANGEMENTS.includes(event.billing_arrangement) ? event.billing_arrangement : 'direct';
  const clientId = str(event.organization_id) || null;
  const billingId = arrangement === 'direct' ? null : str(event.billing_organization_id) || null;
  const referralId = referralSchema ? str(event.referring_sales_partner_id) : '';
  const companyId = str(event.my_company_id) || null;

  const [orgsRes, contactsRes, membershipRes, buyer, commissionsRes, offer] = await Promise.all([
    [clientId, billingId].filter(Boolean).length
      ? s.from('organizations').select('id,name,alias').in('id', [clientId, billingId].filter(Boolean) as string[])
      : Promise.resolve({ data: [], error: null }),
    s.from('event_billing_contacts').select('contact_id,is_primary,contact:contacts(id,full_name,first_name,last_name,email,phone,mobile)').eq('event_id', eventId),
    s.from('event_settlement_group_members').select('group_id,is_primary').eq('event_id', eventId).maybeSingle(),
    invoiceBuyer(ctx, clientId).catch(() => null),
    loadCommissions(ctx, eventId),
    acceptedOffer(ctx, eventId).catch(() => ({ net: 0, commission: null })),
  ]);
  if (orgsRes.error) throw orgsRes.error;
  if (contactsRes.error) throw contactsRes.error;
  const organizations = (orgsRes.data || []) as Row[];
  const client = organizations.find((row) => row.id === clientId) || null;
  const payer = organizations.find((row) => row.id === billingId) || null;

  // Sprzedawca pozyskujący wydarzenie (polecenie).
  let referral: Row | null = null;
  let referralError = '';
  if (referralId) {
    try {
      const { data, error } = await s.from('sales_partner_profiles').select(SELLER_SELECT).eq('id', referralId).maybeSingle();
      if (error) throw error;
      if (data) {
        const terms = await sellerTerms(ctx, companyId, [referralId]);
        referral = sellerOption(data as Row, terms, companyId);
      } else {
        referral = { id: referralId, label: 'Przypisany sprzedawca', description: '', keywords: '', status: '', commissionReady: false };
      }
    } catch {
      referralError = 'Nie udało się wczytać przypisanego sprzedawcy i jego warunków. Odśwież dane przed zapisem.';
    }
  }

  // Wspólne rozliczenie.
  let settlement: Row | null = null;
  const groupId = str((membershipRes.data as Row | null)?.group_id);
  if (!membershipRes.error && groupId) {
    const [groupRes, membersRes] = await Promise.all([
      s.from('event_settlement_groups').select('id,name,primary_event_id').eq('id', groupId).maybeSingle(),
      s.from('event_settlement_group_members').select('event_id,is_primary').eq('group_id', groupId),
    ]);
    if (groupRes.data && membersRes.data) {
      const members = membersRes.data as Row[];
      const eventsRes = await s.from('events').select('id,name,event_date').in('id', members.map((member) => member.event_id));
      const primary = str((groupRes.data as Row).primary_event_id) || str(members.find((member) => member.is_primary)?.event_id) || eventId;
      settlement = {
        groupId, name: str((groupRes.data as Row).name) || 'Wspólne rozliczenie wydarzeń', primaryEventId: primary,
        events: members.map((member) => {
          const row = ((eventsRes.data || []) as Row[]).find((item) => item.id === member.event_id);
          return { id: str(member.event_id), name: str(row?.name) || 'Wydarzenie', date: row?.event_date ?? null };
        }),
      };
    }
  }

  // Prowizje.
  let commissionsAvailable = true;
  let commissionsError = '';
  let rows: Row[] = [];
  if (commissionsRes.error) {
    const missing = ['company_cost_amount', 'contact_id', 'payment_method', 'sales_partner_id', 'automatic_source', 'automatic_waiting_for_offer']
      .some((column) => commissionsRes.error?.message?.includes(column));
    commissionsAvailable = !missing;
    if (!missing) commissionsError = 'Nie udało się wczytać danych prowizji. Odśwież sekcję.';
  } else {
    rows = (commissionsRes.data || []) as Row[];
  }
  const partnerIds = [...new Set(rows.map((row) => str(row.sales_partner_id)).filter(Boolean))];
  const partnersRes = partnerIds.length
    ? await s.from('sales_partner_profiles').select('id,employee_id,contact_id').in('id', partnerIds)
    : { data: [], error: null };
  const partners = (partnersRes.data || []) as Row[];
  const active = rows.filter((row) => row.status !== 'cancelled');
  const nominal = active.reduce((sum, row) => sum + num(row.amount), 0);
  const companyCost = active.reduce((sum, row) => sum + num(row.company_cost_amount ?? row.amount), 0);

  const billingContacts = ((contactsRes.data || []) as Row[]).map((row) => {
    const contact = one(row.contact) as Row | null;
    return { id: str(row.contact_id), name: contactName(contact), email: contact?.email ?? null, phone: contact?.mobile || contact?.phone || null };
  });

  return {
    canManageCommissions: manage,
    billing: {
      arrangement, arrangementLabel: ARRANGEMENT_LABELS[arrangement],
      clientOrganizationId: clientId, clientName: client ? orgLabel(client) : null,
      billingOrganizationId: billingId, billingOrganizationName: payer ? orgLabel(payer) : null,
      invoiceBuyer: buyer,
      purchaseOrderNumber: str(event.purchase_order_number) || null,
      contacts: billingContacts,
      referralSchema,
      referral: referral ? { id: referral.id, label: referral.label, description: referral.description, status: referral.status, commissionReady: referral.commissionReady } : null,
      referralError: referralError || null,
    },
    settlement,
    commissions: {
      available: commissionsAvailable, error: commissionsError || null, syncNotice: syncNotice || null,
      acceptedOfferNet: offer.net,
      totals: { nominal, companyCost, burden: companyCost - nominal },
      rows: rows.filter((row) => !(row.status === 'cancelled' && row.auto_cancelled)).map((row) => {
        const partner = partners.find((item) => item.id === row.sales_partner_id);
        const contactId = str(row.contact_id) || str(partner?.contact_id);
        const employeeId = str(row.employee_id) || str(partner?.employee_id);
        const entryKind = row.entry_kind && row.entry_kind !== 'accrual' ? str(row.entry_kind) : null;
        const status = str(row.status) as CommissionStatus;
        const method = (str(row.payment_method) || 'invoice') as CommissionPaymentMethod;
        return {
          id: str(row.id), name: str(row.beneficiary_name),
          beneficiaryType: str(row.beneficiary_type),
          typeLabel: commissionBeneficiaryLabels[row.beneficiary_type as CommissionBeneficiaryType] || str(row.beneficiary_type),
          paymentMethod: method, paymentLabel: commissionPaymentLabels[method] || method,
          baseDescription: row.base_description ?? null,
          automatic: isAutomaticCommission(row),
          sourceLabel: row.automatic_source ? COMMISSION_SOURCE_LABELS[str(row.automatic_source)] ?? null : null,
          entryKind, entryKindLabel: entryKind ? COMMISSION_ENTRY_KIND_LABELS[entryKind as CommissionEntryKind] ?? entryKind : null,
          rateReason: row.rate_reason ?? null,
          cancelReason: row.status === 'cancelled' ? row.cancel_reason ?? null : null,
          autoCancelled: row.auto_cancelled === true,
          ownerProfit: row.automatic_source === 'seller_owner_profit',
          status, statusLabel: commissionStatusLabels[status] || status,
          calculationType: str(row.calculation_type) || 'percent',
          rate: num(row.rate), baseAmount: num(row.base_amount), amount: num(row.amount),
          companyCost: num(row.company_cost_amount ?? row.amount),
          dividendTaxRate: row.dividend_tax_rate == null ? DEFAULT_DIVIDEND_TAX_RATE : num(row.dividend_tax_rate),
          waitingForOffer: row.automatic_waiting_for_offer === true,
          dueDate: row.due_date ?? null, paidAt: row.paid_at ?? null, notes: row.notes ?? null,
          salesPartnerId: row.sales_partner_id ?? null, employeeId: row.employee_id ?? null, contactId: row.contact_id ?? null,
          organizationId: row.organization_id ?? null,
          settlements: contactId ? { kind: 'contact', id: contactId } : employeeId ? { kind: 'employee', id: employeeId } : null,
        };
      }),
    },
  };
}

registerEventTab('billing', billingTab);

// MARK: Odczyty do edycji

/** Organizacje do wyboru nabywcy i powiązanego hotelu / firmy. */
async function organizationsQuery(ctx: NativeContext) {
  const rows = await pages(() => ctx.supabase.from('organizations').select('id,name,alias').order('name').order('id'));
  return {
    organizations: rows.map((row) => ({ id: str(row.id), label: orgLabel(row) || 'Organizacja bez nazwy', description: str(row.alias).trim() ? str(row.name) : null })),
  };
}

/** Osoby kontaktowe organizacji płatnika (aktualne powiązania, najpierw główne) — opiekunowie rozliczenia. */
async function contactsQuery(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const organizationId = params.get('organization') || '';
  if (!UUID.test(organizationId)) return { contacts: [] };
  const { data, error } = await ctx.supabase.from('contact_organizations')
    .select('contact_id,position,is_primary,contact:contacts(id,full_name,first_name,last_name,email,phone,mobile)')
    .eq('organization_id', organizationId).eq('is_current', true).order('is_primary', { ascending: false });
  if (error) throw error;
  return {
    contacts: ((data || []) as Row[]).flatMap((relation) => {
      const contact = one(relation.contact) as Row | null;
      if (!contact) return [];
      return [{ id: str(contact.id), name: contactName(contact), email: contact.email ?? null, phone: contact.mobile || contact.phone || null, position: relation.position ?? null }];
    }),
  };
}

/** Kartoteka sprzedawców (aktywni i dotychczas przypisany) z warunkami dla marki wydarzenia. */
async function sellersQuery(ctx: NativeContext, eventId: string) {
  const { event, referralSchema } = await eventBillingRow(ctx, eventId);
  if (!referralSchema) return { sellers: [], available: false };
  const selectedId = str(event.referring_sales_partner_id);
  const companyId = str(event.my_company_id) || null;
  const rows = await pages(() => {
    const query = ctx.supabase.from('sales_partner_profiles').select(SELLER_SELECT);
    return (selectedId ? query.or(`status.eq.active,id.eq.${selectedId}`) : query.eq('status', 'active')).order('id');
  });
  const terms: Row[] = [];
  for (let offset = 0; offset < rows.length; offset += 200) {
    terms.push(...await sellerTerms(ctx, companyId, rows.slice(offset, offset + 200).map((row) => str(row.id))));
  }
  return {
    available: true,
    sellers: rows.map((row) => sellerOption(row, terms, companyId)).sort((a, b) => a.label.localeCompare(b.label, 'pl')),
  };
}

/** Ostatnie wydarzenia (300) do wspólnego rozliczenia — aplikacja zawęża je do klienta, kontaktu lub płatnika jak CRM. */
async function settlementEventsQuery(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('events')
    .select('id,name,event_date,organization_id,billing_organization_id,contact_person_id')
    .order('event_date', { ascending: false }).limit(300);
  if (error) throw error;
  return {
    events: ((data || []) as Row[]).map((row) => ({
      id: str(row.id), name: str(row.name), date: row.event_date ?? null, organizationId: row.organization_id ?? null,
      billingOrganizationId: row.billing_organization_id ?? null, contactPersonId: row.contact_person_id ?? null,
    })),
  };
}

/** Okno „Dodaj osobę” / edycja prowizji: sprzedawcy z warunkami dla marki, pracownicy, kontakty, organizacje, oferta. */
/**
 * Rozliczenie wydarzenia do sprawdzenia warunków nowej osoby (`get_event_settlement`): zysk przed prowizjami sprzedawców
 * zewnętrznych, osoby liczone już przez podsumowanie (stawka, czy liczona, kwota) i narzuty sprzedawców z ofert z narzutem.
 * Bez dostępu do kwot wydarzenia — `null` (formularz działa bez podglądu).
 */
async function settlementPreview(ctx: NativeContext, eventId: string) {
  const { data, error } = await ctx.supabase.rpc('get_event_settlement', { p_event_id: eventId });
  if (error || !data || typeof data !== 'object') return null;
  const s = data as Row;
  const totals = (s.totals || {}) as Row;
  const lines = (Array.isArray(s.lines) ? s.lines : []) as Row[];
  const markupLines = lines.filter((line) => line.source_type === 'markup' && UUID.test(str(line.source_id)));
  const offers = markupLines.length
    ? await ctx.supabase.from('offers').select('id,sales_partner_id,offer_number').in('id', markupLines.map((line) => str(line.source_id)))
    : { data: [], error: null };
  const offerRows = (offers.error ? [] : offers.data || []) as Row[];
  return {
    status: str(s.status) || 'draft',
    profitBeforeExternal: num(totals.profit_before_external),
    profitNet: num(totals.profit_net),
    revenueNet: num(totals.revenue_net),
    costsNet: num(totals.costs_net),
    // Sprzedawcy wydarzenia z zespołu (udział): stawka z warunków pracownika, podstawa = zysk netto × udział.
    internal: ((Array.isArray(s.internal) ? s.internal : []) as Row[]).map((row) => ({
      employeeId: str(row.employee_id), name: str(row.name), sharePercent: num(row.share_percent), rate: num(row.rate),
      clientOwned: row.client_owned === true, amount: num(row.amount), enabled: row.enabled === true,
      blockedReason: str(row.blocked_reason) || null, paymentMethod: str(row.payment_method) || 'payroll',
    })),
    external: ((Array.isArray(s.external) ? s.external : []) as Row[]).map((row) => ({
      partnerId: str(row.partner_id) || null, contactId: str(row.contact_id) || null, name: str(row.name),
      rate: num(row.rate), eligible: row.eligible === true, amount: num(row.amount), companyCost: num(row.company_cost),
      paymentMethod: str(row.payment_method) || 'cash_dividend', dividendTaxRate: row.dividend_tax_rate == null ? DEFAULT_DIVIDEND_TAX_RATE : num(row.dividend_tax_rate),
      skipReason: str(row.skip_reason) || null, source: str(row.source),
    })),
    markups: markupLines.map((line) => {
      const offer = offerRows.find((row) => str(row.id) === str(line.source_id));
      return {
        offerId: str(line.source_id), partnerId: str(offer?.sales_partner_id) || null, net: num(line.net_amount), included: line.included === true,
        detail: str(line.detail) || null,
      };
    }),
  };
}

async function commissionOptionsQuery(ctx: NativeContext, eventId: string) {
  requireManage(ctx);
  const s = ctx.supabase;
  const [eventRes, offer, employeesRes, contactsRes, organizations, relationsRes, partnersRes, termsRes, existingRes, overridesRes, settlement, salesRes] = await Promise.all([
    s.from('events').select('my_company_id').eq('id', eventId).maybeSingle(),
    acceptedOffer(ctx, eventId),
    s.from('employees').select('id,name,surname,email').eq('is_active', true).order('surname').limit(500),
    s.from('contacts').select('id,full_name,first_name,last_name,email').order('full_name').limit(1000),
    s.from('organizations').select('id,name,alias').order('name').limit(1000),
    s.from('contact_organizations').select('contact_id,organization_id,is_primary').eq('is_current', true),
    s.from('sales_partner_profiles').select('id,employee_id,contact_id,organization_id,partner_type,status'),
    s.from('sales_partner_brand_terms')
      .select('sales_partner_id,my_company_id,commission_enabled,default_commission_rate,default_payment_method,dividend_tax_rate,is_active').eq('is_active', true),
    // Wpisy tego wydarzenia (bez anulowanych) — żeby nie dodać drugi raz prowizji tej samej osobie.
    s.from('event_commissions').select('id,sales_partner_id,contact_id,employee_id,beneficiary_name,amount,status,automatic_source,entry_kind')
      .eq('event_id', eventId).neq('status', 'cancelled').eq('entry_kind', 'accrual'),
    // Stawka ustalona dla tego wydarzenia ma pierwszeństwo przed kartą sprzedawcy (jak w podsumowaniu).
    s.from('event_external_seller_rates').select('sales_partner_id,rate,reason').eq('event_id', eventId),
    settlementPreview(ctx, eventId).catch(() => null),
    // Pracownicy-sprzedawcy: „Prowizja od sprzedaży” z karty pracownika (stawka własna albo globalna, sposób wypłaty).
    s.rpc('get_sales_commission_settings'),
  ]);
  const failed = [eventRes, employeesRes, contactsRes, organizations, relationsRes, partnersRes, termsRes].find((result) => result.error);
  if (failed?.error) throw failed.error;
  const companyId = str((eventRes.data as Row | null)?.my_company_id) || null;
  const employees = (employeesRes.data || []) as Row[];
  const contacts = (contactsRes.data || []) as Row[];
  const orgs = (organizations.data || []) as Row[];
  const relations = (relationsRes.data || []) as Row[];
  const terms = (termsRes.data || []) as Row[];
  // Wszystkie bieżące organizacje osoby — filtr osób po wybranym hotelu / firmie.
  const contactOrgs = new Map<string, string[]>();
  for (const relation of relations) {
    const list = contactOrgs.get(str(relation.contact_id)) || [];
    if (relation.organization_id && !list.includes(str(relation.organization_id))) list.push(str(relation.organization_id));
    contactOrgs.set(str(relation.contact_id), list);
  }
  const overrides = (overridesRes.error ? [] : overridesRes.data || []) as Row[];
  const sales = (!salesRes.error && salesRes.data && typeof salesRes.data === 'object' ? salesRes.data : null) as Row | null;
  const defaultStandard = sales?.standard_rate == null ? 5 : num(sales.standard_rate);
  const defaultOwn = sales?.own_client_rate == null ? 10 : num(sales.own_client_rate);
  const salesEmployees = ((Array.isArray(sales?.employees) ? sales?.employees : []) as Row[])
    .filter((row) => row.enabled === true && row.is_active !== false)
    .map((row) => ({
      id: str(row.employee_id), name: str(row.name) || 'Pracownik',
      standardRate: row.standard_rate == null ? defaultStandard : num(row.standard_rate),
      ownClientRate: row.own_client_rate == null ? defaultOwn : num(row.own_client_rate),
      customRates: row.standard_rate != null || row.own_client_rate != null,
      paymentMethod: str(row.payment_method) || 'payroll',
    }));
  return {
    salesEmployees,
    employerSocialRate: sales?.employer_social_rate == null ? null : num(sales.employer_social_rate),
    acceptedOfferNet: offer.net,
    offerCommission: offer.commission,
    settlement,
    existing: ((existingRes.error ? [] : existingRes.data || []) as Row[]).map((row) => ({
      id: str(row.id), partnerId: str(row.sales_partner_id) || null, contactId: str(row.contact_id) || null, employeeId: str(row.employee_id) || null,
      name: str(row.beneficiary_name), amount: num(row.amount), status: str(row.status), automatic: isAutomaticCommission(row),
      source: str(row.automatic_source) || null,
    })),
    partners: ((partnersRes.data || []) as Row[]).map((partner) => {
      const employee = employees.find((item) => item.id === partner.employee_id);
      const contact = contacts.find((item) => item.id === partner.contact_id);
      const organization = orgs.find((item) => item.id === partner.organization_id);
      const term = terms.find((item) => item.sales_partner_id === partner.id && item.my_company_id === companyId && item.commission_enabled);
      return {
        id: str(partner.id),
        label: employee ? `${str(employee.name)} ${str(employee.surname)}`.trim() : contact ? contactName(contact) : 'Sprzedawca bez nazwy',
        detail: orgLabel(organization) || (partner.partner_type === 'internal_employee' ? 'Mavinci' : 'bez organizacji'),
        organizationId: partner.organization_id ?? null, partnerType: str(partner.partner_type), status: str(partner.status),
        employeeId: partner.employee_id ?? null, contactId: partner.contact_id ?? null,
        organizationIds: [...new Set([str(partner.organization_id), ...(contactOrgs.get(str(partner.contact_id)) || [])].filter(Boolean))],
        override: (() => {
          const row = overrides.find((item) => str(item.sales_partner_id) === str(partner.id));
          return row ? { rate: num(row.rate), reason: str(row.reason) } : null;
        })(),
        term: term ? {
          rate: num(term.default_commission_rate), paymentMethod: str(term.default_payment_method) || 'invoice',
          dividendTaxRate: term.dividend_tax_rate == null ? DEFAULT_DIVIDEND_TAX_RATE : num(term.dividend_tax_rate),
        } : null,
      };
    }),
    employees: employees.map((employee) => ({ id: str(employee.id), label: `${str(employee.name)} ${str(employee.surname)}`.trim(), detail: str(employee.email) || 'pracownik CRM' })),
    contacts: contacts.map((contact) => {
      const relation = relations.find((item) => item.contact_id === contact.id && item.is_primary) || relations.find((item) => item.contact_id === contact.id);
      return {
        id: str(contact.id), label: contactName(contact), detail: str(contact.email) || 'kontakt CRM', organizationId: relation?.organization_id ?? null,
        organizationIds: contactOrgs.get(str(contact.id)) || [],
      };
    }),
    organizations: orgs.map((row) => ({ id: str(row.id), label: orgLabel(row) || 'Organizacja bez nazwy', description: str(row.alias).trim() ? str(row.name) : null })),
  };
}

registerEventQueries('billing', {
  organizations: organizationsQuery, contacts: contactsQuery, sellers: sellersQuery,
  settlementEvents: settlementEventsQuery, commissionOptions: commissionOptionsQuery,
});

// MARK: Zapisy rozliczenia

/** „Zapisz rozliczenie” w trybie edycji sposobu rozliczenia — jak `handleSave` w `EventBillingContextCard`. */
async function saveBilling(ctx: NativeContext, eventId: string, body: Row) {
  const s = ctx.supabase;
  const arrangement = str(body.arrangement) as Arrangement;
  if (!ARRANGEMENTS.includes(arrangement)) fail('Nieprawidłowy sposób rozliczenia.');
  const billingOrganizationId = str(body.billingOrganizationId);
  const purchaseOrderNumber = str(body.purchaseOrderNumber).trim().slice(0, 200) || null;
  const contactIds = Array.isArray(body.contactIds) ? [...new Set((body.contactIds as unknown[]).map(str).filter((id) => UUID.test(id)))] : [];
  const referralEnabled = body.referralEnabled === true;
  const referralPartnerId = str(body.referralPartnerId);
  const savedReferralPartnerId = str(body.savedReferralPartnerId);
  const { referralSchema } = await eventBillingRow(ctx, eventId);
  if (referralSchema && referralEnabled && !referralPartnerId) fail('Wybierz sprzedawcę, który pozyskał wydarzenie, albo odznacz pole polecenia.');
  if (referralSchema && referralEnabled && referralPartnerId !== savedReferralPartnerId) {
    if (!UUID.test(referralPartnerId)) fail('Wybierz aktywnego sprzedawcę z kartoteki.');
    const { data } = await s.from('sales_partner_profiles').select('status').eq('id', referralPartnerId).maybeSingle();
    if ((data as Row | null)?.status !== 'active') fail('Wybierz aktywnego sprzedawcę z kartoteki.');
  }
  if (arrangement !== 'direct' && !UUID.test(billingOrganizationId)) fail('Wybierz organizację, która będzie rozliczać wydarzenie');

  const storedBillingOrganizationId = arrangement === 'direct' ? null : billingOrganizationId;
  const storedReferralPartnerId = referralEnabled ? referralPartnerId || null : null;
  let update = s.from('events').update({
    billing_arrangement: arrangement,
    billing_organization_id: storedBillingOrganizationId,
    purchase_order_number: purchaseOrderNumber,
    ...(referralSchema ? { referring_sales_partner_id: storedReferralPartnerId } : {}),
  }).eq('id', eventId);
  if (referralSchema) {
    update = savedReferralPartnerId ? update.eq('referring_sales_partner_id', savedReferralPartnerId) : update.is('referring_sales_partner_id', null);
  }
  const { data: saved, error } = await update.select('id').maybeSingle();
  if (error) fail(error.message || 'Nie udało się zapisać rozliczenia wydarzenia');
  if (!saved) fail('Przypisanie sprzedawcy zmieniło się w innej karcie albo brak dostępu do zapisu. Odśwież dane przed ponowieniem.');

  const removed = await s.from('event_billing_contacts').delete().eq('event_id', eventId);
  if (removed.error) fail(removed.error.message || 'Nie udało się zapisać opiekunów rozliczenia');
  if (arrangement !== 'direct' && contactIds.length) {
    const inserted = await s.from('event_billing_contacts').insert(contactIds.map((contactId, index) => ({
      event_id: eventId, organization_id: billingOrganizationId, contact_id: contactId, is_primary: index === 0,
    })));
    if (inserted.error) fail(inserted.error.message || 'Nie udało się zapisać opiekunów rozliczenia');
  }
  return { ok: true, message: 'Sposób rozliczenia wydarzenia został zapisany' };
}

/** „Połącz wydarzenia” / „Edytuj powiązanie” — `save_event_settlement_group` (co najmniej dwa wydarzenia). */
async function saveSettlement(ctx: NativeContext, eventId: string, body: Row) {
  const eventIds = Array.isArray(body.eventIds) ? [...new Set((body.eventIds as unknown[]).map(str).filter((id) => UUID.test(id)))] : [];
  if (!eventIds.includes(eventId)) eventIds.unshift(eventId);
  if (eventIds.length < 2) {
    fail(body.hasGroup === true
      ? 'Grupa musi zawierać co najmniej dwa wydarzenia. Aby ją usunąć, wybierz „Rozłącz grupę”.'
      : 'Wybierz co najmniej dwa wydarzenia do wspólnego rozliczenia.');
  }
  const primary = eventIds.includes(str(body.primaryEventId)) ? str(body.primaryEventId) : eventId;
  const { error } = await ctx.supabase.rpc('save_event_settlement_group', {
    p_anchor_event_id: eventId, p_event_ids: eventIds,
    p_name: str(body.name).trim() || 'Wspólne rozliczenie wydarzeń', p_primary_event_id: primary,
  });
  if (error) fail(error.message || 'Nie udało się zapisać wspólnego rozliczenia');
  return { ok: true, message: 'Wspólne rozliczenie zostało zapisane' };
}

async function dissolve(ctx: NativeContext, eventId: string) {
  const { error } = await ctx.supabase.rpc('dissolve_event_settlement_group', { p_event_id: eventId });
  if (error) fail(error.message || 'Nie udało się rozłączyć wydarzeń');
  return { ok: true, message: 'Wydarzenia zostały rozłączone. Historia faktur pozostała zachowana.' };
}

// MARK: Prowizje

async function commissionOfEvent(ctx: NativeContext, eventId: string, id: string) {
  if (!UUID.test(id)) fail('Nieprawidłowa prowizja.');
  const extended = await ctx.supabase.from('event_commissions').select('id,status,automatic_source,automatic_waiting_for_offer,entry_kind,beneficiary_name,sales_partner_id,employee_id,contact_id')
    .eq('id', id).eq('event_id', eventId).maybeSingle();
  if (extended.error && !missingColumn(extended.error)) throw extended.error;
  const result = extended.error
    ? await ctx.supabase.from('event_commissions').select('id,status,automatic_source,automatic_waiting_for_offer,beneficiary_name,sales_partner_id,employee_id,contact_id')
      .eq('id', id).eq('event_id', eventId).maybeSingle()
    : extended;
  if (result.error) throw result.error;
  if (!result.data) fail('Nie znaleziono prowizji w tym wydarzeniu. Odśwież dane.');
  return result.data as Row;
}

/** Sprzedawca z kartoteki z warunkami dla marki — `add_event_partner_commission` (kwotę liczy podsumowanie). */
async function commissionPartner(ctx: NativeContext, eventId: string, body: Row) {
  requireManage(ctx);
  const partnerId = str(body.salesPartnerId);
  if (!UUID.test(partnerId)) fail('Wybierz sprzedawcę z kartoteki');
  const result = await runAutomaticCommissions(ctx.supabase, ctx.employee.authUserId, eventId, partnerId);
  if (result.status !== 200) fail(str(result.body.error) || 'Nie udało się zapisać prowizji.');
  const commissionId = result.body.commissionId ? str(result.body.commissionId) : null;
  return {
    ok: true, commissionId, created: result.body.created === true,
    message: !commissionId ? str(result.body.message) || 'Uzupełnij dane potrzebne do naliczenia.'
      : result.body.created === true ? 'Sprzedawca dodany — kwotę prowizji liczy podsumowanie wydarzenia' : 'Prowizja dla tej osoby jest już zapisana',
    tone: commissionId ? 'success' : 'warning',
  };
}

/**
 * Nowy wpis ręczny: ta sama osoba nie może dostać w wydarzeniu drugiej ręcznej prowizji ani ręcznego wpisu obok narzutu ze swojej
 * oferty z narzutem (narzut jest już kosztem w podsumowaniu i należnością na jej koncie). Druga ręczna prowizja — tylko gdy
 * użytkownik potwierdzi, że to inna należność (`allowSecond`); obok narzutu — nigdy. Prowizja z podsumowania tej osoby nie
 * blokuje: zatwierdzony wpis ręczny ją zastępuje (podsumowanie liczy wtedy wpis ręczny).
 */
async function guardDuplicate(ctx: NativeContext, eventId: string, partnerId: string | null, contactId: string | null, employeeId: string | null, allowSecond: boolean) {
  const s = ctx.supabase;
  const [commissions, offers] = await Promise.all([
    s.from('event_commissions').select('id,sales_partner_id,contact_id,employee_id,beneficiary_name,amount,status,automatic_source')
      .eq('event_id', eventId).neq('status', 'cancelled').eq('entry_kind', 'accrual'),
    s.from('offers').select('id,sales_partner_id,commercial_model,status').eq('event_id', eventId).eq('status', 'accepted').eq('commercial_model', 'markup'),
  ]);
  if (commissions.error) throw commissions.error;
  const same = (row: Row) => (partnerId && str(row.sales_partner_id) === partnerId) || (contactId && str(row.contact_id) === contactId)
    || (employeeId && str(row.employee_id) === employeeId);
  const manual = ((commissions.data || []) as Row[]).find((row) => !isAutomaticCommission(row) && same(row));
  if (manual && !allowSecond) {
    fail(`Ta osoba ma już ręczną prowizję w tym wydarzeniu: ${str(manual.beneficiary_name)} — ${num(manual.amount).toFixed(2).replace('.', ',')} zł (${commissionStatusLabels[str(manual.status) as CommissionStatus] || str(manual.status)}). Edytuj ten wpis zamiast dodawać drugi — inaczej zapłacisz dwa razy. Jeśli to inna należność, potwierdź to w formularzu.`);
  }
  const markupPartners = ((offers.error ? [] : offers.data || []) as Row[]).map((row) => str(row.sales_partner_id)).filter(Boolean);
  if (markupPartners.length) {
    let ownsMarkup = Boolean(partnerId && markupPartners.includes(partnerId));
    if (!ownsMarkup && (contactId || employeeId)) {
      const { data } = await s.from('sales_partner_profiles').select('id,contact_id,employee_id').in('id', markupPartners);
      ownsMarkup = ((data || []) as Row[]).some((row) => (contactId && str(row.contact_id) === contactId) || (employeeId && str(row.employee_id) === employeeId));
    }
    if (ownsMarkup) {
      fail('Ten sprzedawca ma w wydarzeniu ofertę z narzutem — narzut jest już kosztem w podsumowaniu i należnością na jego koncie prowizji. Nie dopisuj go drugi raz; jeśli należy mu się więcej, zmień narzut w ofercie.');
    }
  }
}

/** Wpis ręczny albo własne warunki (nowy lub edycja) — jak `handleSave` w `EventCommissionsPanel`. */
async function commissionSave(ctx: NativeContext, eventId: string, body: Row) {
  requireManage(ctx);
  const s = ctx.supabase;
  const editingId = str(body.id) || null;
  const saved = editingId ? await commissionOfEvent(ctx, eventId, editingId) : null;
  if (saved && isAutomaticCommission(saved)) fail('Kwotę, podstawę i odbiorcę tej prowizji ustala podsumowanie wydarzenia — zmień termin wypłaty i notatkę.');
  if (saved?.status === 'paid') fail('Prowizja została wypłacona. Odśwież dane przed edycją.');
  const source = ['partner', 'contact', 'employee', 'manual'].includes(str(body.beneficiarySource)) ? str(body.beneficiarySource) : 'manual';
  const beneficiaryId = str(body.beneficiaryId);
  const beneficiaryType = (Object.keys(commissionBeneficiaryLabels).includes(str(body.beneficiaryType)) ? str(body.beneficiaryType) : 'salesperson') as CommissionBeneficiaryType;
  const calculationType = (str(body.calculationType) === 'fixed' ? 'fixed' : 'percent') as CommissionCalculationType;
  const paymentMethod = (Object.keys(commissionPaymentLabels).includes(str(body.paymentMethod)) ? str(body.paymentMethod) : 'invoice') as CommissionPaymentMethod;
  const dueDate = str(body.dueDate).slice(0, 10);
  if (dueDate && !DAY.test(dueDate)) fail('Nieprawidłowy termin wypłaty.');
  const organizationId = UUID.test(str(body.organizationId)) ? str(body.organizationId) : null;

  // Osoba: kartoteka sprzedawców, pracownik, kontakt albo nazwa spoza bazy.
  let partner: Row | null = null;
  let resolvedName = '';
  if (source === 'partner') {
    if (!UUID.test(beneficiaryId)) fail('Wybierz osobę albo wpisz nazwę beneficjenta');
    const { data } = await s.from('sales_partner_profiles').select('id,employee_id,contact_id,employee:employees!employee_id(name,surname),contact:contacts!contact_id(full_name,first_name,last_name)')
      .eq('id', beneficiaryId).maybeSingle();
    partner = data as Row | null;
    const employee = one(partner?.employee) as Row | null;
    const contact = one(partner?.contact) as Row | null;
    resolvedName = employee ? `${str(employee.name)} ${str(employee.surname)}`.trim() : contact ? contactName(contact) : '';
  } else if (source === 'employee' && UUID.test(beneficiaryId)) {
    const { data } = await s.from('employees').select('name,surname').eq('id', beneficiaryId).maybeSingle();
    resolvedName = data ? `${str((data as Row).name)} ${str((data as Row).surname)}`.trim() : '';
  } else if (source === 'contact' && UUID.test(beneficiaryId)) {
    const { data } = await s.from('contacts').select('full_name,first_name,last_name').eq('id', beneficiaryId).maybeSingle();
    resolvedName = data ? contactName(data as Row) : '';
  } else if (source === 'manual') {
    resolvedName = str(body.manualName).trim();
  }
  const unchangedPerson = saved && beneficiaryId === (str(saved.sales_partner_id) || str(saved.employee_id) || str(saved.contact_id));
  if (!resolvedName && unchangedPerson) resolvedName = str(saved?.beneficiary_name);
  if (!resolvedName) fail('Wybierz osobę albo wpisz nazwę beneficjenta');

  const amounts = getCommissionAmounts({
    calculationType, baseAmount: num(body.baseAmount), rate: num(body.rate), fixedAmount: num(body.fixedAmount),
    paymentMethod, dividendTaxRate: num(body.dividendTaxRate ?? DEFAULT_DIVIDEND_TAX_RATE),
  });
  if (!Number.isFinite(amounts.nominalAmount) || !Number.isFinite(amounts.companyCostAmount) || amounts.nominalAmount <= 0) {
    fail('Kwota prowizji musi być większa od zera');
  }
  const employeeId = source === 'partner' ? str(partner?.employee_id) || null : source === 'employee' ? beneficiaryId : null;
  const contactId = source === 'partner' ? str(partner?.contact_id) || null : source === 'contact' ? beneficiaryId : null;
  if (!editingId) await guardDuplicate(ctx, eventId, source === 'partner' ? beneficiaryId : null, contactId, employeeId, body.allowSecond === true);
  const payload: Row = {
    event_id: eventId,
    sales_partner_id: source === 'partner' ? beneficiaryId : null,
    beneficiary_type: beneficiaryType,
    beneficiary_name: resolvedName,
    salesperson_id: beneficiaryType === 'salesperson' ? employeeId : null,
    employee_id: employeeId,
    contact_id: contactId,
    organization_id: organizationId,
    calculation_type: calculationType,
    rate: calculationType === 'percent' ? num(body.rate) : 0,
    base_amount: calculationType === 'percent' ? num(body.baseAmount) : 0,
    base_description: str(body.baseDescription).trim() || null,
    amount: amounts.nominalAmount,
    payment_method: paymentMethod,
    dividend_tax_rate: paymentMethod === 'cash_dividend' ? num(body.dividendTaxRate) : DEFAULT_DIVIDEND_TAX_RATE,
    company_cost_amount: amounts.companyCostAmount,
    due_date: dueDate || null,
    notes: str(body.notes).trim() || null,
    ...(editingId ? { automatic_waiting_for_offer: false } : {}),
    ...(!editingId ? { status: 'planned', created_by: ctx.employee.id } : {}),
  };
  const result = editingId
    ? await s.from('event_commissions').update(payload).eq('id', editingId).eq('event_id', eventId).neq('status', 'paid').select('id').maybeSingle()
    : await s.from('event_commissions').insert(payload).select('id').single();
  if (result.error || !result.data) fail(result.error?.message || 'Prowizja została zmieniona lub wypłacona. Odśwież dane przed edycją.');
  return { ok: true, message: editingId ? 'Prowizja została zaktualizowana' : 'Prowizja została naliczona' };
}

/** Prowizja z podsumowania: tylko termin wypłaty i notatka. */
async function commissionSchedule(ctx: NativeContext, eventId: string, body: Row) {
  requireManage(ctx);
  const row = await commissionOfEvent(ctx, eventId, str(body.id));
  if (row.status === 'paid') fail('Wypłacona prowizja pozostaje w historii rozliczeń.');
  const dueDate = str(body.dueDate).slice(0, 10);
  if (dueDate && !DAY.test(dueDate)) fail('Nieprawidłowy termin wypłaty.');
  const { data, error } = await ctx.supabase.from('event_commissions')
    .update({ due_date: dueDate || null, notes: str(body.notes).trim() || null })
    .eq('id', row.id).eq('event_id', eventId).select('id').maybeSingle();
  if (error || !data) fail(error?.message || 'Nie udało się zapisać zmian. Odśwież dane.');
  return { ok: true, message: 'Termin i notatka zapisane' };
}

/** Status wpisu ręcznego (planowana / zatwierdzona / wypłacona / anulowana) — jak lista statusu w CRM. */
async function commissionStatus(ctx: NativeContext, eventId: string, body: Row) {
  requireManage(ctx);
  const row = await commissionOfEvent(ctx, eventId, str(body.id));
  const status = str(body.status) as CommissionStatus;
  if (!['planned', 'approved', 'paid', 'cancelled'].includes(status) || status === row.status) return { ok: true };
  if (isAutomaticCommission(row)) fail('Status prowizji z podsumowania zmienia podsumowanie wydarzenia.');
  if (row.status === 'paid') fail('Wypłacona prowizja pozostaje w historii rozliczeń. Nie można cofnąć jej samą zmianą statusu.');
  if (row.automatic_waiting_for_offer && (status === 'approved' || status === 'paid')) fail('Najpierw zaakceptuj ofertę lub zapisz ręcznie podstawę prowizji.');
  const { error } = await ctx.supabase.from('event_commissions').update({ status }).eq('id', row.id).eq('event_id', eventId);
  if (error) fail(error.message || 'Nie udało się zmienić statusu');
  return { ok: true, message: `Status prowizji: ${commissionStatusLabels[status]}` };
}

/** Anulowanie: z podsumowania — trwałe, z powodem (`set_event_commission_cancelled`); ręczna — status „anulowana”. */
async function commissionCancel(ctx: NativeContext, eventId: string, body: Row) {
  requireManage(ctx);
  const row = await commissionOfEvent(ctx, eventId, str(body.id));
  if (isAutomaticCommission(row)) {
    const reason = str(body.reason).trim();
    if (!reason) fail('Podaj powód anulowania prowizji.');
    const { error } = await ctx.supabase.rpc('set_event_commission_cancelled', { p_commission_id: row.id, p_cancel: true, p_reason: reason });
    if (error) fail(error.message || 'Nie udało się anulować prowizji.');
    return { ok: true, message: 'Prowizja anulowana' };
  }
  // Zachowanie wpisu blokuje ponowne automatyczne naliczenie.
  const { data, error } = await ctx.supabase.from('event_commissions').update({ status: 'cancelled' })
    .eq('id', row.id).eq('event_id', eventId).neq('status', 'paid').select('id').maybeSingle();
  if (error || !data) fail(error?.message || 'Nie udało się anulować prowizji. Odśwież jej status.');
  return { ok: true, message: 'Prowizja została anulowana' };
}

async function commissionRestore(ctx: NativeContext, eventId: string, body: Row) {
  requireManage(ctx);
  const row = await commissionOfEvent(ctx, eventId, str(body.id));
  const { error } = await ctx.supabase.rpc('set_event_commission_cancelled', { p_commission_id: row.id, p_cancel: false });
  if (error) fail(error.message || 'Nie udało się przywrócić prowizji. Odśwież dane.');
  return { ok: true, message: 'Prowizja przywrócona — kwotę ustali podsumowanie wydarzenia' };
}

registerEventActions('billing', {
  saveBilling, saveSettlement, dissolve, commissionPartner, commissionSave, commissionSchedule, commissionStatus, commissionCancel, commissionRestore,
});
