import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('portfolio_projects')
      .select('*')
      .order('order_index', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ projects: data || [] });
  } catch (error: any) {
    console.error('Error fetching portfolio projects:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { data, error } = await supabase
      .from('portfolio_projects')
      .insert([body])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    console.error('Error creating portfolio project:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
