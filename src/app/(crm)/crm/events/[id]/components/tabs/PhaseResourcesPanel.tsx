'use client';

import React, { useState } from 'react';
import { X, User, Package, Car, Plus, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import {
  EventPhase,
  useGetPhaseAssignmentsQuery,
  useGetPhaseEquipmentQuery,
  useGetPhaseVehiclesQuery,
} from '@/store/api/eventPhasesApi';

interface PhaseResourcesPanelProps {
  phase: EventPhase;
  onClose: () => void;
  resourceFilter: 'all' | 'selected' | 'event';
}

export const PhaseResourcesPanel: React.FC<PhaseResourcesPanelProps> = ({
  phase,
  onClose,
  resourceFilter,
}) => {
  const [currentTab, setCurrentTab] = useState<'employees' | 'equipment' | 'vehicles'>('employees');

  const { data: assignments = [] } = useGetPhaseAssignmentsQuery(phase.id);
  const { data: equipment = [] } = useGetPhaseEquipmentQuery(phase.id);
  const { data: vehicles = [] } = useGetPhaseVehiclesQuery(phase.id);

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
    { id: 'employees' as const, label: 'Pracownicy', icon: User, count: assignments.length },
    { id: 'equipment' as const, label: 'Sprzęt', icon: Package, count: equipment.length },
    { id: 'vehicles' as const, label: 'Pojazdy', icon: Car, count: vehicles.length },
  ];

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
        {/* Employees Tab */}
        {currentTab === 'employees' && (
          <div>
            <div className="border-b border-[#d3bb73]/10 p-4">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                onClick={() => {
                  // TODO: Open AddPhaseAssignmentModal when converted to Tailwind
                  alert('Modal do dodawania pracowników - w trakcie konwersji na Tailwind');
                }}
              >
                <Plus className="h-4 w-4" />
                Dodaj Pracownika
              </button>
            </div>

            {assignments.length === 0 ? (
              <div className="p-8 text-center">
                <User className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/20" />
                <p className="text-sm text-[#e5e4e2]/60">Brak przypisanych pracowników</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/10">
                {assignments.map((assignment) => (
                  <div key={assignment.id} className="p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20">
                        <User className="h-5 w-5 text-[#d3bb73]" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#e5e4e2]">
                            ID: {assignment.employee_id.slice(0, 8)}
                          </span>
                          {getStatusIcon(assignment.invitation_status)}
                        </div>
                        <p className="text-xs text-[#e5e4e2]/50">
                          {getStatusLabel(assignment.invitation_status)}
                        </p>
                      </div>
                    </div>

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
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Equipment Tab */}
        {currentTab === 'equipment' && (
          <div>
            <div className="border-b border-[#d3bb73]/10 p-4">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10"
                disabled
              >
                <Plus className="h-4 w-4" />
                Dodaj Sprzęt
              </button>
            </div>

            {equipment.length === 0 ? (
              <div className="p-8 text-center">
                <Package className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/20" />
                <p className="text-sm text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/10">
                {equipment.map((item) => (
                  <div key={item.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20">
                        <Package className="h-5 w-5 text-[#d3bb73]" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#e5e4e2]">
                          Sprzęt ID: {item.equipment_item_id?.slice(0, 8) || 'N/A'}
                        </p>
                        <p className="text-xs text-[#e5e4e2]/50">
                          {formatTime(item.assigned_start)} - {formatTime(item.assigned_end)}
                        </p>
                        <p className="text-xs text-[#e5e4e2]/50">Ilość: {item.quantity}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Vehicles Tab */}
        {currentTab === 'vehicles' && (
          <div>
            <div className="border-b border-[#d3bb73]/10 p-4">
              <button
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10"
                disabled
              >
                <Plus className="h-4 w-4" />
                Dodaj Pojazd
              </button>
            </div>

            {vehicles.length === 0 ? (
              <div className="p-8 text-center">
                <Car className="mx-auto mb-2 h-12 w-12 text-[#e5e4e2]/20" />
                <p className="text-sm text-[#e5e4e2]/60">Brak przypisanych pojazdów</p>
              </div>
            ) : (
              <div className="divide-y divide-[#d3bb73]/10">
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/20">
                        <Car className="h-5 w-5 text-[#d3bb73]" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#e5e4e2]">
                          Pojazd ID: {vehicle.vehicle_id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-[#e5e4e2]/50">
                          {formatTime(vehicle.assigned_start)} -{' '}
                          {formatTime(vehicle.assigned_end)}
                        </p>
                        {vehicle.driver_id && (
                          <p className="text-xs text-[#e5e4e2]/50">
                            Kierowca: {vehicle.driver_id.slice(0, 8)}
                          </p>
                        )}
                        {vehicle.purpose && (
                          <span className="mt-1 inline-block rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                            {vehicle.purpose}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Summary */}
      <div className="border-t border-[#d3bb73]/10 bg-[#0f1119] p-4">
        <p className="mb-2 text-xs font-semibold text-[#e5e4e2]">Podsumowanie Fazy</p>
        <div className="flex gap-2">
          <span className="rounded-full bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
            <User className="mb-0.5 inline h-3 w-3" /> {assignments.length}
          </span>
          <span className="rounded-full bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
            <Package className="mb-0.5 inline h-3 w-3" /> {equipment.length}
          </span>
          <span className="rounded-full bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
            <Car className="mb-0.5 inline h-3 w-3" /> {vehicles.length}
          </span>
        </div>
      </div>
    </div>
  );
};
