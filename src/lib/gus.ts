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
