import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Aktualizacje bez sklepu (EAS Update): przy starcie i przy każdym powrocie do aplikacji sprawdza, czy jest nowa
 * wersja kodu JS dla tej wersji aplikacji (runtimeVersion), i ją pobiera. „Nowa wersja aplikacji” → „Uruchom ponownie”
 * pojawia się, gdy pobrana aktualizacja czeka na uruchomienie — niezależnie od tego, kto ją pobrał: to sprawdzenie albo
 * sprawdzenie przy starcie aplikacji (`EXPO_UPDATES_CHECK_ON_LAUNCH`), które na Androidzie zwykle kończy się wcześniej
 * (wcześniej komunikat pokazywało tylko pobranie z tego sprawdzenia, więc na Androidzie się nie pojawiał).
 * „Później” — aktualizacja i tak włączy się przy następnym uruchomieniu aplikacji.
 * W trybie deweloperskim (Expo Go, expo start) wyłączone.
 */
export function useOtaUpdates() {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const busy = useRef(false);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) await Updates.fetchUpdateAsync();
      } catch {
        // Brak sieci, serwer aktualizacji niedostępny albo trwa sprawdzanie przy starcie — sprawdzimy przy następnym
        // powrocie do aplikacji; pobraną aktualizację i tak zgłosi `isUpdatePending`.
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

  // Pobrana aktualizacja czeka na uruchomienie — jeden komunikat na aktualizację.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled || !isUpdatePending) return;
    const id = downloadedUpdate?.updateId ?? 'pending';
    if (announced.current === id) return;
    announced.current = id;
    Alert.alert(
      'Nowa wersja aplikacji',
      'Pobrano aktualizację. Uruchom aplikację ponownie, żeby z niej korzystać.',
      [
        { text: 'Później', style: 'cancel' },
        { text: 'Uruchom ponownie', onPress: () => { Updates.reloadAsync().catch(() => undefined); } },
      ],
    );
  }, [isUpdatePending, downloadedUpdate?.updateId]);
}
