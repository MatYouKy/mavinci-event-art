import { ImageMetadata } from '@/lib/supabase/types';
import { createClient } from '@supabase/supabase-js';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  position?: string;
  image: string;
  alt?: string;
  image_metadata?: ImageMetadata;
  bio?: string;
  email?: string;
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  order_index: number;
  is_visible?: boolean;
  created_at?: string;
  updated_at?: string;
}

type EmployeeRow = {
  id: string;
  name: string | null;
  surname: string | null;
  nickname: string | null;
  email: string | null;
  avatar_url: string | null;
  team_page_metadata: any | null;
  occupation: string | null;
  role: string | null;
  website_bio: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  order_index: number | null;
};

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = getServerSupabase();

  const { data, error } = await supabase
    .from('employees')
    .select(
      'id, name, surname, nickname, email, avatar_url, team_page_metadata, occupation, role, website_bio, linkedin_url, instagram_url, facebook_url, order_index, created_at'
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

    const position = emp.occupation || emp.role || '';
    const role = emp.role || emp.occupation || '';

    return {
      id: emp.id,
      name: displayName,
      position,
      role,
      email: emp.email ?? undefined,
      image: emp.avatar_url ?? null,
      image_metadata: emp.team_page_metadata ?? undefined,
      alt: fullName || displayName,
      bio: emp.website_bio ?? undefined,
      linkedin: emp.linkedin_url ?? undefined,
      instagram: emp.instagram_url ?? undefined,
      facebook: emp.facebook_url ?? undefined,
      order_index: emp.order_index ?? 0,
    };
  });
}