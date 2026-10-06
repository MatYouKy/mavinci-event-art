// Wiadomości dostępowe zawsze kierują do produkcji, także wysłane z lokalnego CRM.
// Adres żądania, nagłówek Host i zmienne środowiska nie mogą zmienić tej domeny.
export const PASSWORD_ACCESS_ORIGIN = 'https://mavinci.pl';

export type PasswordAccessPortal = 'seller' | 'crm';
export type PasswordAccessType = 'invite' | 'recovery';

export function passwordAccessUrl(
  portal: PasswordAccessPortal,
  tokenHash?: string,
  type: PasswordAccessType = 'recovery',
) {
  const url = new URL(portal === 'seller' ? '/seller/set-password' : '/reset-password', PASSWORD_ACCESS_ORIGIN);
  if (tokenHash) {
    url.searchParams.set('token_hash', tokenHash);
    url.searchParams.set('type', type);
  }
  return url.toString();
}
