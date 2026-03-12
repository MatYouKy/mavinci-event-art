# Integracja rekomendowanych klauzul umowy z produktami

## Przegląd

Produkty ofertowe (`offer_products`) mogą teraz zawierać rekomendowane klauzule umowy w polu `recommended_contract_clauses` (TEXT, HTML).

## Stan implementacji

### ✅ Zaimplementowane
- [x] Pole `recommended_contract_clauses` w tabeli `offer_products`
- [x] UI do edycji klauzul w `/crm/offers/products/[id]`
- [x] Edytor WYSIWYG (ReactQuill) z formatowaniem
- [x] Podgląd zapisanych klauzul
- [x] Przykłady użycia w UI

### 🔄 Do zrobienia
- [ ] Automatyczne wstawianie klauzul do generowanych umów
- [ ] System zmiennych (placeholders) dla klauzul
- [ ] Numeracja paragrafów w umowie
- [ ] Walidacja HTML w klauzulach
- [ ] Historia zmian klauzul

## Użycie

### 1. Dodawanie klauzul do produktu

1. Przejdź do `/crm/offers/products/[id]`
2. Przewiń do sekcji "Rekomendowane klauzule umowy"
3. Kliknij "Edytuj" lub "Dodaj klauzule"
4. Wpisz treść w edytorze WYSIWYG
5. Kliknij "Zapisz"

### 2. Zmienne (placeholders)

Możesz używać następujących zmiennych w treści klauzul:

- `{{nazwa_produktu}}` - nazwa produktu
- `{{klient}}` - nazwa klienta
- `{{data_wydarzenia}}` - data wydarzenia
- `{{lokalizacja}}` - lokalizacja wydarzenia
- `{{ilosc}}` - ilość produktu w ofercie

**Przykład:**
```html
<p><strong>§X. POSTANOWIENIA DOTYCZĄCE {{nazwa_produktu}}</strong></p>
<p>1. Zleceniodawca {{klient}} zobowiązuje się do zapewnienia...</p>
```

## Integracja z generatorem umów

### Koncepcja implementacji

```typescript
// W funkcji generującej umowę:
async function generateContract(eventId: string, templateId: string) {
  // 1. Pobierz ofertę powiązaną z eventem
  const offer = await getAcceptedOffer(eventId);

  // 2. Pobierz produkty z oferty wraz z klauzulami
  const { data: items } = await supabase
    .from('offer_items')
    .select(`
      *,
      product:offer_products(
        id,
        name,
        recommended_contract_clauses
      )
    `)
    .eq('offer_id', offer.id);

  // 3. Zbierz wszystkie klauzule z produktów
  const additionalClauses = items
    .map(item => item.product?.recommended_contract_clauses)
    .filter(Boolean)
    .map((clause, index) => {
      // Zastąp zmienne
      return replacePlaceholders(clause, {
        nazwa_produktu: items[index].product.name,
        klient: offer.client_name,
        // ... inne zmienne
      });
    })
    .join('\n\n');

  // 4. Wstaw klauzule do umowy przed sekcją "Postanowienia końcowe"
  const contractContent = insertClausesBeforeFindings(
    template.content,
    additionalClauses
  );

  // 5. Wygeneruj PDF
  return generatePDF(contractContent);
}
```

### Funkcja zastępowania zmiennych

```typescript
function replacePlaceholders(text: string, variables: Record<string, string>): string {
  let result = text;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    result = result.replace(regex, value);
  }

  return result;
}
```

### Wstawianie klauzul do umowy

```typescript
function insertClausesBeforeFindings(
  templateContent: string,
  additionalClauses: string
): string {
  // Szukaj sekcji "Postanowienia końcowe" lub podobnej
  const markers = [
    '§ POSTANOWIENIA KOŃCOWE',
    '§ Postanowienia końcowe',
    '<h2>POSTANOWIENIA KOŃCOWE</h2>',
    '<h3>Postanowienia końcowe</h3>',
  ];

  for (const marker of markers) {
    if (templateContent.includes(marker)) {
      return templateContent.replace(
        marker,
        `${additionalClauses}\n\n${marker}`
      );
    }
  }

  // Jeśli nie znaleziono markera, dodaj na końcu przed stopką
  return templateContent.replace(
    '</body>',
    `${additionalClauses}\n\n</body>`
  );
}
```

## Przykłady klauzul

### Streaming
```html
<p><strong>§X. POSTANOWIENIA DOTYCZĄCE TRANSMISJI ONLINE</strong></p>
<p>1. Zleceniodawca zobowiązany jest do zapewnienia stabilnego łącza internetowego o przepustowości minimum 50 Mb/s upload.</p>
<p>2. W przypadku braku odpowiedniej infrastruktury sieciowej, Zleceniobiorca zastrzega sobie prawo do odmowy realizacji usługi streamingu.</p>
<p>3. Zleceniobiorca nie ponosi odpowiedzialności za przerwanie transmisji spowodowane problemami z łączem internetowym po stronie Zleceniodawcy.</p>
```

### Kasyno
```html
<p><strong>§X. POSTANOWIENIA DOTYCZĄCE ORGANIZACJI KASYNA</strong></p>
<p>1. Kasyno służy wyłącznie celom rozrywkowym i nie prowadzi się w nim gier na pieniądze.</p>
<p>2. Zleceniodawca zobowiązuje się do poinformowania uczestników o rozrywkowym charakterze kasyna.</p>
<p>3. Zleceniobiorca dostarcza profesjonalnych krupierów oraz sprzęt do gier (stoły, żetony, karty).</p>
```

### Quiz/Teleturniej
```html
<p><strong>§X. POSTANOWIENIA DOTYCZĄCE QUIZU/TELETURNIEJU</strong></p>
<p>1. Zleceniodawca dostarcza pytania quizowe lub akceptuje propozycje Zleceniobiorcy.</p>
<p>2. Zleceniobiorca zapewnia moderatora/prezentera prowadzącego quiz.</p>
<p>3. W przypadku imprez firmowych, treść pytań może być dostosowana do profilu działalności Zleceniodawcy.</p>
```

## Baza danych

### Struktura tabeli
```sql
ALTER TABLE offer_products
ADD COLUMN recommended_contract_clauses TEXT;

COMMENT ON COLUMN offer_products.recommended_contract_clauses
IS 'Rekomendowane klauzule umowy (HTML) - automatycznie dodawane do umów zawierających ten produkt';
```

### Dostęp do danych
```typescript
// Pobierz produkt z klauzulami
const { data: product } = await supabase
  .from('offer_products')
  .select('*, recommended_contract_clauses')
  .eq('id', productId)
  .single();

// Zapisz klauzule
const { error } = await supabase
  .from('offer_products')
  .update({ recommended_contract_clauses: '<p>Treść...</p>' })
  .eq('id', productId);
```

## Pliki do modyfikacji przy implementacji integracji

1. **Generator umów**: `src/app/bridge/events/contracts/generate/route.ts`
2. **Budowanie HTML umowy**: `src/app/(crm)/crm/events/[id]/helpers/buildContractHtml.ts`
3. **Funkcje pomocnicze**: Nowy plik `src/lib/contracts/clausesHelper.ts`

## Uwagi

- Klauzule są zapisywane jako HTML (z ReactQuill)
- Pole może być NULL - nie wszystkie produkty wymagają dodatkowych klauzul
- System zmiennych będzie zaimplementowany w przyszłości
- Numeracja paragrafów musi być dynamiczna (nie hardcodować "§X")
