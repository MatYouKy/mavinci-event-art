import 'server-only';
import type { IImageMetadata } from '@/types/image';
import type { TeamMember } from '@/lib/supabase/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export type { TeamMember } from '@/lib/supabase/types';

type EmployeeRow = {
  id: string;
  name: string | null;
  surname: string | null;
  nickname: string | null;
  email: string | null;
  avatar_url: string | null;
  team_page_metadata: IImageMetadata | null;
  avatar_metadata: IImageMetadata | null;
  occupation: string | null;
  website_bio: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  order_index: number | null;
};

export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = createSupabaseAdminClient();

  // Service-role access is server-only. Keep this explicit public projection
  // and the publication filter together: never return the full employee row.
  // Both public pages and /bridge/team-members use this same boundary.

  const { data, error } = await supabase
    .from('employees')
    .select(
      'id, name, surname, nickname, email, avatar_url, team_page_metadata, avatar_metadata, occupation, website_bio, linkedin_url, instagram_url, facebook_url, order_index, created_at'
    )
    .eq('show_on_website', true)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getTeamMembers] Supabase error:', error);
    throw error;
  }

  const rows = (data ?? []) as EmployeeRow[];

  return rows.map((emp) => {
    const fullName = `${emp.name ?? ''} ${emp.surname ?? ''}`.trim();
    const fallbackName = emp.nickname?.trim() || 'Pracownik';

    const displayName = fullName || fallbackName;

    // Public role is the job title, never an internal CRM permission role.
    const position = emp.occupation || '';

    return {
      id: emp.id,
      name: displayName,
      position,
      role: position,
      email: emp.email ?? undefined,
      image: emp.avatar_url ?? '',
      image_metadata: emp.team_page_metadata ?? emp.avatar_metadata ?? undefined,
      alt: fullName || displayName,
      bio: emp.website_bio ?? undefined,
      linkedin: emp.linkedin_url ?? undefined,
      instagram: emp.instagram_url ?? undefined,
      facebook: emp.facebook_url ?? undefined,
      order_index: emp.order_index ?? 0,
      is_visible: true,
    };
  });
}