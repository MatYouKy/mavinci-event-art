export interface GUSCompanyData {
  nip: string;
  name: string;
  source?: 'gus' | 'mf_whitelist' | 'krs' | 'ceidg';
  dataSources?: Array<'gus' | 'mf_whitelist' | 'krs' | 'ceidg'>;
  regon?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  voivodeship?: string;
  alias?: string;
  email?: string;
  phone?: string;
  website?: string;
  krs?: string;
  legalForm?: string;
  legalFormName?: string;
  legalFormSource?: 'gus' | 'krs' | 'ceidg' | 'inference';
  businessType?: 'company' | 'hotel' | 'restaurant' | 'venue' | 'freelancer' | 'other';
  registryEntityType?: string;
  registryName?: string;
  registryNumber?: string;
  representationType?: 'sole' | 'joint' | 'joint_with_proxy' | 'proxy' | 'other';
  representationRule?: string;
  representationBasis?: string;
  representationVerifiedAt?: string;
  vatStatus?: string;
  registrationDate?: string;
  workingAddress?: string;
  residenceAddress?: string;
  bankAccountCount?: number;
  hasVirtualAccounts?: boolean;
  representatives?: Array<{
    firstName: string;
    lastName: string;
    fullName: string;
    title: string;
    kind?: 'board_member' | 'proxy' | 'representative' | 'partner';
    authorization?: string;
  }>;
  partners?: Array<{
    firstName: string;
    lastName: string;
    fullName: string;
    title: string;
  }>;
  registryRoles?: Array<{
    kind: 'board_member' | 'proxy';
    title: string;
    authorization?: string;
    fullName?: string;
    nameAvailable: boolean;
  }>;
}

const normalizePersonName = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[Łł]/g, 'L')
    .toLocaleLowerCase('pl-PL')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function findExactRegistryRepresentativeContact<
  T extends {
    id: string;
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
>(data: GUSCompanyData, contacts: T[]) {
  const eligiblePeople = (data.representatives || []).filter((person) => {
    if (data.representationType === 'sole') return person.kind !== 'proxy';
    if (data.representationType === 'proxy') return person.kind === 'proxy';
    return false;
  });
  if (eligiblePeople.length !== 1) return null;

  const registryPerson = eligiblePeople[0];
  const expectedName = normalizePersonName(registryPerson.fullName);
  const matches = contacts.filter((contact) =>
    [
      contact.full_name,
      [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    ].some((value) => normalizePersonName(value) === expectedName),
  );

  return matches.length === 1
    ? { contact: matches[0], title: registryPerson.title || null }
    : null;
}

export async function fetchCompanyDataFromGUS(nip: string): Promise<GUSCompanyData | null> {
  const cleanNip = nip.replace(/\D/g, '');

  if (cleanNip.length !== 10) {
    throw new Error('Nieprawidłowy format NIP');
  }

  const response = await fetch('/bridge/gus/company', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ nip: cleanNip }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Błąd podczas pobierania danych z GUS');
  }

  return data;
}

export function parseGoogleMapsUrl(url: string): { latitude: number; longitude: number } | null {
  try {
    if (url.includes('goo.gl') || url.includes('maps.app.goo.gl')) {
      throw new Error('Skrócone linki nie są obsługiwane. Otwórz link w przeglądarce, skopiuj pełny URL z paska adresu i wklej tutaj.');
    }

    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /\?q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /place\/[^/]+\/@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        const latitude = parseFloat(match[1]);
        const longitude = parseFloat(match[2]);

        if (!isNaN(latitude) && !isNaN(longitude)) {
          return { latitude, longitude };
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Error parsing Google Maps URL:', error);
    throw error;
  }
}
