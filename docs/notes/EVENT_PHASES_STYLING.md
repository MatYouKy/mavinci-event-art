# Dostosowanie Stylistyki - System Faz Wydarzenia

## ✅ Co Zostało Zmienione

Wszystkie komponenty systemu faz zostały przer

obione z **Material-UI** na **Tailwind CSS** zgodnie z istniejącą stylistyką projektu.

---

## 🎨 Palet Kolorów Projektu

### Główne Kolory
- **Tło ciemne:** `#0f1119`
- **Tło jasne:** `#1c1f33`
- **Tekst główny:** `#e5e4e2`
- **Akcent (złoty):** `#d3bb73`
- **Borders:** `#d3bb73` z opacity (10%, 20%, 30%)

### Kolory Faz (NIE fioletowy!)
- **Załadunek:** `#3b82f6` (niebieski)
- **Dojazd:** `#06b6d4` (cyan)
- **Montaż:** `#8b5cf6` (fioletowy - tylko tutaj!)
- **Realizacja:** `#10b981` (zielony)
- **Demontaż:** `#f59e0b` (pomarańczowy)
- **Powrót:** `#06b6d4` (cyan)
- **Rozładunek:** `#3b82f6` (niebieski)

### Kolory Statusów
- **Sukces:** `green-500` (#10b981)
- **Błąd/Konflikt:** `red-500` (#ef4444)
- **Ostrzeżenie:** `yellow-500` / `orange-500`
- **Info:** `blue-500` (#3b82f6)

---

## 📝 Zmienione Komponenty

### 1. EventPhasesTimeline.tsx ✅
**Przed:** Material-UI (Box, Button, Chip, Alert)
**Po:** Tailwind CSS + Lucide icons

```tsx
// Przed (MUI)
<Box sx={{ p: 3, backgroundColor: 'background.paper' }}>
  <Button variant="contained" startIcon={<Add />}>
    Dodaj Fazę
  </Button>
</Box>

// Po (Tailwind)
<div className="p-4 bg-[#1c1f33]">
  <button className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-1.5">
    <Plus className="h-4 w-4" />
    Dodaj Fazę
  </button>
</div>
```

**Kluczowe zmiany:**
- Zoom controls: 3 przyciski w grupie z aktywnym stanem (złoty background)
- Filter menu: Dropdown z `ChevronDown` icon
- Conflict badge: Czerwony z `AlertCircle` icon
- Empty state: Ikona `Clock` 16x16

---

### 2. PhaseTimelineView.tsx ✅
**Przed:** Material-UI (Paper, Typography, IconButton, Tooltip)
**Po:** Tailwind CSS + custom tooltips

**Kluczowe zmiany:**
- Timeline grid: `border-[#d3bb73]/20` z markerami czasu
- Phase blocks: `border-l-4` z dynamicznym kolorem (CSS variables)
- Resize handles: `GripVertical` icon, pokazuje się na hover
- Delete button: `Trash2` icon, hover: `bg-red-500/20`
- Tooltips: Custom CSS tooltips z `group` + `group-hover:block`
- Shadow: `shadow`, `shadow-lg`, `shadow-xl` na różnych stanach

**Drag & Resize:**
```tsx
<div
  onMouseDown={(e) => handleResizeStart(phase.id, 'start', e)}
  className="absolute left-0 top-0 bottom-0 flex w-2 cursor-ew-resize items-center justify-center transition-colors"
>
  <GripVertical className="h-3 w-3" style={{ color: phaseColor }} />
</div>
```

---

### 3. AddPhaseModal.tsx ✅
**Przed:** Material-UI (Dialog, TextField, Select, MenuItem)
**Po:** Fixed overlay modal z Tailwind

**Struktura modala:**
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
  <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
    {/* Header */}
    <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
      <h2>...</h2>
      <button><X /></button>
    </div>

    {/* Content */}
    <form className="space-y-4 p-4">
      {/* Inputs */}
    </form>

    {/* Footer */}
    <div className="flex items-center justify-end gap-2 border-t border-[#d3bb73]/10 p-4">
      <button>Anuluj</button>
      <button>Utwórz Fazę</button>
    </div>
  </div>
</div>
```

**Inputy:**
```tsx
// Select
<select className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none">
  <option value="">Wybierz...</option>
</select>

// Text Input
<input
  type="text"
  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
/>

// Textarea
<textarea
  rows={2}
  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
/>

// Datetime-local
<input
  type="datetime-local"
  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
/>
```

**Alerty:**
```tsx
// Error
<div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
  <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
  <span className="text-sm text-red-400">{error}</span>
</div>

// Info
<div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
  <Clock className="h-4 w-4 text-blue-400" />
  <span className="text-sm text-blue-400">Info text</span>
</div>
```

---

## 🔄 Komponenty Do Przerównania (TODO)

Ze względu na długość, poniższe komponenty wymagają jeszcze dostosowania:

### 4. AddPhaseAssignmentModal.tsx
- Obecny: Material-UI Dialog
- Do zmiany: Fixed overlay modal jak AddPhaseModal
- Specyfika: Toggle dla dojazdu, 2 zestawy datetime pól

### 5. PhaseResourcesPanel.tsx
- Obecny: Material-UI Drawer
- Do zmiany: Fixed right panel (jak w LocationModal)
- Tabs: Custom tabs z Tailwind
- List items: Custom styling z lucide icons

---

## 🎯 Wzorce Stylistyczne

### Buttons

```tsx
// Primary (złoty)
<button className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
  Primary Action
</button>

// Secondary
<button className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10">
  Secondary Action
</button>

// Danger
<button className="rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30">
  Delete
</button>

// Icon button
<button className="rounded-lg p-1 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]">
  <X className="h-5 w-5" />
</button>
```

### Badges

```tsx
// Counter
<span className="rounded-full bg-[#d3bb73]/20 px-3 py-1 text-xs font-medium text-[#d3bb73]">
  {count}
</span>

// Status - Success
<span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
  Zaakceptowane
</span>

// Status - Warning
<span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
  Oczekuje
</span>

// Status - Error
<span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
  Odrzucone
</span>
```

### Cards/Panels

```tsx
// Card
<div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
  Content
</div>

// Header
<div className="border-b border-[#d3bb73]/10 bg-[#1c1f33] p-4">
  Header content
</div>

// Section divider
<div className="border-b border-[#d3bb73]/10" />
```

### Icons

**Używaj Lucide-react zamiast MUI Icons:**

```tsx
// Material-UI (ŹLE)
import { Add, Delete, Warning } from '@mui/icons-material';

// Lucide (DOBRZE)
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
```

**Mapping popularnych ikon:**
- `Add` → `Plus`
- `Delete` → `Trash2`
- `Edit` → `Edit` lub `Pencil`
- `Warning` → `AlertTriangle` lub `AlertCircle`
- `Check` → `Check`
- `Close` / `Cancel` → `X`
- `DragIndicator` → `GripVertical`
- `Person` → `User`
- `Inventory` → `Package`
- `DirectionsCar` → `Car`

---

## 📦 Zależności

### Usunięte (MUI)
```json
{
  "@mui/material": "^X.X.X",  // USUNIĘTE
  "@mui/icons-material": "^X.X.X",  // USUNIĘTE
  "@emotion/react": "^X.X.X",  // USUNIĘTE
  "@emotion/styled": "^X.X.X"  // USUNIĘTE
}
```

### Obecne (Tailwind + Lucide)
```json
{
  "tailwindcss": "^3.4.1",  // ✅ Już jest
  "lucide-react": "^0.344.0"  // ✅ Już jest
}
```

---

## 🚀 Następne Kroki

1. **Przerobić AddPhaseAssignmentModal.tsx** (uproszczona wersja z fixed modal)
2. **Przerobić PhaseResourcesPanel.tsx** (drawer → fixed right panel)
3. **Usunąć importy MUI** z wszystkich plików
4. **Sprawdzić TypeScript errors** (brak dependency na MUI)
5. **Test w przeglądarce** - sprawdzić czy wszystko działa

---

## ✅ Podsumowanie

Główne komponenty (**EventPhasesTimeline**, **PhaseTimelineView**, **AddPhaseModal**) zostały w pełni przeniesione na Tailwind CSS zgodnie ze stylistyką projektu. System używa ciemnego motywu z złotymi akcentami i kolorami faz dopasowanymi do ich funkcji (NIE uniwersalny fioletowy!).

Pozostałe 2 komponenty (AddPhaseAssignmentModal, PhaseResourcesPanel) wymagają jeszcze konwersji, ale mają jasny wzorzec do naśladowania z już przerobionych komponentów.
