import { Alert, Linking, Platform } from 'react-native';

export interface MapLocation {
  name?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  googlePlaceId?: string | null;
}

const coordinate = (value: MapLocation['latitude'], limit: number): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
};

export const getLocationMapLinks = (location: MapLocation) => {
  const latitude = coordinate(location.latitude, 90);
  const longitude = coordinate(location.longitude, 180);
  const coordinates = latitude !== null && longitude !== null
    ? `${latitude},${longitude}` : '';
  const name = location.name?.trim() || '';
  const address = location.address?.trim() || '';
  // Zapisana pinezka ma pierwszeństwo przed wyszukiwaniem podobnej nazwy obiektu.
  const destination = coordinates || address || name;
  if (!destination) return null;
  const encoded = encodeURIComponent(destination);
  const placeId = !coordinates ? location.googlePlaceId?.trim() : '';
  return {
    description: [name, address].filter(Boolean).join('\n') || coordinates,
    approximate: !coordinates && !address,
    google: `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving${placeId ? `&destination_place_id=${encodeURIComponent(placeId)}` : ''}`,
    apple: `https://maps.apple.com/?daddr=${encoded}&dirflg=d`,
    // Android wybiera aplikację obsługującą geo:, bez wymuszania pakietu Google.
    system: `geo:0,0?q=${encodeURIComponent(coordinates ? `${coordinates}${name ? `(${name})` : ''}` : destination)}`,
  };
};

const openMapUrl = async (url: string, fallback?: string) => {
  try {
    await Linking.openURL(url);
  } catch {
    if (fallback && fallback !== url) {
      try {
        await Linking.openURL(fallback);
        return;
      } catch { /* Pokaż jeden komunikat dopiero po nieudanej próbie awaryjnej. */ }
    }
    Alert.alert('Nie udało się otworzyć map', 'Spróbuj ponownie lub wpisz adres w swojej aplikacji nawigacyjnej.');
  }
};

export const showLocationDirections = (location: MapLocation) => {
  const links = getLocationMapLinks(location);
  if (!links) {
    Alert.alert('Brak lokalizacji', 'Najpierw uzupełnij adres lub pinezkę wydarzenia w CRM.');
    return;
  }
  Alert.alert(
    'Otwórz lokalizację',
    `${links.description}${links.approximate ? '\n\nBrak pełnego adresu i współrzędnych. Sprawdź znalezione miejsce przed rozpoczęciem trasy.' : ''}`,
    [
      { text: 'Google Maps — trasa', onPress: () => { void openMapUrl(links.google); } },
      Platform.OS === 'ios'
        ? { text: 'Apple Maps — trasa', onPress: () => { void openMapUrl(links.apple, links.google); } }
        : { text: 'Aplikacja map w telefonie', onPress: () => { void openMapUrl(links.system, links.google); } },
      { text: 'Anuluj', style: 'cancel' },
    ],
    { cancelable: true },
  );
};
