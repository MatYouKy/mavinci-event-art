export type Recipient = { manualAddress?: boolean; email: string; name: string; contactId?: string; organizationId?: string };
export type RecipientContext = { type: 'contact' | 'organization'; id: string; name: string; email?: string | null };
export type Delivery = { id: string; batch_id: string; generation_id: string; brochure_id: string; employee_id: string; recipient_email: string; recipient_name: string; subject: string; body_html: string; status: 'prepared'|'sending'|'sent'|'failed'|'uncertain'; error_message: string|null; created_at: string; sent_at: string|null; contact_id: string|null; organization_id: string|null };
export const deliveryLabels: Record<Delivery['status'],string> = { prepared:'Gotowa do wysłania', sending:'Wysyłka rozpoczęta — oczekiwanie na potwierdzenie', sent:'Wysłano', failed:'Nie wysłano — można ponowić', uncertain:'Wynik niepewny — sprawdź folder Wysłane' };
export const validRecipientEmail = (email: string) => email.length<=200 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
// Supabase errors can be plain objects rather than Error instances.
export function brochureErrorMessage(error: unknown, fallback: string): string {
  const value = error && typeof error === 'object' && 'error' in error ? error.error : error;
  const message = typeof value === 'string' ? value
    : value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ? value.message : '';
  return message.trim() || fallback;
}

export async function readBrochureResponse<T>(response: Response, fallback: string): Promise<T> {
  const result: unknown = await response.json().catch(() => null);
  const httpMessage = response.status === 401 ? 'Sesja wygasła. Zaloguj się ponownie.'
    : response.status === 403 ? 'Brak dostępu do tej operacji.'
    : response.status === 504 ? 'Serwer nie zakończył operacji w wymaganym czasie. Sprawdź jej stan przed ponowieniem.'
    : `${fallback} (HTTP ${response.status})`;
  if (!response.ok) throw new Error(brochureErrorMessage(result, httpMessage));
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`${fallback} Serwer nie zwrócił prawidłowej odpowiedzi.`);
  }
  return result as T;
}

export async function deliveryRequest(body: Record<string,unknown>): Promise<Delivery> {
  const response=await fetch('/bridge/brochures/deliveries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await readBrochureResponse<{delivery?:Delivery;error?:unknown}>(response,'Nie udało się obsłużyć wysyłki.');
  if(!result.delivery)throw new Error(brochureErrorMessage(result.error,'Nie udało się odczytać potwierdzenia operacji. Sprawdź historię przed ponowieniem.'));
  return result.delivery;
}
