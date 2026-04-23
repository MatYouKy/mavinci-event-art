export interface GUSCompanyData {
  nip: string;
  name: string;
  regon?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  voivodeship?: string;
  krs?: string;
}

export async function fetchCompanyDataFromGUS(nip: string): Promise<GUSCompanyData | null> {
  try {
    const cleanNip = nip.replace(/[-\s]/g, '');

    if (cleanNip.length !== 10 || !/^\d+$/.test(cleanNip)) {
      throw new Error('Nieprawidłowy format NIP');
    }

    const today = new Date().toISOString().split('T')[0];

    const response = await fetch(
      `https://wl-api.mf.gov.pl/api/search/nip/${cleanNip}?date=${today}`,
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Nie znaleziono firmy o podanym NIP');
      }
      throw new Error('Błąd podczas pobierania danych firmy');
    }

    const data = await response.json();

    if (!data?.result?.subject) {
      throw new Error('Nie znaleziono danych firmy');
    }

    const subject = data.result.subject;
    const rawAddress = subject.workingAddress || subject.residenceAddress || '';

    let street = rawAddress;
    let city: string | undefined;
    let postalCode: string | undefined;

    const postalMatch = rawAddress.match(/(\d{2}-\d{3})\s+(.+)$/);
    if (postalMatch) {
      postalCode = postalMatch[1];
      city = postalMatch[2].trim();
      street = rawAddress.substring(0, postalMatch.index).trim().replace(/,\s*$/, '');
    }

    return {
      nip: subject.nip || cleanNip,
      name: subject.name || '',
      regon: subject.regon || undefined,
      krs: subject.krs || undefined,
      address: street || undefined,
      city,
      postalCode,
      voivodeship: subject.workingAddress?.province || undefined,
    };
  } catch (error: any) {
    console.error('Company API Error:', error);
    throw error;
  }
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
