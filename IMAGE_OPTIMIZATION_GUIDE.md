# 📸 System Optymalizacji Obrazów

Automatyczny system kompresji i optymalizacji obrazów dla lepszej wydajności strony.

---

## ✨ Funkcje

- **Automatyczna kompresja** - zmniejsza wagę plików
- **Responsive images** - generuje wersje dla desktop, mobile i miniatur
- **Format WebP** - 30% lepsza kompresja niż JPEG
- **Inteligentne skalowanie** - zachowuje proporcje obrazu
- **Równoległe przetwarzanie** - szybki upload wielu wersji

---

## 📐 Rozmiary

| Wersja | Szerokość | Jakość | Użycie |
|--------|-----------|--------|--------|
| Desktop | 2200px | 85% | Komputery i tablety |
| Mobile | 800px | 85% | Smartfony |
| Thumbnail | 400px | 80% | Miniaturki i podglądy |

---

## 🚀 Jak używać

### 1. Upload z automatyczną optymalizacją (ZALECANE)

Upload jednego pliku automatycznie generuje 3 wersje:

```typescript
import { uploadOptimizedImage } from '@/lib/storage';

const handleUpload = async (file: File) => {
  const urls = await uploadOptimizedImage(file, 'portfolio');

  console.log(urls.desktop);    // https://.../image-desktop.webp
  console.log(urls.mobile);     // https://.../image-mobile.webp
  console.log(urls.thumbnail);  // https://.../image-thumb.webp

  // Zapisz URLs do bazy danych
  await supabase.from('portfolio').insert({
    image_desktop: urls.desktop,
    image_mobile: urls.mobile,
    image_thumbnail: urls.thumbnail,
  });
};
```

### 2. Upload prostej wersji (tylko desktop)

Jeśli nie potrzebujesz wersji mobilnych:

```typescript
import { uploadImageSimple } from '@/lib/storage';

const handleUpload = async (file: File) => {
  const result = await uploadImageSimple(file, 'avatars', 1200);

  if (result.success) {
    console.log('URL:', result.url);
  } else {
    console.error('Błąd:', result.error);
  }
};
```

### 3. Backwards compatibility (stare funkcje działają)

Istniejący kod nie wymaga zmian:

```typescript
import { uploadImageToStorage } from '@/lib/storage';

const result = await uploadImageToStorage(file);
// Teraz automatycznie uploaduje wszystkie wersje!
console.log(result.url);      // Desktop URL (backwards compatible)
console.log(result.urls);     // { desktop, mobile, thumbnail }
```

---

## 🖼️ Wyświetlanie obrazów

### Użycie ResponsiveImage component

Automatycznie ładuje odpowiedni rozmiar na podstawie urządzenia:

```tsx
import ResponsiveImage from '@/components/ResponsiveImage';

<ResponsiveImage
  desktop="https://.../image-desktop.webp"
  mobile="https://.../image-mobile.webp"
  thumbnail="https://.../image-thumb.webp"
  alt="Opis obrazu"
  className="rounded-lg"
  loading="lazy"
/>
```

### Helper functions

```typescript
import { hasResponsiveVersions, getImageUrl } from '@/components/ResponsiveImage';

// Sprawdź czy URL ma wersje responsywne
if (hasResponsiveVersions(imageUrl)) {
  const mobile = imageUrl.mobile;
  const desktop = imageUrl.desktop;
}

// Pobierz konkretny rozmiar
const mobileUrl = getImageUrl(imageUrl, 'mobile');
```

---

## 💾 Oszczędności

### Przykład: Zdjęcie 3000x2000px, 4MB

| Wersja | Rozmiar | Oszczędność |
|--------|---------|-------------|
| Oryginał | 4.0 MB | - |
| Desktop (2200px) | ~350 KB | 91% |
| Mobile (800px) | ~80 KB | 98% |
| Thumbnail (400px) | ~30 KB | 99% |

**Dla użytkownika mobile:** Zamiast 4MB pobiera tylko 80KB! ⚡

---

## 🔧 Konfiguracja

Zmień rozmiary w `src/lib/storage.ts`:

```typescript
export const IMAGE_SIZES = {
  desktop: { width: 2200, quality: 0.85 },   // Zmień tutaj
  mobile: { width: 800, quality: 0.85 },
  thumbnail: { width: 400, quality: 0.8 },
};
```

---

## 📝 Migracja istniejących obrazów

### Skrypt do przetworzenia istniejących obrazów:

```typescript
// tools/optimize-existing-images.ts
import { uploadOptimizedImage } from '@/lib/storage';

async function optimizeExistingImages() {
  // 1. Pobierz wszystkie obrazy z bazy
  const { data: items } = await supabase
    .from('portfolio')
    .select('id, image_url');

  for (const item of items) {
    if (!item.image_url) continue;

    // 2. Pobierz obraz
    const response = await fetch(item.image_url);
    const blob = await response.blob();
    const file = new File([blob], 'image.jpg', { type: blob.type });

    // 3. Upload zoptymalizowanych wersji
    const urls = await uploadOptimizedImage(file, 'portfolio');

    // 4. Zaktualizuj bazę
    await supabase
      .from('portfolio')
      .update({
        image_desktop: urls.desktop,
        image_mobile: urls.mobile,
        image_thumbnail: urls.thumbnail,
      })
      .eq('id', item.id);

    console.log(`✓ Optimized: ${item.id}`);
  }
}
```

---

## ⚡ Performance Tips

1. **Użyj loading="lazy"** dla obrazów poniżej fold
2. **Użyj priority={true}** dla hero images
3. **Cache obrazy** - ustawiony cache na 1 rok (31536000s)
4. **Kompresja brotli/gzip** - automatyczna w Supabase Storage

---

## 🎯 Best Practices

### ✅ DO:
- Używaj `uploadOptimizedImage()` dla nowych uploadów
- Używaj `ResponsiveImage` component do wyświetlania
- Dodaj dobre alt texts dla SEO
- Testuj na mobile devices

### ❌ DON'T:
- Nie uploaduj obrazów > 10MB (kompresuj najpierw)
- Nie używaj PNG dla zdjęć (tylko dla grafik z przezroczystością)
- Nie zapomnij o alt text
- Nie używaj inline base64 images

---

## 🐛 Troubleshooting

### Obraz nie kompresuje się

- Sprawdź czy przeglądarka wspiera WebP (wszystkie nowoczesne tak)
- Sprawdź console logs - system loguje rozmiary przed/po

### Upload trwa długo

- Normalne dla dużych obrazów (3-5s dla 5MB)
- System generuje 3 wersje równolegle
- Pokaż loading indicator użytkownikowi

### Stare obrazy JPEG/PNG

- Użyj skryptu migracji powyżej
- Lub zostaw stare i tylko nowe optymalizuj
- System działa z oboma formatami

---

## 📊 Monitoring

```typescript
// Loguj rozmiary przed/po upload
console.log('[Upload] Original:', (file.size / 1024 / 1024).toFixed(2), 'MB');

const urls = await uploadOptimizedImage(file);
// Automatycznie loguje:
// - Desktop: 350KB
// - Mobile: 80KB
// - Thumbnail: 30KB
```

---

**Pytania?** Sprawdź kod w `src/lib/storage.ts` lub dodaj issue.
