/*
  # Oznacz sprzęt zastąpiony przez rental

  1. Zmiany
    - Dodaj kolumnę `replaced_by_rental_id` do `offer_product_equipment`
    - Pozwala oznaczyć który rekord zastąpił dany sprzęt
    
  2. Powód
    - Gdy użytkownik wybiera rental equipment jako zamiennik dla konfliktu
    - Oryginalny sprzęt z produktu pozostaje w bazie (dla historii)
    - Ale jest oznaczony jako zastąpiony przez rental equipment
    - W widokach pokazujemy tylko aktywny sprzęt (nie zastąpiony)
*/

ALTER TABLE offer_product_equipment
ADD COLUMN IF NOT EXISTS replaced_by_rental_id uuid REFERENCES offer_product_equipment(id) ON DELETE SET NULL;

COMMENT ON COLUMN offer_product_equipment.replaced_by_rental_id IS
'ID rental equipment który zastąpił ten sprzęt. Jeśli NOT NULL, ten sprzęt nie powinien być pokazywany w widokach.';