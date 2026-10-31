BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE TABLE public.offer_english_content (
 offer_id uuid PRIMARY KEY REFERENCES public.offers(id) ON DELETE CASCADE,
 source_signature text NOT NULL,
 memory jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.offer_english_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.offer_english_content FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.offer_english_content TO authenticated;
GRANT ALL ON public.offer_english_content TO service_role;
CREATE POLICY offer_english_content_read ON public.offer_english_content FOR SELECT TO authenticated USING(public.sales_can_manage_offer(offer_id));
COMMIT;
