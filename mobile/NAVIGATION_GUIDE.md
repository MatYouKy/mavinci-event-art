# Przewodnik po Nawigacji - Mavinci CRM Mobile

## Struktura Nawigacji

Aplikacja mobilna Mavinci CRM używa kombinacji trzech typów nawigacji:

### 1. **Drawer Navigation** (Menu Hamburgerowe)
- Główne menu boczne otwierane przyciskiem hamburgerowym (☰)
- Zawiera informacje o użytkowniku oraz główne sekcje aplikacji
- Lokalizacja: `/mobile/src/navigation/DrawerNavigator.tsx`

### 2. **Bottom Tab Navigation** (Dolny Pasek Zakładek)
- Szybki dostęp do 5 głównych ekranów:
  - Dashboard (🏠)
  - Kalendarz (📅)
  - Zadania (✓)
  - Klienci (👥)
  - Ustawienia (⚙️)
- Lokalizacja: `/mobile/src/navigation/MainTabNavigator.tsx`

### 3. **Stack Navigation** (Nawigacja Stosowa)
- Zarządza przełączaniem między ekranem logowania a główną aplikacją
- Lokalizacja: `/mobile/src/navigation/RootNavigator.tsx`

## Komponenty Nawigacyjne

### DrawerNavigator
```tsx
DrawerNavigator
├── Custom Drawer Content
│   ├── User Info Section (Avatar, Name, Email, Role)
│   ├── Menu Items (Dashboard, Kalendarz, Zadania, Klienci, Ustawienia)
│   └── Footer (Wyloguj, Wersja)
└── MainTabNavigator
```

### Funkcje Menu Hamburgerowego
- **User Profile Header**: Wyświetla avatar, imię, email i rolę pracownika
- **Navigation Items**: Pozwala przejść do dowolnej sekcji aplikacji
- **Logout Button**: Bezpieczne wylogowanie z potwierdzeniem

## Instalacja Dodatkowych Pakietów

Aplikacja mobilna wymaga następujących pakietów nawigacyjnych:

```bash
npm install @react-navigation/drawer
npm install react-native-gesture-handler
npm install react-native-reanimated
```

## Konfiguracja

### babel.config.js
```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      'react-native-reanimated/plugin', // Musi być ostatni!
    ],
  };
};
```

### App.tsx
```typescript
import 'react-native-gesture-handler'; // Musi być pierwsza linia!
```

## Uruchomienie Aplikacji

Po instalacji nowych pakietów:

```bash
cd mobile
rm -rf node_modules package-lock.json .expo
npm install
npx expo start --clear
```

## Customizacja Nawigacji

### Zmiana Kolorów
Edytuj plik `/mobile/src/theme/colors.ts`:
```typescript
export const colors = {
  primary: {
    gold: '#D4AF37',
    // ...
  },
  // ...
};
```

### Dodawanie Nowych Ekranów do Drawer
W pliku `DrawerNavigator.tsx`, dodaj nowy element do `menuItems`:
```typescript
const menuItems = [
  // ... istniejące elementy
  {
    icon: 'briefcase',
    label: 'Nowy Ekran',
    onPress: () => props.navigation.navigate('NewScreen'),
  },
];
```

### Dodawanie Nowych Tabów
W pliku `MainTabNavigator.tsx`, dodaj nowy `Tab.Screen`:
```typescript
<Tab.Screen
  name="NewTab"
  component={NewTabScreen}
  options={{
    title: 'Nowy Tab',
    tabBarIcon: ({ color, size }) => (
      <Feather name="icon-name" color={color} size={size} />
    ),
  }}
/>
```

## Ikony

Aplikacja używa **Feather Icons** z pakietu `@expo/vector-icons`.

Dostępne ikony: https://feathericons.com/

Przykład użycia:
```typescript
import { Feather } from '@expo/vector-icons';

<Feather name="menu" color={colors.text.primary} size={24} />
```

## Troubleshooting

### Problem: Drawer się nie otwiera
**Rozwiązanie**: Upewnij się, że `react-native-gesture-handler` jest zaimportowany jako pierwsza linia w `App.tsx`

### Problem: Animacje nie działają
**Rozwiązanie**: Dodaj `react-native-reanimated/plugin` jako ostatni plugin w `babel.config.js` i uruchom `npx expo start --clear`

### Problem: TypeScript błędy nawigacji
**Rozwiązanie**: Upewnij się, że wszystkie typy nawigacji są poprawnie zdefiniowane:
```typescript
export type DrawerParamList = {
  MainTabs: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Calendar: undefined;
  // ...
};
```
