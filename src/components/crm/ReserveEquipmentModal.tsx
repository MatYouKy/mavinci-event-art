'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Alert,
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import { Lock, AlertTriangle, CheckCircle, Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface EquipmentItem {
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  has_conflict: boolean;
  shortage_qty: number;
}

interface ReserveEquipmentModalProps {
  offerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReserveEquipmentModal({
  offerId,
  open,
  onClose,
  onSuccess,
}: ReserveEquipmentModalProps) {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    if (open && offerId) {
      loadEquipment();
    }
  }, [open, offerId]);

  const loadEquipment = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_offer_equipment_for_reservation', {
        p_offer_id: offerId,
      });

      if (error) throw error;
      setEquipment(data || []);
    } catch (err: any) {
      console.error('Error loading equipment:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    try {
      setConfirming(true);
      const { data, error } = await supabase.rpc('confirm_equipment_reservation', {
        p_offer_id: offerId,
      });

      if (error) throw error;

      if (data?.success) {
        showSnackbar('Sprzęt został zarezerwowany pomyślnie', 'success');
        onSuccess();
        onClose();
      } else {
        throw new Error(data?.error || 'Błąd podczas rezerwacji');
      }
    } catch (err: any) {
      console.error('Error confirming reservation:', err);
      showSnackbar(err.message || 'Błąd podczas rezerwacji sprzętu', 'error');
    } finally {
      setConfirming(false);
    }
  };

  const hasConflicts = equipment.some((e) => e.has_conflict);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Lock className="h-5 w-5" />
        Zarezerwuj Sprzęt
      </DialogTitle>

      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Poniższy sprzęt zostanie wstępnie zarezerwowany dla tego eventu. Status oferty zmieni
              się na <strong>Zaakceptowana</strong>.
            </Typography>

            {equipment.length === 0 ? (
              <Alert severity="info">Brak sprzętu do rezerwacji</Alert>
            ) : (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Sprzęt</TableCell>
                      <TableCell align="right">Wymagane</TableCell>
                      <TableCell align="right">Dostępne</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {equipment.map((item, index) => (
                      <TableRow key={`${item.item_type}-${item.item_id}-${index}`}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {item.item_type === 'kit' && <Package className="h-4 w-4" />}
                            {item.item_name}
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <strong>{item.required_qty}</strong>
                        </TableCell>
                        <TableCell align="right">
                          {item.available_qty} / {item.total_qty}
                        </TableCell>
                        <TableCell>
                          {item.has_conflict ? (
                            <Chip
                              icon={<AlertTriangle className="h-3 w-3" />}
                              label={`Brak ${item.shortage_qty}`}
                              color="error"
                              size="small"
                            />
                          ) : (
                            <Chip
                              icon={<CheckCircle className="h-3 w-3" />}
                              label="Dostępne"
                              color="success"
                              size="small"
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {hasConflicts && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    <strong>Uwaga!</strong> Niektóre elementy są niedostępne. Nie można zarezerwować
                    sprzętu dopóki wszystkie konflikty nie zostaną rozwiązane.
                    <br />
                    <br />
                    Rozwiąż konflikty w zakładce <strong>Konflikty</strong> oferty poprzez:
                    <ul style={{ marginTop: 8, marginBottom: 0 }}>
                      <li>Zamianę na alternatywny sprzęt (substytucję)</li>
                      <li>Oznaczenie jako rental zewnętrzny</li>
                    </ul>
                  </Alert>
                )}

                {!hasConflicts && equipment.length > 0 && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    Cały sprzęt jest dostępny i gotowy do rezerwacji.
                  </Alert>
                )}
              </>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={confirming}>
          Anuluj
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={loading || confirming || hasConflicts || equipment.length === 0}
          startIcon={confirming ? <CircularProgress size={16} /> : <Lock />}
        >
          {confirming ? 'Rezerwuję...' : 'Potwierdź Rezerwację'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
