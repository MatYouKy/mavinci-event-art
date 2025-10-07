import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const showAll = searchParams.get('all') === 'true';

    let query = supabase
      .from('team_members')
      .select('*');

    if (!showAll) {
      query = query.eq('is_visible', true);
    }

    const { data, error } = await query.order('order_index', { ascending: true });

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

    const { data, error } = await supabase
      .from('team_members')
      .insert([{
        name: body.name,
        role: body.role,
        position: body.position,
        image: body.image,
        alt: body.alt || '',
        email: body.email || '',
        image_metadata: body.image_metadata || {},
        bio: body.bio || '',
        linkedin: body.linkedin || '',
        instagram: body.instagram || '',
        facebook: body.facebook || '',
        order_index: body.order_index || 0,
        is_visible: body.is_visible !== undefined ? body.is_visible : true,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating team member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
