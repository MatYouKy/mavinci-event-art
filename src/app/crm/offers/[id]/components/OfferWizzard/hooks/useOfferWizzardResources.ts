'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function useOfferWizardResources(opts: { isOpen: boolean; step: number }) {
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [subcontractors, setSubcontractors] = useState<any[]>([]);

  useEffect(() => {
    if (!opts.isOpen || opts.step !== 4) return;

    (async () => {
      const eqRes = await supabase
        .from('equipment_items')
        .select('id, name, brand, model')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');

      if (!eqRes.error && eqRes.data) setEquipmentList(eqRes.data);

      const sRes = await supabase
        .from('subcontractors')
        .select('id, contact_person, company_name, specialization')
        .eq('status', 'active')
        .order('company_name');

      if (!sRes.error && sRes.data) setSubcontractors(sRes.data);
    })();
  }, [opts.isOpen, opts.step]);

  return { equipmentList, subcontractors };
}