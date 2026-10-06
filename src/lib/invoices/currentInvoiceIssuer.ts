import { supabase } from '@/lib/supabase/browser';

export type InvoiceIssuerErrorCode =
  | 'AUTH_REQUIRED'
  | 'EMPLOYEE_LOOKUP_FAILED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'EMPLOYEE_AMBIGUOUS'
  | 'EMPLOYEE_NAME_REQUIRED';

export class InvoiceIssuerError extends Error {
  constructor(public readonly code: InvoiceIssuerErrorCode, message: string) {
    super(message);
    this.name = 'InvoiceIssuerError';
  }
}

/** Resolve the person issuing a new document, never the previous document's signer. */
export async function getCurrentInvoiceIssuer(): Promise<{
  employeeId: string;
  signatureName: string;
}> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new InvoiceIssuerError(
      'AUTH_REQUIRED',
      'Nie udało się potwierdzić osoby wystawiającej fakturę. Zaloguj się ponownie i spróbuj jeszcze raz.',
    );
  }

  const { data: employees, error: employeeError } = await supabase
    .from('employees')
    .select('id, name, surname')
    .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
    .eq('is_active', true)
    .limit(2);

  if (employeeError) {
    throw new InvoiceIssuerError(
      'EMPLOYEE_LOOKUP_FAILED',
      'Nie udało się pobrać danych osoby wystawiającej fakturę. Spróbuj ponownie; jeśli problem się powtarza, skontaktuj się z administratorem.',
    );
  }
  if (!employees?.length) {
    throw new InvoiceIssuerError(
      'EMPLOYEE_NOT_FOUND',
      'Zalogowane konto nie ma aktywnego profilu pracownika. Poproś administratora o powiązanie konta przed wystawieniem faktury.',
    );
  }
  if (employees.length !== 1) {
    throw new InvoiceIssuerError(
      'EMPLOYEE_AMBIGUOUS',
      'Zalogowane konto jest powiązane z więcej niż jednym profilem pracownika. Poproś administratora o uporządkowanie powiązań przed wystawieniem faktury.',
    );
  }

  const employee = employees[0];
  const firstName = (employee.name || '').trim();
  const lastName = (employee.surname || '').trim();
  if (!firstName || !lastName) {
    throw new InvoiceIssuerError(
      'EMPLOYEE_NAME_REQUIRED',
      'Uzupełnij imię i nazwisko w swoim profilu pracownika. Te dane są wymagane jako podpis osoby upoważnionej do wystawienia faktury.',
    );
  }

  return { employeeId: employee.id, signatureName: `${firstName} ${lastName}` };
}
