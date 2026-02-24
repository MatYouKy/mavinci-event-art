'use client';

import React, { useState, useEffect } from 'react';
import { X, AlertCircle, Clock } from 'lucide-react';
import { useGetPhaseTypesQuery, useCreatePhaseMutation, EventPhase } from '@/store/api/eventPhasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddPhaseModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventStartDate: string;
  eventEndDate: string;
  existingPhases: EventPhase[];
}

export const AddPhaseModal: React.FC<AddPhaseModalProps> = ({
  open,
  onClose,
  eventId,
  eventStartDate,
  eventEndDate,
  existingPhases,
}) => {
  const { data: phaseTypes = [] } = useGetPhaseTypesQuery();
  const [createPhase, { isLoading }] = useCreatePhaseMutation();
  const { showSnackbar } = useSnackbar();

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [phaseName, setPhaseName] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState('');

  const handleTypeChange = (typeId: string) => {
    setSelectedTypeId(typeId);
    const type = phaseTypes.find((t) => t.id === typeId);
    if (type && !phaseName) {
      setPhaseName(type.name);
    }
  };

  const suggestedStartTime = () => {
    if (existingPhases.length === 0) {
      return eventStartDate;
    }
    const sortedPhases = [...existingPhases].sort(
      (a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime()
    );
    return sortedPhases[0].end_time;
  };

  const calculateSuggestedEndTime = (start: string, typeId: string): string => {
    const type = phaseTypes.find((t) => t.id === typeId);
    if (!type || !start) return '';

    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + type.default_duration_hours * 60 * 60 * 1000);
    return endDate.toISOString().slice(0, 16);
  };

  useEffect(() => {
    if (selectedTypeId && !startTime) {
      const suggested = suggestedStartTime();
      setStartTime(new Date(suggested).toISOString().slice(0, 16));
      setEndTime(calculateSuggestedEndTime(suggested, selectedTypeId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypeId]);

  const validateNoOverlap = (start: Date, end: Date): boolean => {
    return !existingPhases.some((phase) => {
      const phaseStart = new Date(phase.start_time);
      const phaseEnd = new Date(phase.end_time);

      return (
        (start >= phaseStart && start < phaseEnd) ||
        (end > phaseStart && end <= phaseEnd) ||
        (start <= phaseStart && end >= phaseEnd)
      );
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedTypeId) {
      setError('Wybierz typ fazy');
      return;
    }

    if (!phaseName.trim()) {
      setError('Podaj nazwę fazy');
      return;
    }

    if (!startTime || !endTime) {
      setError('Podaj czas rozpoczęcia i zakończenia');
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      setError('Czas zakończenia musi być późniejszy niż rozpoczęcie');
      return;
    }

    if (!validateNoOverlap(start, end)) {
      setError('Ta faza nakłada się z istniejącą fazą. Zmień czas.');
      return;
    }

    // Fazy mogą wykraczać poza ramy czasowe wydarzenia (np. załadunek przed eventem)
    // Główne godziny wydarzenia to tylko agenda/deklaracja dla klienta

    try {
      await createPhase({
        event_id: eventId,
        phase_type_id: selectedTypeId,
        name: phaseName,
        description: description || undefined,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        sequence_order: existingPhases.length + 1,
      }).unwrap();

      showSnackbar('Faza została utworzona', 'success');
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Błąd podczas tworzenia fazy');
    }
  };

  const handleClose = () => {
    setSelectedTypeId('');
    setPhaseName('');
    setDescription('');
    setStartTime('');
    setEndTime('');
    setError('');
    onClose();
  };

  const selectedType = phaseTypes.find((t) => t.id === selectedTypeId);

  const calculateDuration = (): string => {
    if (!startTime || !endTime) return '0h';
    const duration = new Date(endTime).getTime() - new Date(startTime).getTime();
    const hours = Math.round(duration / (1000 * 60 * 60));
    return `${hours}h`;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
          <h2 className="text-lg font-semibold text-[#e5e4e2]">Dodaj Nową Fazę</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {/* Type Selector */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Typ Fazy</label>
            <select
              value={selectedTypeId}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="">Wybierz typ fazy</option>
              {phaseTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} ({type.default_duration_hours}h)
                </option>
              ))}
            </select>
          </div>

          {/* Phase Name */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Nazwa Fazy</label>
            <input
              type="text"
              value={phaseName}
              onChange={(e) => setPhaseName(e.target.value)}
              placeholder={selectedType?.name || 'Wprowadź nazwę'}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 transition-colors focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Opis (opcjonalnie)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 transition-colors focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          {/* Time Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rozpoczęcie</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  if (selectedTypeId) {
                    setEndTime(calculateSuggestedEndTime(e.target.value, selectedTypeId));
                  }
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Zakończenie</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          {/* Duration Display */}
          {startTime && endTime && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
              <Clock className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-blue-400">Czas trwania: {calculateDuration()}</span>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#d3bb73]/10 p-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2]/80 transition-colors hover:bg-[#d3bb73]/10"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {isLoading ? 'Tworzenie...' : 'Utwórz Fazę'}
          </button>
        </div>
      </div>
    </div>
  );
};
