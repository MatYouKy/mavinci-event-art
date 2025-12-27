'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { CheckCircle, Loader2, XCircle, Calendar } from 'lucide-react';

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [eventName, setEventName] = useState('');
  const [eventId, setEventId] = useState('');

  const handleAcceptInvitation = useCallback(async () => {
    try {
      setStatus('loading');

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
        throw new Error('Nieprawidłowy token zaproszenia');
      }

      if (new Date(assignment.invitation_expires_at) < new Date()) {
        throw new Error('Token zaproszenia wygasł');
      }

      if (assignment.status !== 'pending') {
        throw new Error('To zaproszenie zostało już przetworzone');
      }

      const { error: updateError } = await supabase
        .from('employee_assignments')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString(),
        })
        .eq('id', assignment.id);

      if (updateError) {
        throw new Error('Nie udało się zaktualizować statusu zaproszenia');
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

      setEventName(event.name);
      setEventId(assignment.event_id);
      setStatus('success');
      setMessage('Zaproszenie zostało zaakceptowane pomyślnie!');
    } catch (error: any) {
      console.error('Error accepting invitation:', error);
      setStatus('error');
      setMessage(error.message || 'Wystąpił błąd podczas akceptacji zaproszenia');
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Brak tokenu zaproszenia');
      return;
    }

    handleAcceptInvitation();
  }, [token, handleAcceptInvitation]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33] p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-6 flex justify-center">
            {status === 'loading' && (
              <Loader2 className="h-16 w-16 animate-spin text-[#d3bb73]" />
            )}
            {status === 'success' && (
              <CheckCircle className="h-16 w-16 text-green-500" />
            )}
            {status === 'error' && (
              <XCircle className="h-16 w-16 text-red-500" />
            )}
          </div>

          <h1 className="mb-4 text-center text-2xl font-semibold text-[#e5e4e2]">
            {status === 'loading' && 'Akceptowanie zaproszenia...'}
            {status === 'success' && 'Zaproszenie zaakceptowane!'}
            {status === 'error' && 'Wystąpił problem'}
          </h1>

          <div className="mb-6 text-center text-[#e5e4e2]/80">
            {status === 'loading' && (
              <p>Przetwarzanie twojej odpowiedzi, proszę czekać...</p>
            )}
            {status === 'success' && (
              <>
                <p className="mb-4">
                  Zaakceptowałeś zaproszenie do wydarzenia <strong className="text-[#d3bb73]">{eventName}</strong>.
                </p>
                <p className="text-sm text-[#e5e4e2]/60">
                  Wkrótce otrzymasz więcej informacji na temat szczegółów wydarzenia.
                </p>
              </>
            )}
            {status === 'error' && (
              <p className="text-red-400">{message}</p>
            )}
          </div>

          {status === 'success' && eventId && (
            <div className="space-y-3">
              <button
                onClick={() => router.push(`/crm/events/${eventId}`)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
              >
                <Calendar className="h-5 w-5" />
                Zobacz szczegóły wydarzenia
              </button>
              <button
                onClick={() => router.push('/crm/events')}
                className="w-full rounded-lg border border-[#d3bb73]/20 px-6 py-3 font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
              >
                Przejdź do listy wydarzeń
              </button>
            </div>
          )}

          {status === 'error' && (
            <button
              onClick={() => router.push('/crm/events')}
              className="w-full rounded-lg bg-[#d3bb73]/20 px-6 py-3 font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/30"
            >
              Przejdź do panelu CRM
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
        <Loader2 className="h-16 w-16 animate-spin text-[#d3bb73]" />
      </div>
    }>
      <AcceptInvitationContent />
    </Suspense>
  );
}
