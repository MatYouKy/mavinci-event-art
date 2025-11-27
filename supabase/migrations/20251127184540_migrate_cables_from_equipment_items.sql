/*
  # Migracja przewodów z equipment_items do cables

  ## Opis
  Przenosi wszystkie istniejące przewody (equipment_items z cable_specs) do nowej tabeli cables.
  
  ## Proces migracji
  1. Kopiuje dane z equipment_items gdzie cable_specs IS NOT NULL do cables
  2. Konwertuje nazwy connectorów na UUID poprzez dopasowanie z connector_types
  3. Kopiuje powiązane equipment_units do cable_units
  4. Aktualizuje powiązania w equipment_kit_items na equipment_kit_cables
  5. Usuwa przewody z equipment_items (soft delete)
  
  ## Bezpieczeństwo
  - Operacja jest bezpieczna - używa soft delete zamiast hard delete
  - Wszystkie powiązania są zachowane
*/

-- Migracja cables z equipment_items
INSERT INTO cables (
  id,
  name,
  warehouse_category_id,
  storage_location_id,
  thumbnail_url,
  description,
  length_meters,
  connector_in,
  connector_out,
  stock_quantity,
  purchase_date,
  purchase_price,
  current_value,
  notes,
  is_active,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  ei.id,
  ei.name,
  ei.warehouse_category_id,
  ei.storage_location_id,
  ei.thumbnail_url,
  ei.description,
  (ei.cable_specs->>'length_meters')::numeric,
  ct_in.id,
  ct_out.id,
  COALESCE(ei.cable_stock_quantity, 0),
  ei.purchase_date,
  ei.purchase_price,
  ei.current_value,
  ei.notes,
  ei.is_active,
  ei.created_at,
  ei.updated_at,
  ei.deleted_at
FROM equipment_items ei
LEFT JOIN connector_types ct_in ON ct_in.name = ei.cable_specs->>'connector_in'
LEFT JOIN connector_types ct_out ON ct_out.name = ei.cable_specs->>'connector_out'
WHERE ei.cable_specs IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Migracja cable_units z equipment_units
INSERT INTO cable_units (
  id,
  cable_id,
  serial_number,
  status,
  storage_location_id,
  condition_notes,
  last_inspection_date,
  created_at,
  updated_at
)
SELECT
  eu.id,
  eu.equipment_id,
  eu.unit_serial_number,
  eu.status,
  eu.location_id,
  eu.condition_notes,
  eu.last_service_date,
  eu.created_at,
  eu.updated_at
FROM equipment_units eu
INNER JOIN equipment_items ei ON eu.equipment_id = ei.id
WHERE ei.cable_specs IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Migracja equipment_kit_cables z equipment_kit_items
INSERT INTO equipment_kit_cables (
  kit_id,
  cable_id,
  quantity,
  notes,
  created_at
)
SELECT
  eki.kit_id,
  eki.equipment_id,
  eki.quantity,
  'Migrowane z equipment_kit_items',
  eki.created_at
FROM equipment_kit_items eki
INNER JOIN equipment_items ei ON eki.equipment_id = ei.id
WHERE ei.cable_specs IS NOT NULL
ON CONFLICT (kit_id, cable_id) DO NOTHING;

-- Soft delete przewodów z equipment_items
UPDATE equipment_items
SET deleted_at = now()
WHERE cable_specs IS NOT NULL
AND deleted_at IS NULL;
