import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const { id } = await params;

    console.log('[API PUT] Received body:', JSON.stringify(body, null, 2));
    console.log('[API PUT] ID:', id);

    const updateData: any = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.position !== undefined) updateData.position = body.position;
    if (body.image !== undefined) updateData.image = body.image;
    if (body.alt !== undefined) updateData.alt = body.alt || null;
    if (body.email !== undefined) updateData.email = body.email || null;
    if (body.image_metadata !== undefined) updateData.image_metadata = body.image_metadata;
    if (body.order_index !== undefined) updateData.order_index = body.order_index;
    if (body.is_visible !== undefined) updateData.is_visible = body.is_visible;
    if (body.bio !== undefined) updateData.bio = body.bio;
    if (body.linkedin !== undefined) updateData.linkedin = body.linkedin;
    if (body.instagram !== undefined) updateData.instagram = body.instagram;
    if (body.facebook !== undefined) updateData.facebook = body.facebook;

    console.log('[API PUT] Update data:', JSON.stringify(updateData, null, 2));

    const { data, error } = await supabaseAdmin
      .from('team_members')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[API PUT] Supabase error:', error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    console.log('[API PUT] Success, data:', data);

    // Revalidate paths - wrap in try-catch as it can fail in dev mode
    try {
      revalidatePath('/');
      revalidatePath('/zespol');
    } catch (revalidateError) {
      console.warn('[API PUT] Revalidate warning (safe to ignore in dev):', revalidateError);
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('[API PUT] Unexpected error:', error);
    console.error('[API PUT] Error stack:', error.stack);
    return NextResponse.json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await supabaseAdmin
      .from('team_members')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting team member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    try {
      revalidatePath('/');
      revalidatePath('/zespol');
    } catch (revalidateError) {
      console.warn('[API DELETE] Revalidate warning (safe to ignore in dev):', revalidateError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
