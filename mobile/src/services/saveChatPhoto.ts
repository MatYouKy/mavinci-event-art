import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export class PhotoPermissionError extends Error {}

export async function saveChatPhoto(url: string): Promise<void> {
  // Android 10+ permits adding our own media without reading the library.
  if (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 29)) {
    const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) throw new PhotoPermissionError('Brak zgody na zapis zdjęć.');
  }
  if (!FileSystem.cacheDirectory) throw new Error('Brak miejsca na pobranie zdjęcia.');
  const extension = url.split('?')[0].match(/\.(jpe?g|png|webp|heic|heif|gif)$/i)?.[1] || 'jpg';
  const localUri = `${FileSystem.cacheDirectory}chat-photo-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
  try {
    const result = await FileSystem.downloadAsync(url, localUri);
    if (result.status < 200 || result.status >= 300) throw new Error('Nie udało się pobrać zdjęcia. Spróbuj ponownie.');
    await MediaLibrary.saveToLibraryAsync(result.uri);
  } finally {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
  }
}
