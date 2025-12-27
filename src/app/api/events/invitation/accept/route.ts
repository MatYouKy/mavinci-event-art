import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get('token');
  const execute = searchParams.get('execute');

  if (!token) {
    return NextResponse.json(
      { error: 'Token is required' },
      { status: 400 }
    );
  }

  if (execute !== 'true') {
    return NextResponse.redirect(
      new URL(`/crm/events/invitation/accept?token=${token}`, request.url)
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
        location,
        created_by
      )
    `)
    .eq('invitation_token', token)
    .maybeSingle();

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: 'Nieprawidłowy token zaproszenia' },
      { status: 400 }
    );
  }

  if (new Date(assignment.invitation_expires_at) < new Date()) {
    return NextResponse.json(
      { error: 'Token zaproszenia wygasł' },
      { status: 400 }
    );
  }

  if (assignment.status !== 'pending') {
    return NextResponse.json(
      { error: 'To zaproszenie zostało już przetworzone' },
      { status: 400 }
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
    return NextResponse.json(
      { error: 'Nie udało się zaktualizować statusu zaproszenia' },
      { status: 500 }
    );
  }

  const event = assignment.events as any;
  const employee = assignment.employees as any;

  const { data: employeeNotifications } = await supabase
    .from('notification_recipients')
    .select('notification_id, notifications(*)')
    .eq('user_id', assignment.employee_id);

  if (employeeNotifications && employeeNotifications.length > 0) {
    for (const notifRecipient of employeeNotifications) {
      const notification = notifRecipient.notifications as any;
      if (
        notification &&
        notification.related_entity_id === assignment.event_id &&
        notification.related_entity_type === 'event' &&
        notification.metadata?.assignment_id === assignment.id
      ) {
        await supabase
          .from('notifications')
          .update({
            metadata: {
              ...notification.metadata,
              responded: true,
              response_status: 'accepted',
              responded_at: new Date().toISOString()
            }
          })
          .eq('id', notification.id);
      }
    }
  }

  if (event.created_by) {
    const { data: creatorNotification, error: notifError } = await supabase
      .from('notifications')
      .insert({
        category: 'employee',
        title: 'Akceptacja zaproszenia',
        message: `${employee.name} ${employee.surname} zaakceptował zaproszenie do wydarzenia "${event.name}"`,
        type: 'success',
        related_entity_type: 'event',
        related_entity_id: assignment.event_id,
        action_url: `/crm/events/${assignment.event_id}`,
        metadata: {
          event_id: assignment.event_id,
          event_name: event.name,
          employee_id: assignment.employee_id,
          employee_name: `${employee.name} ${employee.surname}`,
          assignment_id: assignment.id,
          response_type: 'accepted'
        }
      })
      .select('id')
      .single();

    if (!notifError && creatorNotification) {
      await supabase
        .from('notification_recipients')
        .insert({
          notification_id: creatorNotification.id,
          user_id: event.created_by
        });
    }
  }

  return NextResponse.json({
    success: true,
    eventId: assignment.event_id,
    eventName: event.name,
    message: 'Zaproszenie zostało zaakceptowane pomyślnie'
  });
}
