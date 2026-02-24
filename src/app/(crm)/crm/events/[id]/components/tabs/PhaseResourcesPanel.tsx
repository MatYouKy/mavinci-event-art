'use client';

import React, { useState } from 'react';
import {
  Box,
  Drawer,
  Typography,
  IconButton,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  Button,
  Divider,
  Alert,
} from '@mui/material';
import {
  Close,
  Person,
  Inventory,
  DirectionsCar,
  Add,
  Warning,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import {
  EventPhase,
  useGetPhaseAssignmentsQuery,
  useGetPhaseEquipmentQuery,
  useGetPhaseVehiclesQuery,
} from '@/store/api/eventPhasesApi';
import { AddPhaseAssignmentModal } from '../Modals/AddPhaseAssignmentModal';

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
  const [currentTab, setCurrentTab] = useState(0);
  const [addAssignmentOpen, setAddAssignmentOpen] = useState(false);

  const { data: assignments = [] } = useGetPhaseAssignmentsQuery(phase.id);
  const { data: equipment = [] } = useGetPhaseEquipmentQuery(phase.id);
  const { data: vehicles = [] } = useGetPhaseVehiclesQuery(phase.id);

  const phaseColor = phase.color || phase.phase_type?.color || '#3b82f6';

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'accepted':
        return <CheckCircle sx={{ color: 'success.main', fontSize: 20 }} />;
      case 'rejected':
        return <Cancel sx={{ color: 'error.main', fontSize: 20 }} />;
      default:
        return <Warning sx={{ color: 'warning.main', fontSize: 20 }} />;
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

  return (
    <>
      <Drawer
        anchor="right"
        open={true}
        onClose={onClose}
        PaperProps={{
          sx: { width: { xs: '100%', sm: 500 } },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 2,
            borderBottom: 1,
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: phaseColor + '10',
          }}
        >
          <Box>
            <Typography variant="h6">{phase.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {formatTime(phase.start_time)} - {formatTime(phase.end_time)}
            </Typography>
          </Box>
          <IconButton onClick={onClose}>
            <Close />
          </IconButton>
        </Box>

        {/* Tabs */}
        <Tabs value={currentTab} onChange={(_, v) => setCurrentTab(v)}>
          <Tab
            icon={<Person />}
            label={`Pracownicy (${assignments.length})`}
            iconPosition="start"
          />
          <Tab
            icon={<Inventory />}
            label={`Sprzęt (${equipment.length})`}
            iconPosition="start"
          />
          <Tab
            icon={<DirectionsCar />}
            label={`Pojazdy (${vehicles.length})`}
            iconPosition="start"
          />
        </Tabs>

        <Divider />

        {/* Tab Content */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {/* Employees Tab */}
          {currentTab === 0 && (
            <Box>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  fullWidth
                  onClick={() => setAddAssignmentOpen(true)}
                >
                  Dodaj Pracownika
                </Button>
              </Box>

              {assignments.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    Brak przypisanych pracowników
                  </Typography>
                </Box>
              ) : (
                <List>
                  {assignments.map((assignment) => (
                    <ListItem key={assignment.id} divider>
                      <ListItemAvatar>
                        <Avatar>
                          <Person />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography>ID: {assignment.employee_id.slice(0, 8)}</Typography>
                            {getStatusIcon(assignment.invitation_status)}
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography variant="caption" display="block">
                              Status: {getStatusLabel(assignment.invitation_status)}
                            </Typography>
                            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                              Przypisanie: {formatTime(assignment.assignment_start)} -{' '}
                              {formatTime(assignment.assignment_end)}
                            </Typography>
                            <Typography variant="caption" display="block">
                              Praca: {formatTime(assignment.phase_work_start)} -{' '}
                              {formatTime(assignment.phase_work_end)}
                            </Typography>
                            <Typography variant="caption" display="block" color="primary">
                              Czas pracy:{' '}
                              {calculateDuration(
                                assignment.phase_work_start,
                                assignment.phase_work_end
                              )}
                            </Typography>
                            {assignment.role && (
                              <Chip label={assignment.role} size="small" sx={{ mt: 0.5 }} />
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}

          {/* Equipment Tab */}
          {currentTab === 1 && (
            <Box>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Button variant="outlined" startIcon={<Add />} fullWidth>
                  Dodaj Sprzęt
                </Button>
              </Box>

              {equipment.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">Brak przypisanego sprzętu</Typography>
                </Box>
              ) : (
                <List>
                  {equipment.map((item) => (
                    <ListItem key={item.id} divider>
                      <ListItemAvatar>
                        <Avatar>
                          <Inventory />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={`Sprzęt ID: ${item.equipment_item_id?.slice(0, 8) || 'N/A'}`}
                        secondary={
                          <>
                            <Typography variant="caption" display="block">
                              {formatTime(item.assigned_start)} - {formatTime(item.assigned_end)}
                            </Typography>
                            <Typography variant="caption" display="block">
                              Ilość: {item.quantity}
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}

          {/* Vehicles Tab */}
          {currentTab === 2 && (
            <Box>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Button variant="outlined" startIcon={<Add />} fullWidth>
                  Dodaj Pojazd
                </Button>
              </Box>

              {vehicles.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">Brak przypisanych pojazdów</Typography>
                </Box>
              ) : (
                <List>
                  {vehicles.map((vehicle) => (
                    <ListItem key={vehicle.id} divider>
                      <ListItemAvatar>
                        <Avatar>
                          <DirectionsCar />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={`Pojazd ID: ${vehicle.vehicle_id.slice(0, 8)}`}
                        secondary={
                          <>
                            <Typography variant="caption" display="block">
                              {formatTime(vehicle.assigned_start)} -{' '}
                              {formatTime(vehicle.assigned_end)}
                            </Typography>
                            {vehicle.driver_id && (
                              <Typography variant="caption" display="block">
                                Kierowca: {vehicle.driver_id.slice(0, 8)}
                              </Typography>
                            )}
                            {vehicle.purpose && (
                              <Chip label={vehicle.purpose} size="small" sx={{ mt: 0.5 }} />
                            )}
                          </>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}
        </Box>

        {/* Summary Footer */}
        <Box
          sx={{
            p: 2,
            borderTop: 1,
            borderColor: 'divider',
            backgroundColor: 'background.default',
          }}
        >
          <Typography variant="body2" fontWeight="bold" gutterBottom>
            Podsumowanie Fazy
          </Typography>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Chip
              icon={<Person />}
              label={`${assignments.length} pracowników`}
              size="small"
            />
            <Chip
              icon={<Inventory />}
              label={`${equipment.length} pozycji sprzętu`}
              size="small"
            />
            <Chip
              icon={<DirectionsCar />}
              label={`${vehicles.length} pojazdów`}
              size="small"
            />
          </Box>
        </Box>
      </Drawer>

      {/* Add Assignment Modal */}
      <AddPhaseAssignmentModal
        open={addAssignmentOpen}
        onClose={() => setAddAssignmentOpen(false)}
        phase={phase}
      />
    </>
  );
};
