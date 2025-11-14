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

    const response = await fetch(
      `https://wl-api.mf.gov.pl/api/search/nip/${cleanNip}?date=${new Date().toISOString().split('T')[0]}`,
    );

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
    if (url.includes('goo.gl') || url.includes('maps.app.goo.gl')) {
      throw new Error(
        'Skrócone linki nie są obsługiwane. Otwórz link w przeglądarce, skopiuj pełny URL z paska adresu i wklej tutaj.',
      );
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

type MapsUrlCheck =
  | { kind: 'full'; lat: number; lng: number }
  | { kind: 'short' };

export function checkGoogleMapsUrl(raw: string): MapsUrlCheck | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();

  // domeny skrócone (nie mają zwykle koordynatów w URL)
  const SHORT_HOSTS = ['maps.app.goo.gl', 'goo.gl', 'goo.gl.maps', 'g.co', 'g.co.maps', 'goo.gl/maps', 'g.co/maps'];
  if (
    host === 'maps.app.goo.gl' ||
    host === 'goo.gl' ||
    host === 'g.co' ||
    host.endsWith('.goo.gl') ||
    host.endsWith('.g.co')
  ) {
    return { kind: 'short' };
  }

  // pełne domeny Google Maps
  const isFullHost =
    host === 'www.google.com' ||
    host === 'google.com' ||
    host === 'maps.google.com' ||
    host.endsWith('.google.com');

  if (!isFullHost) {
    return null;
  }

  const href = url.href;

  // 1) Wzorzec "@lat,lng," np. .../@52.2297,21.0122,15z
  const atMatch = href.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isFinite(lat) && isFinite(lng)) return { kind: 'full', lat, lng };
  }

  // 2) Parametry q=lat,lng lub ll=lat,lng
  const qParam = url.searchParams.get('q') || url.searchParams.get('ll');
  if (qParam) {
    const llMatch = qParam.match(/(-?\d+(?:\.\d)?),\s*(-?\d+(?:\.\d+)?)/);
    if (llMatch) {
      const lat = parseFloat(llMatch[1]);
      const lng = parseFloat(llMatch[2]);
      if (isFinite(lat) && isFinite(lng)) return { kind: 'full', lat, lng };
    }
  }

  // 3) Czasem format /?q=place nazwa — brak współrzędnych, ale domena OK
  return { kind: 'short' };
}