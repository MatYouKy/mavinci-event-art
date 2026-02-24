'use client';

import React, { useState, useMemo } from 'react';
import { X, User, Package, Car, Plus, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import {
  EventPhase,
  useGetPhaseAssignmentsQuery,
  useGetPhaseEquipmentQuery,
  useGetPhaseVehiclesQuery,
} from '@/store/api/eventPhasesApi';
import { useGetEventEmployeesQuery, useGetEventEquipmentQuery, useGetEventVehiclesQuery } from '../../../store/api/eventsApi';

interface PhaseResourcesPanelProps {
  phase: EventPhase;
  eventId: string;
  onClose: () => void;
  resourceFilter: 'all' | 'selected' | 'event';
}

export const PhaseResourcesPanel: React.FC<PhaseResourcesPanelProps> = ({
  phase,
  eventId,
  onClose,
  resourceFilter,
}) => {
  const [currentTab, setCurrentTab] = useState<'employees' | 'equipment' | 'vehicles'>('employees');

  // Get all data from event
  const { data: eventEquipment = [], isLoading: equipmentLoading } = useGetEventEquipmentQuery(eventId, {
    skip: !eventId,
  });
  const { data: eventEmployees = [], isLoading: teamLoading } = useGetEventEmployeesQuery(eventId, {
    skip: !eventId,
  });
  const { data: eventVehicles = [], isLoading: vehiclesLoading } = useGetEventVehiclesQuery(eventId, {
    skip: !eventId,
  });

  // Get phase-specific assignments
  const { data: phaseAssignments = [] } = useGetPhaseAssignmentsQuery(phase.id);
  const { data: phaseEquipment = [] } = useGetPhaseEquipmentQuery(phase.id);
  const { data: phaseVehicles = [] } = useGetPhaseVehiclesQuery(phase.id);

  // Filter event data to show only items in this phase's timeframe
  const filteredEquipment = useMemo(() => {
    if (!eventEquipment) return [];
    // Equipment is assigned to entire event, not specific times
    // Show all equipment for the event in all phases
    return eventEquipment;
  }, [eventEquipment]);

  const filteredEmployees = useMemo(() => {
    if (!eventEmployees) return [];
    // eventEmployees contains employee_assignments with nested employee object
    // Extract and flatten the employee data
    return eventEmployees
      .map((assignment: any) => assignment.employee)
      .filter((emp: any) => emp); // Filter out any null employees
  }, [eventEmployees]);

  const filteredVehicles = useMemo(() => {
    if (!eventVehicles) return [];
    const phaseStart = new Date(phase.start_time);
    const phaseEnd = new Date(phase.end_time);

    return eventVehicles.filter(vehicle => {
      if (!vehicle.assigned_start || !vehicle.assigned_end) return false;
      const vehicleStart = new Date(vehicle.assigned_start);
      const vehicleEnd = new Date(vehicle.assigned_end);

      return (vehicleStart <= phaseEnd && vehicleEnd >= phaseStart);
    });
  }, [eventVehicles, phase.start_time, phase.end_time]);

  const phaseColor = phase.color || phase.phase_type?.color || '#3b82f6';

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'accepted':
        return <CheckCircle className="h-5 w-5 text-green-400" />;
      case 'rejected':
        return <XCircle className="h-5 w-5 text-red-400" />;
      default:
        return <AlertCircle className="h-5 w-5 text-yellow-400" />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'Zaakceptowane';
      case 'rejected':
        return 'Odrzucone';
      default:
        return 'Oczekuje';
    }
  };

  const formatTime = (date: string) => {
    return new Date(date).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const calculateDuration = (start: string, end: string): string => {
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const tabs = [
    { id: 'employees' as const, label: 'Pracownicy', icon: User, count: filteredEmployees.length },
    { id: 'equipment' as const, label: 'Sprzęt', icon: Package, count: filteredEquipment.length },
    { id: 'vehicles' as const, label: 'Pojazdy', icon: Car, count: filteredVehicles.length },
  ];

  const isLoading = teamLoading || equipmentLoading || vehiclesLoading;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
      {/* Header */}
      <div
        className="border-b border-[#d3bb73]/10 p-4"
        style={{ backgroundColor: `${phaseColor}10` }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#e5e4e2]">{phase.name}</h2>
            <p className="text-xs text-[#e5e4e2]/60">
              {formatTime(phase.start_time)} - {formatTime(phase.end_time)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#d3bb73]/10">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                currentTab === tab.id
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              <span className="rounded-full bg-[#d3bb73]/20 px-2 py-0.5 text-xs">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-[#e5e4e2]/60">Ładowanie...</div>
          </div>
        ) : (
          <>
            {/* Employees Tab */}
            {currentTab === 'employees' && (
              <div>
                <div className="border-b border-[#d3bb73]/10 p-4">
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    onClick={() => {
                      alert('Modal do dodawania pracowników - w trakcie implementacji');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Przypisz do fazy
                  </button>
                </div>

                {filteredEmployees.length === 0 ? (
                  <div className="p-8 text-center">
                    <User className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/20" />
                    <p className="text-sm text-[#e5e4e2]/60">
                      Brak pracowników w wydarzeniu
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#d3bb73]/10">
                    {filteredEmployees.map((employee) => {
                      const assignment = phaseAssignments.find(a => a.employee_id === employee.id);

                      return (
                        <div key={employee.id} className="p-4">
                          <div className="mb-2 flex items-center gap-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20">
                              <User className="h-5 w-5 text-[#d3bb73]" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-[#e5e4e2]">
                                  {employee.name} {employee.surname}
                                </span>
                                {assignment && getStatusIcon(assignment.invitation_status)}
                              </div>
                              {assignment && (
                                <p className="text-xs text-[#e5e4e2]/50">
                                  {getStatusLabel(assignment.invitation_status)}
                                </p>
                              )}
                            </div>
                          </div>

                          {assignment && (
                            <div className="space-y-1 text-xs text-[#e5e4e2]/70">
                              <p>
                                <span className="font-medium">Przypisanie:</span>{' '}
                                {formatTime(assignment.assignment_start)} -{' '}
                                {formatTime(assignment.assignment_end)}
                              </p>
                              <p>
                                <span className="font-medium">Praca:</span>{' '}
                                {formatTime(assignment.phase_work_start)} -{' '}
                                {formatTime(assignment.phase_work_end)}
                              </p>
                              <p className="text-[#d3bb73]">
                                Czas pracy:{' '}
                                {calculateDuration(
                                  assignment.phase_work_start,
                                  assignment.phase_work_end
                                )}
                              </p>
                              {assignment.role && (
                                <span className="inline-block rounded bg-[#d3bb73]/20 px-2 py-0.5 text-[#d3bb73]">
                                  {assignment.role}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Equipment Tab */}
            {currentTab === 'equipment' && (
              <div>
                <div className="border-b border-[#d3bb73]/10 p-4">
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    onClick={() => {
                      alert('Modal do dodawania sprzętu - w trakcie implementacji');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Przypisz do fazy
                  </button>
                </div>

                {filteredEquipment.length === 0 ? (
                  <div className="p-8 text-center">
                    <Package className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/20" />
                    <p className="text-sm text-[#e5e4e2]/60">
                      Brak sprzętu w tej fazie
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#d3bb73]/10">
                    {filteredEquipment.map((item) => {
                      const itemName = item.equipment?.name || item.kit?.name || 'Bez nazwy';
                      const itemType = item.equipment_id ? 'Sprzęt' : 'Zestaw';

                      return (
                        <div key={item.id} className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20">
                              <Package className="h-5 w-5 text-[#d3bb73]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[#e5e4e2]">
                                {itemName}
                              </p>
                              <p className="text-xs text-[#e5e4e2]/50">
                                {itemType} • Ilość: {item.quantity || 1}
                              </p>
                              {item.notes && (
                                <p className="text-xs text-[#e5e4e2]/50">{item.notes}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Vehicles Tab */}
            {currentTab === 'vehicles' && (
              <div>
                <div className="border-b border-[#d3bb73]/10 p-4">
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    onClick={() => {
                      alert('Modal do dodawania pojazdów - w trakcie implementacji');
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Przypisz do fazy
                  </button>
                </div>

                {filteredVehicles.length === 0 ? (
                  <div className="p-8 text-center">
                    <Car className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/20" />
                    <p className="text-sm text-[#e5e4e2]/60">
                      Brak pojazdów w tej fazie
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#d3bb73]/10">
                    {filteredVehicles.map((vehicleAssignment) => {
                      const vehicle = vehicleAssignment.vehicle;
                      const driver = vehicleAssignment.driver;
                      const vehicleName = vehicle?.name || vehicle?.registration_number || 'Bez nazwy';
                      const driverName = driver ? `${driver.name} ${driver.surname}` : null;

                      return (
                        <div key={vehicleAssignment.id} className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20">
                              <Car className="h-5 w-5 text-[#d3bb73]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[#e5e4e2]">
                                {vehicleName}
                              </p>
                              <p className="text-xs text-[#e5e4e2]/50">
                                {vehicleAssignment.assigned_start && formatTime(vehicleAssignment.assigned_start)}
                                {vehicleAssignment.assigned_end && ` - ${formatTime(vehicleAssignment.assigned_end)}`}
                              </p>
                              {driverName && (
                                <p className="text-xs text-[#e5e4e2]/50">
                                  Kierowca: {driverName}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#d3bb73]/10 p-4">
        <div className="text-xs text-[#e5e4e2]/60">
          <p>Pokazuje zasoby przypisane do wydarzenia w czasie trwania tej fazy</p>
        </div>
      </div>
    </div>
  );
};
