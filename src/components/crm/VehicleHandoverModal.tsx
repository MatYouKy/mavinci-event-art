'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Vehicle {
  id: string;
  vehicle_id: string | null;
  is_in_use: boolean;
  pickup_timestamp: string | null;
  return_timestamp: string | null;
  vehicles?: {
    name: string;
    registration_number: string | null;
  } | null;
  external_company_name?: string | null;
}

interface VehicleHandoverModalProps {
  vehicle: Vehicle;
  onClose: () => void;
  onSuccess: () => void;
}

export default function VehicleHandoverModal({
  vehicle,
  onClose,
  onSuccess,
}: VehicleHandoverModalProps) {
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();

  // Automatycznie określ typ operacji na podstawie flagi is_in_use
  const handoverType: 'pickup' | 'return' = vehicle.is_in_use ? 'return' : 'pickup';

  const [odometerReading, setOdometerReading] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastOdometer, setLastOdometer] = useState<number | null>(null);
  const [loadingLastOdometer, setLoadingLastOdometer] = useState(true);

  useEffect(() => {
    fetchLastOdometer();
  }, [vehicle.vehicle_id]);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('pl-PL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const fetchLastOdometer = async () => {
    if (!vehicle.vehicle_id) {
      setLoadingLastOdometer(false);
      return;
    }

    try {
      // Najpierw pobierz aktualny przebieg z tabeli vehicles
      const { data: vehicleData, error: vehicleError } = await supabase
        .from('vehicles')
        .select('current_mileage')
        .eq('id', vehicle.vehicle_id)
        .maybeSingle();

      if (vehicleError) throw vehicleError;

      if (vehicleData?.current_mileage) {
        setLastOdometer(vehicleData.current_mileage);
        setOdometerReading(vehicleData.current_mileage.toString());
      } else {
        // Jeśli nie ma przebiegu w vehicles, sprawdź ostatni handover
        const { data: eventVehicles } = await supabase
          .from('event_vehicles')
          .select('id')
          .eq('vehicle_id', vehicle.vehicle_id);

        const eventVehicleIds = eventVehicles?.map((ev) => ev.id) || [];

        if (eventVehicleIds.length > 0) {
          const { data, error } = await supabase
            .from('vehicle_handovers')
            .select('odometer_reading, timestamp, handover_type')
            .in('event_vehicle_id', eventVehicleIds)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) throw error;

          if (data) {
            setLastOdometer(data.odometer_reading);
            setOdometerReading(data.odometer_reading.toString());
          }
        }
      }
    } catch (error: any) {
      console.error('Error fetching last odometer:', error);
    } finally {
      setLoadingLastOdometer(false);
    }
  };

  const handleSubmit = async () => {
    if (!odometerReading || isNaN(Number(odometerReading))) {
      showSnackbar('Podaj prawidłowy stan licznika', 'error');
      return;
    }

    if (!employee) {
      showSnackbar('Nie znaleziono danych pracownika', 'error');
      return;
    }

    setLoading(true);

    try {
      // Walidacja: sprawdź czy pojazd nie jest w użyciu
      if (handoverType === 'pickup' && vehicle.vehicle_id) {
        const { data: eventVehicles } = await supabase
          .from('event_vehicles')
          .select('id')
          .eq('vehicle_id', vehicle.vehicle_id);

        const eventVehicleIds = eventVehicles?.map((ev) => ev.id) || [];

        if (eventVehicleIds.length > 0) {
          const { data: lastHandover } = await supabase
            .from('vehicle_handovers')
            .select('handover_type, timestamp, driver_id, employees(name, surname)')
            .in('event_vehicle_id', eventVehicleIds)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastHandover && lastHandover.handover_type === 'pickup') {
            const driverName = lastHandover.employees
              ? `${lastHandover.employees.name} ${lastHandover.employees.surname}`
              : 'Nieznany kierowca';
            showSnackbar(
              `Pojazd nie został jeszcze zdany! Ostatni odbiór: ${driverName} (${formatDate(lastHandover.timestamp)})`,
              'error',
            );
            setLoading(false);
            return;
          }
        }
      }

      const { error } = await supabase.from('vehicle_handovers').insert({
        event_vehicle_id: vehicle.id,
        driver_id: employee.id,
        handover_type: handoverType,
        odometer_reading: parseInt(odometerReading),
        timestamp: new Date().toISOString(),
        notes: notes || null,
      });

      if (error) throw error;

      showSnackbar(handoverType === 'pickup' ? 'Pojazd odebrany' : 'Pojazd zdany', 'success');
      onSuccess();
    } catch (error: any) {
      console.error('Error saving handover:', error);
      showSnackbar(error.message || 'Błąd podczas zapisywania', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-[#e5e4e2]">
            {handoverType === 'pickup' ? 'Odbierz pojazd' : 'Zdaj pojazd'}
          </h3>
          <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-[#0f1119]">
            <X className="h-5 w-5 text-[#e5e4e2]/60" />
          </button>
        </div>

        <p className="mb-6 text-[#e5e4e2]/60">
          {vehicle.vehicles?.name || vehicle.external_company_name}
          {vehicle.vehicles?.registration_number && <> ({vehicle.vehicles.registration_number})</>}
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Stan licznika (km)
              {loadingLastOdometer ? (
                <span className="ml-2 text-xs">Ładowanie...</span>
              ) : lastOdometer ? (
                <span className="ml-2 text-xs text-[#d3bb73]">
                  Ostatni: {lastOdometer.toLocaleString('pl-PL')} km
                </span>
              ) : null}
            </label>
            <input
              type="number"
              value={odometerReading}
              onChange={(e) => setOdometerReading(e.target.value)}
              className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              placeholder="np. 125000"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Uwagi (opcjonalnie)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              rows={3}
              placeholder="np. Stan techniczny, uszkodzenia, tankowanie..."
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119] disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 rounded bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
