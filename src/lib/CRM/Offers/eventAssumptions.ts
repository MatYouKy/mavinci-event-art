export type EventAssumptionKey =
  | 'guest_count'
  | 'event_hours'
  | 'client_needs'
  | 'event_format'
  | 'agenda'
  | 'venue'
  | 'audience'
  | 'engagement'
  | 'brand_visibility'
  | 'guest_experience'
  | 'online_participants'
  | 'technical_scope'
  | 'special_requirements'
  | 'custom';

export type EventAssumptionItem = {
  key: EventAssumptionKey;
  label: string;
  value: string;
  badge_value?: string;
};

// Limit odpowiada czterem zwartym wierszom na karcie założeń w PDF.
export const EVENT_ASSUMPTION_VALUE_MAX_LENGTH = 250;

export type EventAssumptionOption = {
  key: EventAssumptionKey;
  label: string;
  question: string;
  placeholder: string;
  multiline?: boolean;
  defaultBadgeValue?: string;
  defaultValue?: string;
};

export const EVENT_ASSUMPTION_OPTIONS: EventAssumptionOption[] = [
  {
    key: 'guest_count',
    label: 'Liczba gości',
    question: 'Ilu gości weźmie udział w wydarzeniu?',
    placeholder: 'np. około 180 osób',
  },
  {
    key: 'event_hours',
    label: 'Godziny wydarzenia',
    question: 'W jakich godzinach ma odbywać się wydarzenie i obsługa techniczna?',
    placeholder: 'np. wydarzenie 18:00–02:00, montaż od 12:00',
  },
  {
    key: 'client_needs',
    label: 'Przebieg i potrzeby klienta',
    question: 'Co ma się dziać i czego klient naprawdę potrzebuje?',
    placeholder: 'Opisz przebieg, najważniejsze momenty, oczekiwany efekt i priorytety klienta…',
    multiline: true,
  },
  {
    key: 'event_format',
    label: 'Format wydarzenia',
    question: 'Jaka jest formuła wydarzenia?',
    placeholder: 'np. gala, konferencja, integracja, wesele, hybryda',
  },
  {
    key: 'agenda',
    label: 'Agenda i kluczowe momenty',
    question: 'Jakie punkty programu są najważniejsze dla realizacji?',
    placeholder: 'np. otwarcie, prezentacje, panel, koncert, afterparty',
    multiline: true,
  },
  {
    key: 'venue',
    label: 'Miejsce i warunki',
    question: 'Gdzie odbywa się wydarzenie i jakie są warunki obiektu?',
    placeholder: 'np. sala hotelowa, plener, dostęp od zaplecza, ograniczenia montażowe',
    multiline: true,
  },
  {
    key: 'audience',
    label: 'Grupa odbiorców',
    question: 'Kim są uczestnicy i jaki charakter ma mieć wydarzenie?',
    placeholder: 'np. pracownicy, partnerzy biznesowi, zarząd, rodziny',
    multiline: true,
  },
  {
    key: 'engagement',
    label: 'Zaangażowanie uczestników',
    question: 'Jak wydarzenie ma angażować uczestników?',
    placeholder: 'np. interaktywna formuła, aktywny prowadzący i udział publiczności',
    defaultBadgeValue: '100%',
    defaultValue: 'Interaktywna formuła angażująca uczestników przez cały czas wydarzenia.',
    multiline: true,
  },
  {
    key: 'brand_visibility',
    label: 'Widoczność marki',
    question: 'Jak marka klienta ma być obecna podczas wydarzenia?',
    placeholder: 'np. spójny branding sceny, ekranów, materiałów i komunikacji',
    defaultBadgeValue: '360°',
    defaultValue: 'Spójna obecność marki we wszystkich najważniejszych punktach kontaktu z uczestnikiem.',
    multiline: true,
  },
  {
    key: 'guest_experience',
    label: 'Doświadczenie uczestników',
    question: 'Jakie doświadczenie mają zapamiętać uczestnicy?',
    placeholder: 'np. płynny przebieg, efekt wow i komfort uczestników',
    defaultBadgeValue: 'WOW',
    defaultValue: 'Dopracowane doświadczenie uczestnika od pierwszego kontaktu do zakończenia wydarzenia.',
    multiline: true,
  },
  {
    key: 'online_participants',
    label: 'Uczestnicy online',
    question: 'Czy wydarzenie wymaga udziału online, streamingu lub nagrania?',
    placeholder: 'np. nie / transmisja dla 300 osób na Teams',
  },
  {
    key: 'technical_scope',
    label: 'Zakres techniczny',
    question: 'Jakiego zakresu obsługi technicznej oczekuje klient?',
    placeholder: 'np. scena, dźwięk, światło, multimedia, realizacja wizji',
    multiline: true,
  },
  {
    key: 'special_requirements',
    label: 'Wymagania szczególne',
    question: 'Jakie ograniczenia, ryzyka lub wymagania trzeba uwzględnić?',
    placeholder: 'np. cisza nocna, branding, dostępność, ochrona, wymagania artysty',
    multiline: true,
  },
  {
    key: 'custom',
    label: 'Własne założenie',
    question: 'Opisz własne założenie lub oczekiwany rezultat.',
    placeholder: 'Wpisz treść widoczną pod własnym nagłówkiem…',
    multiline: true,
  },
];

export const DEFAULT_EVENT_ASSUMPTION_KEYS: EventAssumptionKey[] = [
  'guest_count',
  'event_hours',
  'client_needs',
];

const optionByKey = new Map(EVENT_ASSUMPTION_OPTIONS.map((option) => [option.key, option]));

export function getEventAssumptionOption(key: EventAssumptionKey) {
  return optionByKey.get(key) || EVENT_ASSUMPTION_OPTIONS[0];
}

export function normalizeEventAssumptionItems(
  rawValue: unknown,
  legacyText = '',
): EventAssumptionItem[] {
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      parsed = [];
    }
  }

  const used = new Set<EventAssumptionKey>();
  const normalized: EventAssumptionItem[] = [];

  if (Array.isArray(parsed)) {
    parsed.slice(0, 3).forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return;
      const key = String((candidate as Record<string, unknown>).key || '') as EventAssumptionKey;
      const option = optionByKey.get(key);
      const isCustom = key === 'custom';
      if (!option || (!isCustom && used.has(key))) return;
      if (!isCustom) used.add(key);
      const customLabel = String((candidate as Record<string, unknown>).label || '').trim();
      normalized.push({
        key,
        label: isCustom ? customLabel.slice(0, 80) || option.label : option.label,
        value: String((candidate as Record<string, unknown>).value || '').slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH),
        badge_value: String((candidate as Record<string, unknown>).badge_value || '').trim().slice(0, 7),
      });
    });
  }

  DEFAULT_EVENT_ASSUMPTION_KEYS.forEach((key) => {
    if (normalized.length >= 3 || used.has(key)) return;
    const option = getEventAssumptionOption(key);
    used.add(key);
    normalized.push({
      key,
      label: option.label,
      value: key === 'client_needs' ? legacyText : '',
      badge_value: '',
    });
  });

  for (const option of EVENT_ASSUMPTION_OPTIONS) {
    if (normalized.length >= 3) break;
    if (used.has(option.key)) continue;
    used.add(option.key);
    normalized.push({ key: option.key, label: option.label, value: '', badge_value: '' });
  }

  return normalized.slice(0, 3);
}

export function formatEventAssumptionItems(items: EventAssumptionItem[]) {
  return items
    .map((item) => ({
      ...item,
      label: item.label.trim() || getEventAssumptionOption(item.key).label,
      value: item.value.trim(),
    }))
    .filter((item) => item.value)
    .map((item) => `${item.label}: ${item.value}`)
    .join('\n');
}
