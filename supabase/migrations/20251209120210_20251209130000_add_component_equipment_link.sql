/*
  # Dodaj powiązanie komponentów z magazynem sprzętu

  1. Zmiany
    - Dodaj `component_equipment_id` do `equipment_components` (opcjonalne powiązanie)
    - Pozwala wybrać sprzęt z magazynu jako komponent zestawu
    - Lub wpisać własną nazwę (component_equipment_id = NULL)
  
  2. Wykorzystanie
    - Jeśli component_equipment_id jest ustawione - komponent pochodzi z magazynu
    - Jeśli NULL - komponent ma własną nazwę (component_name)
    - Umożliwia automatyczne generowanie checklisty na podstawie dostępnych jednostek
*/

-- Dodaj kolumnę z powiązaniem do equipment_items
ALTER TABLE equipment_components
ADD COLUMN IF NOT EXISTS component_equipment_id uuid REFERENCES equipment_items(id) ON DELETE SET NULL;

-- Indeks dla szybkiego wyszukiwania
CREATE INDEX IF NOT EXISTS idx_equipment_components_component_equipment_id 
ON equipment_components(component_equipment_id);

COMMENT ON COLUMN equipment_components.component_equipment_id IS 'Opcjonalne powiązanie z equipment_items - jeśli ustawione, komponent pochodzi z magazynu';
