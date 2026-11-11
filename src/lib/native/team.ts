import 'server-only';
import type { NativeContext } from './auth';
import { can } from './auth';
import { collectionItems, collectionState, invalidateNativeSync } from './sync';

/*
 * Zespół na Macu (`/crm/employees`, `/crm/employees/[id]`): aktywni pracownicy jak `getEmployees` (kolejność order_index,
 * potem od najnowszych) i dane karty pracownika (wydarzenia, konta e-mail bez haseł, nieobecności, role firmowe, plan).
 * Tokenem pracownika — RLS jak w przeglądarce. E-mail prywatny tylko dla administratora (jak w CRM).
 */

export const TEAM_SET = 'team-employees';

type Row = Record<string, any>;
type Item = { id: string; item: Record<string, unknown> };

const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const list = (value: unknown) => (Array.isArray(value) ? value.map((entry) => text(entry).trim()).filter(Boolean) : []);

/** Kadrowanie zdjęcia jak `EmployeeAvatar` w CRM (`*_metadata.desktop`: przesunięcie w %, skala, dopasowanie). */
export const imageCrop = (metadata: Row | null | undefined) => {
  const desktop = metadata?.desktop;
  const position = desktop?.position;
  if (!position && !desktop?.objectFit) return null;
  return {
    x: Number(position?.posX) || 0,
    y: Number(position?.posY) || 0,
    scale: Number(position?.scale) || 1,
    fit: typeof desktop?.objectFit === 'string' ? desktop.objectFit : 'cover',
  };
};

const FIELDS = 'id,name,surname,nickname,email,personal_email,notification_email_preference,phone_number,phone_private,avatar_url,avatar_metadata,background_image_url,background_metadata,role,access_level,access_level_id,occupation,region,address_street,address_city,address_postal_code,skills,is_active,notes,created_at,last_active_at,show_on_website,website_bio,linkedin_url,instagram_url,facebook_url,order_index';

export function teamAccess(ctx: NativeContext) {
  const e = ctx.employee;
  return {
    employeeId: e.id,
    isAdmin: e.isAdmin,
    canView: can(e, 'employees_view') || can(e, 'employees_manage'),
    canManage: can(e, 'employees_manage'),
    canCreate: can(e, 'employees_manage') || can(e, 'employees_create'),
    /** Zatwierdzanie nieobecności jak w zakładce „Oś czasu” (admin lub employees_manage). */
    canApproveAbsences: can(e, 'employees_manage'),
    canViewPersonnel: can(e, 'personnel_view') || can(e, 'personnel_manage'),
  };
}

export const employeeItem = (row: Row, isAdmin: boolean) => ({
  id: String(row.id),
  name: text(row.name), surname: text(row.surname), nickname: text(row.nickname),
  email: text(row.email), personalEmail: isAdmin ? text(row.personal_email) : '',
  notificationPreference: text(row.notification_email_preference) || 'work',
  phone: text(row.phone_number), phonePrivate: text(row.phone_private),
  avatarUrl: row.avatar_url || null, avatar: imageCrop(row.avatar_metadata),
  backgroundUrl: row.background_image_url || null, background: imageCrop(row.background_metadata),
  role: text(row.role), accessLevel: text(row.access_level), accessLevelId: row.access_level_id || null,
  occupation: text(row.occupation), region: text(row.region),
  street: text(row.address_street), city: text(row.address_city), postalCode: text(row.address_postal_code),
  skills: list(row.skills), active: row.is_active !== false, notes: text(row.notes),
  createdAt: row.created_at || null, lastActiveAt: row.last_active_at || null,
  showOnWebsite: row.show_on_website === true, websiteBio: text(row.website_bio),
  linkedin: text(row.linkedin_url), instagram: text(row.instagram_url), facebook: text(row.facebook_url),
  orderIndex: typeof row.order_index === 'number' ? row.order_index : 999,
});

async function loadTeam(ctx: NativeContext): Promise<Item[]> {
  const { data, error } = await ctx.supabase.from('employees').select(FIELDS).eq('is_active', true)
    .order('order_index', { ascending: true }).order('created_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return (data || []).map((row: Row) => ({ id: String(row.id), item: employeeItem(row, ctx.employee.isAdmin) }));
}

export const teamState = (ctx: NativeContext, hash?: string) => collectionState(ctx, TEAM_SET, loadTeam, hash);
export const teamItems = (ctx: NativeContext, buckets: unknown[]) => collectionItems(ctx, TEAM_SET, loadTeam, buckets);
export const invalidateTeam = () => invalidateNativeSync([TEAM_SET]);

/** Dane zakładek karty pracownika (jak `fetchEvents`, `fetchEmailAccounts`, nieobecności i role firmowe w CRM). */
export async function employeeDetail(ctx: NativeContext, id: string) {
  const s = ctx.supabase;
  const [events, accounts, absences, levels] = await Promise.all([
    s.from('employee_assignments').select('id,role,hours,status,responsibilities,created_at,event:events(id,name,event_date,status)')
      .eq('employee_id', id).order('created_at', { ascending: false }).limit(500),
    s.from('employee_email_accounts').select('id,email_address,is_default').eq('employee_id', id).eq('is_active', true)
      .order('created_at', { ascending: false }),
    s.from('employee_absences').select('id,absence_type,start_date,end_date,all_day,approval_status,notes,approved_at,created_at')
      .eq('employee_id', id).order('start_date', { ascending: false }).limit(500),
    ctx.employee.isAdmin
      ? s.from('access_levels').select('id,name,description').eq('is_company_role', true).order('order_index')
      : Promise.resolve({ data: [], error: null }),
  ]);
  return {
    events: (events.data || []).filter((row: Row) => row.event).map((row: Row) => ({
      id: String(row.id), role: text(row.role), hours: row.hours == null ? null : Number(row.hours), status: text(row.status),
      responsibilities: text(row.responsibilities),
      eventId: String(row.event.id), eventName: text(row.event.name), eventDate: row.event.event_date || null, eventStatus: text(row.event.status),
    })),
    emailAccounts: (accounts.data || []).map((row: Row) => ({ id: String(row.id), email: text(row.email_address), primary: row.is_default === true })),
    absences: (absences.data || []).map((row: Row) => ({
      id: String(row.id), type: text(row.absence_type), start: text(row.start_date), end: text(row.end_date), allDay: row.all_day !== false,
      status: text(row.approval_status) || 'pending', notes: text(row.notes), approvedAt: row.approved_at || null, createdAt: row.created_at || null,
    })),
    accessLevels: (levels.data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name), description: text(row.description) })),
  };
}

/** Plan (`get_employee_schedule`) — jak `fetchEmployeeSchedule`, z dawną funkcją dla starszej bazy. */
export async function employeeSchedule(ctx: NativeContext, ids: string[], from: string, to: string) {
  const { data, error } = await ctx.supabase.rpc('get_employee_schedule', { p_employee_ids: ids, p_from: from, p_to: to });
  if (!error) return { legacy: false, items: Array.isArray(data) ? data : [] };
  if (error.code !== 'PGRST202' && error.code !== '42883') throw error;
  const legacy = await ctx.supabase.rpc('get_employee_timeline_data', { p_employee_ids: ids, p_start_date: from, p_end_date: to });
  if (legacy.error) throw legacy.error;
  const items = (Array.isArray(legacy.data) ? legacy.data : []).flatMap((row: Row) => {
    const kind = row?.item_type === 'event' ? 'event' : row?.item_type === 'phase' ? 'phase' : row?.item_type === 'absence' ? 'absence' : null;
    if (!kind) return [];
    const eventId = kind === 'event' ? row.item_id : row?.item_metadata?.event_id;
    return [{
      employee_id: String(row.employee_id), kind, item_id: String(row.item_id ?? ''), title: text(row.item_title),
      subtitle: text(row?.item_metadata?.location), starts_at: row.item_start, ends_at: row.item_end, all_day: kind !== 'phase',
      status: text(row.item_status), color: typeof row.item_color === 'string' ? row.item_color : '#64748b',
      url: eventId ? `/crm/events/${eventId}` : '',
    }];
  });
  return { legacy: true, items };
}
