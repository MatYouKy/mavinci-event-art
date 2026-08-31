import { supabase } from '@/lib/supabase/browser';

export async function deleteEventSafely(eventId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-event-safe`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ eventId }),
    },
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || 'Nie udało się usunąć wydarzenia.');
  }
}
