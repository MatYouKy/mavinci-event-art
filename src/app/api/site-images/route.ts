import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const section = searchParams.get('section');

    let query = supabase.from('site_images').select('*');

    if (section) {
      query = query.eq('section', section);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ images: data || [] });
  } catch (error: any) {
    console.error('Error fetching site images:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { data, error } = await supabase
      .from('site_images')
      .insert([body])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    console.error('Error creating site image:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
