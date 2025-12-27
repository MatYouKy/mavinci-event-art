import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function RejectInvitationPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token;

  console.log('[reject-invitation] Starting with token:', token);

  if (!token) {
    console.log('[reject-invitation] No token provided');
    redirect('/invitation/error?message=Brak tokenu zaproszenia');
  }

  console.log('[reject-invitation] Supabase URL:', supabaseUrl);
  console.log('[reject-invitation] Service key exists:', !!supabaseServiceKey);

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

  console.log('[reject-invitation] Assignment query result:', { assignment, assignmentError });

  if (assignmentError || !assignment) {
    console.log('[reject-invitation] Invalid token or error');
    redirect('/invitation/error?message=Nieprawidłowy token zaproszenia');
  }

  if (new Date(assignment.invitation_expires_at) < new Date()) {
    redirect('/invitation/error?message=Token zaproszenia wygasł');
  }

  if (assignment.status !== 'pending') {
    const event = assignment.events as any;
    redirect(`/invitation/success?event=${encodeURIComponent(event?.name || '')}&type=rejected`);
  }

  console.log('[reject-invitation] Updating assignment to rejected');

  const { error: updateError } = await supabase
    .from('employee_assignments')
    .update({
      status: 'rejected',
      responded_at: new Date().toISOString(),
    })
    .eq('id', assignment.id);

  console.log('[reject-invitation] Update result:', { updateError });

  if (updateError) {
    console.error('[reject-invitation] Error rejecting invitation:', updateError);
    redirect('/invitation/error?message=Nie udało się zaktualizować statusu zaproszenia');
  }

  const event = assignment.events as any;
  const employee = assignment.employees as any;

  console.log('[reject-invitation] Creating notification for creator:', event.created_by);

  if (event.created_by) {
    const { data: creatorNotification, error: notifError } = await supabase
      .from('notifications')
      .insert({
        category: 'employee',
        title: 'Odrzucenie zaproszenia',
        message: `${employee.name} ${employee.surname} odrzucił zaproszenie do wydarzenia "${event.name}"`,
        type: 'warning',
        related_entity_type: 'event',
        related_entity_id: assignment.event_id,
        action_url: `/crm/events/${assignment.event_id}`,
        metadata: {
          event_id: assignment.event_id,
          event_name: event.name,
          employee_id: assignment.employee_id,
          employee_name: `${employee.name} ${employee.surname}`,
          assignment_id: assignment.id,
          response_type: 'rejected'
        }
      })
      .select('id')
      .single();

    console.log('[reject-invitation] Notification created:', { creatorNotification, notifError });

    if (!notifError && creatorNotification) {
      const { error: recipientError } = await supabase
        .from('notification_recipients')
        .insert({
          notification_id: creatorNotification.id,
          user_id: event.created_by
        });
      console.log('[reject-invitation] Recipient added:', { recipientError });
    }
  }

  console.log('[reject-invitation] Success! Redirecting...');
  redirect(`/invitation/success?event=${encodeURIComponent(event.name)}&type=rejected`);
}
