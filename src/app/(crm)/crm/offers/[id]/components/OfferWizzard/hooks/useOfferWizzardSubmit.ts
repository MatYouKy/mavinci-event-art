'use client';

import { supabase } from '@/lib/supabase/browser';
import { buildSubstitutionsForInsert, calcTotal } from '../utils';
import { EquipmentConflictRow, SelectedAltMap } from '../types';
import { IOfferItem } from '@/app/(crm)/crm/offers/types';

export async function submitOfferWizard(params: {
  eventId: string;
  employeeId: string;

  clientType: 'individual' | 'business';
  organizationId?: string;
  contactId?: string;

  offerData: { offer_number: string; valid_until: string; notes: string };
  offerItems: IOfferItem[];

  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
  equipmentSubstitutions?: Record<string, any>;
}) {
  const totalAmount = calcTotal(params.offerItems);

  const offerDataToInsert: any = {
    event_id: params.eventId,
    client_type: params.clientType,
    organization_id: params.clientType === 'business' ? params.organizationId || null : null,
    contact_id: params.clientType === 'individual' ? params.contactId || null : null,
    valid_until: params.offerData.valid_until || null,
    notes: params.offerData.notes || null,
    status: 'draft',
    total_amount: totalAmount,
    created_by: params.employeeId,
    offer_number: params.offerData.offer_number?.trim()
      ? params.offerData.offer_number.trim()
      : null,
  };

  const { data: offerResult, error: offerError } = await supabase
    .from('offers')
    .insert([offerDataToInsert])
    .select()
    .single();

  if (offerError) throw offerError;

  const itemsToInsert = params.offerItems.map((item, index) => ({
    offer_id: offerResult.id,
    product_id: item.product_id?.trim() ? item.product_id : null,
    name: item.name,
    description: item.description || null,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    unit_cost: 0,
    discount_percent: item.discount_percent || 0,
    discount_amount: 0,
    transport_cost: 0,
    logistics_cost: 0,
    display_order: index + 1,
    notes: null,
  }));

  const { error: itemsError } = await supabase.from('offer_items').insert(itemsToInsert);
  if (itemsError) throw itemsError;

  // Merge committed substitutions with temporary selections
  const combinedSubstitutions: SelectedAltMap = {};

  // First, add committed substitutions from equipmentSubstitutions
  if (params.equipmentSubstitutions) {
    Object.entries(params.equipmentSubstitutions).forEach(([key, sub]) => {
      combinedSubstitutions[key] = {
        item_id: sub.to_item_id,
        qty: sub.qty,
      };
    });
  }

  // Then, add temporary selections from selectedAlt
  Object.entries(params.selectedAlt).forEach(([key, sel]) => {
    combinedSubstitutions[key] = sel;
  });

  const substitutionsPayload = buildSubstitutionsForInsert({
    offerId: offerResult.id,
    selectedAlt: combinedSubstitutions,
    conflicts: params.conflicts,
  });

  if (substitutionsPayload.length > 0) {
    const { error: subsError } = await supabase
      .from('offer_equipment_substitutions')
      .insert(substitutionsPayload);

    if (subsError) throw subsError;
  }

  return offerResult as { id: string; offer_number: string };
}
