'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { EquipmentConflictRow, SelectedAltMap } from '../types';
import { IOfferItem } from '@/app/crm/offers/types';
import { buildConflictPayloadItems, buildSubstitutionsForRpc } from '../utils';

export function useOfferWizardConflicts(opts: { eventId: string }) {
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [conflicts, setConflicts] = useState<EquipmentConflictRow[]>([]);
  const [showConflictsModal, setShowConflictsModal] = useState(false);

  const [selectedAlt, setSelectedAlt] = useState<SelectedAltMap>({});
  const [equipmentSubstitutions, setEquipmentSubstitutions] = useState<Record<string, any>>({});

  const checkCartConflicts = async (items: IOfferItem[], baseConflicts?: EquipmentConflictRow[]) => {
    if (!opts.eventId) return [];

    const payload = buildConflictPayloadItems(items);

    // Build substitutions from equipmentSubstitutions (committed) + selectedAlt (temporary)
    const combinedSubstitutions: Record<string, { item_id: string; qty: number }> = {};

    // First, add committed substitutions from equipmentSubstitutions
    Object.entries(equipmentSubstitutions).forEach(([key, sub]) => {
      combinedSubstitutions[key] = {
        item_id: sub.to_item_id,
        qty: sub.qty,
      };
    });

    // Then, add temporary selections from selectedAlt (these override if same key)
    Object.entries(selectedAlt).forEach(([key, sel]) => {
      combinedSubstitutions[key] = sel;
    });

    const substitutionsPayload = buildSubstitutionsForRpc({
      selectedAlt: combinedSubstitutions,
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