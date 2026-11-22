import { requireOptionalNativeModule } from 'expo-modules-core';

/*
 * „Mavinci” w aplikacji Pliki (iPhone, iPad) — moduł natywny `ios/MavinciFilesModule.swift` (pod `MavinciFilesBridge`).
 * Na Androidzie i w wersji aplikacji sprzed rozszerzenia (aktualizacja OTA bez nowego buildu) modułu nie ma: `null`.
 * Używaj przez `src/lib/filesProvider.ts`.
 */

export type MavinciFilesStatus = {
  /** iOS 16+ i grupa aplikacji (wersja aplikacji z rozszerzeniem Plików). */
  available: boolean;
  /** Lokalizacja „Mavinci” zarejestrowana w aplikacji Pliki. */
  enabled: boolean;
  /** Konto zapisanej sesji rozszerzenia; brak — sesji nie ma albo została unieważniona. */
  userId?: string | null;
};

export type MavinciFilesNative = {
  status(): Promise<MavinciFilesStatus>;
  /** Adresy serwera (`FinderShared.Connection`) i sesja rozszerzenia (JSON sesji Supabase), potem rejestracja lokalizacji. */
  enable(connection: string, session: string): Promise<void>;
  /** Unieważnia sesję rozszerzenia na serwerze, usuwa ją i lokalizację (z pobranymi kopiami plików). */
  disable(): Promise<void>;
  /** Prośba o sprawdzenie zmian; `driveChanged` — plik dodany w aplikacji do Dysku. */
  signal(driveChanged: boolean): Promise<void>;
};

export const MavinciFiles = requireOptionalNativeModule<MavinciFilesNative>('MavinciFiles');
