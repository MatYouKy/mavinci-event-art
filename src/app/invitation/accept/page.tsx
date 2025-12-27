import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token;

  console.log('[accept-invitation] Starting with token:', token);

  if (!token) {
    console.log('[accept-invitation] No token provided');
    redirect('/invitation/error?message=Brak tokenu zaproszenia');
  }

  console.log('[accept-invitation] Supabase URL:', supabaseUrl);
  console.log('[accept-invitation] Service key exists:', !!supabaseServiceKey);

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

  console.log('[accept-invitation] Assignment query result:', { assignment, assignmentError });

  if (assignmentError || !assignment) {
    console.log('[accept-invitation] Invalid token or error');
    redirect('/invitation/error?message=Nieprawidłowy token zaproszenia');
  }

  if (new Date(assignment.invitation_expires_at) < new Date()) {
    redirect('/invitation/error?message=Token zaproszenia wygasł');
  }

  if (assignment.status !== 'pending') {
    const event = assignment.events as any;
    redirect(`/invitation/success?event=${encodeURIComponent(event?.name || '')}&type=accepted`);
  }

  console.log('[accept-invitation] Updating assignment to accepted');

  const { error: updateError } = await supabase
    .from('employee_assignments')
    .update({
      status: 'accepted',
      responded_at: new Date().toISOString(),
    })
    .eq('id', assignment.id);

  console.log('[accept-invitation] Update result:', { updateError });

  if (updateError) {
    console.error('[accept-invitation] Error accepting invitation:', updateError);
    redirect('/invitation/error?message=Nie udało się zaktualizować statusu zaproszenia');
  }

  const event = assignment.events as any;
  const employee = assignment.employees as any;

  console.log('[accept-invitation] Creating notification for creator:', event.created_by);

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

    console.log('[accept-invitation] Notification created:', { creatorNotification, notifError });

    if (!notifError && creatorNotification) {
      const { error: recipientError } = await supabase
        .from('notification_recipients')
        .insert({
          notification_id: creatorNotification.id,
          user_id: event.created_by
        });
      console.log('[accept-invitation] Recipient added:', { recipientError });
    }
  }

  console.log('[accept-invitation] Success! Redirecting...');
  redirect(`/invitation/success?event=${encodeURIComponent(event.name)}&type=accepted`);
}
