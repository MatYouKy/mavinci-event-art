const messageTypeLabels: Record<string, string> = {
  event_inquiry: 'Zapytanie Event',
  contact_form: 'Formularz kontaktowy',
  general: 'Wiadomość ogólna',
  team_join: 'Rekrutacja',
  portfolio: 'Portfolio',
  services: 'Zapytanie o usługi',
  quote_request: 'Prośba o wycenę',
  inquiry: 'Zapytanie',
  lead: 'Nowy lead',
  order: 'Nowe zamówienie',
  payment: 'Płatność',
  registration: 'Rejestracja',
  booking: 'Rezerwacja',
  newsletter_signup: 'Zapis do newslettera',
};

const priorityLabels: Record<string, string> = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
  urgent: 'Pilny',
  critical: 'Krytyczny',
};

export function getMessageTypeLabel(type: string | null | undefined) {
  if (!type) return 'Wiadomość';
  if (messageTypeLabels[type]) return messageTypeLabels[type];

  const readable = type.replace(/[_-]+/g, ' ').trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : 'Wiadomość';
}

export function getPriorityLabel(priority: string | null | undefined) {
  if (!priority) return 'Normalny';
  return priorityLabels[priority] || getMessageTypeLabel(priority);
}

export function humanizeMessageEnums(value: string) {
  return value.replace(
    /\b(event_inquiry|contact_form|team_join|quote_request|newsletter_signup|general|portfolio|services|inquiry|lead|order|payment|registration|booking)\b/g,
    (match) => getMessageTypeLabel(match),
  );
}
