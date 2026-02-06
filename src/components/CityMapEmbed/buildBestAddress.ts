export function buildBestAddress(place: any) {
  const comps = place?.address_components ?? [];

  const getLong = (type: string) =>
    comps.find((c: any) => c.types?.includes(type))?.long_name ?? '';

  const route = getLong('route'); // ulica
  const streetNumber = getLong('street_number'); // numer (często brak!)
  const locality = getLong('locality'); // miasto/wieś
  const postalCode = getLong('postal_code');
  const country = getLong('country');

  // Fallbacki gdy nie ma route
  const premise = getLong('premise');
  const neighborhood = getLong('neighborhood');
  const sublocality = getLong('sublocality') || getLong('sublocality_level_1');
  const admin3 = getLong('administrative_area_level_3');

  const fa = String(place?.formatted_address ?? '').trim();
  const faParts = fa.split(',').map((s) => s.trim()).filter(Boolean);

  // --- ✅ fallback: wyciągnij numer z formatted_address jeśli brak street_number ---
  // Przykłady PL:
  // "Warlity Wielkie 16, 14-100 Warlity Wielkie, Polska"
  // "ul. Prosta 5, 00-001 Warszawa, Polska"
  const extractNumberFromFirstPart = (firstPart: string) => {
    // szukamy końcówki typu " 16" albo " 16A" albo " 16/2"
    const m = firstPart.match(/(?:\s|^)(\d+[A-Za-z]?([/-]\d+[A-Za-z]?)?)\s*$/);
    return m?.[1] ?? '';
  };

  const firstPart = faParts[0] ?? '';
  const numberFromFA = extractNumberFromFirstPart(firstPart);

  const effectiveNumber = streetNumber || numberFromFA; // <-- klucz

  // --- baza adresu ---
  // jeśli nie ma ulicy, to chcemy żeby bazą była miejscowość
  const addressBase =
    route ||
    premise ||
    neighborhood ||
    sublocality ||
    locality ||
    admin3 ||
    '';

  // --- składanie adresu ---
  // 1) Jeśli mamy route: "Długa 5"
  // 2) Jeśli brak route, ale mamy locality i numer: "Warlity Wielkie 16"
  // 3) fallback: bierz pierwszy segment formatted_address
  let address = '';
  if (route) {
    address = [route, effectiveNumber].filter(Boolean).join(' ').trim();
  } else if (locality && effectiveNumber) {
    address = `${locality} ${effectiveNumber}`.trim();
  } else {
    address = addressBase.trim() || firstPart.trim();
  }

  // --- formatted_short ---
  // Chcesz: "Warlity Wielkie 16, 14-100 Warlity Wielkie"
  // czyli: [address], [postalCode + locality]
  const addressWithPostalCity = [postalCode, locality].filter(Boolean).join(' ').trim();
  const formattedShort = [address, addressWithPostalCity].filter(Boolean).join(', ').trim();

  // --- formatted_address (ładna, pełna) ---
  const formattedAddress = [formattedShort, country].filter(Boolean).join(', ').trim();

  return {
    address: address || undefined,
    city: locality || undefined,
    postal_code: postalCode || undefined,
    country: country || undefined,
    formatted_short: formattedShort || undefined,
    formatted_address: formattedAddress || fa || undefined,
  };
}