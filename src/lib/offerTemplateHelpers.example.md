# Placeholder {{OFFER_ITEMS_TABLE}} - Dokumentacja

## Opis

Placeholder `{{OFFER_ITEMS_TABLE}}` automatycznie generuje sformatowaną tabelę HTML ze wszystkimi pozycjami oferty.

## Jak używać

1. **W edytorze szablonów**:
   - Otwórz szablon umowy/oferty w `/crm/contract-templates/[id]/edit-wysiwyg`
   - Kliknij przycisk "Tabela pozycji oferty" w sekcji Placeholdery
   - Placeholder `{{OFFER_ITEMS_TABLE}}` zostanie wstawiony w miejscu kursora

2. **W treści szablonu**:
   ```html
   ## § 2 - Zakres usług

   Wykonawca zobowiązuje się do realizacji następujących usług:

   {{OFFER_ITEMS_TABLE}}

   Całkowita wartość usług wynosi: {{budget}}
   ```

## Co zawiera tabela?

Tabela automatycznie zawiera następujące kolumny:

1. **Lp.** - Numer porządkowy
2. **Nazwa** - Nazwa pozycji/usługi
3. **Opis** - Szczegółowy opis (jeśli dostępny)
4. **Ilość** - Liczba sztuk/jednostek
5. **Jedn.** - Jednostka miary (szt., godz., kpl., itp.)
6. **Cena jedn.** - Cena za jednostkę (w PLN)
7. **Rabat** - Procent rabatu (jeśli zastosowany)
8. **Wartość** - Łączna wartość pozycji (po rabacie)

## Dodatkowe funkcje

- **Automatyczne sumowanie**: Tabela zawiera wiersz z sumą wszystkich pozycji
- **Zebra styling**: Naprzemienne kolorowanie wierszy dla lepszej czytelności
- **Formatowanie walut**: Automatyczne formatowanie kwot w PLN (np. 1 500,00 zł)
- **Obsługa rabatów**: Automatyczne wyliczanie rabatów procentowych
- **Puste stany**: Jeśli oferta nie ma pozycji, wyświetla się komunikat

## Przykład wygenerowanej tabeli

| Lp. | Nazwa | Opis | Ilość | Jedn. | Cena jedn. | Rabat | Wartość |
|-----|-------|------|-------|-------|------------|-------|---------|
| 1 | System nagłośnienia | Profesjonalny system liniowy CODA N-RAY | 1 | kpl. | 5 000,00 zł | - | 5 000,00 zł |
| 2 | Oświetlenie LED | 12x reflektor LED PAR64 | 12 | szt. | 150,00 zł | 10% | 1 620,00 zł |
| 3 | Obsługa techniczna | DJ + Realizator dźwięku | 8 | godz. | 300,00 zł | - | 2 400,00 zł |
| **SUMA** | | | | | | | **9 020,00 zł** |

## Integracja z kodem

### Użycie w komponencie React

```typescript
import { replaceOfferItemsTablePlaceholder, fetchOfferItems } from '@/lib/offerTemplateHelpers';

async function generateContract(offerId: string, templateContent: string) {
  // Pobierz pozycje oferty
  const offerItems = await fetchOfferItems(offerId);

  // Zastąp placeholder tabelą
  const processedContent = replaceOfferItemsTablePlaceholder(templateContent, offerItems);

  return processedContent;
}
```

### Użycie w Edge Function lub API Route

```typescript
import { generateOfferItemsTable } from '@/lib/offerTemplateHelpers';

export default async function handler(req, res) {
  const { offerId } = req.query;

  // Pobierz dane z bazy
  const { data: offerItems } = await supabase
    .from('offer_items')
    .select('*')
    .eq('offer_id', offerId);

  // Wygeneruj tabelę
  const tableHTML = generateOfferItemsTable(offerItems);

  res.status(200).json({ table: tableHTML });
}
```

## Stylowanie

Tabela używa inline CSS dla zapewnienia poprawnego renderowania w PDF. Kolory są dostosowane do motywu aplikacji:

- **Nagłówek**: `#d3bb73` (złoty) z ciemnym tekstem `#1c1f33`
- **Stopka**: Taki sam styl jak nagłówek
- **Wiersze**: Naprzemienne `#f9f9f9` i `#ffffff`
- **Obramowanie**: `#999` dla nagłówka/stopki, `#ddd` dla wierszy

## Dostosowywanie

Jeśli chcesz dostosować wygląd tabeli, edytuj funkcję `generateOfferItemsTable` w pliku:
```
/src/lib/offerTemplateHelpers.ts
```

## Testowanie

Przykład testowania placeholdera:

```typescript
const mockItems = [
  {
    id: '1',
    name: 'Test Item',
    description: 'Test description',
    quantity: 2,
    unit: 'szt.',
    unit_price: 100,
    discount_percent: 10,
    total: 180
  }
];

const html = generateOfferItemsTable(mockItems);
console.log(html); // Wyświetli HTML tabeli
```

## Rozwiązywanie problemów

### Tabela nie wyświetla się
- Sprawdź czy w bazie są pozycje oferty dla danego `offer_id`
- Upewnij się że placeholder jest dokładnie `{{OFFER_ITEMS_TABLE}}` (wielkość liter ma znaczenie)

### Brak sum/obliczeń
- Sprawdź czy kolumny `quantity`, `unit_price`, `discount_percent` mają poprawne wartości numeryczne
- Sprawdź console na błędy obliczeniowe

### PDF nie renderuje tabeli poprawnie
- Sprawdź czy generator PDF wspiera inline CSS
- Rozważ użycie zewnętrznego arkusza stylów dla PDF
