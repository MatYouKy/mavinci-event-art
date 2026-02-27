'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Truck,
  AlertTriangle,
  Calendar,
  Clock,
  MapPin,
  DollarSign,
  User,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { utcToLocalDatetimeString, localDatetimeStringToUTC } from '@/lib/utils/dateTimeUtils';
import { useAppDispatch } from '@/store/hooks';
import { eventPhasesApi } from '@/store/api/eventPhasesApi';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';

interface AddEventVehicleModalProps {
  eventId: string;
  eventDate: string;
  eventLocation: string;
  existingVehicleIds: string[];
  editingVehicleId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface Vehicle {
  id: string;
  name: string;
  registration_number: string;
  brand: string;
  model: string;
  fuel_type: string;
  max_load_kg: number;
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

export default function AddEventVehicleModal({
  eventId,
  eventDate,
  eventLocation,
  existingVehicleIds,
  editingVehicleId,
  onClose,
  onSuccess,
}: AddEventVehicleModalProps) {
  const { showSnackbar } = useSnackbar();
  const dispatch = useAppDispatch();

  const [isExternal, setIsExternal] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trailers, setTrailers] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [eventPhases, setEventPhases] = useState<EventPhase[]>([]);
  const [suggestedTimes, setSuggestedTimes] = useState<SuggestedTimes | null>(null);
  const [useSuggestedTimes, setUseSuggestedTimes] = useState(false);

  const [formData, setFormData] = useState({
    vehicle_id: '',
    external_company_name: '',
    external_vehicle_name: '',
    external_rental_cost: '',
    role: 'transport_equipment',
    driver_id: '',
    departure_location: '',
    loading_time_minutes: 60,
    preparation_time_minutes: 30,
    travel_time_minutes: 60,
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
  });

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchVehicles(), fetchTrailers(), fetchEventPhases()]);
      if (editingVehicleId) {
        await loadVehicleData();
      }
    };
    init();
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [formData.vehicle_id, isExternal]);

  useEffect(() => {
    if (formData.vehicle_id && !isExternal) {
      checkAvailability();
    }
  }, [
    formData.vehicle_id,
    formData.loading_time_minutes,
    formData.preparation_time_minutes,
    formData.travel_time_minutes,
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
        .select('id, name, registration_number, brand, model, fuel_type, max_load_kg')
        .eq('status', 'active')
        .neq('category', 'trailer')
        .order('name');

      if (error) throw error;

      // Filtruj pojazdy już dodane do wydarzenia
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
        .select('id, name, registration_number, brand, model, fuel_type, max_load_kg')
        .eq('status', 'active')
        .eq('category', 'trailer')
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
        .order('sequence_order', { ascending: true });

      if (error) throw error;

      console.log('[fetchEventPhases] data:', data);
      setEventPhases((data as any) || []);
    } catch (error) {
      console.error('Error fetching event phases:', error);
      setEventPhases([]);
    }
  };
  console.log('eventPhases', eventPhases);

  const calculateSuggestedTimes = useCallback((): SuggestedTimes | null => {
    if (!eventPhases.length) return null;
  
    const normalize = (v?: string) => (v || '').toLowerCase();
  
    const loadingPhase = eventPhases.find((p) =>
      normalize(p.name).includes('załad')
    );
  
    const unloadingPhase = eventPhases.find((p) =>
      normalize(p.name).includes('rozład')
    );
  
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
      travel_time_minutes: travelMinutes || 60,
    }));

    showSnackbar('Zastosowano sugerowane czasy na podstawie faz wydarzenia', 'success');
  };

  const loadVehicleData = async () => {
    if (!editingVehicleId) return;

    try {
      const { data, error } = await supabase.from('event_vehicles').select('*').eq('id', editingVehicleId).single();

      if (error) throw error;
      if (!data) return;

      setIsExternal(data.is_external);
      setFormData({
        vehicle_id: data.vehicle_id || '',
        external_company_name: data.external_company_name || '',
        external_vehicle_name: data.external_vehicle_name || '',
        external_rental_cost: data.external_rental_cost?.toString() || '',
        role: data.role || 'transport_equipment',
        driver_id: data.driver_id || '',
        departure_location: data.departure_location || '',
        loading_time_minutes: data.loading_time_minutes || 60,
        preparation_time_minutes: data.preparation_time_minutes || 30,
        travel_time_minutes: data.travel_time_minutes || 60,
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
        external_trailer_return_date: utcToLocalDatetimeString(data.external_trailer_return_date) || '',
        external_trailer_return_location: data.external_trailer_return_location || '',
        external_trailer_notes: data.external_trailer_notes || '',
      });
    } catch (error) {
      console.error('Error loading vehicle data:', error);
      showSnackbar('Błąd podczas ładowania danych pojazdu', 'error');
    }
  };

  const fetchEmployees = async () => {
    try {
      // Pobierz kierowców już przypisanych do INNYCH pojazdów w tym wydarzeniu
      let query = supabase
        .from('event_vehicles')
        .select('driver_id')
        .eq('event_id', eventId)
        .not('driver_id', 'is', null);

      // Jeśli edytujemy istniejący pojazd, wykluczamy go z zapytania
      if (editingVehicleId) {
        query = query.neq('id', editingVehicleId);
      }

      const { data: assignedDrivers } = await query;

      const assignedDriverIds = assignedDrivers?.map((v) => v.driver_id) || [];

      // Jeśli nie wybrano pojazdu lub jest zewnętrzny, nie pokazuj żadnych kierowców
      if (!formData.vehicle_id || isExternal) {
        setEmployees([]);
        return;
      }

      const { data: requirements, error: reqError } = await supabase
        .from('vehicle_license_requirements')
        .select('license_category_id')
        .eq('vehicle_id', formData.vehicle_id)
        .eq('is_required', true);

      if (reqError) throw reqError;

      if (!requirements || requirements.length === 0) {
        // Pojazd nie ma wymagań - pokaż wszystkich aktywnych, którzy nie są zajęci
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, surname')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;

        const availableEmployees = (data || []).filter((e) => !assignedDriverIds.includes(e.id));
        setEmployees(availableEmployees);
        return;
      }

      const categoryIds = requirements.map((r) => r.license_category_id);

      // Znajdź pracowników którzy mają WSZYSTKIE wymagane kategorie
      const { data: qualifiedEmployees, error: empError } = await supabase
        .from('employee_driving_licenses')
        .select(
          `
          employee_id,
          license_category_id,
          employee:employees!employee_driving_licenses_employee_id_fkey(id, name, surname, is_active)
        `,
        )
        .in('license_category_id', categoryIds);

      if (empError) throw empError;

      // Grupuj według employee_id i sprawdź czy mają wszystkie wymagane kategorie
      const employeeMap = new Map<
        string,
        { id: string; name: string; surname: string; categories: Set<string>; is_active: boolean }
      >();

      qualifiedEmployees?.forEach((item) => {
        const emp = item.employee as any;
        // Pomiń nieaktywnych pracowników
        if (!emp || !emp.is_active) return;

        if (!employeeMap.has(item.employee_id)) {
          employeeMap.set(item.employee_id, {
            id: emp.id,
            name: emp.name,
            surname: emp.surname,
            is_active: emp.is_active,
            categories: new Set(),
          });
        }
        employeeMap.get(item.employee_id)!.categories.add(item.license_category_id);
      });

      // Filtruj tylko tych, którzy mają wszystkie wymagane kategorie i nie są już przypisani
      const fullyQualifiedEmployees = Array.from(employeeMap.values())
        .filter(
          (emp) =>
            categoryIds.every((catId) => emp.categories.has(catId)) && !assignedDriverIds.includes(emp.id),
        )
        .map(({ id, name, surname }) => ({ id, name, surname }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setEmployees(fullyQualifiedEmployees);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  const checkAvailability = async () => {
    if (!formData.vehicle_id) return;
  
    setCheckingAvailability(true);
    try {
      // BIERZEMY Z FAKTYCZNYCH FAZ: Załadunek -> Rozładunek
      const suggested = calculateSuggestedTimes();
  
      // fallback (jak brak faz) – możesz też zablokować sprawdzanie
      const fallbackStart = new Date(eventDate).toISOString();
      const fallbackEnd = new Date(new Date(eventDate).getTime() + 2 * 60 * 60000).toISOString(); // np. +2h
  
      const availableFrom = suggested?.availableFrom
        ? suggested.availableFrom.toISOString()
        : fallbackStart;
  
      const availableUntil = suggested?.availableUntil
        ? suggested.availableUntil.toISOString()
        : fallbackEnd;
  
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

  /**
   * Przypisuje pojazd do całego wydarzenia (od załadunku do rozładunku)
   * Tworzy fazy logistyczne jeśli nie istnieją
   * Pojazd jest widoczny w timeline jako jedna ciągła linia przez cały event
   *
   * ✅ FIX: departureTime traktujemy jako START LOGISTYKI (start załadunku),
   * a nie "wyjazd". Dzięki temu nie odejmujemy loadingMinutes drugi raz.
   */
  const assignVehicleToLogisticPhases = async (
    eventId: string,
    vehicleId: string,
    departureTime: Date, // START LOGISTYKI / START ZAŁADUNKU
    eventDateTime: Date, // START WYDARZENIA / ARRIVAL
    driverId: string | null,
    loadingMinutes: number,
    preparationMinutes: number,
    travelMinutes: number,
  ) => {
    try {
      // 1. Pobierz wszystkie phase_types (Załadunek, Dojazd, Powrót, Rozładunek)
      const { data: phaseTypes, error: phaseTypesError } = await supabase
        .from('event_phase_types')
        .select('id, name, default_duration_hours, sequence_priority')
        .in('name', ['Załadunek', 'Dojazd', 'Powrót', 'Rozładunek'])
        .order('sequence_priority');

      if (phaseTypesError) throw phaseTypesError;
      if (!phaseTypes || phaseTypes.length === 0) return;

      // 2. Pobierz istniejące fazy dla tego wydarzenia
      const { data: existingPhases, error: phasesError } = await supabase
        .from('event_phases')
        .select('id, phase_type_id, name, start_time, end_time')
        .eq('event_id', eventId)
        .in(
          'name',
          phaseTypes.map((pt) => pt.name),
        );

      if (phasesError) throw phasesError;

      const LOGISTIC_NAMES = ['Załadunek', 'Dojazd', 'Powrót', 'Rozładunek'];

      // 3. Pobierz też inne fazy (np. Realizacja) aby znać rzeczywisty koniec wydarzenia
      const { data: allPhases } = await supabase
      .from('event_phases')
      .select('end_time, name')
      .eq('event_id', eventId)
      .not('name', 'in', `(${LOGISTIC_NAMES.map((n) => `"${n}"`).join(',')})`)
      .order('end_time', { ascending: false })
      .limit(1);

      // Jeśli są jakieś fazy - użyj ostatniego czasu jako końca wydarzenia
      let eventEnd = new Date(eventDateTime.getTime() + 8 * 60 * 60000); // Domyślnie +8h
      if (allPhases && allPhases.length > 0 && allPhases[0].end_time) {
        eventEnd = new Date(allPhases[0].end_time);
      }

      /**
       * ✅ SPÓJNA OŚ CZASU (bez podwójnego odejmowania/dodawania):
       *
       * loadingStart  = departureTime (start logistyki / start załadunku)
       * loadingEnd    = loadingStart + loadingMinutes
       * prepStart     = loadingEnd
       * prepEnd       = prepStart + preparationMinutes
       * travelStart   = prepEnd (to jest realny "wyjazd")
       * travelEnd     = eventDateTime (przyjazd / start eventu)
       *
       * returnStart   = eventEnd
       * returnEnd     = returnStart + travelMinutes
       * unloadingStart= returnEnd
       * unloadingEnd  = unloadingStart + loadingMinutes (symetrycznie do załadunku)
       */
      const loadingStart = new Date(departureTime);
      const loadingEnd = new Date(loadingStart.getTime() + loadingMinutes * 60000);

      const preparationStart = loadingEnd;
      const preparationEnd = new Date(preparationStart.getTime() + preparationMinutes * 60000);

      const travelStart = preparationEnd;
      const travelEnd = eventDateTime;

      const returnStart = eventEnd;
      const returnEnd = new Date(returnStart.getTime() + travelMinutes * 60000);

      const unloadingStart = returnEnd;
      const unloadingEnd = new Date(unloadingStart.getTime() + loadingMinutes * 60000);

      // 5. Mapa phase_type_id -> phase
      const existingPhasesMap = new Map<
        string,
        { id: string; phase_type_id: string; name: string; start_time: string; end_time: string }
      >((existingPhases || []).map((p) => [p.phase_type_id, p]));

      // 6. Utwórz brakujące fazy
      const phaseTimesMap: Record<string, { start: Date; end: Date; purpose: string }> = {
        Załadunek: {
          start: loadingStart,
          end: loadingEnd,
          purpose: 'Załadunek sprzętu',
        },
        Dojazd: {
          start: travelStart,
          end: travelEnd,
          purpose: 'Transport do miejsca wydarzenia',
        },
        Powrót: {
          start: returnStart,
          end: returnEnd,
          purpose: 'Transport powrotny',
        },
        Rozładunek: {
          start: unloadingStart,
          end: unloadingEnd,
          purpose: 'Rozładunek i składowanie sprzętu',
        },
      };

      const createdPhases: Array<{ id: string; name: string }> = [];

      for (const phaseType of phaseTypes) {
        let phase = existingPhasesMap.get(phaseType.id);

        // Jeśli faza nie istnieje - utwórz ją
        if (!phase) {
          const times = phaseTimesMap[phaseType.name];
          if (!times) continue;

          const { data: newPhase, error: createError } = await supabase
            .from('event_phases')
            .insert([
              {
                event_id: eventId,
                phase_type_id: phaseType.id,
                name: phaseType.name,
                start_time: times.start.toISOString(),
                end_time: times.end.toISOString(),
                sequence_order: phaseType.sequence_priority,
              },
            ])
            .select('id')
            .single();

          if (createError) {
            console.error(`Error creating phase ${phaseType.name}:`, createError);
            continue;
          }

          createdPhases.push({
            id: newPhase.id,
            name: phaseType.name,
          });
        } else {
          createdPhases.push({
            id: phase.id,
            name: phase.name,
          });
        }
      }

      // 7. Przypisz pojazd do CAŁEGO wydarzenia (od początku załadunku do końca rozładunku)
      const firstPhase = createdPhases.find((p) => p.name === 'Załadunek');
      if (firstPhase) {
        const { error: assignError } = await supabase.from('event_phase_vehicles').upsert(
          [
            {
              phase_id: firstPhase.id,
              vehicle_id: vehicleId,
              assigned_start: loadingStart.toISOString(),
              assigned_end: unloadingEnd.toISOString(),
              driver_id: driverId,
              purpose: 'Pojazd przypisany do całego wydarzenia (załadunek → rozładunek)',
              notes: 'Automatycznie przypisany pojazd do wydarzenia',
            },
          ],
          {
            onConflict: 'phase_id,vehicle_id',
          },
        );

        if (assignError) {
          console.error('Error assigning vehicle to event:', assignError);
        }
      }
    } catch (error) {
      console.error('Error in assignVehicleToLogisticPhases:', error);
      // Nie rzucamy błędu - przypisanie do faz jest opcjonalne
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    try {
      const eventDateTime = new Date(eventDate);

      // Jeśli używamy sugerowanych czasów, użyj ich bezpośrednio

      let availableFrom: string;
      let availableUntil: string;
      let departureTime: Date;
      
      // DLA POJAZDU Z FLOTY: zawsze z faz załad/rozład
      if (!isExternal) {
        const range = calculateSuggestedTimes();
      
        if (!range || !range.hasLoadingPhase || !range.hasUnloadingPhase) {
          throw new Error('Brak faz Załadunek/Rozładunek – nie można poprawnie zarezerwować pojazdu.');
        }
      
        departureTime = range.availableFrom;
        availableFrom = range.availableFrom.toISOString();
        availableUntil = range.availableUntil.toISOString();
      } else {
        // zewnętrzny – możesz zostawić obecne liczenie (albo też wymusić fazy)
        departureTime = calculateDepartureTime();
        availableFrom = departureTime.toISOString();
        availableUntil = new Date(new Date(eventDate).getTime() + 8 * 60 * 60000).toISOString(); // albo coś innego
      }

      const insertData: any = {
        event_id: eventId,
        role: formData.role,
        driver_id: formData.driver_id || null,
        departure_location: formData.departure_location || null,
        loading_time_minutes: formData.loading_time_minutes,
        preparation_time_minutes: formData.preparation_time_minutes,
        travel_time_minutes: formData.travel_time_minutes,
        departure_time: departureTime.toISOString(),
        arrival_time: eventDateTime.toISOString(),
        estimated_distance_km: parseFloat(formData.estimated_distance_km) || null,
        fuel_cost_estimate: parseFloat(formData.fuel_cost_estimate) || null,
        toll_cost_estimate: parseFloat(formData.toll_cost_estimate) || null,
        notes: formData.notes || null,
        vehicle_available_from: availableFrom,
        vehicle_available_until: availableUntil,
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
          insertData.external_trailer_rental_cost = parseFloat(formData.external_trailer_rental_cost) || null;
          insertData.external_trailer_return_date = formData.external_trailer_return_date
            ? localDatetimeStringToUTC(formData.external_trailer_return_date)
            : null;
          insertData.external_trailer_return_location = formData.external_trailer_return_location || null;
          insertData.external_trailer_notes = formData.external_trailer_notes || null;
        } else {
          insertData.trailer_vehicle_id = formData.trailer_vehicle_id || null;
        }
      }

      if (editingVehicleId) {
        // Tryb edycji - UPDATE
        const { error } = await supabase.from('event_vehicles').update(insertData).eq('id', editingVehicleId);

        if (error) throw error;
        showSnackbar('Pojazd został zaktualizowany', 'success');
      } else {
        // Tryb dodawania - INSERT
        const { data: insertedVehicle, error } = await supabase
          .from('event_vehicles')
          .insert([insertData])
          .select('id')
          .single();

        if (error) throw error;

        // Przypisz pojazd do faz logistycznych
        if (!isExternal && formData.vehicle_id) {
          await assignVehicleToLogisticPhases(
            eventId,
            formData.vehicle_id,
            departureTime, // start logistyki (start załadunku) - spójne z nową osią czasu
            eventDateTime,
            formData.driver_id,
            formData.loading_time_minutes,
            formData.preparation_time_minutes,
            formData.travel_time_minutes,
          );

          // ✅ PEWNA INVALIDACJA: pobierz ID faz logistycznych i invaliduj per-phase
          const { data: logisticPhases, error: logisticPhasesError } = await supabase
            .from('event_phases')
            .select('id')
            .eq('event_id', eventId)
            .in('name', ['Załadunek', 'Dojazd', 'Powrót', 'Rozładunek']);

          if (!logisticPhasesError && logisticPhases?.length) {
            dispatch(
              eventPhasesApi.util.invalidateTags(
                logisticPhases.map((p) => ({ type: 'PhaseVehicles' as const, id: p.id })),
              ),
            );
          }
        }

        // Invaliduj cache pojazdów i logistyki dla wydarzenia
        dispatch(
          eventsApi.util.invalidateTags([
            { type: 'EventVehicles', id: eventId },
            { type: 'EventLogistics', id: eventId },
          ]),
        );

        showSnackbar('Pojazd został dodany do wydarzenia', 'success');
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding vehicle:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania pojazdu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const departureTime = calculateDepartureTime();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="flex items-center gap-3">
            <Truck className="h-6 w-6 text-[#d3bb73]" />
            <h2 className="text-xl font-bold text-[#e5e4e2]">
              {editingVehicleId ? 'Edytuj pojazd' : 'Dodaj pojazd do wydarzenia'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-[#0f1119]">
            <X className="h-5 w-5 text-[#e5e4e2]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
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
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Wybierz pojazd *</label>
              <select
                required
                value={formData.vehicle_id}
                onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="">Wybierz pojazd...</option>
                {vehicles.map((v) => (
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
                  onChange={(e) => setFormData({ ...formData, external_company_name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  placeholder="np. Rent-a-Car"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Nazwa pojazdu *</label>
                <input
                  type="text"
                  required
                  value={formData.external_vehicle_name}
                  onChange={(e) => setFormData({ ...formData, external_vehicle_name: e.target.value })}
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
                  onChange={(e) => setFormData({ ...formData, external_rental_cost: e.target.value })}
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
                          <div className="font-medium text-[#e5e4e2]">{conflict.event_name}</div>
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
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rola pojazdu *</label>
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
                  <span className="text-xs text-[#d3bb73]">(tylko z wymaganymi prawami jazdy)</span>
                )}
              </label>
              <select
                value={formData.driver_id}
                onChange={(e) => setFormData({ ...formData, driver_id: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                disabled={!isExternal && !formData.vehicle_id}
              >
                <option value="">
                  {!isExternal && !formData.vehicle_id
                    ? 'Najpierw wybierz pojazd...'
                    : employees.length === 0 && formData.vehicle_id
                      ? 'Brak kierowców z wymaganymi uprawnieniami'
                      : 'Wybierz kierowcę...'}
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} {e.surname}
                  </option>
                ))}
              </select>
              {!isExternal && formData.vehicle_id && employees.length === 0 && (
                <p className="mt-1 text-xs text-yellow-500">
                  Brak dostępnych pracowników z wymaganymi prawami jazdy dla tego pojazdu. Sprawdź wymagania pojazdu w
                  panelu floty.
                </p>
              )}
            </div>
          </div>


          {/* Przyczepka */}
          {!isExternal && (
            <div className="space-y-4 rounded-lg bg-[#0f1119] p-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="has_trailer"
                  checked={formData.has_trailer}
                  onChange={(e) => setFormData({ ...formData, has_trailer: e.target.checked })}
                  className="h-5 w-5 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <label htmlFor="has_trailer" className="cursor-pointer font-medium text-[#e5e4e2]">
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
                    <label htmlFor="trailer_own" className="cursor-pointer text-sm text-[#e5e4e2]">
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
                        {trailers.map((t) => (
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
                            setFormData({ ...formData, external_trailer_company: e.target.value })
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

          {/* Czasy */}
          <div className="space-y-4 rounded-lg bg-[#0f1119] p-4">
            <h4 className="flex items-center gap-2 font-medium text-[#e5e4e2]">
              <Clock className="h-5 w-5 text-[#d3bb73]" />
              Planowanie czasu
            </h4>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">


              {/* Sugerowane czasy na podstawie faz */}
              {suggestedTimes && (
                <div className="col-span-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-400" />
                    <span className="text-sm font-semibold text-blue-300">
                      Sugerowane czasy na podstawie faz wydarzenia
                    </span>
                  </div>
                  <div className="mb-3 text-xs text-[#e5e4e2]/70">{suggestedTimes.explanation}</div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-[#e5e4e2]/60">Dostępny od:</div>
                      <div className="font-medium text-blue-300">
                        {suggestedTimes.availableFrom.toLocaleString('pl-PL', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-[#e5e4e2]/60">Dostępny do:</div>
                      <div className="font-medium text-blue-300">
                        {suggestedTimes.availableUntil.toLocaleString('pl-PL', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={applySuggestedTimes}
                    className="mt-3 w-full rounded-lg bg-blue-500/20 px-4 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/30"
                  >
                    Użyj sugerowanych czasów
                  </button>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Czas załadunku (min)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.loading_time_minutes}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      loading_time_minutes: parseInt(e.target.value) || 0,
                    });
                    setUseSuggestedTimes(false); // Reset przy ręcznej zmianie
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Czas dojazdu (min)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.travel_time_minutes}
                  onChange={(e) => {
                    setFormData({
                      ...formData,
                      travel_time_minutes: parseInt(e.target.value) || 0,
                    });
                    setUseSuggestedTimes(false); // Reset przy ręcznej zmianie
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>

          {/* Koszty */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Dystans (km)</label>
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
                onChange={(e) => setFormData({ ...formData, fuel_cost_estimate: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, toll_cost_estimate: e.target.value })}
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
              disabled={loading || checkingAvailability}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Dodawanie...' : 'Dodaj pojazd'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
