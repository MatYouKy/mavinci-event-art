BEGIN;

-- A read acknowledgement is separate from the commercial decision. Remember
-- the exact request revision, so submitting the offer again restores its badge.
CREATE TABLE IF NOT EXISTS public.seller_review_reads (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offer_id uuid NOT NULL REFERENCES public.offers(id) ON DELETE CASCADE,
  read_token text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, offer_id)
);
ALTER TABLE public.seller_review_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_review_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.seller_review_reads TO authenticated;
DROP POLICY IF EXISTS seller_review_reads_self ON public.seller_review_reads;
CREATE POLICY seller_review_reads_self ON public.seller_review_reads
  FOR SELECT TO authenticated USING (user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.mark_seller_review_read(p_offer uuid,p_read_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_review public.seller_offer_reviews%ROWTYPE; v_token text;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() OR NOT EXISTS (
    SELECT 1 FROM public.offers o JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
    WHERE o.id=p_offer
      AND public.seller_directory_crm_row_access(p.employee_id,p.contact_id,p.partner_type)
      AND public.seller_offer_can_manage(o.id)
      AND public.seller_workspace_offers_access(o.my_company_id)
  ) THEN RAISE EXCEPTION 'Brak dostępu do powiadomienia sprzedawcy' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_review FROM public.seller_offer_reviews WHERE offer_id=p_offer FOR SHARE;
  IF NOT FOUND OR v_review.status<>'pending' THEN RETURN false; END IF;
  v_token:=md5(v_review.document_id::text||'|'||extract(epoch FROM v_review.requested_at)::text||'|'||COALESCE(v_review.source_key,''));
  IF p_read_token IS DISTINCT FROM v_token THEN RETURN false; END IF;
  -- Acknowledging the request also reads this user's corresponding bell item,
  -- never deliveries to other employees or a newer request.
  UPDATE public.notification_recipients recipient SET is_read=true,read_at=now()
  FROM public.notifications n
  WHERE recipient.notification_id=n.id AND recipient.user_id=auth.uid() AND NOT recipient.is_read
    AND n.related_entity_id::text=p_offer::text
    AND n.metadata->>'document_id'=v_review.document_id::text
    AND n.created_at>=v_review.requested_at
    AND (n.metadata->>'workflow'='seller_offer' OR n.title='Zapytanie sprzedawcy: termin i zasoby');
  -- Same lock order as the bell's recipient update + acknowledgement trigger.
  INSERT INTO public.seller_review_reads(user_id,offer_id,read_token)
  VALUES(auth.uid(),p_offer,v_token)
  ON CONFLICT(user_id,offer_id) DO UPDATE SET read_token=EXCLUDED.read_token,read_at=now();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mark_seller_review_read(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_seller_review_read(uuid,text) TO authenticated;

-- Reading an actual review notification in the bell has the same effect as
-- opening it from the directory. Old deliveries cannot consume new requests.
CREATE OR REPLACE FUNCTION public.sync_seller_review_notification_read()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer uuid; v_token text;
BEGIN
  IF NEW.is_read IS NOT TRUE OR OLD.is_read IS TRUE OR NEW.user_id IS DISTINCT FROM auth.uid()
    OR auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN RETURN NEW; END IF;
  SELECT r.offer_id,md5(r.document_id::text||'|'||extract(epoch FROM r.requested_at)::text||'|'||COALESCE(r.source_key,''))
  INTO v_offer,v_token
  FROM public.notifications n
  JOIN public.seller_offer_reviews r ON r.offer_id::text=n.related_entity_id::text
  JOIN public.offers o ON o.id=r.offer_id
  JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
  WHERE n.id=NEW.notification_id AND r.status='pending'
    AND n.metadata->>'document_id'=r.document_id::text AND n.created_at>=r.requested_at
    AND (n.metadata->>'workflow'='seller_offer' OR n.title='Zapytanie sprzedawcy: termin i zasoby')
    AND public.seller_directory_crm_row_access(p.employee_id,p.contact_id,p.partner_type)
    AND public.seller_offer_can_manage(o.id) AND public.seller_workspace_offers_access(o.my_company_id);
  IF FOUND THEN
    INSERT INTO public.seller_review_reads(user_id,offer_id,read_token)
    VALUES(NEW.user_id,v_offer,v_token)
    ON CONFLICT(user_id,offer_id) DO UPDATE SET read_token=EXCLUDED.read_token,read_at=now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.sync_seller_review_notification_read() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS seller_review_notification_read ON public.notification_recipients;
CREATE TRIGGER seller_review_notification_read AFTER UPDATE OF is_read ON public.notification_recipients
  FOR EACH ROW EXECUTE FUNCTION public.sync_seller_review_notification_read();

-- One response supplies both the row badges and their sidebar sum. Keep the
-- existing inbox's company/module/chat checks and the directory's profile RLS.
-- Do not aggregate other employees' read states: everyone reads for themselves.
CREATE OR REPLACE FUNCTION public.get_seller_sidebar_badge()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_admin boolean;
  v_scope text:='mine';
  v_items jsonb:='[]'::jsonb;
  v_count bigint:=0;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN jsonb_build_object('items',v_items,'count',0,'scope',v_scope,'employee_id',NULL,'can_choose_scope',false);
  END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=public.current_employee_id() AND is_active=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('items',v_items,'count',0,'scope',v_scope,'employee_id',NULL,'can_choose_scope',false);
  END IF;
  v_admin:=COALESCE(v_employee.role::text='admin' OR v_employee.access_level::text='admin'
    OR 'admin'=ANY(COALESCE(v_employee.permissions,'{}'::text[])),false);
  IF NOT v_admin AND NOT (COALESCE(v_employee.permissions,'{}'::text[])
    && ARRAY['contacts_view','contacts_manage','finances_view','finances_manage']) THEN
    RETURN jsonb_build_object('items',v_items,'count',0,'scope',v_scope,'employee_id',v_employee.id,'can_choose_scope',false);
  END IF;
  -- The full admin list is the default. Preserve an explicitly saved mine choice.
  IF v_admin AND COALESCE(v_employee.preferences #>> '{notifications,sellerSidebarScope}','all')<>'mine' THEN
    v_scope:='all';
  END IF;

  WITH candidates AS (
    SELECT item.value,r.document_id,
      md5(r.document_id::text||'|'||extract(epoch FROM r.requested_at)::text||'|'||COALESCE(r.source_key,'')) AS token,
      seen.read_token
    FROM jsonb_array_elements(public.get_seller_inbox()) item(value)
    JOIN public.sales_partner_profiles p ON p.id::text=item.value->>'sales_partner_id'
    LEFT JOIN public.contacts c ON c.id=p.contact_id
    LEFT JOIN public.seller_offer_reviews r ON item.value->>'kind'='review' AND r.offer_id::text=item.value->>'offer_id'
    LEFT JOIN public.seller_review_reads seen ON seen.offer_id=r.offer_id AND seen.user_id=auth.uid()
    WHERE public.seller_directory_crm_row_access(p.employee_id,p.contact_id,p.partner_type)
      AND (v_scope='all' OR c.owner_id=v_employee.id)
  ), unread AS (
    SELECT CASE WHEN value->>'kind'='review'
      THEN value||jsonb_build_object('read_token',token,'document_id',document_id)
      ELSE value END AS item
    FROM candidates
    WHERE value->>'kind'<>'review' OR (token IS NOT NULL AND read_token IS DISTINCT FROM token)
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'created_at')::timestamptz DESC,item->>'id'),'[]'::jsonb),
    COALESCE(sum((item->>'count')::bigint),0)
  INTO v_items,v_count FROM unread;
  RETURN jsonb_build_object('items',v_items,'count',v_count,'scope',v_scope,
    'employee_id',v_employee.id,'can_choose_scope',v_admin);
END; $$;
REVOKE ALL ON FUNCTION public.get_seller_sidebar_badge() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_sidebar_badge() TO authenticated;
COMMENT ON FUNCTION public.get_seller_sidebar_badge() IS
  'Wspólne nieodczytane sprawy listy sprzedawców i ich suma w sidebarze. Odczyt indywidualny, niezależny od decyzji. Zakres moje/wszystkie obowiązuje w obu miejscach.';

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='seller_review_reads') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_review_reads;
  END IF;
END; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
