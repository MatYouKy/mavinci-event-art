# Poprawka przekreślenia w PDF - 2026-01-30

## Problem
Linia przekreślenia w wygenerowanym PDF była wyświetlana za wysoko (powyżej tekstu) zamiast przez środek tekstu.

## Przyczyna
`html2canvas` (używany przez html2pdf.js) nie obsługuje poprawnie CSS `transform: translateY(-50%)` w połączeniu z `top: 50%`.

## Rozwiązanie
Zmieniono sposób pozycjonowania linii przekreślenia:

### Poprzednia metoda (nie działała):
```javascript
lineElement.style.top = '50%';
lineElement.style.transform = 'translateY(-50%)';
```

### Nowa metoda (działa):
```javascript
// Oblicz rzeczywistą wysokość linii tekstu
const computedStyle = window.getComputedStyle(htmlEl);
const lineHeight = parseFloat(computedStyle.lineHeight);
const fontSize = parseFloat(computedStyle.fontSize);
const effectiveLineHeight = isNaN(lineHeight) ? fontSize * 1.2 : lineHeight;

// Umieść linię na 55% wysokości (bezpośrednia wartość w px)
lineElement.style.top = `${effectiveLineHeight * 0.55}px`;
```

## Zmodyfikowane pliki
- `/src/app/(crm)/crm/events/[id]/components/tabs/EventContractTab.tsx`
- `/src/styles/contractA4.css`

## Dodatkowe zmiany
- Dodano funkcjonalność aktywacji/dezaktywacji szablonów umów
- Filtrowanie tylko aktywnych szablonów przy wyborze szablonu do umowy
- Przycisk toggle w liście szablonów (`/crm/contract-templates`)

## Testowanie
1. Otwórz umowę z przekreślonym tekstem (np. `<s>tekst</s>`)
2. Wygeneruj PDF
3. Sprawdź czy linia przekreślenia jest przez środek tekstu (nie powyżej)

## Wersja
Data: 2026-01-30 10:30
