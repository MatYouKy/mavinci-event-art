import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const showAll = searchParams.get('all') === 'true';

    let query = supabase
      .from('team_members')
      .select('*');

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

    const insertData: any = {
      name: body.name,
      role: body.role,
      position: body.position,
      image: body.image,
      alt: body.alt || null,
      email: body.email || null,
      image_metadata: body.image_metadata || {},
      order_index: body.order_index || 0,
    };

    if (body.is_visible !== undefined) {
      insertData.is_visible = body.is_visible;
    }

    const { data, error } = await supabase
      .from('team_members')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('Error creating team member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidatePath('/');
    revalidatePath('/zespol');

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
