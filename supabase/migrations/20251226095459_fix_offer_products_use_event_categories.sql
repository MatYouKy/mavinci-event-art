/*
  # Zmiana kategorii produktów - używaj event_categories

  1. Zmiany
    - Usuń foreign key `offer_products.category_id -> offer_product_categories`
    - Dodaj foreign key `offer_products.category_id -> event_categories`
    - Frontend już używa kategorii z event_categories jako jednego źródła prawdy

  2. Security
    - Nie zmieniamy RLS - pozostają takie same uprawnienia
*/

-- Usuń stary foreign key constraint
ALTER TABLE offer_products
DROP CONSTRAINT IF EXISTS offer_products_category_id_fkey;

-- Dodaj nowy foreign key do event_categories
ALTER TABLE offer_products
ADD CONSTRAINT offer_products_category_id_fkey
  FOREIGN KEY (category_id)
  REFERENCES event_categories(id)
  ON DELETE SET NULL;

-- Ustaw NULL dla category_id które nie istnieją w event_categories
UPDATE offer_products
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM event_categories
    WHERE id = offer_products.category_id
  );

COMMENT ON COLUMN offer_products.category_id IS
'Kategoria produktu - odnosi się do event_categories (jedno źródło prawdy dla całego systemu)';
