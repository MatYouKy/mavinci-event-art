'use client';

import { supabase } from '@/lib/supabase/browser';

/** Resize before uploading: the public page does not rely on global Next image optimization. */
export async function uploadQuizImage(file: File, folder: 'quiz-formats' | 'quiz-gallery'): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Wybierz zdjęcie JPG, PNG lub WebP. Zdjęcie HEIC zapisz najpierw jako JPG.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('Zdjęcie może mieć maksymalnie 10 MB.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('Nie udało się odczytać zdjęcia. Zapisz je jako JPG, PNG lub WebP i spróbuj ponownie.'); }
  const key = crypto.randomUUID();
  let desktopUrl = '';
  try {
    for (const width of [640, 1280]) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(width / bitmap.width, 1);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Nie udało się przygotować zdjęcia.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value && value.type === 'image/webp' ? resolve(value) : reject(new Error('Przeglądarka nie może przygotować zdjęcia WebP.')),
        'image/webp', 0.82,
      ));
      const path = `${folder}/${key}-${width}.webp`;
      const { error } = await supabase.storage.from('site-images').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
      if (error) throw new Error('Nie udało się przesłać zdjęcia. Sprawdź połączenie i uprawnienia do edycji strony.');
      if (width === 1280) desktopUrl = supabase.storage.from('site-images').getPublicUrl(path).data.publicUrl;
    }
    return desktopUrl;
  } finally { bitmap.close(); }
}
