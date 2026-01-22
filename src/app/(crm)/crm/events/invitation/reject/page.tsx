'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { XCircle, Loader2, CheckCircle, Home } from 'lucide-react';

function RejectInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [eventName, setEventName] = useState('');

  const handleRejectInvitation = useCallback(async () => {
    try {
      setStatus('loading');

      const { data: assignment, error: assignmentError } = await supabase
        .from('employee_assignments')
        .select(
          `
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
        `,
        )
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
          status: 'rejected',
          responded_at: new Date().toISOString(),
        })
        .eq('invitation_token', token)
        .eq('id', assignment.id);

      if (updateError) {
        console.error('Error updating assignment:', updateError);
        throw new Error(`Nie udało się zaktualizować statusu zaproszenia: ${updateError.message}`);
      }

      const event = assignment.events as any;
      const employee = assignment.employees as any;

      if (event.created_by) {
        const { data: creatorNotification, error: notifError } = await supabase
          .from('notifications')
          .insert({
            category: 'employee',
            title: 'Odrzucenie zaproszenia',
            message: `${employee.name} ${employee.surname} odrzucił zaproszenie do wydarzenia "${event.name}"`,
            type: 'info',
            related_entity_type: 'event',
            related_entity_id: assignment.event_id,
            action_url: `/crm/events/${assignment.event_id}`,
            metadata: {
              event_id: assignment.event_id,
              event_name: event.name,
              employee_id: assignment.employee_id,
              employee_name: `${employee.name} ${employee.surname}`,
              assignment_id: assignment.id,
              response_type: 'rejected',
            },
          })
          .select('id')
          .single();

        if (notifError) {
          console.error('Error creating notification:', notifError);
        } else if (creatorNotification) {
          const { error: recipientError } = await supabase.from('notification_recipients').insert({
            notification_id: creatorNotification.id,
            user_id: event.created_by,
          });

          if (recipientError) {
            console.error('Error adding notification recipient:', recipientError);
          }
        }
      }

      setEventName(event.name);
      setStatus('success');
      setMessage('Twoja decyzja została zapisana');
    } catch (error: any) {
      console.error('Error rejecting invitation:', error);
      setStatus('error');
      setMessage(error.message || 'Wystąpił błąd podczas odrzucania zaproszenia');
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Brak tokenu zaproszenia');
      return;
    }

    handleRejectInvitation();
  }, [token, handleRejectInvitation]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33] p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-6 flex justify-center">
            {status === 'loading' && <Loader2 className="h-16 w-16 animate-spin text-[#d3bb73]" />}
            {status === 'success' && <CheckCircle className="h-16 w-16 text-blue-500" />}
            {status === 'error' && <XCircle className="h-16 w-16 text-red-500" />}
          </div>

          <h1 className="mb-4 text-center text-2xl font-semibold text-[#e5e4e2]">
            {status === 'loading' && 'Przetwarzanie odpowiedzi...'}
            {status === 'success' && 'Szanujemy Twoją decyzję'}
            {status === 'error' && 'Wystąpił problem'}
          </h1>

          <div className="mb-6 text-center text-[#e5e4e2]/80">
            {status === 'loading' && <p>Zapisywanie twojej odpowiedzi, proszę czekać...</p>}
            {status === 'success' && (
              <>
                <p className="mb-4">
                  Odrzuciłeś zaproszenie do wydarzenia{' '}
                  <strong className="text-[#d3bb73]">{eventName}</strong>.
                </p>
                <p className="text-sm text-[#e5e4e2]/60">
                  Może uda się następnym razem. Dziękujemy za odpowiedź!
                </p>
              </>
            )}
            {status === 'error' && <p className="text-red-400">{message}</p>}
          </div>

          <div className="space-y-3">
            <button
              onClick={() => router.push('/crm/events')}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
            >
              <Home className="h-5 w-5" />
              Przejdź do panelu CRM
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RejectInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <Loader2 className="h-16 w-16 animate-spin text-[#d3bb73]" />
        </div>
      }
    >
      <RejectInvitationContent />
    </Suspense>
  );
}
