'use client';

import { supabase } from '@/lib/supabase/browser';
import { buildSubstitutionsForInsert, getRentalEquipmentFromSelectedAlt } from '../utils';
import { EquipmentConflictRow, SelectedAltMap } from '../types';
import { IOfferItem } from '@/app/(crm)/crm/offers/types';
import {
  EventAssumptionItem,
  formatEventAssumptionItems,
} from '@/lib/CRM/Offers/eventAssumptions';

export async function submitOfferWizard(params: {
  eventId: string;
  employeeId: string;

  clientType: 'individual' | 'business';
  organizationId?: string;
  contactId?: string;

  offerData: {
    offer_number: string;
    valid_until: string;
    notes: string;
    event_location: string;
    event_assumptions: string;
    event_assumption_items: EventAssumptionItem[];
    event_goal: string;
  };
  offerItems: IOfferItem[];

  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
  equipmentSubstitutions?: Record<string, any>;
  hasEquipmentShortage?: boolean;
  pricing: {
    listNet: number;
    targetNet: number;
    discountAmount: number;
    discountPercent: number;
    taxPercent: number;
    taxAmount: number;
    gross: number;
  };
}) {
  const offerDataToInsert: any = {
    event_id: params.eventId,
    client_type: params.clientType,
    organization_id: params.clientType === 'business' ? params.organizationId || null : null,
    contact_id: params.contactId || null,
    valid_until: params.offerData.valid_until || null,
    notes: params.offerData.notes || null,
    event_location: params.offerData.event_location.trim() || null,
    event_assumptions:
      formatEventAssumptionItems(params.offerData.event_assumption_items) ||
      params.offerData.event_assumptions.trim() ||
      null,
    event_assumption_items: params.offerData.event_assumption_items,
    event_goal: params.offerData.event_goal.trim() || null,
    status: 'draft',
    subtotal: params.pricing.listNet,
    discount_percent: params.pricing.discountPercent,
    discount_amount: params.pricing.discountAmount,
    tax_percent: params.pricing.taxPercent,
    tax_amount: params.pricing.taxAmount,
    total_amount: params.pricing.gross,
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
    product_variant_id: item.product_variant_id || null,
    show_variant_prices_in_pdf: item.show_variant_prices_in_pdf !== false,
    show_product_variants_in_pdf: item.show_product_variants_in_pdf !== false,
    name: item.name,
    description: item.description || null,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    unit_cost: 0,
    discount_percent: item.discount_percent || 0,
    discount_amount: Math.round(
      (Number(item.quantity || 0) * Number(item.unit_price || 0) * Number(item.discount_percent || 0) / 100 + Number.EPSILON) * 100,
    ) / 100,
    transport_cost: 0,
    logistics_cost: 0,
    display_order: index + 1,
    notes: null,
  }));

  const { error: itemsError } = await supabase.from('offer_items').insert(itemsToInsert);
  if (itemsError) throw itemsError;

  // Trigger przelicza ofertę po dodaniu pozycji. Nadpisujemy podsumowanie dokładną
  // kwotą rabatu wpisaną przez użytkownika, aby np. 400 zł nie stało się 400,32 zł
  // wskutek zaokrąglenia procentu do dwóch miejsc.
  const { error: totalsError } = await supabase
    .from('offers')
    .update({
      subtotal: params.pricing.listNet,
      discount_percent: params.pricing.discountPercent,
      discount_amount: params.pricing.discountAmount,
      tax_percent: params.pricing.taxPercent,
      tax_amount: params.pricing.taxAmount,
      total_amount: params.pricing.gross,
    })
    .eq('id', offerResult.id);
  if (totalsError) throw totalsError;

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

  // Zamień konfliktowy sprzęt na rental equipment
  const rentalEquipment = getRentalEquipmentFromSelectedAlt(combinedSubstitutions);

  if (rentalEquipment.length > 0) {
    for (const rental of rentalEquipment) {
      // Znajdź wszystkie produkty w tej ofercie
      const { data: offerItemsWithProducts } = await supabase
        .from('offer_items')
        .select('id, product_id')
        .eq('offer_id', offerResult.id)
        .not('product_id', 'is', null);

      if (offerItemsWithProducts) {
        for (const offerItem of offerItemsWithProducts) {
          // Znajdź oryginalny sprzęt który ma być zastąpiony
          const { data: existingEquipment } = await supabase
            .from('offer_product_equipment')
            .select('id')
            .eq('product_id', offerItem.product_id)
            .eq(
              rental.originalItemType === 'item' ? 'equipment_item_id' : 'equipment_kit_id',
              rental.originalItemId
            )
            .maybeSingle();

          if (existingEquipment) {
            // Dodaj rental equipment
            const { data: rentalRecord, error: rentalError } = await supabase
              .from('offer_product_equipment')
              .insert({
                product_id: offerItem.product_id,
                rental_equipment_id: rental.rentalEquipmentId,
                subcontractor_id: rental.subcontractorId,
                quantity: rental.quantity,
                is_rental: true,
                is_optional: false,
              })
              .select('id')
              .single();

            if (rentalError) {
              console.error('Error inserting rental equipment:', rentalError);
            } else if (rentalRecord) {
              // Oznacz oryginalny sprzęt jako zastąpiony
              await supabase
                .from('offer_product_equipment')
                .update({ replaced_by_rental_id: rentalRecord.id })
                .eq('id', existingEquipment.id);
            }
          } else {
            // Jeśli nie znaleziono oryginalnego (np. już nie istnieje), po prostu dodaj rental
            const { error: rentalError } = await supabase
              .from('offer_product_equipment')
              .insert({
                product_id: offerItem.product_id,
                rental_equipment_id: rental.rentalEquipmentId,
                subcontractor_id: rental.subcontractorId,
                quantity: rental.quantity,
                is_rental: true,
                is_optional: false,
              });

            if (rentalError) {
              console.error('Error inserting rental equipment:', rentalError);
            }
          }
        }
      }
    }
  }

  // Jeśli oferta ma braki sprzętowe, oznacz event
  if (params.hasEquipmentShortage) {
    const { error: eventError } = await supabase
      .from('events')
      .update({ has_equipment_shortage: true })
      .eq('id', params.eventId);

    if (eventError) {
      console.error('Error updating event equipment shortage flag:', eventError);
      // Nie rzucamy błędu - oferta została utworzona, to tylko flaga
    }
  }

  return offerResult as { id: string; offer_number: string };
}
