import Constants from 'expo-constants';

/**
 * Wersja wydania aplikacji pokazywana użytkownikowi (np. 1.3.16) — z app.json wbudowanego w aplikację,
 * a po aktualizacji OTA z opublikowanej paczki. Jedno źródło dla menu i ustawień.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '—';
