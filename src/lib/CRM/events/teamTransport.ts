/**
 * Transport zespołu wydarzenia: którym autem jedzie każda osoba i czy wystarcza miejsc siedzących.
 *
 * Kierowcę przypisuje logistyka (`event_vehicles.driver_id`); pozostali członkowie zespołu mają
 * `employee_assignments.transport_event_vehicle_id`. Miejsca auta z floty: `vehicles.number_of_seats` (z kierowcą).
 * Wspólne dla zakładki Zespół w CRM i aplikacji na Maca (przez `/bridge/native`).
 */

export type TeamTransportVehicle = {
  id: string;
  name: string;
  registration: string | null;
  /** Miejsca siedzące razem z kierowcą; `null` — nieznane (np. auto z wynajmu). */
  seats: number | null;
  driverId: string | null;
  external: boolean;
};

export type TeamTransportMember = {
  employeeId: string;
  transportVehicleId: string | null;
  /** Odrzucone zaproszenie — ta osoba nie jedzie. */
  rejected?: boolean;
};

export type TeamTransportLoad = {
  vehicle: TeamTransportVehicle;
  /** Kierowca + pasażerowie. */
  people: number;
  overCapacity: boolean;
};

export type TeamTransportSummary = {
  loads: TeamTransportLoad[];
  /** Osoby z zespołu bez auta (nie są kierowcami i nie mają przypisanego pojazdu). */
  withoutVehicle: number;
  teamSize: number;
  knownSeats: number;
  vehiclesWithUnknownSeats: number;
  /** Brakujące miejsca dla całego zespołu — `null`, gdy nie da się tego ocenić (auta bez liczby miejsc). */
  shortage: number | null;
  warnings: string[];
};

/** Kolumny pojazdów wydarzenia potrzebne do przydziału transportu. */
export const TEAM_TRANSPORT_VEHICLE_SELECT =
  'id, vehicle_id, driver_id, is_external, external_company_name, created_at, vehicles!event_vehicles_vehicle_id_fkey(name, registration_number, number_of_seats)';

export const mapTeamTransportVehicles = (rows: any[]): TeamTransportVehicle[] =>
  rows.map((row) => {
    const fleet = Array.isArray(row?.vehicles) ? row.vehicles[0] : row?.vehicles;
    const seats = Number(fleet?.number_of_seats);
    return {
      id: String(row.id),
      name: String(fleet?.name || (row?.is_external ? row?.external_company_name || 'Pojazd zewnętrzny' : 'Pojazd')),
      registration: fleet?.registration_number ? String(fleet.registration_number) : null,
      seats: Number.isFinite(seats) && seats > 0 ? Math.round(seats) : null,
      driverId: row?.driver_id ? String(row.driver_id) : null,
      external: row?.is_external === true,
    };
  });

const people = (count: number) => `${count} ${count === 1 ? 'osoba' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'osoby' : 'osób'}`;

export function summarizeTeamTransport(vehicles: TeamTransportVehicle[], members: TeamTransportMember[]): TeamTransportSummary {
  const travelling = members.filter((member) => member.employeeId && !member.rejected);
  const drivers = new Set(vehicles.map((vehicle) => vehicle.driverId).filter((id): id is string => Boolean(id)));
  const loads = vehicles.map((vehicle) => {
    const passengers = travelling.filter((member) => member.transportVehicleId === vehicle.id && member.employeeId !== vehicle.driverId).length;
    const count = passengers + (vehicle.driverId ? 1 : 0);
    return { vehicle, people: count, overCapacity: vehicle.seats !== null && count > vehicle.seats };
  });
  const withoutVehicle = travelling.filter((member) => !drivers.has(member.employeeId) && !member.transportVehicleId).length;
  const teamIds = new Set(travelling.map((member) => member.employeeId));
  drivers.forEach((id) => teamIds.add(id));
  const teamSize = teamIds.size;
  const knownSeats = vehicles.reduce((sum, vehicle) => sum + (vehicle.seats ?? 0), 0);
  const vehiclesWithUnknownSeats = vehicles.filter((vehicle) => vehicle.seats === null).length;
  const missing = Math.max(0, teamSize - knownSeats);
  const shortage = vehiclesWithUnknownSeats === 0 || missing === 0 ? missing : null;

  const warnings: string[] = [];
  loads.filter((load) => load.overCapacity).forEach((load) => {
    warnings.push(`${load.vehicle.name}: ${people(load.people)} na ${load.vehicle.seats} miejsc.`);
  });
  if (vehicles.length && shortage) {
    warnings.push(`Za mało miejsc w autach: zespół to ${people(teamSize)}, miejsc ${knownSeats}. Dodaj auto w logistyce lub ustal dojazd własny.`);
  }
  return { loads, withoutVehicle, teamSize, knownSeats, vehiclesWithUnknownSeats, shortage, warnings };
}

/** „Robur · 3/5 miejsc” — etykieta auta w menu przydziału. */
export const teamTransportVehicleLabel = (load: TeamTransportLoad) =>
  `${load.vehicle.name}${load.vehicle.registration ? ` (${load.vehicle.registration})` : ''} · ${load.people}/${load.vehicle.seats ?? '?'} miejsc`;
