import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Aktualizacje bez sklepu (EAS Update): przy starcie i przy każdym powrocie do aplikacji sprawdza, czy jest nowa
 * wersja kodu JS dla tej wersji aplikacji (runtimeVersion), pobiera ją i proponuje ponowne uruchomienie.
 * „Później” — aktualizacja i tak włączy się przy następnym uruchomieniu aplikacji.
 * W trybie deweloperskim (Expo Go, expo start) wyłączone.
 */
export function useOtaUpdates() {
  const busy = useRef(false);
  const handled = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      if (busy.current || handled.current) return;
      busy.current = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable) return;
        const fetched = await Updates.fetchUpdateAsync();
        if (!fetched.isNew) return;
        handled.current = true;
        Alert.alert(
          'Nowa wersja aplikacji',
          'Pobrano aktualizację. Uruchom aplikację ponownie, żeby z niej korzystać.',
          [
            { text: 'Później', style: 'cancel' },
            { text: 'Uruchom ponownie', onPress: () => { Updates.reloadAsync().catch(() => undefined); } },
          ],
        );
      } catch {
        // Brak sieci albo serwer aktualizacji niedostępny — sprawdzimy przy następnym powrocie do aplikacji.
      } finally {
        busy.current = false;
      }
    };

    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);
}
