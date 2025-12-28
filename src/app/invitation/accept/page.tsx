import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const redirectError = (msg: string) => {
  redirect(`/invitation/error?message=${encodeURIComponent(msg)}`);
};

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token;


  if (!token) {
    redirectError('Brak tokenu zaproszenia');
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
    redirectError('Nieprawidłowy token zaproszenia');
  }

  if (new Date(assignment.invitation_expires_at) < new Date()) {
    redirectError('Token zaproszenia wygasł');
  }

  if (assignment.status !== 'pending') {
    const event = assignment.events as any;
    redirect(
      `/invitation/success?event=${encodeURIComponent(event?.name || '')}&type=accepted`,
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
    console.error('[accept-invitation] Error accepting invitation:', updateError);
    // ✅ pokaż dokładny błąd w URL (z kodem), bez 500
    redirectError(`Nie udało się zaktualizować statusu: ${updateError.code} ${updateError.message}`);
  }

  const event = assignment.events as any;
  const employee = assignment.employees as any;


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
          response_type: 'accepted',
        },
      })
      .select('id')
      .single();


    if (notifError) {
      redirectError(`Błąd tworzenia powiadomienia: ${notifError.code} ${notifError.message}`);
    }

    if (creatorNotification) {
      const { error: recipientError } = await supabase
        .from('notification_recipients')
        .insert({
          notification_id: creatorNotification.id,
          user_id: event.created_by,
        });

      if (recipientError) {
        redirectError(
          `Błąd dodania odbiorcy powiadomienia: ${recipientError.code} ${recipientError.message}`,
        );
      }
    }
  }


  redirect(`/invitation/success?event=${encodeURIComponent(event.name)}&type=accepted`);
}