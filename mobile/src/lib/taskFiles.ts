import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { pickMaterialDocuments, pickMaterialMedia } from './materialsApi';
import type { TaskUploadFile } from './tasksBoard';

/*
 * Załączniki zadania z telefonu (nowe zadanie, edycja i szczegóły): zdjęcia i filmy z galerii (także zrzuty ekranu), zdjęcie
 * z aparatu, dowolne pliki z „Plików” i obraz ze schowka (np. zrzut ekranu skopiowany po zrobieniu). Pliki czekają w formularzu
 * do zapisu zadania — potem idą na serwer CRM po kolei (`uploadTaskAttachment`).
 */

export type PickedTaskFile = TaskUploadFile & { key: string; image: boolean };
export type TaskFileSource = 'library' | 'camera' | 'files' | 'clipboard';

let sequence = 0;
const keyOf = (name: string) => `${Date.now()}-${(sequence += 1)}-${name}`;
const isImage = (mime: string, name: string) => mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);

const pad = (value: number) => String(value).padStart(2, '0');
const stamp = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

/** Obraz ze schowka zapisany jako plik PNG (do wysłania); `null` — w schowku nie ma obrazu. */
async function clipboardImage(): Promise<PickedTaskFile | null> {
  const available = await Clipboard.hasImageAsync().catch(() => false);
  if (!available) return null;
  const image = await Clipboard.getImageAsync({ format: 'png' });
  const base64 = image?.data ? image.data.replace(/^data:image\/[a-z+.-]+;base64,/i, '') : '';
  if (!base64) return null;
  const directory = FileSystem.cacheDirectory;
  if (!directory) throw new Error('Nie udało się przygotować obrazu ze schowka.');
  const name = `obraz-ze-schowka-${stamp(new Date())}.png`;
  const uri = `${directory}${keyOf('schowek').replace(/[^a-z0-9-]/gi, '')}.png`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists && 'size' in info ? Number(info.size) || 0 : Math.floor((base64.length * 3) / 4);
  return { key: keyOf(name), uri, name, mimeType: 'image/png', size, image: true };
}

/**
 * Pliki ze wskazanego źródła. Pusta lista — anulowano; błąd — brak dostępu (np. do aparatu) albo pusty schowek
 * (komunikat do pokazania).
 */
export async function pickTaskFiles(source: TaskFileSource): Promise<PickedTaskFile[]> {
  if (source === 'clipboard') {
    const file = await clipboardImage();
    if (!file) throw new Error('W schowku nie ma obrazu. Zrób zrzut ekranu i wybierz „Kopiuj”, albo dodaj go z galerii.');
    return [file];
  }
  const picked = source === 'files' ? await pickMaterialDocuments() : await pickMaterialMedia(source);
  return picked.map((file) => ({
    key: keyOf(file.name),
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType || 'application/octet-stream',
    size: file.size,
    image: isImage(file.mimeType || '', file.name),
  }));
}

/** Dopisanie wybranych plików do listy bez powtórzeń (ta sama nazwa i rozmiar). */
export function mergeTaskFiles(current: PickedTaskFile[], added: PickedTaskFile[]): PickedTaskFile[] {
  const next = [...current];
  for (const file of added) {
    if (!next.some((item) => item.name === file.name && item.size === file.size)) next.push(file);
  }
  return next;
}

export function taskFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
