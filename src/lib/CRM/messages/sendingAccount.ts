/*
 * Domyślna skrzynka nadawcy w oknach wysyłki (CRM i serwer dla Maca i telefonu): wiadomość wychodzi od osoby, która ją wysyła —
 * najpierw jej własna skrzynka osobista (oznaczona jako domyślna przed pozostałymi), potem osobiste skrzynki przypisane, wspólne
 * (np. biuro@), a systemowa (system@) dopiero, gdy nie ma żadnej innej. Odpowiedź wychodzi ze skrzynki, na którą przyszła
 * wiadomość, chyba że to skrzynka systemowa. Na Macu ta sama kolejność: `MailAccount.sendingRank` w `MessageModels.swift`.
 */

export type SendingAccountLike = {
  id: string;
  email_address?: string | null;
  account_type?: string | null;
  is_default?: boolean | null;
  employee_id?: string | null;
  can_send?: boolean | null;
};

/** 0 — własna domyślna, 1 — własna osobista, 2 — osobista przypisana, 3 — wspólna, 4 — systemowa. */
export function sendingAccountRank(account: SendingAccountLike, employeeId?: string | null): number {
  const type = account.account_type || 'personal';
  if (type === 'system') return 4;
  if (type === 'personal') {
    const own = !account.employee_id || !employeeId || account.employee_id === employeeId;
    if (own) return account.is_default ? 0 : 1;
    return 2;
  }
  return 3;
}

/** Porównanie do sortowania listy „Od:” (kolejność rang, w randze domyślna, potem adres). */
export function compareSendingAccounts(employeeId?: string | null) {
  return (left: SendingAccountLike, right: SendingAccountLike) => {
    const rank = sendingAccountRank(left, employeeId) - sendingAccountRank(right, employeeId);
    if (rank !== 0) return rank;
    if (Boolean(left.is_default) !== Boolean(right.is_default)) return left.is_default ? -1 : 1;
    return String(left.email_address || '').localeCompare(String(right.email_address || ''), 'pl');
  };
}

const usable = (account: SendingAccountLike) => account.id !== 'all' && account.id !== 'contact_form' && account.can_send !== false;

/**
 * Skrzynka wybrana na start: wskazana (skrzynka odpowiedzi albo przeglądana skrzynka), o ile wolno z niej wysyłać i nie jest
 * systemowa; w innym razie najlepsza według `sendingAccountRank`. Pusty tekst — brak skrzynki do wysyłki.
 */
export function preferredSendingAccountId(
  accounts: SendingAccountLike[],
  options: { preferredIds?: Array<string | null | undefined>; employeeId?: string | null } = {},
): string {
  const candidates = accounts.filter(usable);
  for (const id of options.preferredIds || []) {
    const match = id ? candidates.find((account) => account.id === id) : undefined;
    if (match && (match.account_type || 'personal') !== 'system') return match.id;
  }
  return [...candidates].sort(compareSendingAccounts(options.employeeId))[0]?.id || '';
}
