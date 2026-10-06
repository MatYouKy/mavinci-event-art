-- Regression for catalog edits incorrectly rebuilding existing reservations.
-- All fixture changes are rolled back. Run after the migration.
BEGIN;
CREATE TEMP TABLE reservation_snapshot ON COMMIT DROP AS
  SELECT * FROM public.event_equipment;
CREATE TEMP TABLE catalog_test_result (result text) ON COMMIT DROP;
DO $$
DECLARE
  product uuid := 'cbdd905d-37d9-4f33-aefb-b717c6f7a7bc';
  item uuid;
  link uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.offer_product_equipment WHERE product_id=product) THEN
    RAISE EXCEPTION 'Missing regression fixture product';
  END IF;
  SELECT e.id INTO item FROM public.equipment_items e
  WHERE NOT EXISTS (SELECT 1 FROM public.offer_product_equipment pe
    WHERE pe.product_id=product AND pe.equipment_item_id=e.id)
  LIMIT 1;
  IF item IS NULL THEN RAISE EXCEPTION 'Missing available catalog test item'; END IF;

  INSERT INTO public.offer_product_equipment(product_id,equipment_item_id,quantity,is_optional)
  VALUES(product,item,1,false) RETURNING id INTO link;
  UPDATE public.offer_product_equipment SET quantity=2 WHERE id=link;
  DELETE FROM public.offer_product_equipment WHERE id=link;
  UPDATE public.offer_product_equipment SET quantity=quantity
    WHERE product_id=product;
  SET CONSTRAINTS ALL IMMEDIATE;

  IF EXISTS (SELECT * FROM public.event_equipment EXCEPT SELECT * FROM reservation_snapshot)
    OR EXISTS (SELECT * FROM reservation_snapshot EXCEPT SELECT * FROM public.event_equipment) THEN
    RAISE EXCEPTION 'Catalog edit changed event reservations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.event_equipment'::regclass
    AND tgname='event_kit_stock' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Physical kit inventory protection is not enabled';
  END IF;
  INSERT INTO catalog_test_result VALUES ('PASS: catalog insert/update/delete; existing product update; reservations unchanged; stock protection enabled');
END $$;
SELECT * FROM catalog_test_result;
ROLLBACK;
