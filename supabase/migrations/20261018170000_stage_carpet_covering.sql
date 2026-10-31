BEGIN;
-- Separate stage carpet rate per square metre, with no assumed warehouse inventory.
INSERT INTO public.equipment_items (id,name,description,notes,warehouse_category_id,rental_price_per_day,total_quantity,is_active)
VALUES ('498f691c-0a38-5399-8b4f-66198caa1c5c','Pokrycie podestu dywanem — m²',
'Pokrycie powierzchni podestu wykładziną dywanową. Ilość do wyceny odpowiada powierzchni podestu w metrach kwadratowych: szerokość × głębokość. Cena za 1 m²: 100 zł netto.',
'Pozycja przeznaczona do konfiguratora podestu. Jednostka rozliczeniowa: m². Kolor oraz dostępność materiału ustalane przy ofercie. Stan fizycznego materiału nie został zadeklarowany.',
'ca3cae11-c385-474a-9028-664bc9e576e5',100,0,true)
ON CONFLICT (id) DO NOTHING
;
UPDATE public.offer_products p
SET configuration_schema=jsonb_set(p.configuration_schema,'{roots}',(p.configuration_schema->'roots')||'{"id":"498f691c-0a38-5399-8b4f-66198caa1c5c","equipment_id":"498f691c-0a38-5399-8b4f-66198caa1c5c","basis":"area","quantity":1,"required":false}'::jsonb)
WHERE p.id='be81ab60-9ca7-4429-af94-b7068f8e9530'
AND p.configuration_schema->>'profile'='warehouse_stage'
AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.configuration_schema->'roots') r WHERE r->>'equipment_id'='498f691c-0a38-5399-8b4f-66198caa1c5c');
COMMIT;
