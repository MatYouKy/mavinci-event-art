'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { SubcontractorRow } from '@/app/(crm)/crm/offers/api/OfferWizzardApi';

export type EquipmentListItem = {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
};

export function useOfferWizardResources(opts: {
  isOpen: boolean;
  step: number;

  /** Sety przychodzą z logiki (koszyk + availability) */
  excludedIds?: ReadonlySet<string>;
  unavailableIds?: ReadonlySet<string>;
}) {
  const [equipmentListAll, setEquipmentListAll] = useState<EquipmentListItem[]>([]);
  const [subcontractors, setSubcontractors] = useState<SubcontractorRow[]>([]);

  const excludedIds = opts.excludedIds ?? new Set<string>();
  const unavailableIds = opts.unavailableIds ?? new Set<string>();

  const equipmentList = useMemo(() => {
    // filtrujemy tylko na etapie kroku 4, żeby nie mieszać gdy wizard jest wcześniej
    if (!opts.isOpen || opts.step !== 4) return equipmentListAll;

    return equipmentListAll.filter((x) => {
      const id = x.id;
      if (excludedIds.has(id)) return false;
      if (unavailableIds.has(id)) return false;
      return true;
    });
  }, [equipmentListAll, excludedIds, unavailableIds, opts.isOpen, opts.step]);

  useEffect(() => {
    if (!opts.isOpen || opts.step !== 4) return;

    let cancelled = false;

    (async () => {
      const [eqRes, sRes] = await Promise.all([
        supabase
          .from('equipment_items')
          .select('id, name, brand, model')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name'),
        supabase
          .from('subcontractors')
          .select('id, contact_person, company_name, specialization')
          .eq('status', 'active')
          .order('company_name'),
      ]);

      if (!cancelled) {
        if (!eqRes.error && eqRes.data) setEquipmentListAll(eqRes.data as EquipmentListItem[]);
        if (!sRes.error && sRes.data) setSubcontractors(sRes.data as SubcontractorRow[]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opts.isOpen, opts.step]);

  return { equipmentList, equipmentListAll, subcontractors };
}
