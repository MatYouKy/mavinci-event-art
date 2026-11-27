import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * Wersja wydania aplikacji pokazywana użytkownikowi (np. 1.3.16) — z app.json wbudowanego w aplikację,
 * a po aktualizacji OTA z opublikowanej paczki. Jedno źródło dla menu i ustawień.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '—';

const stamp = (value: Date | null | undefined) =>
  value ? value.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/**
 * Aktualizacje bez sklepu w tej instalacji (Ustawienia, pod wersją): kanał, wersja środowiska (`runtimeVersion`) i to, czy
 * działa kod wbudowany w aplikację, czy pobrana aktualizacja — po tym widać, czy telefon dostaje `yarn deploy:ota`
 * (docs/mobile-ota.md). Bez kanału albo z wyłączonymi aktualizacjami — trzeba zainstalować nową wersję aplikacji.
 */
export function appUpdateLabel(): string {
  if (__DEV__) return 'Tryb deweloperski — aktualizacje bez sklepu wyłączone';
  if (!Updates.isEnabled) return 'Aktualizacje bez sklepu wyłączone w tej instalacji — zainstaluj nową wersję aplikacji';
  const parts = [
    `kanał ${Updates.channel || 'brak (zainstaluj nową wersję aplikacji)'}`,
    `środowisko ${Updates.runtimeVersion || '—'}`,
    Updates.isEmbeddedLaunch ? 'kod wbudowany w aplikację' : `aktualizacja z ${stamp(Updates.createdAt)}`,
  ];
  return parts.join(' · ');
}
