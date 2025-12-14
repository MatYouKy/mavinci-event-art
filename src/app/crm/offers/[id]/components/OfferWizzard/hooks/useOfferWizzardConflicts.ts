'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { EquipmentConflictRow, OfferItem, SelectedAltMap } from '../types';
import { buildConflictPayloadItems, buildSubstitutionsForRpc } from '../utils';

export function useOfferWizardConflicts(opts: { eventId: string }) {
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflicts, setConflicts] = useState<EquipmentConflictRow[]>([]);
  const [showConflictsModal, setShowConflictsModal] = useState(false);

  const [selectedAlt, setSelectedAlt] = useState<SelectedAltMap>({});
  const [equipmentSubstitutions, setEquipmentSubstitutions] = useState<Record<string, any>>({});

  const checkCartConflicts = async (items: OfferItem[], baseConflicts?: EquipmentConflictRow[]) => {
    if (!opts.eventId) return [];

    const payload = buildConflictPayloadItems(items);

    const substitutionsPayload = buildSubstitutionsForRpc({
      selectedAlt,
      conflicts: baseConflicts ?? conflicts,
    });

    setCheckingConflicts(true);
    try {
      const { data, error } = await supabase.rpc('check_offer_cart_equipment_conflicts_v2', {
        p_event_id: opts.eventId,
        p_items: payload,
        p_substitutions: substitutionsPayload,
      });

      if (error) throw error;

      const rows = Array.isArray(data) ? (data as EquipmentConflictRow[]) : [];
      setConflicts(rows);
      if (rows.length > 0) setShowConflictsModal(true);
      return rows;
    } catch (e) {
      console.error(e);
      return [];
    } finally {
      setCheckingConflicts(false);
    }
  };

  return {
    checkingConflicts,
    conflicts,
    showConflictsModal,
    setShowConflictsModal,

    selectedAlt,
    setSelectedAlt,

    equipmentSubstitutions,
    setEquipmentSubstitutions,

    checkCartConflicts,
    setConflicts,
  };
}