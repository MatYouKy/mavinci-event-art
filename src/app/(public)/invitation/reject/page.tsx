import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  if (!searchParams.token) redirect('/invitation/error?message=Brak%20tokenu%20zaproszenia');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: assignment, error } = await db
    .from('employee_assignments')
    .select('id,status,event_id,invitation_expires_at')
    .eq('invitation_token', searchParams.token)
    .maybeSingle();
  if (error || !assignment) redirect('/invitation/error?message=Nieprawidłowe%20zaproszenie');
  // A processed link opens the event; it cannot reverse a response from the app.
  if (assignment.status === 'accepted') redirect(`/crm/events/${assignment.event_id}`);
  if (assignment.status !== 'pending') redirect('/invitation/success?type=rejected');
  if (assignment.invitation_expires_at && Date.parse(assignment.invitation_expires_at) < Date.now())
    redirect('/invitation/error?message=Token%20zaproszenia%20wygasł');
  const result = await db
    .from('employee_assignments')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', assignment.id)
    .eq('status', 'pending')
    .select('status')
    .maybeSingle();
  if (result.error) redirect('/invitation/error?message=Nie%20udało%20się%20zapisać%20odpowiedzi');
  const current =
    result.data ||
    (await db.from('employee_assignments').select('status').eq('id', assignment.id).single()).data;
  if (!current) redirect('/invitation/error?message=Nie%20udało%20się%20odczytać%20odpowiedzi');
  if (current.status === 'accepted') redirect(`/crm/events/${assignment.event_id}`);
  redirect(`/invitation/success?type=${encodeURIComponent(current.status)}`);
}
