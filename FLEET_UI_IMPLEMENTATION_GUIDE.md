# Przewodnik implementacji UI dla systemu zarządzania flotą

## ✅ Co zostało zrobione

1. **VehicleAlertsWidget** - `/src/components/crm/VehicleAlertsWidget.tsx`
   - Wyświetla aktywne alerty pojazdu
   - Rozwijana lista z priorytetami i ikonami
   - Oznaczenie alertów blokujących

2. **Migracja bazy danych** - `supabase/migrations/20251021200000_reorganize_vehicle_maintenance_system.sql`
   - Gotowa do zastosowania
   - Instrukcja w `APPLY_FLEET_MIGRATION.md`

3. **Dokumentacja** - `FLEET_SYSTEM_REORGANIZATION.md`
   - Kompletny opis systemu
   - Przykłady użycia

## 🔨 Co trzeba jeszcze zrobić

### 1. Panel Ubezpieczeń (InsurancePoliciesPanel.tsx)

```typescript
'use client';

interface InsurancePolicy {
  id: string;
  type: 'oc' | 'ac' | 'nnw' | 'assistance' | 'other';
  insurance_company: string;
  policy_number: string;
  start_date: string;
  end_date: string;
  premium_amount: number;
  is_mandatory: boolean;
  blocks_usage: boolean;
  detailed_coverage: {
    theft?: boolean;
    fire?: boolean;
    vandalism?: boolean;
    glass?: boolean;
    natural_disasters?: boolean;
    collision?: {
      own_fault?: boolean;
      others_fault?: boolean;
    };
    assistance?: {
      towing?: boolean;
      replacement_vehicle?: boolean;
    };
  };
  status: 'active' | 'expired';
}

// Komponenty:
// - Lista ubezpieczeń z statusem (aktywne/wygasłe)
// - Przycisk "Dodaj ubezpieczenie"
// - Modal z formularzem (typ, firma, polisa, daty, kwota, zakres)
// - Dla AC: checkboxy z szczegółowym zakresem
// - Edycja istniejących ubezpieczeń
// - Oznaczenie OC jako obowiązkowe (badge)
```

**Struktura panelu:**

- Header: "Ubezpieczenia" + liczba aktywnych + przycisk "Dodaj"
- Lista ubezpieczeń (grupowanie: OC, AC, inne)
- Dla każdego: typ, firma, ważność, status, kwota
- Ikona 🔒 przy obowiązkowych
- Dla AC: rozwijany zakres ochrony
- Akcje: Edytuj, Archiwizuj

### 2. Panel Przeglądów Okresowych (PeriodicInspectionsPanel.tsx)

```typescript
interface PeriodicInspection {
  id: string;
  inspection_type: 'technical' | 'emissions';
  inspection_date: string;
  valid_until: string;
  next_inspection_due: string;
  inspection_station: string;
  inspector_name?: string;
  certificate_number?: string;
  odometer_reading?: number;
  result: 'passed' | 'failed' | 'conditional';
  issues_found?: string[];
  cost: number;
  is_current: boolean;
}

// Komponenty:
// - Lista przeglądów (chronologicznie, najnowszy na górze)
// - Oznaczenie aktualnego przeglądu (badge "Aktualny")
// - Przycisk "Dodaj przegląd"
// - Modal z formularzem (typ, data, ważność do, stacja, wynik, koszt)
// - Timeline przeglądów
// - Status: ważny / wygasa za X dni / przeterminowany
```

**Struktura panelu:**

- Header: "Przeglądy okresowe" + status aktualnego + przycisk "Dodaj"
- Aktualny przegląd (duża karta na górze):
  - Typ: Przegląd techniczny
  - Ważny do: DD.MM.YYYY (za X dni)
  - Następny przegląd: DD.MM.YYYY
  - Stacja diagnostyczna
- Historia przeglądów (timeline)
- Dla każdego: data, wynik, przebieg, koszt

### 3. Panel Serwisu i Napraw (MaintenanceRepairsPanel.tsx)

```typescript
interface MaintenanceRepair {
  id: string;
  repair_type:
    | 'service'
    | 'repair'
    | 'tire_change'
    | 'oil_change'
    | 'brake_service'
    | 'battery_replacement'
    | 'other';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description?: string;
  reported_date: string;
  started_date?: string;
  completed_date?: string;
  estimated_completion_date?: string;
  odometer_reading: number;
  service_provider?: string;
  labor_cost: number;
  parts_cost: number;
  other_cost: number;
  total_cost: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  blocks_availability: boolean;
  assigned_to?: {
    name: string;
    surname: string;
  };
}

// Komponenty:
// - Filtry: Wszystkie / Aktywne / Zakończone
// - Lista napraw z kolorami według severity
// - Przycisk "Zgłoś naprawę"
// - Modal z formularzem (typ, severity, opis, przebieg, warsztat, koszty)
// - Ikona 🔒 przy blokujących
// - Status timeline (zaplanowana → w trakcie → zakończona)
// - Edycja i zmiana statusu
```

**Struktura panelu:**

- Header: "Serwis i naprawy" + filtry + przycisk "Zgłoś"
- Aktywne naprawy (na górze, czerwone jeśli blokujące)
- Lista napraw:
  - Typ i tytuł
  - Severity (kolorowy badge: low=niebieski, medium=żółty, high=czerwony)
  - Status (zaplanowana/w trakcie/zakończona)
  - Ikona 🔒 jeśli blocks_availability
  - Przebieg, data, koszt
  - Warsztat/serwis
- Podsumowanie kosztów

### 4. Zakładki w /crm/fleet/[id]/page.tsx

Dodaj system zakładek do strony szczegółów pojazdu:

```typescript
const [activeTab, setActiveTab] = useState<'overview' | 'insurance' | 'fuel' | 'maintenance'>('overview');

const tabs = [
  { id: 'overview', label: 'Przegląd', icon: Car },
  { id: 'insurance', label: 'Ubezpieczenia/Przeglądy', icon: Shield },
  { id: 'fuel', label: 'Tankowania', icon: Fuel },
  { id: 'maintenance', label: 'Serwis/Naprawy', icon: Wrench },
];

// Renderowanie:
<div className="flex gap-2 border-b border-[#e5e4e2]/20 mb-6">
  {tabs.map(tab => (
    <button
      key={tab.id}
      onClick={() => setActiveTab(tab.id)}
      className={`flex items-center gap-2 px-4 py-3 ${
        activeTab === tab.id
          ? 'border-b-2 border-[#d3bb73] text-[#d3bb73]'
          : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
      }`}
    >
      <tab.icon className="w-5 h-5" />
      {tab.label}
    </button>
  ))}
</div>

{activeTab === 'overview' && (
  <div>
    <VehicleAlertsWidget vehicleId={vehicleId} />
    {/* Obecna zawartość strony */}
  </div>
)}

{activeTab === 'insurance' && (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <InsurancePoliciesPanel vehicleId={vehicleId} />
    <PeriodicInspectionsPanel vehicleId={vehicleId} />
  </div>
)}

{activeTab === 'maintenance' && (
  <MaintenanceRepairsPanel vehicleId={vehicleId} />
)}
```

### 5. Aktualizacja listy pojazdów (/crm/fleet/page.tsx)

Dodaj kolumnę z alertami:

```typescript
// W tabeli, przed kolumną "Akcje":
<td className="px-6 py-4">
  <VehicleAlertsCount vehicleId={vehicle.id} />
</td>

// Komponent VehicleAlertsCount:
const VehicleAlertsCount = ({ vehicleId }: { vehicleId: string }) => {
  const [alertsCount, setAlertsCount] = useState(0);
  const [blockingCount, setBlockingCount] = useState(0);

  useEffect(() => {
    // Pobierz liczbę alertów z API
    // const { data } = await supabase
    //   .from('vehicle_alerts')
    //   .select('id, is_blocking')
    //   .eq('vehicle_id', vehicleId)
    //   .eq('is_active', true);
  }, [vehicleId]);

  if (alertsCount === 0) return <span className="text-[#e5e4e2]/40">Brak</span>;

  return (
    <div className="flex items-center gap-2">
      <span className={`px-2 py-1 rounded text-xs ${
        blockingCount > 0
          ? 'bg-red-500/20 text-red-400'
          : 'bg-yellow-500/20 text-yellow-400'
      }`}>
        {alertsCount} {alertsCount === 1 ? 'alert' : 'alertów'}
      </span>
      {blockingCount > 0 && (
        <span className="text-red-400">🔒</span>
      )}
    </div>
  );
};
```

### 6. Funkcja Cron dla automatycznego generowania alertów

Utwórz Supabase Edge Function lub cron job:

```typescript
// supabase/functions/generate-vehicle-alerts/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Wywołaj funkcję generowania alertów
  await supabaseClient.rpc('generate_vehicle_alerts');
  await supabaseClient.rpc('update_vehicle_status_from_alerts');

  return new Response(JSON.stringify({ success: true, message: 'Alerty wygenerowane' }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

Następnie ustaw cron w `supabase/functions/generate-vehicle-alerts/cron.yml`:

```yaml
- schedule: '0 6 * * *' # Codziennie o 6:00
  function: generate-vehicle-alerts
```

## Integracja z Supabase

W każdym komponencie zamień przykładowe dane na prawdziwe zapytania:

```typescript
import { supabase } from '@/lib/supabase';

// Pobieranie alertów
const { data: alerts, error } = await supabase
  .from('vehicle_alerts')
  .select('*')
  .eq('vehicle_id', vehicleId)
  .eq('is_active', true)
  .order('priority', { ascending: false });

// Pobieranie ubezpieczeń
const { data: insurances } = await supabase
  .from('insurance_policies')
  .select('*')
  .eq('vehicle_id', vehicleId)
  .order('end_date', { ascending: false });

// Pobieranie przeglądów
const { data: inspections } = await supabase
  .from('periodic_inspections')
  .select('*')
  .eq('vehicle_id', vehicleId)
  .order('inspection_date', { ascending: false });

// Pobieranie napraw
const { data: repairs } = await supabase
  .from('maintenance_repairs')
  .select(
    `
    *,
    assigned_to:employees(name, surname)
  `,
  )
  .eq('vehicle_id', vehicleId)
  .order('reported_date', { ascending: false });
```

## Realtime Updates

Dodaj subskrypcje Realtime dla automatycznego odświeżania:

```typescript
useEffect(() => {
  const channel = supabase
    .channel('vehicle_alerts')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'vehicle_alerts',
        filter: `vehicle_id=eq.${vehicleId}`,
      },
      () => {
        fetchAlerts();
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [vehicleId]);
```

## Kolejność implementacji (zalecana)

1. ✅ Zastosuj migrację (instrukcja w APPLY_FLEET_MIGRATION.md)
2. ✅ Dodaj testowe dane przez SQL (przykłady w instrukcji)
3. ✅ Podłącz VehicleAlertsWidget do Supabase
4. ⏳ Stwórz InsurancePoliciesPanel
5. ⏳ Stwórz PeriodicInspectionsPanel
6. ⏳ Stwórz MaintenanceRepairsPanel
7. ⏳ Dodaj zakładki w /crm/fleet/[id]
8. ⏳ Zaktualizuj listę pojazdów z alertami
9. ⏳ Ustaw cron dla automatycznego generowania alertów
10. ⏳ Testy end-to-end

## Testy

Po implementacji przetestuj:

1. **Dodawanie ubezpieczenia OC:**
   - Sprawdź czy is_mandatory = true
   - Sprawdź czy blocks_usage = true
   - Sprawdź czy generuje się alert przed wygaśnięciem

2. **Dodawanie przeglądu:**
   - Sprawdź czy poprzedni jest oznaczony jako nieaktualny
   - Sprawdź czy generuje się alert przed wygaśnięciem

3. **Zgłaszanie naprawy wysokiej wagi:**
   - Sprawdź czy automatycznie ustawia blocks_availability = true
   - Sprawdź czy pojazd zmienia status na 'under_repair'
   - Sprawdź czy generuje się alert

4. **Zakończenie naprawy:**
   - Sprawdź czy usuwa blokadę
   - Sprawdź czy pojazd wraca do statusu 'available'
   - Sprawdź czy alert zostaje dezaktywowany

## Wsparcie

W razie pytań lub problemów:

- Sprawdź FLEET_SYSTEM_REORGANIZATION.md - pełna dokumentacja
- Sprawdź APPLY_FLEET_MIGRATION.md - instrukcja migracji
- Sprawdź kod w VehicleAlertsWidget.tsx - przykładowa implementacja
