import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('team_members')
      .select('*')
      .order('order_index', { ascending: true });

    if (error) {
      console.error('Error fetching team members:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const insertData: any = {
      name: body.name,
      role: body.role,
      position: body.position,
      image: body.image,
      alt: body.alt || null,
      email: body.email || null,
      image_metadata: body.image_metadata || {},
      order_index: body.order_index || 0,
      is_visible: body.is_visible !== undefined ? body.is_visible : true,
      bio: body.bio || null,
      linkedin: body.linkedin || null,
      instagram: body.instagram || null,
      facebook: body.facebook || null,
    };

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('team_members')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('Error creating team member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    try {
      revalidatePath('/');
      revalidatePath('/zespol');
    } catch (revalidateError) {
      console.warn('[API POST] Revalidate warning (safe to ignore in dev):', revalidateError);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
