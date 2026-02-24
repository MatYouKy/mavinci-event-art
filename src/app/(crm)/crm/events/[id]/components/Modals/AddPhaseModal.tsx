'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Chip,
} from '@mui/material';
import { useGetPhaseTypesQuery, useCreatePhaseMutation, EventPhase } from '@/store/api/eventPhasesApi';

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

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [phaseName, setPhaseName] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [error, setError] = useState('');

  // Update phase name when type changes
  const handleTypeChange = (typeId: string) => {
    setSelectedTypeId(typeId);
    const type = phaseTypes.find((t) => t.id === typeId);
    if (type && !phaseName) {
      setPhaseName(type.name);
    }
  };

  // Suggest start time (after last phase or event start)
  const suggestedStartTime = () => {
    if (existingPhases.length === 0) {
      return eventStartDate;
    }

    const sortedPhases = [...existingPhases].sort(
      (a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime()
    );
    return sortedPhases[0].end_time;
  };

  // Calculate suggested end time based on phase type duration
  const calculateSuggestedEndTime = (start: string, typeId: string): string => {
    const type = phaseTypes.find((t) => t.id === typeId);
    if (!type || !start) return '';

    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + type.default_duration_hours * 60 * 60 * 1000);
    return endDate.toISOString().slice(0, 16);
  };

  // Auto-set times when type is selected
  React.useEffect(() => {
    if (selectedTypeId && !startTime) {
      const suggested = suggestedStartTime();
      setStartTime(new Date(suggested).toISOString().slice(0, 16));
      setEndTime(calculateSuggestedEndTime(suggested, selectedTypeId));
    }
  }, [selectedTypeId]);

  // Validate overlap with existing phases
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

  const handleSubmit = async () => {
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

    const eventStart = new Date(eventStartDate);
    const eventEnd = new Date(eventEndDate);

    if (start < eventStart || end > eventEnd) {
      setError('Faza musi mieścić się w ramach czasowych wydarzenia');
      return;
    }

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

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Dodaj Nową Fazę</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <FormControl fullWidth>
            <InputLabel>Typ Fazy</InputLabel>
            <Select
              value={selectedTypeId}
              onChange={(e) => handleTypeChange(e.target.value)}
              label="Typ Fazy"
            >
              {phaseTypes.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        backgroundColor: type.color,
                      }}
                    />
                    {type.name}
                    <Chip
                      label={`${type.default_duration_hours}h`}
                      size="small"
                      sx={{ ml: 'auto' }}
                    />
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Nazwa Fazy"
            fullWidth
            value={phaseName}
            onChange={(e) => setPhaseName(e.target.value)}
            placeholder={selectedType?.name}
          />

          <TextField
            label="Opis (opcjonalnie)"
            fullWidth
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <TextField
            label="Rozpoczęcie"
            type="datetime-local"
            fullWidth
            value={startTime}
            onChange={(e) => {
              setStartTime(e.target.value);
              if (selectedTypeId) {
                setEndTime(calculateSuggestedEndTime(e.target.value, selectedTypeId));
              }
            }}
            InputLabelProps={{ shrink: true }}
          />

          <TextField
            label="Zakończenie"
            type="datetime-local"
            fullWidth
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          {startTime && endTime && (
            <Alert severity="info">
              Czas trwania:{' '}
              {Math.round(
                (new Date(endTime).getTime() - new Date(startTime).getTime()) /
                  (1000 * 60 * 60)
              )}{' '}
              godzin
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Anuluj</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isLoading}>
          {isLoading ? 'Tworzenie...' : 'Utwórz Fazę'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
