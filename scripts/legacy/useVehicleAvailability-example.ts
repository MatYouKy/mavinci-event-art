/**
 * Hook do sprawdzania dostępności pojazdów
 *
 * Użycie w komponencie AddEventVehicleModal:
 *
 * 1. Dodaj ten hook do projektu jako useVehicleAvailability.ts
 * 2. W komponencie AddEventVehicleModal, użyj hooka do pobrania dostępnych pojazdów
 * 3. Wyświetl pojazdy z oznaczeniem dostępności
 */

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';

interface AvailableVehicle {
  id: string;
  name: string;
  brand: string;
  model: string;
  registration_number: string;
  status: string;
  vehicle_type: string;
  number_of_seats: number;
  year: number;
  notes: string;
  is_available: boolean;
  conflicting_events_count: number;
}

interface UseVehicleAvailabilityParams {
  startDate: Date | null;
  endDate: Date | null;
  excludeEventVehicleId?: string | null;
  vehicleType?: string | null;
  enabled?: boolean;
}

export function useVehicleAvailability({
  startDate,
  endDate,
  excludeEventVehicleId = null,
  vehicleType = null,
  enabled = true,
}: UseVehicleAvailabilityParams) {
  const [vehicles, setVehicles] = useState<AvailableVehicle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !startDate || !endDate) {
      return;
    }

    const fetchAvailableVehicles = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: rpcError } = await supabase.rpc(
          'get_available_vehicles_for_event',
          {
            p_start_date: startDate.toISOString(),
            p_end_date: endDate.toISOString(),
            p_exclude_event_vehicle_id: excludeEventVehicleId,
            p_vehicle_type: vehicleType,
          }
        );

        if (rpcError) throw rpcError;

        setVehicles(data || []);
      } catch (err) {
        console.error('Error fetching available vehicles:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchAvailableVehicles();
  }, [startDate, endDate, excludeEventVehicleId, vehicleType, enabled]);

  // Rozdziel pojazdy na dostępne i niedostępne
  const availableVehicles = vehicles.filter((v) => v.is_available);
  const unavailableVehicles = vehicles.filter((v) => !v.is_available);

  return {
    vehicles,
    availableVehicles,
    unavailableVehicles,
    isLoading,
    error,
  };
}

/**
 * Przykład użycia w komponencie AddEventVehicleModal:
 */

/*
import { useVehicleAvailability } from '@/hooks/useVehicleAvailability';

export default function AddEventVehicleModal({
  eventStartDate,
  eventEndDate,
  onClose
}: Props) {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const {
    availableVehicles,
    unavailableVehicles,
    isLoading
  } = useVehicleAvailability({
    startDate: eventStartDate,
    endDate: eventEndDate,
    enabled: true,
  });

  return (
    <div className="modal">
      <h2>Dodaj pojazd do wydarzenia</h2>

      {isLoading ? (
        <div>Ładowanie pojazdów...</div>
      ) : (
        <>
          {availableVehicles.length > 0 && (
            <div className="available-vehicles">
              <h3>Dostępne pojazdy ({availableVehicles.length})</h3>
              {availableVehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="vehicle-item available"
                  onClick={() => setSelectedVehicleId(vehicle.id)}
                >
                  <span className="status-badge success">Dostępny</span>
                  <div className="vehicle-info">
                    <strong>{vehicle.name}</strong>
                    <span>{vehicle.brand} {vehicle.model}</span>
                    <span>{vehicle.registration_number}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {unavailableVehicles.length > 0 && (
            <div className="unavailable-vehicles">
              <h3>Niedostępne pojazdy ({unavailableVehicles.length})</h3>
              {unavailableVehicles.map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="vehicle-item unavailable"
                  title={`Konfliktów: ${vehicle.conflicting_events_count}`}
                >
                  <span className="status-badge error">
                    Niedostępny ({vehicle.conflicting_events_count} konfliktów)
                  </span>
                  <div className="vehicle-info">
                    <strong>{vehicle.name}</strong>
                    <span>{vehicle.brand} {vehicle.model}</span>
                    <span>{vehicle.registration_number}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
*/

/**
 * Dodatkowa funkcja do sprawdzania pojedynczego pojazdu:
 */
export async function checkSingleVehicleAvailability(
  vehicleId: string,
  startDate: Date,
  endDate: Date,
  excludeEventVehicleId?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_vehicle_available', {
    p_vehicle_id: vehicleId,
    p_start_date: startDate.toISOString(),
    p_end_date: endDate.toISOString(),
    p_exclude_event_vehicle_id: excludeEventVehicleId || null,
  });

  if (error) {
    console.error('Error checking vehicle availability:', error);
    return false;
  }

  return data === true;
}
