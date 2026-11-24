/*
 * Numer telefonu klienta — zapis i wyświetlanie (CRM i Mac). Polskie numery zapisujemy i pokazujemy z kierunkowym:
 * „+48 510 233 670” (komórkowe i specjalne 3-3-3), „+48 22 123 45 67” (stacjonarne z numerem kierunkowym strefy).
 * Wcześniej formularz nowego kontaktu zapisywał same cyfry („48510233670” — bez „+”, więc telefon wybierał zły numer);
 * takie numery pokazujemy poprawnie, a migracja `20261130111000_contact_phone_plus` poprawia je w bazie.
 * Numer zagraniczny („+44 …”, „0044 …”) zostaje z „+”, a zapis inny niż sam numer (np. „… lub … — Konrad”) — bez zmian.
 */

/** Znaki kierunku tekstu doklejane przy kopiowaniu numeru (np. z WhatsApp). */
const INVISIBLE = /[‎‏‪-‮⁦-⁩]/g;
/** Strefy numeracyjne telefonów stacjonarnych (dwie pierwsze cyfry numeru krajowego). */
const LANDLINE_ZONES = new Set([
  '12', '13', '14', '15', '16', '17', '18', '22', '23', '24', '25', '29', '32', '33', '34', '41', '42', '43', '44', '46', '48',
  '52', '54', '55', '56', '58', '59', '61', '62', '63', '65', '67', '68', '71', '74', '75', '76', '77', '81', '82', '83', '84',
  '85', '86', '87', '89', '91', '94', '95',
]);

type ParsedPhone = { raw: string; national: string | null; international: string | null };

function parsePhone(value: unknown): ParsedPhone {
  const raw = String(value ?? '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const compact = raw.replace(/[\s().\-/]/g, '');
  if (!/^(\+|00)?\d+$/.test(compact)) return { raw, national: null, international: null };
  const prefixed = compact.startsWith('+') || compact.startsWith('00');
  const digits = compact.replace(/^(\+|00)/, '');
  if (digits.length === 11 && digits.startsWith('48') && digits[2] !== '0') return { raw, national: digits.slice(2), international: null };
  if (!prefixed && digits.length === 9 && digits[0] !== '0') return { raw, national: digits, international: null };
  if (prefixed && digits.length >= 7 && digits.length <= 15) return { raw, national: null, international: digits };
  return { raw, national: null, international: null };
}

const groupNational = (national: string) => (LANDLINE_ZONES.has(national.slice(0, 2))
  ? `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5, 7)} ${national.slice(7)}`
  : `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`);

/** Numer do wyświetlenia i zapisu: „+48 510 233 670”; zagraniczny z „+”; inny zapis bez zmian (puste — ''). */
export function formatPhone(value: unknown): string {
  const phone = parsePhone(value);
  if (phone.national) return `+48 ${groupNational(phone.national)}`;
  if (phone.international) return phone.raw.startsWith('+') ? phone.raw : `+${phone.raw.replace(/^00\s*/, '')}`;
  return phone.raw;
}

/**
 * Zapisy tego samego numeru, które mogą już być w bazie (same cyfry, z „+48”, ze spacjami, bez kierunkowego) — do szukania
 * duplikatów kontaktu przy dodawaniu. Numer w innym zapisie — tylko on sam.
 */
export function phoneLookupValues(value: unknown): string[] {
  const phone = parsePhone(value);
  if (!phone.raw) return [];
  const values = [phone.raw];
  if (phone.national) {
    const grouped = groupNational(phone.national);
    const spaced = `${phone.national.slice(0, 3)} ${phone.national.slice(3, 6)} ${phone.national.slice(6)}`;
    values.push(
      `+48 ${grouped}`, `+48 ${spaced}`, `+48 ${phone.national}`, `+48${phone.national}`, `48${phone.national}`, `0048${phone.national}`,
      phone.national, grouped, spaced,
    );
  } else if (phone.international) {
    values.push(`+${phone.international}`, phone.international, `00${phone.international}`);
  }
  return Array.from(new Set(values));
}

/** Warunki `or(...)` PostgREST: dowolny z numerów w polach telefonu kontaktu (wartości w cudzysłowach — spacje i „+”). */
export function phoneDuplicateConditions(values: unknown[], columns = ['phone', 'mobile', 'business_phone']): string[] {
  const list = Array.from(new Set(values.flatMap((value) => phoneLookupValues(value))))
    .map((item) => `"${item.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`);
  if (!list.length) return [];
  return columns.map((column) => `${column}.in.(${list.join(',')})`);
}
