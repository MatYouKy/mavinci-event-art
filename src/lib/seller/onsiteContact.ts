import type { ArrangementContact } from './arrangements';

export const onsiteContactChoices = [
  { value: 'seller', label: 'Osobista koordynacja' },
  { value: 'client', label: 'Klient z wydarzenia' },
  { value: 'other', label: 'Inny kontakt' },
] as const;

export type OnsiteContactSource = typeof onsiteContactChoices[number]['value'];
export type OnsiteContact = ArrangementContact & { source: OnsiteContactSource; note?: string };

// Shared by the form and its API. This is a contact proposal for the existing
// conversation, not an edit of the seller's card or the client's CRM record.
export function parseOnsiteContact(input: unknown): OnsiteContact {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Wybierz osobę kontaktową na miejscu.');
  }
  const raw = input as Record<string, unknown>;
  const choice = onsiteContactChoices.find(item => item.value === raw.source);
  if (!choice) throw new Error('Wybierz: osobista koordynacja, klient z wydarzenia lub inny kontakt.');
  const field = (key: string, label: string, max: number, required = true) => {
    if (raw[key] != null && typeof raw[key] !== 'string') throw new Error(`Sprawdź pole „${label}”.`);
    const value = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
    if (required && !value) throw new Error(`Uzupełnij pole „${label}”.`);
    if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Sprawdź pole „${label}” — maksymalnie ${max} znaków, bez nowych linii.`);
    return value;
  };
  const name = field('name', 'Imię i nazwisko', 160);
  const role = field('role', 'Stanowisko / rola', 100);
  const phone = field('phone', 'Telefon', 50);
  const email = field('email', 'E-mail', 254, false);
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    throw new Error('Podaj poprawny telefon osoby na miejscu: od 7 do 15 cyfr, opcjonalnie z prefiksem kraju.');
  }
  if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) {
    throw new Error('Popraw adres e-mail albo pozostaw to pole puste.');
  }
  if (raw.note != null && typeof raw.note !== 'string') throw new Error('Sprawdź dodatkowe informacje.');
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > 2000) throw new Error('Dodatkowe informacje mogą mieć maksymalnie 2000 znaków.');
  return { source: choice.value, name, role, phone, email, note };
}

export function onsiteContactMessage(input: unknown): string {
  const contact = parseOnsiteContact(input);
  const choice = onsiteContactChoices.find(item => item.value === contact.source)!;
  return [
    `Koordynacja: ${choice.label}`,
    `Imię i nazwisko: ${contact.name}`,
    `Stanowisko / rola: ${contact.role}`,
    `Telefon: ${contact.phone}`,
    contact.email && `E-mail: ${contact.email}`,
    contact.note && `Dodatkowe informacje:\n${contact.note}`,
  ].filter(Boolean).join('\n');
}
