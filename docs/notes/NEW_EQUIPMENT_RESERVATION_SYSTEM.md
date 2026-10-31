# Nowy System Rezerwacji Sprzętu - Dokumentacja

## 🎯 Cel Systemu

Elastyczny system rezerwacji sprzętu, który:
- ✅ NIE blokuje sprzętu przy tworzeniu oferty draft/sent
- ✅ Pozwala na tworzenie wielu ofert dla jednego eventu bez konfliktów
- ✅ Rezerwuje sprzęt TYLKO przy zmianie statusu na 'accepted'
- ✅ Wspiera rental zewnętrzny dla brakującego sprzętu
- ✅ Blokuje status 'ready_for_execution' gdy są nierozwiązane braki
- ✅ Pokazuje żółty ⚠️ w UI dla eventów z brakami

---

## 📊 Struktura Danych

### Nowe Tabele

#### `offer_equipment_conflicts`
Przechowuje konflikty sprzętowe wykryte dla każdej oferty.

```sql
CREATE TABLE offer_equipment_conflicts (
  id uuid PRIMARY KEY,
  offer_id uuid REFERENCES offers(id),

  -- Sprzęt
  equipment_item_id uuid REFERENCES equipment_items(id),
  equipment_kit_id uuid REFERENCES equipment_kits(id),

  -- Ilości
  required_qty integer,
  available_qty integer,
  shortage_qty integer,

  -- Status
  status conflict_status, -- 'unresolved', 'substituted', 'external_rental', 'resolved'
  use_external_rental boolean,

  -- Detale
  conflict_details jsonb,
  conflict_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid,
  notes text
);
```

### Nowe Pola

#### `events.pending_external_rental`
```sql
ALTER TABLE events ADD COLUMN pending_external_rental boolean DEFAULT false;
```
- `true` = event ma nierozwiązane braki sprzętowe oznaczone jako rental zewnętrzny
- Automatycznie aktualizowane przez trigger
- Blokuje zmianę statusu na 'ready_for_execution'

#### `event_equipment.reservation_status`
```sql
ALTER TABLE event_equipment ADD COLUMN reservation_status equipment_reservation_status;
```

Możliwe wartości:
- `'planned'` - planowany (oferta draft/sent)
- `'reserved_pending'` - wstępnie zarezerwowany (oferta accepted)
- `'reserved_confirmed'` - potwierdzona rezerwacja (po podpisaniu umowy)
- `'in_use'` - w użyciu (podczas eventu)
- `'returned'` - zwrócony

---

## 🔄 Flow Rezerwacji

### 1. Tworzenie Oferty (Draft)

**Stary system:**
```
Utworzenie oferty → Sprzęt natychmiast dodany do event_equipment
```

**Nowy system:**
```
Utworzenie oferty → Sprawdzenie konfliktów → Zapisanie do offer_equipment_conflicts
                  → Sprzęt NIE jest dodawany do event_equipment
```

**Kod:**
```typescript
// 1. Sprawdź konflikty
const conflicts = await supabase.rpc('check_offer_cart_equipment_conflicts_v2', {
  p_event_id: eventId,
  p_items: products,
  p_substitutions: []
});

// 2. Utwórz ofertę
const { data: offer } = await supabase
  .from('offers')
  .insert({ event_id: eventId, status: 'draft', ... })
  .select()
  .single();

// 3. Zapisz konflikty (jeśli są)
if (conflicts.length > 0) {
  await supabase.rpc('save_offer_conflicts', {
    p_offer_id: offer.id,
    p_conflicts: conflicts
  });
}
```

### 2. Zmiana Statusu na 'Accepted' - Akcja "Zablokuj Sprzęt"

**Nowy flow:**
```
Użytkownik klika "Zablokuj sprzęt"
  ↓
Modal pokazuje listę sprzętu z oferty + aktualna dostępność
  ↓
Użytkownik przegląda co zostanie zarezerwowane
  ↓
Klik "Potwierdź rezerwację"
  ↓
Status zmienia się na 'accepted'
  ↓
Trigger automatycznie rezerwuje sprzęt (reservation_status = 'reserved_pending')
```

**Kod dla modalu:**
```typescript
// 1. Pobierz listę sprzętu do rezerwacji
const { data: equipment } = await supabase.rpc('get_offer_equipment_for_reservation', {
  p_offer_id: offerId
});

// equipment zawiera:
// [
//   {
//     item_type: 'item',
//     item_id: uuid,
//     item_name: 'Mikser Yamaha MG16',
//     required_qty: 2,
//     total_qty: 5,
//     reserved_qty: 2,
//     available_qty: 3,
//     has_conflict: false,
//     shortage_qty: 0
//   },
//   ...
// ]

// 2. Pokaż modal z listą

// 3. Po potwierdzeniu
const { data: result } = await supabase.rpc('confirm_equipment_reservation', {
  p_offer_id: offerId
});

if (result.success) {
  // Sukces - sprzęt zarezerwowany
  showNotification('Sprzęt został zarezerwowany');
} else {
  // Błąd - nierozwiązane konflikty
  showError(result.error);
}
```

### 3. Rozwiązywanie Konfliktów

**Zakładka "Konflikty" w ofercie:**
```typescript
// Pobierz konflikty dla oferty
const { data: conflicts } = await supabase
  .from('offer_equipment_conflicts')
  .select(`
    *,
    equipment_item:equipment_items(name),
    equipment_kit:equipment_kits(name)
  `)
  .eq('offer_id', offerId)
  .eq('status', 'unresolved');

// Opcja 1: Substytucja
await supabase.rpc('resolve_conflict_with_substitution', {
  p_conflict_id: conflictId,
  p_substitute_item_id: alternativeItemId
});

// Opcja 2: Rental zewnętrzny
await supabase.rpc('resolve_conflict_with_external_rental', {
  p_conflict_id: conflictId,
  p_notes: 'Wynajmiemy od XYZ Rental'
});
```

### 4. Walidacja Statusu Event

```typescript
// Przed zmianą statusu na 'ready_for_execution'
const { data: validation } = await supabase.rpc('can_event_be_ready_for_execution', {
  p_event_id: eventId
});

if (!validation.can_proceed) {
  showError(validation.message);
  // Pokaż szczegóły konfliktów: validation.conflicts
} else {
  // Można zmienić status
  await supabase
    .from('events')
    .update({ status: 'ready_for_execution' })
    .eq('id', eventId);
}
```

---

## 🎨 Zmiany UI

### 1. Lista Eventów - Żółty Warning

**Komponent:** EventsList
```typescript
function EventRow({ event }) {
  const showWarning = event.pending_external_rental || event.has_equipment_shortage;

  return (
    <TableRow>
      <TableCell>
        {showWarning && (
          <Tooltip title="Wymaga rentalu zewnętrznego lub ma nierozwiązane konflikty">
            <WarningIcon sx={{ color: 'warning.main', mr: 1 }} />
          </Tooltip>
        )}
        {event.name}
      </TableCell>
      {/* ... */}
    </TableRow>
  );
}
```

### 2. Modal "Zablokuj Sprzęt" przy Zmianie Statusu

**Nowy komponent:** `LockEquipmentModal.tsx`

```typescript
interface LockEquipmentModalProps {
  offerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function LockEquipmentModal({ offerId, open, onClose, onSuccess }: LockEquipmentModalProps) {
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadEquipment();
    }
  }, [open]);

  const loadEquipment = async () => {
    const { data } = await supabase.rpc('get_offer_equipment_for_reservation', {
      p_offer_id: offerId
    });
    setEquipment(data || []);
  };

  const handleConfirm = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('confirm_equipment_reservation', {
      p_offer_id: offerId
    });

    if (data.success) {
      onSuccess();
      onClose();
    } else {
      alert(data.error);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Zablokuj Sprzęt - Rezerwacja</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Poniższy sprzęt zostanie wstępnie zarezerwowany dla tego eventu.
        </Typography>

        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Sprzęt</TableCell>
              <TableCell align="right">Wymagane</TableCell>
              <TableCell align="right">Dostępne</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {equipment.map((item) => (
              <TableRow key={item.item_id}>
                <TableCell>{item.item_name}</TableCell>
                <TableCell align="right">{item.required_qty}</TableCell>
                <TableCell align="right">
                  {item.available_qty} / {item.total_qty}
                </TableCell>
                <TableCell>
                  {item.has_conflict ? (
                    <Chip
                      label={`Brak ${item.shortage_qty}`}
                      color="error"
                      size="small"
                    />
                  ) : (
                    <Chip label="OK" color="success" size="small" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {equipment.some(e => e.has_conflict) && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Niektóre elementy są niedostępne. Rozwiąż konflikty w zakładce "Konflikty"
            lub oznacz jako rental zewnętrzny.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Anuluj</Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={loading || equipment.some(e => e.has_conflict)}
        >
          {loading ? 'Rezerwuję...' : 'Potwierdź Rezerwację'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

### 3. Zakładka "Konflikty" w Ofercie

**Nowy komponent:** `OfferConflictsTab.tsx`

```typescript
function OfferConflictsTab({ offerId }) {
  const { data: conflicts } = useQuery(['offer-conflicts', offerId], async () => {
    const { data } = await supabase
      .from('offer_equipment_conflicts')
      .select(`
        *,
        equipment_item:equipment_items(name, thumbnail),
        equipment_kit:equipment_kits(name)
      `)
      .eq('offer_id', offerId)
      .order('status', { ascending: true });
    return data;
  });

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('offer-conflicts')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'offer_equipment_conflicts',
        filter: `offer_id=eq.${offerId}`
      }, () => {
        queryClient.invalidateQueries(['offer-conflicts', offerId]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [offerId]);

  return (
    <Box>
      {conflicts?.length === 0 && (
        <Alert severity="success">
          Brak konfliktów - cały sprzęt jest dostępny!
        </Alert>
      )}

      {conflicts?.map(conflict => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          onResolve={() => queryClient.invalidateQueries(['offer-conflicts', offerId])}
        />
      ))}
    </Box>
  );
}

function ConflictCard({ conflict, onResolve }) {
  const itemName = conflict.equipment_item?.name || conflict.equipment_kit?.name;

  const handleSubstitute = async (alternativeId) => {
    await supabase.rpc('resolve_conflict_with_substitution', {
      p_conflict_id: conflict.id,
      p_substitute_item_id: alternativeId
    });
    onResolve();
  };

  const handleExternalRental = async () => {
    await supabase.rpc('resolve_conflict_with_external_rental', {
      p_conflict_id: conflict.id
    });
    onResolve();
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">{itemName}</Typography>
        <Typography color="text.secondary">
          Wymagane: {conflict.required_qty} | Dostępne: {conflict.available_qty} |
          Brakuje: {conflict.shortage_qty}
        </Typography>

        {conflict.status === 'unresolved' && (
          <Box sx={{ mt: 2 }}>
            <Button
              onClick={() => setShowAlternatives(true)}
              startIcon={<SwapHorizIcon />}
            >
              Zamień na alternatywę
            </Button>
            <Button
              onClick={handleExternalRental}
              startIcon={<ShoppingCartIcon />}
              color="warning"
            >
              Rental Zewnętrzny
            </Button>
          </Box>
        )}

        {conflict.status === 'external_rental' && (
          <Chip label="Rental Zewnętrzny" color="warning" />
        )}

        {conflict.status === 'substituted' && (
          <Chip label="Zamieniono" color="success" />
        )}
      </CardContent>
    </Card>
  );
}
```

### 4. Przycisk "Zablokuj Sprzęt" przy Zmianie Statusu

**W komponencie:** `OfferActions.tsx`

```typescript
function OfferActions({ offer }) {
  const [showLockModal, setShowLockModal] = useState(false);

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === 'accepted' && offer.status !== 'accepted') {
      // Pokaż modal "Zablokuj sprzęt"
      setShowLockModal(true);
    } else {
      // Bezpośrednia zmiana statusu
      updateOfferStatus(newStatus);
    }
  };

  return (
    <>
      <Select value={offer.status} onChange={(e) => handleStatusChange(e.target.value)}>
        <MenuItem value="draft">Szkic</MenuItem>
        <MenuItem value="sent">Wysłana</MenuItem>
        <MenuItem value="accepted">Zaakceptowana</MenuItem>
        <MenuItem value="rejected">Odrzucona</MenuItem>
      </Select>

      <LockEquipmentModal
        offerId={offer.id}
        open={showLockModal}
        onClose={() => setShowLockModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries(['offers']);
          showNotification('Sprzęt został zarezerwowany');
        }}
      />
    </>
  );
}
```

---

## 🔒 Bezpieczeństwo

### RLS Policies

Wszystkie nowe tabele mają RLS:
- `offer_equipment_conflicts` - dostęp dla użytkowników z `offers_view` / `offers_manage`
- Wszystkie funkcje RPC działają w kontekście `SECURITY DEFINER`
- Walidacja uprawnień wewnątrz funkcji

### Triggery

1. **`trigger_update_event_external_rental`** - automatycznie aktualizuje `events.pending_external_rental`
2. **`trigger_handle_offer_status_change`** - rezerwuje/zwalnia sprzęt przy zmianie statusu
3. **`trigger_validate_event_status`** - blokuje nieprawidłową zmianę statusu eventu

---

## 📝 Migracja Istniejących Danych

### Krok 1: Analiza

```sql
-- Sprawdź oferty ze statusem 'draft' lub 'sent' które mają sprzęt w event_equipment
SELECT
  o.id,
  o.offer_number,
  o.status,
  e.name as event_name,
  COUNT(ee.id) as equipment_count
FROM offers o
JOIN events e ON e.id = o.event_id
JOIN event_equipment ee ON ee.offer_id = o.id
WHERE o.status IN ('draft', 'sent')
GROUP BY o.id, o.offer_number, o.status, e.name;
```

### Krok 2: Czyszczenie

```sql
-- Usuń sprzęt z ofert draft/sent (będzie dodany przy zmianie na accepted)
DELETE FROM event_equipment
WHERE offer_id IN (
  SELECT id FROM offers WHERE status IN ('draft', 'sent')
);
```

### Krok 3: Ustawienie Statusów Rezerwacji

```sql
-- Ustaw właściwe statusy dla istniejącego sprzętu
UPDATE event_equipment ee
SET reservation_status = CASE
  WHEN o.status = 'accepted' THEN 'reserved_pending'::equipment_reservation_status
  ELSE 'planned'::equipment_reservation_status
END
FROM offers o
WHERE ee.offer_id = o.id;
```

---

## 🧪 Testowanie

### Scenariusz 1: Tworzenie Wielu Ofert

1. Utwórz event na 2026-04-10
2. Dodaj ofertę A (draft) z 5x Mikser
3. Dodaj ofertę B (draft) z 5x Mikser
4. Dodaj ofertę C (draft) z 5x Mikser
5. **Oczekiwany rezultat:** Wszystkie oferty utworzone, sprzęt NIE zarezerwowany
6. Zmień ofertę A na 'accepted' → sprzęt zarezerwowany (5x)
7. Zmień ofertę B na 'accepted' → błąd "brak dostępnego sprzętu"
8. Rozwiąż konflikty w ofercie B (substytucja lub rental)
9. Ponownie zmień na 'accepted' → sukces

### Scenariusz 2: Rental Zewnętrzny

1. Utwórz ofertę z 10x Mikser (dostępne: 5)
2. Konflikty zapisane, oferta utworzona
3. Otwórz zakładkę "Konflikty"
4. Oznacz brakujące 5x jako "Rental Zewnętrzny"
5. Zmień status na 'accepted' → sukces, sprzęt zarezerwowany
6. **Oczekiwany rezultat:** `events.pending_external_rental = true`
7. Próba zmiany statusu eventu na 'ready_for_execution' → błąd
8. Potwierdź rental zewnętrzny (zmień status konfliktu)
9. Flaga `pending_external_rental` się wyczyści
10. Zmiana statusu na 'ready_for_execution' → sukces

### Scenariusz 3: Dynamiczne Odświeżanie

1. Użytkownik A otwiera zakładkę "Konflikty" w ofercie
2. Użytkownik B zwalnia sprzęt (odrzuca inną ofertę)
3. **Oczekiwany rezultat:** Zakładka "Konflikty" użytkownika A automatycznie odświeża się (realtime)
4. Konflikty znikają lub dostępność się zwiększa

---

## 🚀 Wdrożenie

### Etap 1: Backend (✅ ZROBIONE)
- ✅ Tabela `offer_equipment_conflicts`
- ✅ Pola `pending_external_rental` i `reservation_status`
- ✅ Funkcje RPC
- ✅ Triggery
- ✅ Walidacje

### Etap 2: Frontend (DO ZROBIENIA)
- ⏳ Komponent `LockEquipmentModal`
- ⏳ Komponent `OfferConflictsTab`
- ⏳ Żółty warning w liście eventów
- ⏳ Integracja z `OfferActions`

### Etap 3: Migracja Danych (DO ZROBIENIA)
- ⏳ Analiza istniejących ofert
- ⏳ Czyszczenie sprzętu z draft/sent
- ⏳ Ustawienie statusów rezerwacji

### Etap 4: Testy (DO ZROBIENIA)
- ⏳ Testy scenariuszy
- ⏳ Testy realtime updates
- ⏳ Testy walidacji

---

## 📞 Wsparcie

Jeśli masz pytania lub problemy z nowym systemem:
1. Sprawdź logi w Supabase Dashboard
2. Sprawdź czy triggery są aktywne
3. Sprawdź RLS policies
4. Sprawdź realtime subscription

Główne funkcje do debugowania:
- `get_offer_equipment_for_reservation(offer_id)` - sprawdź dostępność
- `can_event_be_ready_for_execution(event_id)` - sprawdź walidację
- `save_offer_conflicts(offer_id, conflicts)` - zapisz konflikty ręcznie
