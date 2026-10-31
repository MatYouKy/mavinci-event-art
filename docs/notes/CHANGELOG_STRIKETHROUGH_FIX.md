# Poprawka przekreślenia w PDF - 2026-01-30 (v3 - DZIAŁAJĄCA)

## Problem
html2canvas (używany przez html2pdf.js) nie renderuje poprawnie `text-decoration: line-through` przy `foreignObjectRendering: false`.

## Rozwiązanie - Hybrydowe podejście
Różne metody dla różnych kontekstów:

### 1. Normalny widok edytora (CSS)
```css
.contract-content s,
.contract-content strike,
.contract-content del {
  text-decoration: line-through !important;
  text-decoration-thickness: 1.5px !important;
  text-decoration-color: #000 !important;
}
```

### 2. Generowanie PDF (JavaScript + DOM)
**Przed renderowaniem html2canvas:**
```javascript
// Znajdź wszystkie elementy <s>, <del>, <strike>
strikethroughElements.forEach((el) => {
  // Wyłącz natywne text-decoration
  el.style.textDecoration = 'none';
  el.style.position = 'relative';
  el.style.display = 'inline-block';

  // Dodaj realny <span> jako czarną linię przez środek
  const line = document.createElement('span');
  line.style.position = 'absolute';
  line.style.left = '0';
  line.style.right = '0';
  line.style.top = '50%';
  line.style.height = '1.5px';
  line.style.backgroundColor = '#000';
  line.style.marginTop = '-0.75px'; // wycentruj

  el.appendChild(line);
});
```

**Po wygenerowaniu PDF:**
```javascript
// Usuń dodane linie
addedLines.forEach(line => line.remove());

// Przywróć natywne przekreślenie
strikethroughElements.forEach(el => {
  el.style.textDecoration = '';
  el.style.position = '';
  el.style.display = '';
});
```

### 3. Druk bezpośredni (CSS @media print)
```css
@media print {
  .contract-content s,
  .contract-content strike,
  .contract-content del {
    position: relative;
    text-decoration: none;
    display: inline-block;
  }

  .contract-content s::after,
  .contract-content strike::after,
  .contract-content del::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1.5px;
    background-color: #000;
    margin-top: -0.75px;
  }
}
```

## Kluczowe elementy
✅ **backgroundColor zamiast border** - lepiej renderowane przez html2canvas
✅ **top: 50% + marginTop: -0.75px** - zamiast transform (html2canvas go ignoruje)
✅ **Realne elementy DOM** - nie pseudo-elementy CSS (dla PDF)
✅ **Cleanup po generowaniu** - przywrócenie natywnego wyglądu

## Zmodyfikowane pliki
- `/src/app/(crm)/crm/events/[id]/components/tabs/EventContractTab.tsx`
- `/src/styles/contractA4.css`

## Testowanie
1. Edytor umowy: `/crm/events/[id]` → zakładka "Umowy"
2. Wpisz: `Ten tekst jest <s>przekreślony</s> w środku zdania`
3. Sprawdź wizualnie - linia przez środek
4. Wygeneruj PDF → sprawdź - linia przez środek
5. Wydrukuj (Ctrl+P) → sprawdź - linia przez środek

## Obsługiwane tagi
- `<s>tekst</s>`
- `<del>tekst</del>`
- `<strike>tekst</strike>`

## Dlaczego to działa
- html2canvas renderuje realne elementy DOM (span z backgroundColor) ✅
- html2canvas NIE renderuje text-decoration ❌
- html2canvas NIE renderuje pseudo-elementów ::after w pełni ❌
- html2canvas NIE renderuje transform: translateY() ❌

## Wersja
Data: 2026-01-30 12:00 (v3 - hybrydowa, działająca)
