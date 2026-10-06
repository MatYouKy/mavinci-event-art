BEGIN;
DO $$ DECLARE oid uuid; pid uuid; rowid uuid; proposals jsonb; payload jsonb; BEGIN
 INSERT INTO public.offer_products(name,base_price) VALUES('__test_offer_product',100) RETURNING id INTO pid;
 INSERT INTO public.offers(title,status) VALUES('__test_offer_placement','draft') RETURNING id INTO oid;
 proposals:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',pid,'name','Usługa','quantity',2,'unit_price',80,'unit','szt'));
 UPDATE public.offers SET recommended_items=proposals WHERE id=oid;
 payload:=jsonb_build_object('product_id',pid,'name','Usługa','quantity',2,'unit','szt','unit_price',80,'unit_cost',0,'discount_percent',0,'discount_amount',0,'transport_cost',0,'logistics_cost',0,'display_order',999,'variant_prices_net','{}'::jsonb,'show_variant_prices_in_pdf',true,'show_product_variants_in_pdf',true);
 BEGIN
 PERFORM public.add_offer_item_without_duplicate(oid,payload,false,proposals);
 RAISE EXCEPTION 'TEST: missing confirmation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.add_offer_item_without_duplicate(oid,payload,true,'[]');
 RAISE EXCEPTION 'TEST: stale recommendations accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
 BEGIN
 PERFORM public.add_offer_item_without_duplicate(oid,payload||jsonb_build_object('product_variant_id',gen_random_uuid()),true,proposals);
 RAISE EXCEPTION 'TEST: invalid variant accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF (SELECT recommended_items FROM public.offers WHERE id=oid) IS DISTINCT FROM proposals THEN RAISE EXCEPTION 'TEST: failed insert lost recommendation'; END IF;
 rowid:=public.add_offer_item_without_duplicate(oid,payload,true,proposals);
 IF (SELECT recommended_items FROM public.offers WHERE id=oid)<>'[]'::jsonb OR NOT EXISTS(SELECT 1 FROM public.offer_items WHERE id=rowid AND quantity=2 AND unit_price=80) THEN RAISE EXCEPTION 'TEST: transfer failed'; END IF;
 BEGIN
 PERFORM public.add_offer_item_without_duplicate(oid,payload,false,'[]');
 RAISE EXCEPTION 'TEST: duplicate accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
 BEGIN
 UPDATE public.offers SET recommended_items=proposals WHERE id=oid;
 RAISE EXCEPTION 'TEST: main product recommended';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF; END;
END $$;
SELECT 'PASS: confirmation, stale data, transfer, duplicate and recommendation guards';
ROLLBACK;
