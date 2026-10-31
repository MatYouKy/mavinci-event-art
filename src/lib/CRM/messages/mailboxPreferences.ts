/**
 * Wybór skrzynek widocznych w „Wiadomościach” (Ustawienia → Powiadomienia).
 * Zapisywany w employees.preferences.messages:
 *  - hiddenMailboxIds: skrzynki ukryte — poza listą, widokiem „Wszystkie konta”, licznikiem i powiadomieniami,
 *  - mutedMailboxIds: skrzynki widoczne, ale bez powiadomień i bez wliczania do licznika w menu.
 * Wybór nie zmienia uprawnień: dostęp do poczty nadal wynika z RLS (własna i przypisane skrzynki).
 * Tę samą regułę stosuje wyzwalacz powiadomień notify_new_received_email.
 */

export interface MailboxViewPreferences {
  hidden: Set<string>;
  muted: Set<string>;
}

/** Identyfikator, który nie pasuje do żadnej skrzynki — zamiast zapytania bez filtra przy pustej liście. */
export const NO_MAILBOX_ID = '00000000-0000-0000-0000-000000000000';

export const mailboxFilter = (ids: string[]) => (ids.length > 0 ? ids : [NO_MAILBOX_ID]);

const toIdSet = (value: unknown) =>
  new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);

export function readMailboxViewPreferences(preferences: unknown): MailboxViewPreferences {
  const messages = (preferences as { messages?: Record<string, unknown> } | null)?.messages;
  return { hidden: toIdSet(messages?.hiddenMailboxIds), muted: toIdSet(messages?.mutedMailboxIds) };
}

type QueryClient = { from: (table: string) => any };

export async function loadMailboxViewPreferences(
  client: QueryClient,
  employeeId: string,
): Promise<MailboxViewPreferences> {
  const { data } = await client.from('employees').select('preferences').eq('id', employeeId).maybeSingle();
  return readMailboxViewPreferences(data?.preferences);
}

/**
 * Skrzynki pracownika w „Wiadomościach”: własne aktywne i przypisane, bez ukrytych.
 * forBadge: także bez wyciszonych (licznik w menu i powiadomienia).
 */
export async function inboxMailboxIds(
  client: QueryClient,
  employeeId: string,
  options: { forBadge?: boolean } = {},
): Promise<string[]> {
  const [{ data: personal }, { data: assigned }, preferences] = await Promise.all([
    client.from('employee_email_accounts').select('id').eq('employee_id', employeeId).eq('is_active', true),
    client.from('employee_email_account_assignments').select('email_account_id').eq('employee_id', employeeId),
    loadMailboxViewPreferences(client, employeeId),
  ]);
  const ids = new Set<string>([
    ...((personal || []) as Array<{ id: string }>).map((account) => account.id),
    ...((assigned || []) as Array<{ email_account_id: string }>).map((row) => row.email_account_id),
  ]);
  return Array.from(ids).filter(
    (id) => !preferences.hidden.has(id) && !(options.forBadge && preferences.muted.has(id)),
  );
}
