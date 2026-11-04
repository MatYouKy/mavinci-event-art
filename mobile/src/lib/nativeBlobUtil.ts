import { TurboModuleRegistry } from 'react-native';
import type { ReactNativeBlobUtil as BlobUtil } from 'react-native-blob-util';

let cached: BlobUtil | null | undefined;

/**
 * react-native-blob-util istnieje tylko w buildzie natywnym (EAS / TestFlight / App Store). W Expo Go go nie ma,
 * a sam import pakietu od razu tworzy NativeEventEmitter i wywraca start całej aplikacji („[runtime not ready]”).
 * Dlatego ładujemy go dopiero przy użyciu i tylko wtedy, gdy moduł natywny jest dostępny. Brak = null
 * (ekran używa wtedy zwykłego otwarcia podpisanego linku).
 */
export function getBlobUtil(): BlobUtil | null {
  if (cached !== undefined) return cached;
  try {
    if (!TurboModuleRegistry.get('ReactNativeBlobUtil')) {
      cached = null;
      return cached;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-blob-util') as { default?: BlobUtil };
    cached = mod?.default ?? null;
  } catch {
    cached = null;
  }
  return cached;
}
