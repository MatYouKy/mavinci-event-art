export const THANKS_GROUP_LABELS = {
  parents: 'Rodzice',
  witnesses: 'Świadkowie',
  grandparents: 'Dziadkowie',
  godparents: 'Chrzestni',
  other: 'Inne osoby',
} as const;
export const THANKS_SIDE_LABELS = {
  bride: 'Strona Panny Młodej',
  groom: 'Strona Pana Młodego',
  shared: 'Wspólni',
} as const;
export type ThanksGroup = keyof typeof THANKS_GROUP_LABELS;
export type ThanksSide = keyof typeof THANKS_SIDE_LABELS;
export type ThanksRecipient = { id: string; name: string; side: ThanksSide | '' };
export type ThanksEntry = { id: string; group: ThanksGroup; recipients: ThanksRecipient[]; notes: string };
export type ThanksCardPerson = { first_name: string; last_name?: string; side: string; role: string };

export const WELCOME_GLASS_OPTIONS = [
  { value: 'vodka_before_entry', label: 'Rzucamy kieliszkami po wódce przy powitaniu, przed wejściem na salę' },
  { value: 'champagne_after_entry', label: 'Rzucamy szampanówkami po wejściu na salę' },
  { value: 'none', label: 'Nie rzucamy kieliszkami' },
  { value: 'other', label: 'Inny przebieg — opiszemy poniżej' },
] as const;
export const THANKS_PROPOSAL_TITLE = 'Czerwony dywan i kordony — jak gala rozdania Oscarów dla gwiazd';

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readThanksEntries(value: unknown): ThanksEntry[] {
  let rows = value;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch { return []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.filter(record).flatMap((row, index) => {
    if (!Object.hasOwn(THANKS_GROUP_LABELS, String(row.group))) return [];
    const recipients = Array.isArray(row.recipients) ? row.recipients.filter(record) : [];
    return [{
      id: typeof row.id === 'string' ? row.id : `entry-${index}`,
      group: row.group as ThanksGroup,
      notes: typeof row.notes === 'string' ? row.notes : '',
      recipients: recipients.map((person, personIndex) => ({
        id: typeof person.id === 'string' ? person.id : `person-${index}-${personIndex}`,
        name: typeof person.name === 'string' ? person.name : '',
        side: Object.hasOwn(THANKS_SIDE_LABELS, String(person.side)) ? person.side as ThanksSide : '',
      })),
    }];
  });
}

export function formatThanksEntries(value: unknown): string {
  return readThanksEntries(value).map((entry, index) => {
    const people = entry.recipients.filter((person) => person.name.trim()).map((person) =>
      `• ${person.name}${person.side ? ` — ${THANKS_SIDE_LABELS[person.side]}` : ''}`,
    );
    return [`Wyjście ${index + 1}: ${THANKS_GROUP_LABELS[entry.group]}`, ...people, entry.notes ? `Notatki: ${entry.notes}` : ''].filter(Boolean).join('\n');
  }).join('\n\n');
}

export function thanksRecipientsFromCard(group: ThanksGroup, people: ThanksCardPerson[]): ThanksRecipient[] {
  const roles = group === 'parents' ? ['mother', 'father'] : group === 'witnesses' ? ['witness'] : [];
  return people.filter((person) => roles.includes(person.role) && person.first_name.trim()).map((person) => ({
    id: crypto.randomUUID(),
    name: [person.first_name, person.last_name].filter(Boolean).join(' '),
    side: Object.hasOwn(THANKS_SIDE_LABELS, person.side) ? person.side as ThanksSide : '',
  }));
}

