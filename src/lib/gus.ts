export interface GUSCompanyData {
  nip: string;
  name: string;
  regon?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  voivodeship?: string;
}

export async function fetchCompanyDataFromGUS(nip: string): Promise<GUSCompanyData | null> {
  try {
    const cleanNip = nip.replace(/[-\s]/g, '');

    if (cleanNip.length !== 10 || !/^\d+$/.test(cleanNip)) {
      throw new Error('Nieprawidłowy format NIP');
    }

    const response = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${cleanNip}?date=${new Date().toISOString().split('T')[0]}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Nie znaleziono firmy o podanym NIP');
      }
      throw new Error('Błąd podczas pobierania danych z GUS');
    }

    const data = await response.json();

    if (!data.result || !data.result.subject) {
      throw new Error('Nie znaleziono danych firmy');
    }

    const subject = data.result.subject;

    return {
      nip: subject.nip,
      name: subject.name || '',
      regon: subject.regon || undefined,
      address: subject.workingAddress || subject.residenceAddress || undefined,
      city: undefined,
      postalCode: undefined,
      voivodeship: undefined,
    };
  } catch (error: any) {
    console.error('GUS API Error:', error);
    throw error;
  }
}

export function parseGoogleMapsUrl(url: string): { latitude: number; longitude: number } | null {
  try {
    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /\?q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /place\/[^/]+\/@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
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
    return null;
  }
}
