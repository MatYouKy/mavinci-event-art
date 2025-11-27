import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`Missing Supabase credentials: URL=${!!supabaseUrl}, Key=${!!serviceRoleKey}`);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { service_item_id, display_order } = body;

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('conferences_related_services')
      .insert({
        service_item_id,
        display_order
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const service_item_id = searchParams.get('service_item_id');

    if (!service_item_id) {
      return NextResponse.json({ error: 'service_item_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { error } = await supabase
      .from('conferences_related_services')
      .delete()
      .eq('service_item_id', service_item_id);

    if (error) {
      console.error('Supabase delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
