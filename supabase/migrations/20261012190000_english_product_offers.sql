BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.offer_products
 ADD COLUMN translation_revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN english_content jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN english_source_revision bigint,
 ADD COLUMN english_version bigint NOT NULL DEFAULT 0,
 ADD COLUMN english_updated_at timestamptz;
CREATE FUNCTION public.product_translation_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (to_jsonb(NEW) - ARRAY['updated_at','translation_revision','english_content','english_source_revision','english_version','english_updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','translation_revision','english_content','english_source_revision','english_version','english_updated_at']) THEN
   NEW.translation_revision := OLD.translation_revision + 1;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_translation_revision BEFORE UPDATE ON public.offer_products
 FOR EACH ROW EXECUTE FUNCTION public.product_translation_revision();
CREATE FUNCTION public.variant_translation_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN UPDATE public.offer_products SET translation_revision=translation_revision+1 WHERE id=OLD.product_id; END IF;
 IF TG_OP = 'INSERT' THEN UPDATE public.offer_products SET translation_revision=translation_revision+1 WHERE id=NEW.product_id;
 ELSIF TG_OP = 'UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN UPDATE public.offer_products SET translation_revision=translation_revision+1 WHERE id=NEW.product_id; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER variant_translation_revision AFTER INSERT OR UPDATE OR DELETE ON public.offer_product_variants
 FOR EACH ROW EXECUTE FUNCTION public.variant_translation_revision();
CREATE TABLE public.offer_language_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
 language text NOT NULL CHECK(language='en'),
 source_revision bigint NOT NULL,
 file_path text NOT NULL,
 file_name text NOT NULL,
 page_count integer NOT NULL,
 translation_memory jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX offer_language_documents_offer ON public.offer_language_documents(offer_id, created_at DESC);
ALTER TABLE public.offer_language_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_language_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.offer_language_documents TO authenticated;
GRANT ALL ON public.offer_language_documents TO service_role;
CREATE POLICY offer_language_documents_read ON public.offer_language_documents FOR SELECT TO authenticated USING(public.sales_can_manage_offer(offer_id));
CREATE FUNCTION public.record_offer_english_document(p_offer uuid, p_revision bigint, p_path text, p_name text, p_pages integer, p_memory jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_revision bigint; result uuid;
BEGIN
 SELECT content_revision INTO current_revision FROM public.offers WHERE id=p_offer FOR SHARE;
 IF NOT FOUND OR current_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Oferta zmieniła się podczas generowania EN. Wygeneruj ją ponownie.'; END IF;
 IF p_path NOT LIKE p_offer::text || '/%' THEN RAISE EXCEPTION 'Nieprawidłowa ścieżka dokumentu'; END IF;
 INSERT INTO public.offer_language_documents(offer_id,language,source_revision,file_path,file_name,page_count,translation_memory)
 VALUES(p_offer,'en',p_revision,p_path,p_name,p_pages,p_memory) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_offer_english_document(uuid,bigint,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_offer_english_document(uuid,bigint,text,text,integer,jsonb) TO service_role;
COMMIT;
