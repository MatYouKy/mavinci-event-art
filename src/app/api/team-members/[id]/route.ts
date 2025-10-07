import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { id } = params;

    const updateData: any = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.position !== undefined) updateData.position = body.position;
    if (body.image !== undefined) updateData.image = body.image;
    if (body.alt !== undefined) updateData.alt = body.alt || '';
    if (body.email !== undefined) updateData.email = body.email || '';
    if (body.image_metadata !== undefined) updateData.image_metadata = body.image_metadata || {};
    if (body.bio !== undefined) updateData.bio = body.bio || '';
    if (body.linkedin !== undefined) updateData.linkedin = body.linkedin || '';
    if (body.instagram !== undefined) updateData.instagram = body.instagram || '';
    if (body.facebook !== undefined) updateData.facebook = body.facebook || '';
    if (body.order_index !== undefined) updateData.order_index = body.order_index;
    if (body.is_visible !== undefined) updateData.is_visible = body.is_visible;

    const { data, error } = await supabase
      .from('team_members')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating team member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting team member:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
