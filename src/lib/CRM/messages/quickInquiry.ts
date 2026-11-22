import { supabase } from '@/lib/supabase/browser';
import { messageInquirySaveFeedback } from './salesContext';

/*
 * „Dodaj do zapytań i przypisz mnie” / „Przypisz mnie do zapytania” jednym kliknięciem (jak w aplikacji na telefonie i na Macu):
 * nowe zapytanie z wiadomości albo zapytanie z puli (np. utworzone przez AI ze skrzynki) dostaje opiekuna — osobę, która to kliknęła.
 * Wybór innego opiekuna albo dołączenie do istniejącego zapytania — okno „Dodaj do zapytań” w pasku czynności.
 */
export async function addMessageInquiryAsMe(message: { type: string; id: string }, employeeId: string) {
  const { data, error } = await supabase.rpc('crm_create_inquiry_from_message', {
    p_type: message.type, p_id: message.id, p_owner: employeeId, p_guest_count: null,
  });
  if (error) throw error;
  if (!data?.id) throw new Error('Serwer nie potwierdził zapisu zapytania.');
  return {
    id: String(data.id),
    assigned: data.ownerId === employeeId,
    feedback: messageInquirySaveFeedback(data, employeeId),
  };
}
