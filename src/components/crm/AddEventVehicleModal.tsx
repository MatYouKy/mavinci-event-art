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
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddEventVehicleModalProps {
  eventId: string;
  eventDate: string;
  eventLocation: string;
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
    fetchVehicles();
    fetchTrailers();
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
      setVehicles(data || []);
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

  const fetchEmployees = async () => {
    try {
      if (!formData.vehicle_id || isExternal) {
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, surname')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        setEmployees(data || []);
        return;
      }

      const { data: requirements, error: reqError } = await supabase
        .from('vehicle_license_requirements')
        .select('license_category_id')
        .eq('vehicle_id', formData.vehicle_id)
        .eq('is_required', true);

      if (reqError) throw reqError;

      if (!requirements || requirements.length === 0) {
        const { data, error } = await supabase
          .from('employees')
          .select('id, name, surname')
          .eq('is_active', true)
          .order('name');

        if (error) throw error;
        setEmployees(data || []);
        return;
      }

      const categoryIds = requirements.map(r => r.license_category_id);

      const { data: qualifiedEmployees, error: empError } = await supabase
        .from('employee_driving_licenses')
        .select(`
          employee_id,
          employee:employees!inner(id, name, surname)
        `)
        .in('license_category_id', categoryIds)
        .order('employee(name)');

      if (empError) throw empError;

      const uniqueEmployees = Array.from(
        new Map(
          qualifiedEmployees.map(item => [
            item.employee.id,
            { id: item.employee.id, name: item.employee.name, surname: item.employee.surname }
          ])
        ).values()
      );

      setEmployees(uniqueEmployees);
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

      const availableFrom = new Date(
        eventDateTime.getTime() - totalMinutes * 60000
      ).toISOString();

      const availableUntil = new Date(
        eventDateTime.getTime() + 8 * 60 * 60000
      ).toISOString();

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
      const availableUntil = new Date(
        eventDateTime.getTime() + 8 * 60 * 60000
      ).toISOString();

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
          insertData.external_trailer_return_date = formData.external_trailer_return_date || null;
          insertData.external_trailer_return_location = formData.external_trailer_return_location || null;
          insertData.external_trailer_notes = formData.external_trailer_notes || null;
        } else {
          insertData.trailer_vehicle_id = formData.trailer_vehicle_id || null;
        }
      }

      const { error } = await supabase.from('event_vehicles').insert([insertData]);

      if (error) throw error;

      showSnackbar('Pojazd został dodany do wydarzenia', 'success');
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Truck className="w-6 h-6 text-[#d3bb73]" />
            <h2 className="text-xl font-bold text-[#e5e4e2]">Dodaj pojazd do wydarzenia</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#0f1119] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Typ pojazdu */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-3">
              Typ pojazdu
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!isExternal}
                  onChange={() => setIsExternal(false)}
                  className="w-4 h-4"
                />
                <span className="text-[#e5e4e2]">Pojazd z floty</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={isExternal}
                  onChange={() => setIsExternal(true)}
                  className="w-4 h-4"
                />
                <span className="text-[#e5e4e2]">Pojazd zewnętrzny (wypożyczony)</span>
              </label>
            </div>
          </div>

          {/* Wybór pojazdu */}
          {!isExternal ? (
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Wybierz pojazd *
              </label>
              <select
                required
                value={formData.vehicle_id}
                onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Nazwa firmy wypożyczającej *
                </label>
                <input
                  type="text"
                  required
                  value={formData.external_company_name}
                  onChange={(e) =>
                    setFormData({ ...formData, external_company_name: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  placeholder="np. Rent-a-Car"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Nazwa pojazdu *
                </label>
                <input
                  type="text"
                  required
                  value={formData.external_vehicle_name}
                  onChange={(e) =>
                    setFormData({ ...formData, external_vehicle_name: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  placeholder="np. Mercedes Sprinter"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Koszt wypożyczenia (zł)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.external_rental_cost}
                  onChange={(e) =>
                    setFormData({ ...formData, external_rental_cost: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

          {/* Konflikty dostępności */}
          {!isExternal && conflicts.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-medium text-orange-400 mb-2">
                    ⚠️ Konflikty rezerwacji
                  </h4>
                  <p className="text-sm text-[#e5e4e2]/80 mb-3">
                    Ten pojazd jest już zarezerwowany na inne wydarzenia w tym samym czasie:
                  </p>
                  <div className="space-y-2">
                    {conflicts.map((conflict, idx) => (
                      <div
                        key={idx}
                        className="bg-[#1c1f33] rounded-lg p-3 flex items-start justify-between"
                      >
                        <div>
                          <div className="font-medium text-[#e5e4e2]">
                            {conflict.event_name}
                          </div>
                          <div className="text-sm text-[#e5e4e2]/60 mt-1">
                            <div>
                              {new Date(conflict.event_date).toLocaleString('pl-PL')}
                            </div>
                            <div>{conflict.event_location}</div>
                          </div>
                        </div>
                        <a
                          href={`/crm/events/${conflict.conflicting_event_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                        >
                          Zobacz
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Szczegóły */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Rola pojazdu *
              </label>
              <select
                required
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="transport_equipment">Transport sprzętu</option>
                <option value="transport_crew">Transport ekipy</option>
                <option value="support">Wsparcie</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Kierowca {!isExternal && formData.vehicle_id && (
                  <span className="text-xs text-[#d3bb73]">
                    (tylko z wymaganymi prawami jazdy)
                  </span>
                )}
              </label>
              <select
                value={formData.driver_id}
                onChange={(e) => setFormData({ ...formData, driver_id: e.target.value })}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="">Wybierz kierowcę...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} {e.surname}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Przyczepka */}
          {!isExternal && (
            <div className="bg-[#0f1119] rounded-lg p-4 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="has_trailer"
                  checked={formData.has_trailer}
                  onChange={(e) => setFormData({ ...formData, has_trailer: e.target.checked })}
                  className="w-5 h-5 rounded bg-[#1c1f33] border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <label htmlFor="has_trailer" className="font-medium text-[#e5e4e2] cursor-pointer">
                  Pojazd z przyczepką
                </label>
              </div>

              {formData.has_trailer && (
                <div className="space-y-4 pl-8 border-l-2 border-[#d3bb73]/20">
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      id="trailer_own"
                      name="trailer_type"
                      checked={!formData.is_trailer_external}
                      onChange={() => setFormData({ ...formData, is_trailer_external: false })}
                      className="w-4 h-4 text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <label htmlFor="trailer_own" className="text-sm text-[#e5e4e2] cursor-pointer">
                      Własna przyczepka
                    </label>
                  </div>

                  {!formData.is_trailer_external && (
                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        Wybierz przyczepkę
                      </label>
                      <select
                        value={formData.trailer_vehicle_id}
                        onChange={(e) => setFormData({ ...formData, trailer_vehicle_id: e.target.value })}
                        className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
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
                      className="w-4 h-4 text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <label htmlFor="trailer_external" className="text-sm text-[#e5e4e2] cursor-pointer">
                      Przyczepka wynajęta
                    </label>
                  </div>

                  {formData.is_trailer_external && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                          Nazwa przyczepki
                        </label>
                        <input
                          type="text"
                          value={formData.external_trailer_name}
                          onChange={(e) => setFormData({ ...formData, external_trailer_name: e.target.value })}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                          placeholder="np. Przyczepka 3.5t"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                          Firma wypożyczająca
                        </label>
                        <input
                          type="text"
                          value={formData.external_trailer_company}
                          onChange={(e) => setFormData({ ...formData, external_trailer_company: e.target.value })}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                          placeholder="np. Rent-a-Trailer Sp. z o.o."
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                            Koszt wynajmu (PLN)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={formData.external_trailer_rental_cost}
                            onChange={(e) => setFormData({ ...formData, external_trailer_rental_cost: e.target.value })}
                            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                            placeholder="0.00"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                            Termin zwrotu
                          </label>
                          <input
                            type="datetime-local"
                            value={formData.external_trailer_return_date}
                            onChange={(e) => setFormData({ ...formData, external_trailer_return_date: e.target.value })}
                            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                          Miejsce zwrotu
                        </label>
                        <input
                          type="text"
                          value={formData.external_trailer_return_location}
                          onChange={(e) => setFormData({ ...formData, external_trailer_return_location: e.target.value })}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                          placeholder="np. Warszawa, ul. Przykładowa 123"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                          Dodatkowe informacje
                        </label>
                        <textarea
                          value={formData.external_trailer_notes}
                          onChange={(e) => setFormData({ ...formData, external_trailer_notes: e.target.value })}
                          rows={2}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] resize-none"
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
          <div className="bg-[#0f1119] rounded-lg p-4 space-y-4">
            <h4 className="font-medium text-[#e5e4e2] flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#d3bb73]" />
              Planowanie czasu
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
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
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
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
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
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
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>

            <div className="bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-lg p-3">
              <div className="text-sm text-[#e5e4e2]/80 mb-1">
                Obliczony czas wyjazdu:
              </div>
              <div className="text-lg font-bold text-[#d3bb73]">
                {departureTime.toLocaleString('pl-PL', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </div>
              <div className="text-xs text-[#e5e4e2]/60 mt-1">
                Suma czasów: {formData.preparation_time_minutes + formData.loading_time_minutes + formData.travel_time_minutes} minut
              </div>
            </div>
          </div>

          {/* Koszty */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Dystans (km)
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.estimated_distance_km}
                onChange={(e) =>
                  setFormData({ ...formData, estimated_distance_km: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Koszt paliwa (zł)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.fuel_cost_estimate}
                onChange={(e) =>
                  setFormData({ ...formData, fuel_cost_estimate: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Koszt autostrad (zł)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.toll_cost_estimate}
                onChange={(e) =>
                  setFormData({ ...formData, toll_cost_estimate: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Notatki */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] resize-none"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          {/* Przyciski */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[#d3bb73]/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading || checkingAvailability}
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Dodawanie...' : 'Dodaj pojazd'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
