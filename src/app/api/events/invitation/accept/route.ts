import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json(
      { error: 'Token is required' },
      { status: 400 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: assignment, error: assignmentError } = await supabase
    .from('employee_assignments')
    .select(`
      id,
      status,
      invitation_expires_at,
      employee_id,
      event_id,
      employees!employee_assignments_employee_id_fkey(
        id,
        name,
        surname,
        email
      ),
      events(
        id,
        name,
        event_date,
        location
      )
    `)
    .eq('invitation_token', token)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return NextResponse.redirect(
      new URL('/crm/events?error=invalid_token', request.url)
    );
  }

  if (new Date(assignment.invitation_expires_at) < new Date()) {
    return NextResponse.redirect(
      new URL('/crm/events?error=token_expired', request.url)
    );
  }

  if (assignment.status !== 'pending') {
    return NextResponse.redirect(
      new URL(`/crm/events/${assignment.event_id}?info=already_responded`, request.url)
    );
  }

  const { error: updateError } = await supabase
    .from('employee_assignments')
    .update({
      status: 'accepted',
      responded_at: new Date().toISOString(),
    })
    .eq('id', assignment.id);

  if (updateError) {
    console.error('Error accepting invitation:', updateError);
    return NextResponse.redirect(
      new URL('/crm/events?error=update_failed', request.url)
    );
  }

  const event = assignment.events as any;
  const employee = assignment.employees as any;

  return NextResponse.redirect(
    new URL(
      `/crm/events/${assignment.event_id}?success=invitation_accepted&event=${encodeURIComponent(event.name)}`,
      request.url
    )
  );
}
