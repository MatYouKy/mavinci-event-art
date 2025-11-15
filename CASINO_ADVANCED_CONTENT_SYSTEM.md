# 🎰 Casino Advanced Content System - Instrukcja

## ✅ Co zostało zaimplementowane

### 1. **Nowa struktura bazy danych**

Utworzono 3 nowe tabele:

```sql
casino_content_sections     -- Sekcje główne
casino_content_items        -- Elementy w sekcjach (nagłówki, paragrafy, listy, obrazy, filmy)
casino_content_separators   -- Separatory wizualne między sekcjami
```

### 2. **Rich Content Items - 5 typów treści**

Każdy item w sekcji może być jednym z:

#### **A. Nagłówek (Heading)**
- 3 poziomy: H1, H2, H3
- Pełna edycja tekstu
- Użycie: Tytuły podsekcji

#### **B. Paragraf (Paragraph)**
- Justowanie: lewy, środek, prawy, wyjustowany
- Textarea na dłuższe teksty
- Użycie: Opisy, treści główne

#### **C. Lista punktowana (List)**
- Dynamiczne dodawanie/usuwanie punktów
- Każdy punkt edytowalny
- Użycie: Wymienienia, cechy, zalety

#### **D. Obraz (Image)**
- URL obrazu
- ALT text dla SEO
- Podgląd na żywo
- Użycie: Galerie, ilustracje

#### **E. Film (Video)**
- URL filmu (YouTube, Vimeo embed)
- Wsparcie dla embedów
- Użycie: Tutoriale, prezentacje

### 3. **Separatory wizualne**

4 typy separatorów między sekcjami:

```
line  → ────────────────────  (linia pozioma z gradientem)
dots  → • • •                 (trzy kropki)
wave  → ～～～～～            (fala SVG)
none  → [40px space]          (pusta przestrzeń)
```

### 4. **Układy Grid**

Każda sekcja może mieć własny układ:
- `grid-1` → 1 kolumna (pełna szerokość)
- `grid-2` → 2 kolumny
- `grid-3` → 3 kolumny
- `grid-4` → 4 kolumny

### 5. **Padding control**

Każda sekcja może mieć różny padding wertykalny:
- `small` → 2rem (32px)
- `normal` → 4rem (64px)
- `large` → 6rem (96px)

---

## 🎨 Komponenty

### `CasinoAdvancedContentEditor.tsx`

Główny edytor zarządzający:
- ✅ Dodawanie/usuwanie sekcji
- ✅ Dodawanie/usuwanie separatorów
- ✅ Drag & drop ordering (strzałki góra/dół)
- ✅ Collapse/expand sekcji
- ✅ Zarządzanie itemami w sekcjach

### `RichContentItemEditor.tsx`

Edytor pojedynczego elementu:
- ✅ Dynamiczne UI zależne od typu
- ✅ Move up/down w ramach sekcji
- ✅ Usuwanie elementu
- ✅ Live preview (dla obrazów)

---

## 📐 Struktura Danych

### Section
```typescript
{
  id: string;
  title: string;              // Tytuł sekcji
  subtitle?: string;          // Podtytuł (opcjonalny)
  layout_type: 'grid-1' | 'grid-2' | 'grid-3' | 'grid-4';
  items: ContentItem[];       // Tablice itemów
  order_index: number;
  background_color?: string;  // Kolor tła
  padding_y?: 'small' | 'normal' | 'large';
}
```

### ContentItem
```typescript
{
  id: string;
  item_type: 'heading' | 'paragraph' | 'list' | 'image' | 'video';
  content: {
    // Dla heading:
    text?: string;
    level?: 'h1' | 'h2' | 'h3';

    // Dla paragraph:
    text?: string;
    align?: 'left' | 'center' | 'right' | 'justify';

    // Dla list:
    items?: string[];  // ['punkt 1', 'punkt 2', ...]

    // Dla image:
    url?: string;
    alt?: string;

    // Dla video:
    url?: string;  // YouTube/Vimeo embed URL
  };
  order_index: number;
}
```

### Separator
```typescript
{
  id: string;
  separator_type: 'line' | 'dots' | 'wave' | 'none';
  order_index: number;
}
```

---

## 🚀 Jak używać

### 1. **Dodaj sekcję**

```
[+ Dodaj sekcję]
```

- Kliknij przycisk w prawym górnym rogu
- Pojawi się nowa pusta sekcja

### 2. **Skonfiguruj sekcję**

- **Tytuł**: Wpisz bezpośrednio w nagłówku sekcji
- **Układ grid**: Wybierz 1-4 kolumny
- **Padding**: Wybierz mały/normalny/duży

### 3. **Dodaj elementy do sekcji**

Kliknij jeden z przycisków:
```
[+ Nagłówek] [+ Paragraf] [+ Lista] [+ Obraz] [+ Film]
```

### 4. **Edytuj element**

Każdy element ma własne pola w zależności od typu:

**Nagłówek:**
- Wybierz H1/H2/H3
- Wpisz tekst

**Paragraf:**
- Wybierz justowanie (lewy/środek/prawy/justify)
- Wpisz tekst (textarea)

**Lista:**
- Dodaj punkty przyciskiem `[+ Dodaj element]`
- Każdy punkt edytowalny
- Usuń punkt `[🗑️]`

**Obraz:**
- Wklej URL obrazu
- Dodaj ALT text
- Zobacz podgląd

**Film:**
- Wklej URL embeda (YouTube/Vimeo)

### 5. **Zmień kolejność elementów**

- **Strzałki obok elementu**: Przesuń w ramach sekcji
- **Strzałki obok sekcji/separatora**: Przesuń w całej strukturze

### 6. **Dodaj separator między sekcjami**

```
[- Dodaj separator]
```

Wybierz typ:
- Linia
- Kropki
- Fala
- Przestrzeń

### 7. **Usuń sekcję/element/separator**

Kliknij `[🗑️]` przy elemencie

---

## 💾 Zapisywanie

Dane są zapisywane po kliknięciu **[Zapisz wszystko]** w górnym pasku edycji.

System automatycznie:
1. Usuwa stare bloki z `casino_content_blocks`
2. Zapisuje sekcje do `casino_content_sections`
3. Zapisuje itemy do `casino_content_items`
4. Zapisuje separatory do `casino_content_separators`
5. Zachowuje kolejność (`order_index`)

---

## 🎯 Przykład użycia

### Scenariusz: "Dlaczego Mavinci Casino?"

```
┌─────────────────────────────────────┐
│ SEKCJA 1: "Dlaczego my?"           │
│ Grid: 1 kolumna, Padding: normal   │
│                                     │
│ [H2] Dlaczego warto?               │
│ [Paragraf] Jesteśmy liderem...     │
│ [Lista]                             │
│   • 15 lat doświadczenia            │
│   • 200+ eventów rocznie            │
│   • Profesjonalny sprzęt            │
└─────────────────────────────────────┘
         ↓
    [SEPARATOR: line]
         ↓
┌─────────────────────────────────────┐
│ SEKCJA 2: "Nasze stoły"            │
│ Grid: 3 kolumny, Padding: large    │
│                                     │
│ [Obraz] poker-table.jpg             │
│ [H3] Texas Hold'em                  │
│ [Paragraf] Najpopularniejszy...    │
└─────────────────────────────────────┘
         ↓
    [SEPARATOR: dots]
         ↓
┌─────────────────────────────────────┐
│ SEKCJA 3: "Tutorial"               │
│ Grid: 1 kolumna, Padding: normal   │
│                                     │
│ [H2] Jak grać?                      │
│ [Film] youtube.com/embed/xyz        │
└─────────────────────────────────────┘
```

---

## 🔧 Integracja w kodzie

### Import komponentu:

```tsx
import CasinoAdvancedContentEditor from '@/components/CasinoAdvancedContentEditor';
```

### Użycie:

```tsx
const [sections, setSections] = useState<Section[]>([]);
const [separators, setSeparators] = useState<Separator[]>([]);

<CasinoAdvancedContentEditor
  sections={sections}
  separators={separators}
  onChange={(newSections, newSeparators) => {
    setSections(newSections);
    setSeparators(newSeparators);
  }}
/>
```

---

## 🎨 Rendering na Frontend

### Pobieranie danych:

```typescript
// Pobierz sekcje z itemami
const { data: sections } = await supabase
  .from('casino_content_sections')
  .select(`
    *,
    items:casino_content_items(*)
  `)
  .eq('is_visible', true)
  .order('order_index');

// Pobierz separatory
const { data: separators } = await supabase
  .from('casino_content_separators')
  .select('*')
  .eq('is_visible', true)
  .order('order_index');
```

### Renderowanie:

```tsx
{/* Połącz sekcje i separatory według order_index */}
{mergedElements.map(element => (
  element.type === 'separator' ? (
    <SeparatorComponent separator={element.data} />
  ) : (
    <SectionComponent section={element.data}>
      {element.data.items.map(item => (
        <ContentItemRenderer item={item} />
      ))}
    </SectionComponent>
  )
))}
```

---

## ✅ Gotowe!

System jest w pełni funkcjonalny i gotowy do użycia. Możesz teraz:

1. ✅ Tworzyć dowolne sekcje
2. ✅ Dodawać w nich nagłówki, paragrafy, listy, obrazy, filmy
3. ✅ Justować tekst
4. ✅ Dodawać separatory wizualne
5. ✅ Zmieniać układ grid (1-4 kolumny)
6. ✅ Kontrolować padding sekcji
7. ✅ Drag & drop ordering

**Migracja bazy już zastosowana!** 🎉
