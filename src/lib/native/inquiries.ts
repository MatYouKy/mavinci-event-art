import 'server-only';
import type { NativeContext } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';
import { inquirySourceLabel, inquiryTitleLabel, inquiryTypeLabels } from '@/lib/ui/systemLabels';

/*
 * Lejek zapytań na Macu (`/crm/inquiries`): te same zapytania co strona (`InquiriesPageClient` — `tasks` z opiekunem,
 * członkostwo `inquiry_team_members`), tokenem pracownika (RLS). Etykiety (tytuł, źródło, rodzaj) liczy serwer tymi samymi
 * funkcjami co przeglądarka (`systemLabels.ts`). Zmiany wykrywa skrót treści koszyków (`sync.ts`).
 */

export const INQUIRY_FUNNEL_SET = 'inquiry-funnel';
const PAGE = 1000;

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

async function loadInquiries(ctx: NativeContext): Promise<Item[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.supabase
      .from('tasks')
      .select(
        `id, title, description, created_at, updated_at,
         inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
         first_contact_at, sla_first_contact_due_at,
         estimated_value, win_probability, lost_reason, lost_reason_category,
         linked_offer_id, event_id, contact_id, organization_id,
         inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, sales_team_id)`,
      )
      .eq('is_inquiry', true)
      .is('archived_at', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  const { data: memberships } = await ctx.supabase
    .from('inquiry_team_members').select('inquiry_id').eq('employee_id', ctx.employee.id).eq('is_active', true);
  const member = new Set((memberships || []).map((row: Row) => String(row.inquiry_id)));

  return rows.map((t) => {
    const d = (t.inquiry_details && typeof t.inquiry_details === 'object' ? t.inquiry_details : {}) as Row;
    const owner = t.inquiry_owner && typeof t.inquiry_owner === 'object' ? (t.inquiry_owner as Row) : null;
    return {
      id: String(t.id),
      item: {
        id: String(t.id),
        title: text(t.title),
        titleLabel: inquiryTitleLabel(t.title),
        sourceLabel: inquirySourceLabel(d),
        typeLabels: inquiryTypeLabels(text(t.title), d),
        description: text(t.description),
        message: text(d.source_message_content),
        stage: text(t.inquiry_stage) || 'new',
        ownerId: t.inquiry_owner_id ?? null,
        ownerName: owner ? `${owner.name ?? ''} ${owner.surname ?? ''}`.trim() : '',
        ownerTeamId: owner?.sales_team_id ?? null,
        nextActionAt: t.next_action_at ?? null,
        lastContactAt: t.last_contact_at ?? null,
        firstContactAt: t.first_contact_at ?? null,
        slaDueAt: t.sla_first_contact_due_at ?? null,
        estimatedValue: t.estimated_value === null || t.estimated_value === undefined ? null : Number(t.estimated_value),
        probability: Number(t.win_probability ?? 0),
        lostReason: text(t.lost_reason),
        lostReasonCategory: text(t.lost_reason_category),
        linkedOfferId: t.linked_offer_id ?? null,
        eventId: t.event_id ?? null,
        contactId: t.contact_id ?? null,
        organizationId: t.organization_id ?? null,
        clientText: text(d.client_text),
        clientCompany: text(d.client_company),
        clientPhone: text(d.client_phone),
        clientEmail: text(d.client_email),
        locationText: text(d.location_text),
        scope: text(d.scope),
        sourceName: text(d.source_name),
        member: member.has(String(t.id)),
        createdAt: t.created_at,
      },
    };
  });
}

/** Uprawnienia lejka jak w `InquiriesPageClient` (zakresy, przejmowanie, zarządzanie własnymi / zespołu / wszystkimi). */
export async function inquiryAccess(ctx: NativeContext) {
  const e = ctx.employee;
  const has = (scope: string) => e.permissions.includes(scope);
  const { data } = await ctx.supabase.from('employees').select('sales_team_id,is_sales_team_manager').eq('id', e.id).maybeSingle();
  return {
    employeeId: e.id,
    salesTeamId: (data?.sales_team_id as string | null) ?? null,
    isTeamManager: !!data?.is_sales_team_manager,
    isAdmin: e.isAdmin,
    canViewPool: e.isAdmin || has('inquiries_view') || has('inquiries_manage') || has('inquiries_view_pool'),
    canViewTeam: e.isAdmin || has('inquiries_view_team') || has('inquiries_manage_team'),
    canViewAll: e.isAdmin || has('inquiries_view_all') || has('inquiries_manage_all'),
    canAssign: e.isAdmin || has('inquiries_assign') || has('inquiries_manage_all'),
    canClaim: e.isAdmin || has('inquiries_assign') || has('inquiries_manage'),
    canCreate: e.isAdmin || has('inquiries_manage') || has('inquiries_manage_all') || has('tasks_create'),
    manageAll: e.isAdmin || has('inquiries_manage_all'),
    manageOwn: has('inquiries_manage') || has('inquiries_manage_own'),
    manageTeam: has('inquiries_manage_team'),
  };
}

export const inquiriesState = (ctx: NativeContext, hash?: string) => collectionState(ctx, INQUIRY_FUNNEL_SET, loadInquiries, hash);
export const inquiriesItems = (ctx: NativeContext, buckets: unknown[]) => collectionItems(ctx, INQUIRY_FUNNEL_SET, loadInquiries, buckets);
/** Zmiana zapytania widoczna od razu dla wszystkich (każdy pracownik ma własną migawkę), także w kartach aplikacji. */
export const invalidateInquiries = () => invalidateNativeSync([INQUIRY_FUNNEL_SET, 'inquiries']);
