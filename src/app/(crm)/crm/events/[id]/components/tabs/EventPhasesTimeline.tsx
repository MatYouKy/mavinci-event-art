'use client';

import React, { useState, useMemo } from 'react';
import { Box, Typography, Button, IconButton, Chip, Alert } from '@mui/material';
import { Add, ZoomIn, ZoomOut, Warning, CheckCircle, Cancel } from '@mui/icons-material';
import {
  useGetEventPhasesQuery,
  useCreatePhaseMutation,
  useUpdatePhaseMutation,
  useDeletePhaseMutation,
  EventPhase,
} from '@/store/api/eventPhasesApi';
import { PhaseTimelineView } from './PhaseTimelineView';
import { AddPhaseModal } from '../Modals/AddPhaseModal';
import { PhaseResourcesPanel } from './PhaseResourcesPanel';

interface EventPhasesTimelineProps {
  eventId: string;
  eventStartDate: string;
  eventEndDate: string;
}

type ZoomLevel = 'days' | 'hours' | 'minutes';

export const EventPhasesTimeline: React.FC<EventPhasesTimelineProps> = ({
  eventId,
  eventStartDate,
  eventEndDate,
}) => {
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('hours');
  const [selectedPhase, setSelectedPhase] = useState<EventPhase | null>(null);
  const [addPhaseOpen, setAddPhaseOpen] = useState(false);
  const [resourceFilter, setResourceFilter] = useState<'all' | 'selected' | 'event'>('all');

  const { data: phases = [], isLoading, error } = useGetEventPhasesQuery(eventId);
  const [updatePhase] = useUpdatePhaseMutation();
  const [deletePhase] = useDeletePhaseMutation();

  // Calculate timeline bounds
  const timelineBounds = useMemo(() => {
    const start = new Date(eventStartDate);
    const end = new Date(eventEndDate);

    // Add padding (10% of total duration)
    const duration = end.getTime() - start.getTime();
    const padding = duration * 0.1;

    return {
      start: new Date(start.getTime() - padding),
      end: new Date(end.getTime() + padding),
    };
  }, [eventStartDate, eventEndDate]);

  // Calculate phase conflicts
  const phaseConflicts = useMemo(() => {
    const conflicts: Record<string, boolean> = {};

    for (let i = 0; i < phases.length; i++) {
      for (let j = i + 1; j < phases.length; j++) {
        const phase1 = phases[i];
        const phase2 = phases[j];

        const start1 = new Date(phase1.start_time).getTime();
        const end1 = new Date(phase1.end_time).getTime();
        const start2 = new Date(phase2.start_time).getTime();
        const end2 = new Date(phase2.end_time).getTime();

        // Check for overlap
        if (
          (start1 >= start2 && start1 < end2) ||
          (end1 > start2 && end1 <= end2) ||
          (start1 <= start2 && end1 >= end2)
        ) {
          conflicts[phase1.id] = true;
          conflicts[phase2.id] = true;
        }
      }
    }

    return conflicts;
  }, [phases]);

  const handlePhaseResize = async (phaseId: string, newStart: Date, newEnd: Date) => {
    try {
      await updatePhase({
        id: phaseId,
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
      }).unwrap();
    } catch (error) {
      console.error('Failed to update phase:', error);
    }
  };

  const handlePhaseClick = (phase: EventPhase) => {
    setSelectedPhase(phase);
  };

  const handleDeletePhase = async (phaseId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę fazę? Wszystkie przypisania zostaną utracone.')) {
      return;
    }

    try {
      await deletePhase(phaseId).unwrap();
      if (selectedPhase?.id === phaseId) {
        setSelectedPhase(null);
      }
    } catch (error) {
      console.error('Failed to delete phase:', error);
    }
  };

  const handleZoomIn = () => {
    if (zoomLevel === 'days') setZoomLevel('hours');
    else if (zoomLevel === 'hours') setZoomLevel('minutes');
  };

  const handleZoomOut = () => {
    if (zoomLevel === 'minutes') setZoomLevel('hours');
    else if (zoomLevel === 'hours') setZoomLevel('days');
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography>Ładowanie faz...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        Błąd podczas ładowania faz wydarzenia
      </Alert>
    );
  }

  const hasConflicts = Object.keys(phaseConflicts).length > 0;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6">Fazy Wydarzenia</Typography>
          <Chip
            label={`${phases.length} ${phases.length === 1 ? 'faza' : 'faz'}`}
            size="small"
            color="primary"
          />
          {hasConflicts && (
            <Chip
              icon={<Warning />}
              label="Nakładające się fazy!"
              size="small"
              color="error"
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* Resource Filter */}
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button
              size="small"
              variant={resourceFilter === 'all' ? 'contained' : 'outlined'}
              onClick={() => setResourceFilter('all')}
            >
              Wszystkie zasoby
            </Button>
            <Button
              size="small"
              variant={resourceFilter === 'selected' ? 'contained' : 'outlined'}
              onClick={() => setResourceFilter('selected')}
              disabled={!selectedPhase}
            >
              Wybrane
            </Button>
            <Button
              size="small"
              variant={resourceFilter === 'event' ? 'contained' : 'outlined'}
              onClick={() => setResourceFilter('event')}
            >
              Z wydarzenia
            </Button>
          </Box>

          {/* Zoom Controls */}
          <Box sx={{ display: 'flex', gap: 0.5, borderLeft: 1, borderColor: 'divider', pl: 1 }}>
            <IconButton size="small" onClick={handleZoomOut} disabled={zoomLevel === 'days'}>
              <ZoomOut />
            </IconButton>
            <Chip label={zoomLevel === 'days' ? 'Dni' : zoomLevel === 'hours' ? 'Godziny' : 'Minuty'} size="small" />
            <IconButton size="small" onClick={handleZoomIn} disabled={zoomLevel === 'minutes'}>
              <ZoomIn />
            </IconButton>
          </Box>

          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setAddPhaseOpen(true)}
          >
            Dodaj fazę
          </Button>
        </Box>
      </Box>

      {/* Timeline View */}
      <Box sx={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {phases.length === 0 ? (
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}
          >
            <Typography color="text.secondary">
              To wydarzenie nie ma jeszcze żadnych faz
            </Typography>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setAddPhaseOpen(true)}
            >
              Utwórz pierwszą fazę
            </Button>
          </Box>
        ) : (
          <PhaseTimelineView
            phases={phases}
            timelineBounds={timelineBounds}
            zoomLevel={zoomLevel}
            selectedPhase={selectedPhase}
            phaseConflicts={phaseConflicts}
            onPhaseClick={handlePhaseClick}
            onPhaseResize={handlePhaseResize}
            onPhaseDelete={handleDeletePhase}
          />
        )}
      </Box>

      {/* Phase Resources Panel */}
      {selectedPhase && (
        <PhaseResourcesPanel
          phase={selectedPhase}
          onClose={() => setSelectedPhase(null)}
          resourceFilter={resourceFilter}
        />
      )}

      {/* Add Phase Modal */}
      <AddPhaseModal
        open={addPhaseOpen}
        onClose={() => setAddPhaseOpen(false)}
        eventId={eventId}
        eventStartDate={eventStartDate}
        eventEndDate={eventEndDate}
        existingPhases={phases}
      />
    </Box>
  );
};
