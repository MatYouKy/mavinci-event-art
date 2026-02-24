'use client';

import { useState, useEffect } from 'react';
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

  const [isExternal, setIsExternal] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trailers, setTrailers] = useState<Vehicle[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

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
      await Promise.all([fetchVehicles(), fetchTrailers()]);
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

  const loadVehicleData = async () => {
    if (!editingVehicleId) return;

    try {
      const { data, error } = await supabase
        .from('event_vehicles')
        .select('*')
        .eq('id', editingVehicleId)
        .single();

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
        external_trailer_return_date:
          utcToLocalDatetimeString(data.external_trailer_return_date) || '',
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
            categoryIds.every((catId) => emp.categories.has(catId)) &&
            !assignedDriverIds.includes(emp.id),
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
      const eventDateTime = new Date(eventDate);
      const totalMinutes =
        (formData.loading_time_minutes || 0) +
        (formData.preparation_time_minutes || 0) +
        (formData.travel_time_minutes || 0);

      const availableFrom = new Date(eventDateTime.getTime() - totalMinutes * 60000).toISOString();

      const availableUntil = new Date(eventDateTime.getTime() + 8 * 60 * 60000).toISOString();

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
    return new Date(eventDateTime.getTime() - totalMinutes * 60000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const eventDateTime = new Date(eventDate);
      const departureTime = calculateDepartureTime();
      const totalMinutes =
        (formData.loading_time_minutes || 0) +
        (formData.preparation_time_minutes || 0) +
        (formData.travel_time_minutes || 0);

      const availableFrom = departureTime.toISOString();
      const availableUntil = new Date(eventDateTime.getTime() + 8 * 60 * 60000).toISOString();

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
        // Tryb edycji - UPDATE
        const { error } = await supabase
          .from('event_vehicles')
          .update(insertData)
          .eq('id', editingVehicleId);

        if (error) throw error;
        showSnackbar('Pojazd został zaktualizowany', 'success');
      } else {
        // Tryb dodawania - INSERT
        const { error } = await supabase.from('event_vehicles').insert([insertData]);

        if (error) throw error;
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
                  Brak dostępnych pracowników z wymaganymi prawami jazdy dla tego pojazdu. Sprawdź
                  wymagania pojazdu w panelu floty.
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
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Czas przygotowania (min)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.preparation_time_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      preparation_time_minutes: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Czas załadunku (min)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.loading_time_minutes}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      loading_time_minutes: parseInt(e.target.value) || 0,
                    })
                  }
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
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      travel_time_minutes: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-3">
              <div className="mb-1 text-sm text-[#e5e4e2]/80">Obliczony czas wyjazdu:</div>
              <div className="text-lg font-bold text-[#d3bb73]">
                {departureTime.toLocaleString('pl-PL', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </div>
              <div className="mt-1 text-xs text-[#e5e4e2]/60">
                Suma czasów:{' '}
                {formData.preparation_time_minutes +
                  formData.loading_time_minutes +
                  formData.travel_time_minutes}{' '}
                minut
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
