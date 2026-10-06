export async function getDrivingLeg(origin: string, destination: string, key: string) {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  for (const [name, value] of Object.entries({
    origin,
    destination,
    key,
    mode: 'driving',
    language: 'pl',
    region: 'pl',
    units: 'metric',
  }))
    url.searchParams.set(name, value);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Google Maps jest chwilowo niedostępne. Spróbuj ponownie.');
  const data = await response.json();
  if (data.status === 'ZERO_RESULTS' || data.status === 'NOT_FOUND')
    throw new Error(
      'Google Maps nie znalazło trasy. Sprawdź adres startu i miejsce realizacji.',
    );
  if (data.status !== 'OK')
    throw new Error(
      'Nie udało się pobrać trasy z Google Maps. Sprawdź dostęp i limit zapytań klucza.',
    );
  const leg = data.routes?.[0]?.legs?.[0];
  if (!Number.isFinite(leg?.distance?.value) || !Number.isFinite(leg?.duration?.value))
    throw new Error('Google Maps nie zwróciło dystansu i czasu przejazdu.');
  return {
    distanceMeters: leg.distance.value as number,
    durationSeconds: leg.duration.value as number,
    startAddress: leg.start_address as string,
    endAddress: leg.end_address as string,
  };
}

