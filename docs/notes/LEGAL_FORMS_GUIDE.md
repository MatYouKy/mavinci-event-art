# Przewodnik po formach prawnych organizacji

## Dostępne formy prawne

System obsługuje następujące formy prawne działalności:

### 1. **JDG** - Jednoosobowa działalność gospodarcza
- Najprostsza forma działalności
- Prowadzona przez osobę fizyczną
- **Nie wymaga KRS** (brak wpisu do Krajowego Rejestru Sądowego)
- Wymaga: NIP, REGON
- Reprezentant: właściciel (osoba fizyczna)

### 2. **sp. z o.o.** - Spółka z ograniczoną odpowiedzialnością
- Najpopularniejsza forma spółki kapitałowej
- Wymaga: NIP, KRS, REGON
- Reprezentant: Prezes Zarządu, Członek Zarządu, Prokurent
- Osoby decyzyjne: prokurenci, członkowie zarządu

### 3. **sp. jawna** - Spółka jawna
- Spółka osobowa
- Wymaga: NIP, KRS, REGON
- Reprezentanci: wszyscy wspólnicy (chyba że umowa stanowi inaczej)

### 4. **sp. komandytowa** - Spółka komandytowa
- Spółka osobowa z komplementariuszami i komandytariuszami
- Wymaga: NIP, KRS, REGON
- Reprezentanci: komplementariusze

### 5. **sp. komandytowo-akcyjna** - Spółka komandytowo-akcyjna
- Hybryda spółki osobowej i kapitałowej
- Wymaga: NIP, KRS, REGON
- Reprezentanci: komplementariusze

### 6. **S.A.** - Spółka akcyjna
- Największa forma spółki kapitałowej
- Wymaga: NIP, KRS, REGON
- Reprezentanci: Zarząd (Prezes, Wiceprezes, Członek Zarządu)

### 7. **Spółdzielnia**
- Forma organizacyjna oparta na zasadzie samopomocy
- Wymaga: NIP, KRS, REGON
- Reprezentanci: Zarząd spółdzielni

### 8. **Fundacja**
- Organizacja non-profit
- Wymaga: NIP, KRS, REGON
- Reprezentanci: Zarząd fundacji

### 9. **Stowarzyszenie**
- Organizacja społeczna non-profit
- Wymaga: NIP, KRS, REGON
- Reprezentanci: Zarząd stowarzyszenia

### 10. **Inna**
- Inne formy działalności nie wymienione powyżej
- Wymagania: zależne od specyfiki

## Automatyka w systemie

### KRS dla JDG
Gdy wybierzesz formę prawną "JDG":
- Pole KRS zostaje **automatycznie ukryte** w formularzu
- W trybie edycji pole KRS jest **wyłączone (disabled)**
- W wygenerowanych umowach placeholder `{{organization_krs}}` zostanie **całkowicie usunięty**

### Placeholder w umowach
Jeśli wartość jest `null` lub `undefined`:
```
KRS: {{organization_krs}}
```
Zostanie całkowicie usunięte z umowy (nie pojawi się pusta linia).

## Przykłady użycia

### JDG - Jan Kowalski
```
Nazwa: Jan Kowalski - Usługi eventowe
Forma prawna: Jednoosobowa działalność gospodarcza (JDG)
NIP: 1234567890
REGON: 123456789
(brak KRS)

Reprezentant prawny: Jan Kowalski - Właściciel
```

### Spółka z o.o. - EVENT RULERS
```
Nazwa: EVENT RULERS sp. z o.o.
Forma prawna: Spółka z ograniczoną odpowiedzialnością (sp. z o.o.)
NIP: 9876543210
KRS: 0000123456
REGON: 987654321

Reprezentant prawny: Anna Nowak - Prezes Zarządu
Osoby decyzyjne:
- Piotr Wiśniewski - Prokurent (może podpisywać umowy)
- Maria Kowalska - Członek Zarządu
```

## Integracja z umowami

W szablonach umów możesz używać:
```
{{organization_legal_form}}  - wyświetli pełną nazwę formy prawnej
{{organization_krs}}         - automatycznie ukryty dla JDG
{{organization_regon}}       - zawsze dostępny
```

## Walidacja

System automatycznie:
1. Ukrywa pole KRS dla JDG
2. Wyłącza pole KRS dla JDG w trybie edycji
3. Usuwa puste placeholdery z generowanych dokumentów
4. Indeksuje organizacje po formie prawnej dla szybkiego wyszukiwania
