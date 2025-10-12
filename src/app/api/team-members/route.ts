import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';

function isAdminRequest(request: Request): boolean {
  const adminToken = request.headers.get('x-admin-token');
  const validToken = process.env.ADMIN_API_TOKEN || 'mavinci-admin-secret-2025';
  return adminToken === validToken;
}

export async function GET(request: Request) {
  try {
    // Fetch employees marked as show_on_website=true for public display
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, surname, nickname, email, avatar_url, avatar_metadata, role, occupation, show_on_website, website_bio, linkedin_url, instagram_url, facebook_url, order_index, access_level, created_at')
      .eq('show_on_website', true)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching employees:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform employees data to match team_members structure for compatibility
    const teamMembers = (data || []).map((emp: any, index: number) => ({
      id: emp.id,
      name: `${emp.name || ''} ${emp.surname || ''}`.trim() || emp.nickname || 'Pracownik',
      position: emp.occupation || emp.role || '',
      role: emp.role || emp.occupation || '',
      email: emp.email,
      image: emp.avatar_url,
      image_metadata: emp.avatar_metadata,
      alt: `${emp.name || ''} ${emp.surname || ''}`.trim(),
      order_index: index,
      bio: emp.website_bio,
      linkedin: emp.linkedin_url,
      instagram: emp.instagram_url,
      facebook: emp.facebook_url,
      is_visible: emp.show_on_website,
    }));

    return NextResponse.json(teamMembers);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST removed - use /crm/employees to add new employees instead
// This endpoint is read-only for displaying website team members
