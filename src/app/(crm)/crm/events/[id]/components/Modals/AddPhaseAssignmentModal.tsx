'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Alert,
  Typography,
  Divider,
  FormControlLabel,
  Switch,
} from '@mui/material';
import {
  EventPhase,
  useCreatePhaseAssignmentMutation,
  useLazyGetEmployeeConflictsQuery,
} from '@/store/api/eventPhasesApi';

interface AddPhaseAssignmentModalProps {
  open: boolean;
  onClose: () => void;
  phase: EventPhase;
}

export const AddPhaseAssignmentModal: React.FC<AddPhaseAssignmentModalProps> = ({
  open,
  onClose,
  phase,
}) => {
  const [createAssignment, { isLoading }] = useCreatePhaseAssignmentMutation();
  const [checkConflicts, { data: conflicts, isFetching: checkingConflicts }] =
    useLazyGetEmployeeConflictsQuery();

  const [employeeId, setEmployeeId] = useState('');
  const [role, setRole] = useState('');
  const [includeTravelTime, setIncludeTravelTime] = useState(true);

  // Assignment times (full schedule including travel)
  const [assignmentStart, setAssignmentStart] = useState('');
  const [assignmentEnd, setAssignmentEnd] = useState('');

  // Work times (actual work in phase)
  const [workStart, setWorkStart] = useState('');
  const [workEnd, setWorkEnd] = useState('');

  const [travelToNotes, setTravelToNotes] = useState('');
  const [travelFromNotes, setTravelFromNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // Initialize times based on phase
  useEffect(() => {
    if (open) {
      const phaseStart = new Date(phase.start_time).toISOString().slice(0, 16);
      const phaseEnd = new Date(phase.end_time).toISOString().slice(0, 16);

      setWorkStart(phaseStart);
      setWorkEnd(phaseEnd);

      if (includeTravelTime) {
        // Add 1 hour before for travel to
        const travelStart = new Date(phase.start_time);
        travelStart.setHours(travelStart.getHours() - 1);
        setAssignmentStart(travelStart.toISOString().slice(0, 16));

        // Add 1 hour after for travel from
        const travelEnd = new Date(phase.end_time);
        travelEnd.setHours(travelEnd.getHours() + 1);
        setAssignmentEnd(travelEnd.toISOString().slice(0, 16));
      } else {
        setAssignmentStart(phaseStart);
        setAssignmentEnd(phaseEnd);
      }
    }
  }, [open, phase, includeTravelTime]);

  // Check for conflicts when employee or times change
  useEffect(() => {
    if (employeeId && assignmentStart && assignmentEnd) {
      checkConflicts({
        employeeId,
        startTime: assignmentStart,
        endTime: assignmentEnd,
      });
    }
  }, [employeeId, assignmentStart, assignmentEnd, checkConflicts]);

  const handleTravelTimeToggle = (enabled: boolean) => {
    setIncludeTravelTime(enabled);

    if (enabled) {
      // Add travel time
      const travelStart = new Date(workStart);
      travelStart.setHours(travelStart.getHours() - 1);
      setAssignmentStart(travelStart.toISOString().slice(0, 16));

      const travelEnd = new Date(workEnd);
      travelEnd.setHours(travelEnd.getHours() + 1);
      setAssignmentEnd(travelEnd.toISOString().slice(0, 16));
    } else {
      // Remove travel time
      setAssignmentStart(workStart);
      setAssignmentEnd(workEnd);
    }
  };

  const calculateDuration = (start: string, end: string): string => {
    if (!start || !end) return '0h 0m';
    const duration = new Date(end).getTime() - new Date(start).getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const handleSubmit = async () => {
    setError('');

    if (!employeeId.trim()) {
      setError('Podaj ID pracownika');
      return;
    }

    if (!assignmentStart || !assignmentEnd || !workStart || !workEnd) {
      setError('Wszystkie pola czasu są wymagane');
      return;
    }

    const assStart = new Date(assignmentStart);
    const assEnd = new Date(assignmentEnd);
    const wStart = new Date(workStart);
    const wEnd = new Date(workEnd);

    if (assEnd <= assStart) {
      setError('Czas zakończenia musi być późniejszy niż rozpoczęcie');
      return;
    }

    if (wEnd <= wStart) {
      setError('Czas zakończenia pracy musi być późniejszy niż rozpoczęcie');
      return;
    }

    if (wStart < assStart || wEnd > assEnd) {
      setError('Czas pracy musi mieścić się w ramach przypisania');
      return;
    }

    try {
      await createAssignment({
        phase_id: phase.id,
        employee_id: employeeId,
        assignment_start: assStart.toISOString(),
        assignment_end: assEnd.toISOString(),
        phase_work_start: wStart.toISOString(),
        phase_work_end: wEnd.toISOString(),
        role: role || undefined,
        travel_to_notes: travelToNotes || undefined,
        travel_from_notes: travelFromNotes || undefined,
        notes: notes || undefined,
      }).unwrap();

      handleClose();
    } catch (err: any) {
      setError(err.message || 'Błąd podczas dodawania przypisania');
    }
  };

  const handleClose = () => {
    setEmployeeId('');
    setRole('');
    setIncludeTravelTime(true);
    setAssignmentStart('');
    setAssignmentEnd('');
    setWorkStart('');
    setWorkEnd('');
    setTravelToNotes('');
    setTravelFromNotes('');
    setNotes('');
    setError('');
    onClose();
  };

  const hasConflicts = conflicts && conflicts.length > 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Dodaj Pracownika do Fazy: {phase.name}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {hasConflicts && (
            <Alert severity="warning">
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Wykryto konflikty:
              </Typography>
              {conflicts.map((conflict, index) => (
                <Typography key={index} variant="caption" display="block">
                  • {conflict.event_name} - {conflict.phase_name}
                </Typography>
              ))}
            </Alert>
          )}

          <TextField
            label="ID Pracownika"
            fullWidth
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="UUID pracownika"
          />

          <TextField
            label="Rola (opcjonalnie)"
            fullWidth
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="np. technician, lead, assistant"
          />

          <Divider>
            <Typography variant="caption" color="text.secondary">
              Harmonogram Indywidualny
            </Typography>
          </Divider>

          <FormControlLabel
            control={
              <Switch
                checked={includeTravelTime}
                onChange={(e) => handleTravelTimeToggle(e.target.checked)}
              />
            }
            label="Uwzględnij czas dojazdu/powrotu"
          />

          {/* Assignment Times (Full Schedule) */}
          <Box sx={{ p: 2, backgroundColor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Pełny Harmonogram (z dojazdem/powrotem)
            </Typography>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Start przypisania"
                type="datetime-local"
                fullWidth
                value={assignmentStart}
                onChange={(e) => setAssignmentStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />

              <TextField
                label="Koniec przypisania"
                type="datetime-local"
                fullWidth
                value={assignmentEnd}
                onChange={(e) => setAssignmentEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Łączny czas: {calculateDuration(assignmentStart, assignmentEnd)}
            </Typography>
          </Box>

          {/* Work Times (Actual Work in Phase) */}
          <Box sx={{ p: 2, backgroundColor: 'primary.light', opacity: 0.1, borderRadius: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Faktyczna Praca w Fazie
            </Typography>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Start pracy"
                type="datetime-local"
                fullWidth
                value={workStart}
                onChange={(e) => setWorkStart(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />

              <TextField
                label="Koniec pracy"
                type="datetime-local"
                fullWidth
                value={workEnd}
                onChange={(e) => setWorkEnd(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Czas pracy: {calculateDuration(workStart, workEnd)}
            </Typography>
          </Box>

          {includeTravelTime && (
            <>
              <TextField
                label="Notatki - dojazd"
                fullWidth
                multiline
                rows={2}
                value={travelToNotes}
                onChange={(e) => setTravelToNotes(e.target.value)}
                placeholder="np. Punkt zbiórki, środek transportu"
              />

              <TextField
                label="Notatki - powrót"
                fullWidth
                multiline
                rows={2}
                value={travelFromNotes}
                onChange={(e) => setTravelFromNotes(e.target.value)}
                placeholder="np. Punkt docelowy, środek transportu"
              />
            </>
          )}

          <TextField
            label="Dodatkowe notatki"
            fullWidth
            multiline
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Anuluj</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isLoading || checkingConflicts}
        >
          {isLoading ? 'Dodawanie...' : 'Dodaj Pracownika'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
