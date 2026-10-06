'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Truck, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { utcToLocalDatetimeString, localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';
import { useAppDispatch } from '@/store/hooks';
import { eventPhasesApi } from '@/store/api/eventPhasesApi';
import VehicleTravelCalculator from '@/components/crm/VehicleTravelCalculator';
import { phaseRank } from '@/lib/CRM/events/phaseSuggestions';
import type { TravelPlan } from '@/lib/CRM/events/travelPlan';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';
import { DEFAULT_TRAVEL_ORIGIN } from '@/lib/CRM/events/travelEstimate';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { vehicleBoundaryOptions, resolveVehiclePhases } from '@/lib/CRM/events/vehicleSchedule';
import SearchCombobox from '@/components/crm/SearchCombobox';

interface AddEventVehicleModalProps {
  eventId: string;
  eventDate: string;
  eventLocation: string;
  existingVehicleIds: string[];
  editingVehicleId?: string;
  onClose: () => void;
  onSuccess: () => void;
  onSavingChange?: (saving: boolean) => void;
}

interface Vehicle {
  id: string;
  name: string;
  registration_number: string;
  brand: string;
  model: string;
  fuel_type: string;
  max_load_kg: number;
  category?: string | null;
  vehicle_type?: 'car' | 'trailer' | string | null;
  has_tow_hitch?: boolean;
}

interface Employee {
  id: string;
  name: string;
  surname: string;
}

interface Conflict {
  conflicting_event_id: string;
  event_name: string;
  event_date: string;
  event_location: string;
  overlap_start: string;
  overlap_end: string;
}

interface EventPhaseType {
  id: string;
  name: string;
}

interface EventPhase {
  id: string;
  name: string;
  phase_type_id: string | null;
  phase_type?: EventPhaseType | null;
  start_time: string;
  end_time: string;
  sequence_order: number;
}

interface SuggestedTimes {
  availableFrom: Date;
  availableUntil: Date;
  hasLoadingPhase: boolean;
  hasUnloadingPhase: boolean;
  explanation: string;
}

// `available` is the current fleet status. `active` is kept for vehicles that
// still use the legacy value from before the status migration.
const ASSIGNABLE_VEHICLE_STATUSES = ['available', 'active'];

export default function AddEventVehicleModal({
  eventId,
  eventDate,
  eventLocation,
  existingVehicleIds,
  editingVehicleId,
  onClose,
  onSuccess,
  onSavingChange,
}: AddEventVehicleModalProps) {
  const { showSnackbar } = useSnackbar();
  const dispatch = useAppDispatch();

  const [isExternal, setIsExternal] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trailers, setTrailers] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [checkingDrivers, setCheckingDrivers] = useState(false);
  const [driverMessage, setDriverMessage] = useState('');
  const [driverState, setDriverState] = useState<
    'waiting' | 'loading' | 'preview' | 'ready' | 'error'
  >('waiting');
  const [driversRefresh, setDriversRefresh] = useState(0);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(false);
  const savingRef = useRef(false);
  const [saveStage, setSaveStage] = useState('Zapisywanie danych pojazdu…');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [calculatingTravel, setCalculatingTravel] = useState(false);
  const [eventPhases, setEventPhases] = useState<EventPhase[]>([]);
  const [savedStages, setSavedStages] = useState<
    Array<{ id: string; name: string; start_time: string; end_time: string }>
  >([]);
  const [suggestedTimes, setSuggestedTimes] = useState<SuggestedTimes | null>(null);
  const [useSuggestedTimes, setUseSuggestedTimes] = useState(false);

  const [formData, setFormData] = useState({
    vehicle_id: '',
    external_company_name: '',
    external_vehicle_name: '',
    external_rental_cost: '',
    role: 'transport_equipment',
    driver_id: '',
    departure_location: DEFAULT_TRAVEL_ORIGIN,
    loading_time_minutes: 60,
    unloading_time_minutes: 60,
    preparation_time_minutes: 30,
    travel_time_minutes: 60,
    travel_plan: null as TravelPlan | null,
    estimated_distance_km: '',
    fuel_cost_estimate: '',
    toll_cost_estimate: '',
    notes: '',
    has_trailer: false,
    trailer_vehicle_id: '',
    is_trailer_external: false,
    external_trailer_name: '',
    external_trailer_company: '',
    external_trailer_rental_cost: '',
    external_trailer_return_date: '',
    external_trailer_return_location: '',
    external_trailer_notes: '',
    phase_from_id: 'local:loading',
    phase_to_id: 'local:unloading',
    independent_schedule: true,
    pickup_time: '',
    return_time: '',
  });

  const [savedSchedule, setSavedSchedule] = useState<any>(null);

  const boundaryReferences = [
    ...eventPhases,
    ...savedStages.filter(
      (stage) =>
        !stage.id.startsWith('local:') && !eventPhases.some((phase) => phase.id === stage.id),
    ),
  ];
  const pickupOptions = vehicleBoundaryOptions(boundaryReferences, 'pickup');
  const returnOptions = vehicleBoundaryOptions(boundaryReferences, 'return');
  const bookingPhases = resolveVehiclePhases(
    formData.independent_schedule ? boundaryReferences : eventPhases,
    formData,
  );
  const changeBoundary = (side: 'pickup' | 'return', id: string) => {
    const phase = eventPhases.find((item) => item.id === id);
    setFormData((previous) => ({
      ...previous,
      [side === 'pickup' ? 'phase_from_id' : 'phase_to_id']: id,
      ...(phase
        ? {
            [side === 'pickup' ? 'pickup_time' : 'return_time']: utcToLocalDatetimeString(
              side === 'pickup' ? phase.start_time : phase.end_time,
            ),
          }
        : {}),
    }));
  };

  // Funkcja ładująca dane pojazdu do edycji
  const loadVehicleData = useCallback(async () => {
    if (!editingVehicleId) return;

    try {
      const { data, error } = await supabase
        .from('event_vehicles')
        .select('*')
        .eq('id', editingVehicleId)
        .single();

      if (error) throw error;
      if (!data) return;

      // Załaduj przypisania pojazdów do faz dla tego pojazdu i wydarzenia
      const { data: eventPhasesData } = await supabase
        .from('event_phases')
        .select('id, sequence_order, name, start_time, end_time')
        .eq('event_id', data.event_id)
        .order('start_time', { ascending: true });

      // Załaduj przypisania tego pojazdu do faz
      const { data: phaseVehicles, error: phaseError } = await supabase
        .from('event_phase_vehicles')
        .select('phase_id, vehicle_id, driver_id, assigned_start, assigned_end')
        .eq('vehicle_id', data.vehicle_id)
        .order('assigned_start', { ascending: true });

      if (phaseError) {
        console.error('Error loading phase vehicles:', phaseError);
      }

      // Znajdź pierwszą i ostatnią fazę z przypisanym pojazdem
      let phaseFromId = '';
      let phaseToId = '';

      if (
        phaseVehicles &&
        phaseVehicles.length > 0 &&
        eventPhasesData &&
        eventPhasesData.length > 0
      ) {
        // Znajdź które fazy mają przypisany ten pojazd
        const assignedPhaseIds = new Set(phaseVehicles.map((pv) => pv.phase_id));
        const assignedPhases = eventPhasesData.filter((p) => assignedPhaseIds.has(p.id));

        if (assignedPhases.length > 0) {
          // Pierwsza i ostatnia przypisana faza według sequence_order
          phaseFromId = assignedPhases[0].id;
          phaseToId = assignedPhases[assignedPhases.length - 1].id;
        }
      }

      // Reservation boundaries are authoritative, including legacy continuous assignments.
      phaseFromId =
        eventPhasesData?.find(
          (p) => Date.parse(p.start_time) === Date.parse(data.vehicle_available_from),
        )?.id || phaseFromId;
      phaseToId =
        eventPhasesData?.find(
          (p) => Date.parse(p.end_time) === Date.parse(data.vehicle_available_until),
        )?.id || phaseToId;

      if (data.vehicle_id) {
        const { data: assignedVehicle } = await supabase
          .from('vehicles')
          .select(
            'id,name,registration_number,brand,model,fuel_type,max_load_kg,category,vehicle_type,has_tow_hitch',
          )
          .eq('id', data.vehicle_id)
          .maybeSingle();
        if (assignedVehicle)
          setVehicles((previous) =>
            previous.some((vehicle) => vehicle.id === assignedVehicle.id)
              ? previous
              : [...previous, assignedVehicle],
          );
      }
      setSavedStages(
        [data.logistics_schedule?.pickup, data.logistics_schedule?.return]
          .filter((stage) => stage?.id && stage?.name)
          .map((stage) => ({
            id: stage.id,
            name: stage.name,
            start_time: data.vehicle_available_from,
            end_time: data.vehicle_available_until,
          })),
      );
      setIsExternal(data.is_external);
      setSavedSchedule(data.logistics_schedule || null);
      setFormData({
        vehicle_id: data.vehicle_id || '',
        external_company_name: data.external_company_name || '',
        external_vehicle_name: data.external_vehicle_name || '',
        external_rental_cost: data.external_rental_cost?.toString() || '',
        role: data.role || 'transport_equipment',
        driver_id: data.driver_id || '',
        departure_location: data.departure_location || DEFAULT_TRAVEL_ORIGIN,
        loading_time_minutes: data.loading_time_minutes ?? 60,
        unloading_time_minutes: data.logistics_schedule?.unloading_minutes ?? 60,
        preparation_time_minutes: data.preparation_time_minutes || 30,
        travel_time_minutes: data.travel_time_minutes || 60,
        travel_plan: data.travel_plan || null,
        estimated_distance_km: data.estimated_distance_km?.toString() || '',
        fuel_cost_estimate: data.fuel_cost_estimate?.toString() || '',
        toll_cost_estimate: data.toll_cost_estimate?.toString() || '',
        notes: data.notes || '',
        has_trailer: data.has_trailer || false,
        trailer_vehicle_id: data.trailer_vehicle_id || '',
        is_trailer_external: data.is_trailer_external || false,
        external_trailer_name: data.external_trailer_name || '',
        external_trailer_company: data.external_trailer_company || '',
        external_trailer_rental_cost: data.external_trailer_rental_cost?.toString() || '',
        external_trailer_return_date:
          utcToLocalDatetimeString(data.external_trailer_return_date) || '',
        external_trailer_return_location: data.external_trailer_return_location || '',
        external_trailer_notes: data.external_trailer_notes || '',
        phase_from_id: data.logistics_schedule?.pickup?.id || phaseFromId || 'local:loading',
        phase_to_id: data.logistics_schedule?.return?.id || phaseToId || 'local:unloading',
        independent_schedule: true,
        pickup_time: utcToLocalDatetimeString(data.vehicle_available_from) || '',
        return_time: utcToLocalDatetimeString(data.vehicle_available_until) || '',
      });
    } catch (error) {
      console.error('Error loading vehicle data:', error);
      showSnackbar('Błąd podczas ładowania danych pojazdu', 'error');
    }
  }, [editingVehicleId, showSnackbar]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchVehicles(), fetchTrailers(), fetchEventPhases()]);
      if (editingVehicleId) {
        await loadVehicleData();
      }
    };
    init();
  }, [editingVehicleId, loadVehicleData]);

  useEffect(() => {
    const refresh = () => setDriversRefresh((value) => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('employee-driving-licenses-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('employee-driving-licenses-changed', refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const from = bookingPhases.find((phase) => phase.id === formData.phase_from_id);
    const to = bookingPhases.find((phase) => phase.id === formData.phase_to_id);
    setEmployees([]);
    const missingTrailer =
      formData.has_trailer && !formData.is_trailer_external && !formData.trailer_vehicle_id;
    if (isExternal || !formData.vehicle_id || missingTrailer) {
      setCheckingDrivers(false);
      setDriverState('waiting');
      setDriverMessage(
        isExternal
          ? 'Kierowcę pojazdu zewnętrznego ustal z wypożyczalnią.'
          : missingTrailer
            ? 'Wybierz przyczepę, aby uwzględnić również jej wymagane kategorie.'
            : 'Najpierw wybierz pojazd. Pokażemy pracowników z wymaganymi kategoriami.',
      );
      if (isExternal || !formData.vehicle_id)
        setFormData((previous) => (previous.driver_id ? { ...previous, driver_id: '' } : previous));
      return () => {
        cancelled = true;
      };
    }
    const completePeriod = Boolean(from && to);
    if (
      completePeriod &&
      (!Number.isFinite(Date.parse(from!.start_time)) ||
        !Number.isFinite(Date.parse(to!.end_time)) ||
        Date.parse(to!.end_time) <= Date.parse(from!.start_time))
    ) {
      setCheckingDrivers(false);
      setDriverState('waiting');
      setDriverMessage(
        'Popraw fazy: zwrot pojazdu musi nastąpić po jego odbiorze. Lista nie została jeszcze sprawdzona.',
      );
      return () => {
        cancelled = true;
      };
    }
    const previewDate = new Date(eventDate);
    if (!completePeriod && !Number.isFinite(previewDate.getTime())) {
      setCheckingDrivers(false);
      setDriverState('waiting');
      setDriverMessage('Uzupełnij datę wydarzenia lub wybierz fazy odbioru i zwrotu.');
      return;
    }
    setCheckingDrivers(true);
    setDriverState('loading');
    setDriverMessage(
      completePeriod
        ? 'Sprawdzanie dostępności i ważności uprawnień…'
        : 'Sprawdzanie wymaganych kategorii na dzień wydarzenia…',
    );
    const scope = {
      p_vehicle_id: formData.vehicle_id,
      p_trailer_id:
        formData.has_trailer && !formData.is_trailer_external
          ? formData.trailer_vehicle_id || null
          : null,
      p_external_trailer: formData.has_trailer && formData.is_trailer_external,
    };
    const request = completePeriod
      ? supabase.rpc('eligible_event_vehicle_drivers', {
          ...scope,
          p_start: from!.start_time,
          p_end: to!.end_time,
          p_exclude_id: editingVehicleId || null,
        })
      : supabase.rpc('qualified_vehicle_drivers', {
          ...scope,
          p_date: new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Europe/Warsaw',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(previewDate),
        });
    Promise.resolve(request)
      .then(({ data, error }) => {
        if (cancelled) return;
        const available = error ? [] : ((data || []) as Employee[]);
        setEmployees(available);
        setCheckingDrivers(false);
        setDriverState(error ? 'error' : completePeriod ? 'ready' : 'preview');
        setDriverMessage(
          error
            ? ['PGRST202', '42883'].includes(error.code)
              ? 'Sprawdzanie kierowców wymaga aktualizacji bazy: migracja 20260917200000 (po 20260917151000). To nie oznacza braku uprawnień pracowników.'
              : error.message
            : available.length
              ? completePeriod
                ? 'Dostępni w całym terminie rezerwacji, z ważnymi wymaganymi kategoriami.'
                : 'Najpierw ustal godziny w Timeline. Następnie wybierz kierowcę — sprawdzimy jego dostępność i uprawnienia w całym terminie.'
              : completePeriod
                ? 'Brak kierowców wolnych w tym terminie z ważnymi wymaganymi kategoriami.'
                : 'Brak aktywnych pracowników z wymaganymi kategoriami ważnymi w dniu wydarzenia. Kategorie uzupełnisz w Kwalifikacje → Prawa jazdy.',
        );
        if (!error)
          setFormData((previous) =>
            previous.driver_id && !available.some((driver) => driver.id === previous.driver_id)
              ? { ...previous, driver_id: '' }
              : previous,
          );
      })
      .catch(() => {
        if (cancelled) return;
        setCheckingDrivers(false);
        setDriverState('error');
        setDriverMessage(
          'Nie udało się sprawdzić kierowców. Odśwież listę — nie jest to informacja o braku uprawnień.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [
    formData.vehicle_id,
    formData.phase_from_id,
    formData.phase_to_id,
    formData.pickup_time,
    formData.return_time,
    formData.independent_schedule,
    formData.has_trailer,
    formData.trailer_vehicle_id,
    formData.is_trailer_external,
    isExternal,
    editingVehicleId,
    eventPhases,
    savedStages,
    eventDate,
    driversRefresh,
  ]);

  useEffect(() => {
    if (formData.vehicle_id && !isExternal) {
      checkAvailability();
    }
  }, [
    formData.vehicle_id,
    formData.loading_time_minutes,
    formData.preparation_time_minutes,
    formData.travel_time_minutes,
    formData.phase_from_id,
    formData.phase_to_id,
    formData.pickup_time,
    formData.return_time,
    formData.independent_schedule,
    eventPhases,
    savedStages,
  ]);

  // Oblicz sugerowane czasy gdy fazy się załadują
  useEffect(() => {
    if (eventPhases.length > 0) {
      const suggested = calculateSuggestedTimes();
      setSuggestedTimes(suggested);
    }
  }, [eventPhases]);

  const fetchVehicles = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select(
          'id, name, registration_number, brand, model, fuel_type, max_load_kg, category, vehicle_type, has_tow_hitch',
        )
        .in('status', ASSIGNABLE_VEHICLE_STATUSES)
        .eq('vehicle_type', 'car')
        .order('name');

      if (error) throw error;

      const availableVehicles = (data || []).filter((v) => !existingVehicleIds.includes(v.id));
      setVehicles(availableVehicles);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
    }
  };

  const fetchTrailers = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select(
          'id, name, registration_number, brand, model, fuel_type, max_load_kg, category, vehicle_type',
        )
        .in('status', ASSIGNABLE_VEHICLE_STATUSES)
        .eq('vehicle_type', 'trailer')
        .order('name');

      if (error) throw error;
      setTrailers(data || []);
    } catch (error) {
      console.error('Error fetching trailers:', error);
    }
  };

  const fetchEventPhases = async () => {
    try {
      const { data, error } = await supabase
        .from('event_phases')
        .select(
          `
          id,
          name,
          phase_type_id,
          start_time,
          end_time,
          sequence_order,
          phase_type:event_phase_types(*)
        `,
        )
        .eq('event_id', eventId)
        .order('start_time', { ascending: true });

      if (error) throw error;

      setEventPhases((data as any) || []);
    } catch (error) {
      console.error('Error fetching event phases:', error);
      setEventPhases([]);
    }
  };

  const calculateSuggestedTimes = useCallback((): SuggestedTimes | null => {
    if (!eventPhases.length) return null;

    const normalize = (v?: string) => (v || '').toLowerCase();

    const loadingPhase = eventPhases.find((p) => normalize(p.name).includes('załad'));

    const unloadingPhase = eventPhases.find((p) => normalize(p.name).includes('rozład'));

    if (!loadingPhase || !unloadingPhase) {
      return {
        availableFrom: new Date(),
        availableUntil: new Date(),
        hasLoadingPhase: !!loadingPhase,
        hasUnloadingPhase: !!unloadingPhase,
        explanation:
          'Brak wymaganych faz logistycznych (Załadunek / Rozładunek). Utwórz je, aby poprawnie wyznaczyć zakres rezerwacji pojazdu.',
      };
    }

    const availableFrom = new Date(loadingPhase.start_time);
    const availableUntil = new Date(unloadingPhase.end_time);

    if (availableUntil.getTime() < availableFrom.getTime()) {
      return {
        availableFrom,
        availableUntil,
        hasLoadingPhase: true,
        hasUnloadingPhase: true,
        explanation:
          'Uwaga: faza Rozładunek kończy się przed rozpoczęciem Załadunku. Sprawdź czasy faz.',
      };
    }

    return {
      availableFrom,
      availableUntil,
      hasLoadingPhase: true,
      hasUnloadingPhase: true,
      explanation:
        'Pojazd będzie zarezerwowany od początku fazy Załadunek do końca fazy Rozładunek.',
    };
  }, [eventPhases]);

  const applySuggestedTimes = () => {
    if (!suggestedTimes) return;

    // Ustaw flagę aby użyć sugerowanych czasów bezpośrednio
    setUseSuggestedTimes(true);

    // Oblicz różnicę czasów aby uzupełnić formularz (dla display only)
    const eventDateTime = new Date(eventDate);
    const totalMinutesBeforeEvent = Math.max(
      0,
      Math.floor((eventDateTime.getTime() - suggestedTimes.availableFrom.getTime()) / 60000),
    );

    // Rozłóż na loading (60%), preparation (20%), travel (20%)
    const loadingMinutes = Math.floor(totalMinutesBeforeEvent * 0.6);
    const preparationMinutes = Math.floor(totalMinutesBeforeEvent * 0.2);
    const travelMinutes = totalMinutesBeforeEvent - loadingMinutes - preparationMinutes;

    setFormData((prev) => ({
      ...prev,
      loading_time_minutes: loadingMinutes || 60,
      preparation_time_minutes: preparationMinutes || 30,
      travel_time_minutes: prev.travel_plan?.outbound.plannedMinutes ?? (travelMinutes || 60),
    }));

    showSnackbar('Zastosowano sugerowane czasy na podstawie faz wydarzenia', 'success');
  };

  const checkAvailability = async () => {
    if (!formData.vehicle_id) return;

    setCheckingAvailability(true);
    try {
      const from = bookingPhases.find((p) => p.id === formData.phase_from_id);
      const to = bookingPhases.find((p) => p.id === formData.phase_to_id);
      if (!from || !to || Date.parse(to.end_time) <= Date.parse(from.start_time)) {
        setConflicts([]);
        return;
      }
      const availableFrom = from.start_time;
      const availableUntil = to.end_time;

      const { data, error } = await supabase.rpc('check_vehicle_availability', {
        p_vehicle_id: formData.vehicle_id,
        p_start_time: availableFrom,
        p_end_time: availableUntil,
        p_exclude_event_id: eventId,
      });

      if (error) throw error;
      setConflicts(data || []);
    } catch (error) {
      console.error('Error checking availability:', error);
    } finally {
      setCheckingAvailability(false);
    }
  };

  const calculateDepartureTime = () => {
    const eventDateTime = new Date(eventDate);
    const totalMinutes =
      (formData.loading_time_minutes || 0) +
      (formData.preparation_time_minutes || 0) +
      (formData.travel_time_minutes || 0);
    // UWAGA: historycznie to zwraca "start całej logistyki" (start załadunku),
    // mimo że w DB pole nazywa się departure_time.
    return new Date(eventDateTime.getTime() - totalMinutes * 60000);
  };

  // Use the same reservation boundaries in logistics and the timeline.
  const assignVehicleToLogisticPhases = async (
    phaseId: string,
    vehicleId: string,
    availableFrom: string,
    availableUntil: string,
  ) => {
    const { error } = await supabase.from('event_phase_vehicles').upsert(
      {
        phase_id: phaseId,
        vehicle_id: vehicleId,
        assigned_start: availableFrom,
        assigned_end: availableUntil,
        driver_id: formData.driver_id || null,
        purpose: 'Rezerwacja pojazdu od fazy odbioru do końca fazy zwrotu',
        notes: 'Przypisanie zgodne z planowaniem pojazdu w logistyce',
      },
      { onConflict: 'phase_id,vehicle_id' },
    );
    if (error) throw error;
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      savingRef.current ||
      loading ||
      checkingAvailability ||
      checkingDrivers ||
      calculatingTravel
    )
      return;
    const costFields = [
      formData.estimated_distance_km,
      formData.fuel_cost_estimate,
      formData.toll_cost_estimate,
    ];
    if (
      costFields.some(
        (value) => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0),
      )
    ) {
      showSnackbar('Dystans i koszty muszą być nieujemnymi liczbami.', 'error');
      return;
    }
    if (formData.driver_id && !employees.some((driver) => driver.id === formData.driver_id)) {
      showSnackbar('Wybierz dostępnego kierowcę z wymaganymi uprawnieniami.', 'error');
      return;
    }
    savingRef.current = true;
    setLoading(true);
    setSaveStage('Zapisywanie danych pojazdu…');
    onSavingChange?.(true);
    let vehicleSaved = false;
    let phaseSyncFailed = false;
    let savedEventVehicleId = editingVehicleId || '';
    let saveWarning = '';

    try {
      // Logistics edits estimates only. Preserve existing reservations; Timeline owns dates.
      let availableFrom: string | null = formData.pickup_time
        ? localDatetimeStringToUTC(formData.pickup_time)
        : null;
      let availableUntil: string | null = formData.return_time
        ? localDatetimeStringToUTC(formData.return_time)
        : null;

      const insertData: any = {
        event_id: eventId,
        role: formData.role,
        driver_id: formData.driver_id || null,
        departure_location: formData.departure_location || null,
        loading_time_minutes: formData.loading_time_minutes,
        preparation_time_minutes: formData.preparation_time_minutes,
        travel_time_minutes:
          formData.travel_plan?.outbound.plannedMinutes ?? formData.travel_time_minutes,
        travel_plan: formData.travel_plan,
        departure_time: availableFrom,
        arrival_time: null,
        estimated_distance_km: formData.estimated_distance_km.trim()
          ? Number(formData.estimated_distance_km)
          : null,
        fuel_cost_estimate: formData.fuel_cost_estimate.trim()
          ? Number(formData.fuel_cost_estimate)
          : null,
        toll_cost_estimate: parseFloat(formData.toll_cost_estimate) || null,
        notes: formData.notes || null,
        vehicle_available_from: availableFrom,
        vehicle_available_until: availableUntil,
        logistics_schedule: {
          ...(savedSchedule || {
            mode: 'timeline',
            pickup: { id: 'local:loading', name: 'Załadunek' },
            return: { id: 'local:unloading', name: 'Rozładunek' },
          }),
          unloading_minutes: formData.unloading_time_minutes,
        },
        is_external: isExternal,
      };

      if (isExternal) {
        insertData.external_company_name = formData.external_company_name;
        insertData.external_rental_cost = parseFloat(formData.external_rental_cost) || null;
        insertData.vehicle_id = null;
      } else {
        insertData.vehicle_id = formData.vehicle_id;
      }

      if (formData.has_trailer) {
        insertData.has_trailer = true;

        if (formData.is_trailer_external) {
          insertData.is_trailer_external = true;
          insertData.external_trailer_name = formData.external_trailer_name || null;
          insertData.external_trailer_company = formData.external_trailer_company || null;
          insertData.external_trailer_rental_cost =
            parseFloat(formData.external_trailer_rental_cost) || null;
          insertData.external_trailer_return_date = formData.external_trailer_return_date
            ? localDatetimeStringToUTC(formData.external_trailer_return_date)
            : null;
          insertData.external_trailer_return_location =
            formData.external_trailer_return_location || null;
          insertData.external_trailer_notes = formData.external_trailer_notes || null;
        } else {
          insertData.trailer_vehicle_id = formData.trailer_vehicle_id || null;
        }
      }

      if (editingVehicleId) {
        const { data: savedVehicle, error } = await supabase
          .from('event_vehicles')
          .update(insertData)
          .eq('id', editingVehicleId)
          .eq('event_id', eventId)
          .select('id')
          .single();
        if (error) throw error;
        savedEventVehicleId = savedVehicle.id;
      } else {
        const { data: savedVehicle, error } = await supabase
          .from('event_vehicles')
          .insert([insertData])
          .select('id')
          .single();
        if (error) throw error;
        savedEventVehicleId = savedVehicle.id;
      }
      vehicleSaved = true;
      if (!isExternal) {
        const { data: synced, error: syncedError } = await supabase
          .from('event_vehicles')
          .select('vehicle_available_from, vehicle_available_until')
          .eq('id', savedEventVehicleId)
          .single();
        if (syncedError) throw syncedError;
        availableFrom = synced.vehicle_available_from;
        availableUntil = synced.vehicle_available_until;
      }
      setSaveStage('Zapisywanie przypisań do faz logistycznych…');

      if (!isExternal && formData.vehicle_id) {
        if (editingVehicleId) {
          const { data: phasesToClean, error: phasesError } = await supabase
            .from('event_phases')
            .select('id')
            .eq('event_id', eventId);
          if (phasesError) throw phasesError;
          if (phasesToClean?.length) {
            const { error: cleanupError } = await supabase
              .from('event_phase_vehicles')
              .delete()
              .in(
                'phase_id',
                phasesToClean.map((phase) => phase.id),
              )
              .eq('vehicle_id', formData.vehicle_id);
            if (cleanupError) throw cleanupError;
          }
        }
        if (!formData.independent_schedule)
          phaseSyncFailed = !(await assignVehicleToLogisticPhases(
            formData.phase_from_id,
            formData.vehicle_id,
            availableFrom!,
            availableUntil!,
          ));
      }
      if (formData.travel_plan && !formData.independent_schedule) {
        setSaveStage('Aktualizowanie faz dojazdu i powrotu oraz rezerwacji auta…');
        const { data: synchronization, error: synchronizationError } = await supabase.rpc(
          'apply_saved_vehicle_travel_phases',
          { p_event_id: eventId, p_event_vehicle_id: savedEventVehicleId },
        );
        if (synchronizationError) {
          throw new Error(
            synchronizationError.code === 'PGRST202' || synchronizationError.code === '42883'
              ? 'Brak migracji 20260917210000_apply_saved_vehicle_travel_phases.sql. Po jej uruchomieniu zapisz pojazd ponownie.'
              : synchronizationError.message,
          );
        }
        if (!synchronization) throw new Error('Brak potwierdzenia aktualizacji faz logistyki.');
        const missingPhases = [
          !synchronization.has_outbound_phase ? 'Dojazd' : null,
          formData.travel_plan.inbound && !synchronization.has_return_phase ? 'Powrót' : null,
        ].filter(Boolean);
        if (missingPhases.length) {
          phaseSyncFailed = true;
          saveWarning = `Pojazd i trasa zapisane. Brakuje faz: ${missingPhases.join(', ')}. Dodaj je w osi czasu, aby pokazać przejazd.`;
        }
      }
    } catch (error: any) {
      console.error('Error saving event vehicle:', error);
      if (!vehicleSaved) {
        showSnackbar(error.message || 'Nie udało się zapisać pojazdu. Spróbuj ponownie.', 'error');
        savingRef.current = false;
        setLoading(false);
        onSavingChange?.(false);
        return;
      }
      // The vehicle already exists. Do not offer another INSERT after a secondary failure.
      phaseSyncFailed = true;
      saveWarning = `Pojazd zapisano, ale nie zakończono synchronizacji faz. ${error.message || 'Sprawdź fazy logistyczne i zapisz pojazd ponownie.'}`;
    }

    showSnackbar(
      phaseSyncFailed
        ? saveWarning ||
            'Pojazd zapisano, ale nie udało się uzupełnić przypisań do faz. Sprawdź fazy logistyczne.'
        : formData.independent_schedule
          ? 'Pojazd zapisany z własnym terminem odbioru i zwrotu.'
          : formData.travel_plan
            ? 'Pojazd i trasa zapisane. Fazy logistyczne zostały zsynchronizowane.'
            : editingVehicleId
              ? 'Pojazd został zaktualizowany'
              : 'Pojazd został dodany do wydarzenia',
      phaseSyncFailed ? 'warning' : 'success',
    );
    // The parent closes the modal and refreshes logistics once, after all writes finish.
    dispatch(eventsApi.util.invalidateTags(['EventVehicles']));
    onSuccess();
    onSavingChange?.(false);
    dispatch(
      eventPhasesApi.util.invalidateTags(['PhaseVehicles', { type: 'Phases', id: eventId }]),
    );
  };

  const selectedVehicle = vehicles.find((v) => v.id === formData.vehicle_id) || null;
  const selectedVehicleHasTowHitch = !!selectedVehicle?.has_tow_hitch;

  useEffect(() => {
    if (isExternal) return;

    if (!selectedVehicleHasTowHitch) {
      setFormData((prev) => ({
        ...prev,
        has_trailer: false,
        trailer_vehicle_id: '',
        is_trailer_external: false,
        external_trailer_name: '',
        external_trailer_company: '',
        external_trailer_rental_cost: '',
        external_trailer_return_date: '',
        external_trailer_return_location: '',
        external_trailer_notes: '',
      }));
    }
  }, [selectedVehicleHasTowHitch, isExternal]);

  const departureTime = calculateDepartureTime();

  return (
    <>
      <FullScreenLoader show={loading} title="Zapisywanie pojazdu" description={saveStage} />
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
          <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-4">
            <div className="flex items-center gap-3">
              <Truck className="h-6 w-6 text-[#d3bb73]" />
              <h2 className="text-xl font-bold text-[#e5e4e2]">
                {editingVehicleId ? 'Edytuj pojazd' : 'Dodaj pojazd do wydarzenia'}
              </h2>
            </div>
            <button
              disabled={loading}
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:bg-[#0f1119]"
            >
              <X className="h-5 w-5 text-[#e5e4e2]" />
            </button>
          </div>

          <form onSubmit={handleSubmit} aria-busy={loading}>
            <fieldset disabled={loading} className="min-w-0 space-y-6 p-6">
              {/* Typ pojazdu */}
              <div>
                <label className="mb-3 block text-sm font-medium text-[#e5e4e2]">Typ pojazdu</label>
                <div className="flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      checked={!isExternal}
                      onChange={() => setIsExternal(false)}
                      className="h-4 w-4"
                    />
                    <span className="text-[#e5e4e2]">Pojazd z floty</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      checked={isExternal}
                      onChange={() => setIsExternal(true)}
                      className="h-4 w-4"
                    />
                    <span className="text-[#e5e4e2]">Pojazd zewnętrzny (wypożyczony)</span>
                  </label>
                </div>
              </div>

              {/* Wybór pojazdu */}
              {!isExternal ? (
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Wybierz pojazd *
                  </label>
                  <select
                    required
                    value={formData.vehicle_id}
                    onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  >
                    <option value="">Wybierz pojazd...</option>
                    {vehicles
                      .filter((v) => v.vehicle_type === 'car')
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.registration_number}) - {v.brand} {v.model}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Nazwa firmy wypożyczającej *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.external_company_name}
                      onChange={(e) =>
                        setFormData({ ...formData, external_company_name: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      placeholder="np. Rent-a-Car"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Nazwa pojazdu *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.external_vehicle_name}
                      onChange={(e) =>
                        setFormData({ ...formData, external_vehicle_name: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      placeholder="np. Mercedes Sprinter"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Koszt wypożyczenia (zł)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.external_rental_cost}
                      onChange={(e) =>
                        setFormData({ ...formData, external_rental_cost: e.target.value })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}

              {/* Konflikty dostępności */}
              {!isExternal && conflicts.length > 0 && (
                <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-400" />
                    <div className="flex-1">
                      <h4 className="mb-2 font-medium text-orange-400">⚠️ Konflikty rezerwacji</h4>
                      <p className="mb-3 text-sm text-[#e5e4e2]/80">
                        Ten pojazd jest już zarezerwowany na inne wydarzenia w tym samym czasie:
                      </p>
                      <div className="space-y-2">
                        {conflicts.map((conflict, idx) => (
                          <div
                            key={idx}
                            className="flex items-start justify-between rounded-lg bg-[#1c1f33] p-3"
                          >
                            <div>
                              <div className="font-medium text-[#e5e4e2]">
                                {conflict.event_name}
                              </div>
                              <div className="mt-1 text-sm text-[#e5e4e2]/60">
                                <div>{new Date(conflict.event_date).toLocaleString('pl-PL')}</div>
                                <div>{conflict.event_location}</div>
                              </div>
                            </div>
                            <a
                              href={`/crm/events/${conflict.conflicting_event_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                            >
                              Zobacz
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Szczegóły */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Rola pojazdu *
                  </label>
                  <select
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  >
                    <option value="transport_equipment">Transport sprzętu</option>
                    <option value="transport_crew">Transport ekipy</option>
                    <option value="support">Wsparcie</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Kierowca{' '}
                    {!isExternal && formData.vehicle_id && (
                      <span className="text-xs text-[#d3bb73]">
                        (tylko z wymaganymi prawami jazdy)
                      </span>
                    )}
                  </label>
                  <SearchCombobox
                    ariaLabel="Kierowca"
                    value={formData.driver_id}
                    onChange={(id) => setFormData((previous) => ({ ...previous, driver_id: id }))}
                    disabled={
                      isExternal ||
                      driverState === 'preview' ||
                      driverState === 'waiting' ||
                      checkingDrivers ||
                      driverState === 'error' ||
                      employees.length === 0
                    }
                    options={employees.map((employee) => ({
                      id: employee.id,
                      label: `${employee.name} ${employee.surname}`,
                    }))}
                    placeholder={
                      checkingDrivers
                        ? 'Sprawdzanie kierowców…'
                        : driverState === 'error'
                          ? 'Nie udało się sprawdzić kierowców'
                          : driverState === 'waiting'
                            ? 'Uzupełnij dane do sprawdzenia'
                            : !employees.length
                              ? driverState === 'preview'
                                ? 'Brak ważnych wymaganych kategorii'
                                : 'Brak dostępnych kierowców w terminie'
                              : 'Wyszukaj kierowcę…'
                    }
                  />
                  <p className="mt-1 text-xs text-[#e5e4e2]/70" role="status">
                    {driverMessage}
                  </p>
                  {!isExternal && formData.vehicle_id && (
                    <button data-crm-action="secondary"
                      type="button"
                      disabled={checkingDrivers || loading}
                      onClick={() => setDriversRefresh((value) => value + 1)}
                      className="mt-2 rounded px-2 py-1 text-xs text-[#d3bb73] hover:bg-white/5 disabled:opacity-40"
                    >
                      Odśwież kierowców
                    </button>
                  )}
                </div>
              </div>

              {/* Przyczepka */}
              {!isExternal && selectedVehicleHasTowHitch && (
                <div className="space-y-4 rounded-lg bg-[#0f1119] p-4">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="has_trailer"
                      checked={formData.has_trailer}
                      onChange={(e) => setFormData({ ...formData, has_trailer: e.target.checked })}
                      className="h-5 w-5 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <label
                      htmlFor="has_trailer"
                      className="cursor-pointer font-medium text-[#e5e4e2]"
                    >
                      Pojazd z przyczepką
                    </label>
                  </div>

                  {formData.has_trailer && (
                    <div className="space-y-4 border-l-2 border-[#d3bb73]/20 pl-8">
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          id="trailer_own"
                          name="trailer_type"
                          checked={!formData.is_trailer_external}
                          onChange={() => setFormData({ ...formData, is_trailer_external: false })}
                          className="h-4 w-4 text-[#d3bb73] focus:ring-[#d3bb73]"
                        />
                        <label
                          htmlFor="trailer_own"
                          className="cursor-pointer text-sm text-[#e5e4e2]"
                        >
                          Własna przyczepka
                        </label>
                      </div>

                      {!formData.is_trailer_external && (
                        <div>
                          <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                            Wybierz przyczepkę
                          </label>
                          <select
                            value={formData.trailer_vehicle_id}
                            onChange={(e) =>
                              setFormData({ ...formData, trailer_vehicle_id: e.target.value })
                            }
                            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                          >
                            <option value="">Wybierz przyczepkę...</option>
                            {trailers
                              .filter((t) => t.vehicle_type === 'trailer')
                              .map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} {t.registration_number && `(${t.registration_number})`}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}

                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          id="trailer_external"
                          name="trailer_type"
                          checked={formData.is_trailer_external}
                          onChange={() => setFormData({ ...formData, is_trailer_external: true })}
                          className="h-4 w-4 text-[#d3bb73] focus:ring-[#d3bb73]"
                        />
                        <label
                          htmlFor="trailer_external"
                          className="cursor-pointer text-sm text-[#e5e4e2]"
                        >
                          Przyczepka wynajęta
                        </label>
                      </div>

                      {formData.is_trailer_external && (
                        <div className="space-y-3">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                              Nazwa przyczepki
                            </label>
                            <input
                              type="text"
                              value={formData.external_trailer_name}
                              onChange={(e) =>
                                setFormData({ ...formData, external_trailer_name: e.target.value })
                              }
                              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                              placeholder="np. Przyczepka 3.5t"
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                              Firma wypożyczająca
                            </label>
                            <input
                              type="text"
                              value={formData.external_trailer_company}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  external_trailer_company: e.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                              placeholder="np. Rent-a-Trailer Sp. z o.o."
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                                Koszt wynajmu (PLN)
                              </label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={formData.external_trailer_rental_cost}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    external_trailer_rental_cost: e.target.value,
                                  })
                                }
                                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                                placeholder="0.00"
                              />
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                                Termin zwrotu
                              </label>
                              <input
                                type="datetime-local"
                                value={formData.external_trailer_return_date}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    external_trailer_return_date: e.target.value,
                                  })
                                }
                                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                              Miejsce zwrotu
                            </label>
                            <input
                              type="text"
                              value={formData.external_trailer_return_location}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  external_trailer_return_location: e.target.value,
                                })
                              }
                              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                              placeholder="np. Warszawa, ul. Przykładowa 123"
                            />
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                              Dodatkowe informacje
                            </label>
                            <textarea
                              value={formData.external_trailer_notes}
                              onChange={(e) =>
                                setFormData({ ...formData, external_trailer_notes: e.target.value })
                              }
                              rows={2}
                              className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                              placeholder="Dodatkowe notatki..."
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg bg-white/5 p-4 text-sm text-[#e5e4e2]/70">
                Tutaj obliczysz czas i koszt trasy. Godzinę rozpoczęcia dojazdu i powrotu ustawisz w
                Timeline — zakończenie wyliczy się z czasu jazdy, zapasu i przerw.
                <a
                  href={`/crm/events/${eventId}?tab=phases`}
                  className="ml-2 text-[#d3bb73] underline"
                >
                  Przejdź do timeline
                </a>
              </div>

              <VehicleTravelCalculator
                eventId={eventId}
                travelPlan={formData.travel_plan}
                eventLocation={eventLocation}
                vehicleId={isExternal ? '' : formData.vehicle_id}
                vehicleFuelType={
                  isExternal
                    ? undefined
                    : vehicles.find((vehicle) => vehicle.id === formData.vehicle_id)?.fuel_type
                }
                origin={formData.departure_location}
                distance={formData.estimated_distance_km}
                onOriginChange={(value) =>
                  setFormData((previous) => ({ ...previous, departure_location: value }))
                }
                onBusyChange={setCalculatingTravel}
                onApply={({ distanceKm, travelMinutes, fuelCost, travelPlan }) =>
                  setFormData((previous) => ({
                    ...previous,
                    ...(travelPlan !== undefined ? { travel_plan: travelPlan } : {}),
                    ...(distanceKm !== undefined
                      ? { estimated_distance_km: distanceKm.toString() }
                      : {}),
                    ...(travelMinutes !== undefined ? { travel_time_minutes: travelMinutes } : {}),
                    ...(fuelCost !== undefined
                      ? { fuel_cost_estimate: fuelCost === null ? '' : fuelCost.toFixed(2) }
                      : {}),
                  }))
                }
              />

              {/* Koszty */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Łączny dystans (km)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.estimated_distance_km}
                    onChange={(e) =>
                      setFormData({ ...formData, estimated_distance_km: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Koszt paliwa (zł)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.fuel_cost_estimate}
                    onChange={(e) =>
                      setFormData({ ...formData, fuel_cost_estimate: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Koszt autostrad (zł)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.toll_cost_estimate}
                    onChange={(e) =>
                      setFormData({ ...formData, toll_cost_estimate: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Notatki */}
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  placeholder="Dodatkowe informacje..."
                />
              </div>

              {/* Przyciski */}
              <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  disabled={loading || checkingAvailability || checkingDrivers || calculatingTravel}
                  className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Zapisywanie...' : editingVehicleId ? 'Zapisz pojazd' : 'Dodaj pojazd'}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </>
  );
}
