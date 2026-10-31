BEGIN;

-- One official sales document has one CRM identity and one payment ledger.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS ksef_source_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.linked_sales_ksef(p_invoice uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids uuid[];
BEGIN
 SELECT array_agg(k.id) INTO ids FROM public.ksef_invoices k JOIN public.invoices i ON i.id=k.invoice_id
 WHERE i.id=p_invoice AND k.invoice_type='issued' AND k.my_company_id=i.my_company_id
 AND k.sync_status IS DISTINCT FROM 'error' AND nullif(k.ksef_reference_number,'') IS NOT NULL
 AND i.ksef_reference_number=k.ksef_reference_number
 AND upper(coalesce(k.currency,'PLN'))=i.currency_code
 AND abs(abs(coalesce(k.amount_to_pay_gross,k.gross_amount))-public.bank_document_due_amount(i.id,NULL,NULL))<=0.01;
 IF coalesce(array_length(ids,1),0)>1 THEN RAISE EXCEPTION 'Więcej niż jeden dokument KSeF odpowiada fakturze. Sprawdź powiązania.'; END IF;
 RETURN ids[1];
END; $$;
REVOKE ALL ON FUNCTION public.linked_sales_ksef(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.project_sales_ksef_payment(p_ksef uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k public.ksef_invoices%ROWTYPE; amount numeric; latest date; old_sync text; old_bank text;
BEGIN
 SELECT * INTO k FROM public.ksef_invoices WHERE id=p_ksef;
 IF k.invoice_id IS NULL OR public.linked_sales_ksef(k.invoice_id) IS DISTINCT FROM k.id THEN RETURN; END IF;
 SELECT coalesce(sum(p.amount),0),max(p.payment_date) INTO amount,latest FROM public.ksef_invoice_payments p WHERE p.ksef_invoice_id=k.id;
 old_sync:=current_setting('app.ksef_sales_sync',true); old_bank:=current_setting('app.bank_match_recalc',true);
 PERFORM set_config('app.ksef_sales_sync','1',true); PERFORM set_config('app.bank_match_recalc','1',true);
 -- Explicitly clear a previously paid status before the existing normalizer runs.
 UPDATE public.invoices SET paid_amount=amount,manual_paid_amount=0,paid_date=latest,paid_at=latest::timestamptz,
   status=CASE WHEN status IN ('paid','overdue') THEN 'issued' ELSE status END,
   payment_status=CASE WHEN amount>0 THEN 'partially_paid' ELSE 'unpaid' END
 WHERE id=k.invoice_id AND status NOT IN ('draft','proforma','cancelled')
 AND (paid_amount IS DISTINCT FROM amount OR paid_date IS DISTINCT FROM latest OR manual_paid_amount<>0
   OR (status='paid' AND amount<public.bank_document_due_amount(id,NULL,NULL)-0.01));
 PERFORM set_config('app.bank_match_recalc',coalesce(old_bank,''),true);
 PERFORM set_config('app.ksef_sales_sync',coalesce(old_sync,''),true);
END; $$;
REVOKE ALL ON FUNCTION public.project_sales_ksef_payment(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.forward_local_sales_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE kid uuid; current_total numeric; bank_total numeric; target numeric; excess numeric; p record; old_sync text;
BEGIN
 IF current_setting('app.ksef_sales_sync',true)='1' OR current_setting('app.bank_match_recalc',true)='1' THEN RETURN NULL; END IF;
 IF NEW.paid_amount IS NOT DISTINCT FROM OLD.paid_amount AND NEW.payment_status IS NOT DISTINCT FROM OLD.payment_status
    AND NEW.paid_date IS NOT DISTINCT FROM OLD.paid_date THEN RETURN NULL; END IF;
 kid:=public.linked_sales_ksef(NEW.id); IF kid IS NULL THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.ksef_invoices WHERE id=kid FOR UPDATE;
 SELECT coalesce(sum(amount),0),coalesce(sum(amount) FILTER(WHERE bank_match_id IS NOT NULL),0)
 INTO current_total,bank_total FROM public.ksef_invoice_payments WHERE ksef_invoice_id=kid;
 target:=greatest(coalesce(NEW.paid_amount,0),bank_total);
 old_sync:=current_setting('app.ksef_sales_sync',true); PERFORM set_config('app.ksef_sales_sync','1',true);
 IF target>current_total+0.009 THEN
   INSERT INTO public.ksef_invoice_payments(ksef_invoice_id,amount,payment_date,notes,created_by)
   VALUES(kid,target-current_total,coalesce(NEW.paid_date,current_date),'Wpłata potwierdzona w lokalnej fakturze',public.current_invoice_employee_id());
 ELSIF target<current_total-0.009 THEN
   excess:=current_total-target;
   FOR p IN SELECT * FROM public.ksef_invoice_payments WHERE ksef_invoice_id=kid AND bank_match_id IS NULL ORDER BY payment_date DESC,created_at DESC,id FOR UPDATE LOOP
     EXIT WHEN excess<=0.009;
     IF p.amount<=excess+0.009 THEN
       DELETE FROM public.ksef_invoice_payments WHERE id=p.id; excess:=excess-p.amount;
     ELSE
       UPDATE public.ksef_invoice_payments SET amount=amount-excess WHERE id=p.id; excess:=0;
     END IF;
   END LOOP;
 END IF;
 IF NEW.paid_date IS DISTINCT FROM OLD.paid_date AND NEW.paid_date IS NOT NULL AND target=current_total THEN
   UPDATE public.ksef_invoice_payments SET payment_date=NEW.paid_date
   WHERE id=(SELECT id FROM public.ksef_invoice_payments WHERE ksef_invoice_id=kid AND bank_match_id IS NULL ORDER BY payment_date DESC,created_at DESC LIMIT 1);
 END IF;
 PERFORM public.project_sales_ksef_payment(kid);
 PERFORM set_config('app.ksef_sales_sync',coalesce(old_sync,''),true);
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.forward_local_sales_payment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_forward_local_sales_payment AFTER UPDATE OF paid_amount,payment_status,paid_date,status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.forward_local_sales_payment();

CREATE OR REPLACE FUNCTION public.project_sales_payment_after_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('app.ksef_sales_sync',true)='1' THEN RETURN NULL; END IF;
 IF TG_OP<>'INSERT' THEN PERFORM public.project_sales_ksef_payment(OLD.ksef_invoice_id); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM public.project_sales_ksef_payment(NEW.ksef_invoice_id); END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.project_sales_payment_after_ledger() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_project_sales_payment_after_ledger AFTER INSERT OR UPDATE OR DELETE ON public.ksef_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.project_sales_payment_after_ledger();

-- Bank matches remain traceable by their original id and cannot be removed as manual payments.
CREATE OR REPLACE FUNCTION public.mirror_local_sales_bank_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE kid uuid;
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.invoice_id IS NOT NULL THEN PERFORM public.project_sales_ksef_payment(public.linked_sales_ksef(OLD.invoice_id)); END IF;
   RETURN NULL;
 END IF;
 IF TG_OP='UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id AND OLD.invoice_id IS NOT NULL THEN
   DELETE FROM public.ksef_invoice_payments WHERE bank_match_id=OLD.id AND ksef_invoice_id=public.linked_sales_ksef(OLD.invoice_id);
 END IF;
 kid:=public.linked_sales_ksef(NEW.invoice_id); IF kid IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.ksef_invoice_payments(ksef_invoice_id,amount,payment_date,bank_match_id,payment_source,notes,created_by)
 SELECT kid,coalesce(NEW.document_amount,NEW.amount),b.transaction_date,NEW.id,'bank','Dopasowanie bankowe lokalnej faktury',NEW.created_by
 FROM public.bank_transactions b JOIN public.bank_statements st ON st.id=b.statement_id
 JOIN public.ksef_invoices k ON k.id=kid
 WHERE b.id=NEW.bank_transaction_id AND st.my_company_id=k.my_company_id
 AND coalesce(NEW.document_currency,NEW.currency)=upper(coalesce(k.currency,'PLN'))
 ON CONFLICT(bank_match_id) WHERE bank_match_id IS NOT NULL DO UPDATE SET amount=excluded.amount,payment_date=excluded.payment_date;
 PERFORM public.project_sales_ksef_payment(kid);
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.mirror_local_sales_bank_match() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_mirror_local_sales_bank_match AFTER INSERT OR UPDATE OR DELETE ON public.bank_transaction_invoice_matches
FOR EACH ROW EXECUTE FUNCTION public.mirror_local_sales_bank_match();

CREATE OR REPLACE FUNCTION public.ensure_local_sales_ksef(p_ksef uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k public.ksef_invoices%ROWTYPE; i public.invoices%ROWTYPE; iid uuid; doc_type text; before_amount numeric; ledger_amount numeric; old_sync text; entry jsonb; rate text; n int:=0;
BEGIN
 SELECT * INTO k FROM public.ksef_invoices WHERE id=p_ksef FOR UPDATE;
 IF NOT FOUND OR k.invoice_type<>'issued' OR nullif(k.ksef_reference_number,'') IS NULL OR k.sync_status='error' THEN RETURN NULL; END IF;
 IF k.my_company_id IS NULL OR nullif(k.invoice_number,'') IS NULL OR k.gross_amount IS NULL OR k.issue_date IS NULL THEN
   RAISE EXCEPTION 'Brak pełnych danych faktury KSeF: firmy, numeru, daty lub kwoty.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(k.my_company_id::text||':'||k.invoice_number,0));
 SELECT * INTO i FROM public.invoices WHERE my_company_id=k.my_company_id AND invoice_number=k.invoice_number FOR UPDATE;
 IF k.invoice_id IS NOT NULL AND i.id IS DISTINCT FROM k.invoice_id THEN RAISE EXCEPTION 'Niezgodne powiązanie faktury KSeF.'; END IF;
 old_sync:=current_setting('app.ksef_sales_sync',true); PERFORM set_config('app.ksef_sales_sync','1',true);
 IF i.id IS NULL THEN
   IF nullif(k.xml_content,'') IS NULL THEN RAISE EXCEPTION 'Brak XML faktury KSeF. Pobierz pełny dokument przed importem lokalnym.'; END IF;
   doc_type:=coalesce(substring(k.xml_content from '<(?:[[:alnum:]_]+:)?RodzajFaktury[^>]*>([^<]+)</'),'VAT');
   doc_type:=CASE WHEN doc_type LIKE 'KOR%' THEN 'corrective' WHEN doc_type='ZAL' THEN 'advance' WHEN doc_type='ROZ' THEN 'final' ELSE 'vat' END;
   INSERT INTO public.invoices(invoice_number,invoice_type,status,my_company_id,issue_date,sale_date,payment_due_date,
     seller_name,seller_nip,seller_street,seller_postal_code,seller_city,buyer_name,buyer_nip,buyer_street,buyer_postal_code,buyer_city,
     payment_method,bank_account,currency_code,total_net,total_vat,total_gross,ksef_source_snapshot,settlement_summary,is_proforma,internal_notes)
   VALUES(k.invoice_number,doc_type,'draft',k.my_company_id,k.issue_date,coalesce(nullif(substring(k.xml_content from '<(?:[[:alnum:]_]+:)?P_6[^>]*>([^<]+)</'),'')::date,k.issue_date),coalesce(k.payment_due_date,k.issue_date),
     coalesce(k.seller_name,''),coalesce(k.seller_nip,''),coalesce(k.seller_address,''),'','',coalesce(k.buyer_name,''),k.buyer_nip,coalesce(k.buyer_address,''),'','',
     coalesce(k.payment_method,'przelew'),k.bank_account_number,upper(coalesce(k.currency,'PLN')),coalesce(k.net_amount,0),coalesce(k.vat_amount,0),k.gross_amount,
     to_jsonb(k),k.settlement_summary,false,'Zaimportowano z KSeF. Oryginalne dane dokumentu zachowano w migawce źródłowej.') RETURNING id INTO iid;
   -- Populate available official lines while the new record is still a draft.
   FOR entry IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(k.invoice_items)='array' THEN k.invoice_items ELSE '[]'::jsonb END) LOOP
     n:=n+1; rate:=replace(coalesce(entry->>'vat_rate','23'),'%','');
     IF rate NOT IN ('23','8','5','0','0 KR','0 WDT','0 EX','zw','np I','np II','oo') THEN RAISE EXCEPTION 'Nieobsługiwana stawka VAT w pozycji %: %',n,rate; END IF;
     IF nullif(entry->>'name','') IS NULL OR nullif(entry->>'price_net','') IS NULL THEN RAISE EXCEPTION 'Brak pełnych danych pozycji % faktury KSeF.',n; END IF;
     INSERT INTO public.invoice_items(invoice_id,position_number,name,unit,quantity,price_net,vat_rate,vat_code,vat_exemption_reason,value_net,vat_amount,value_gross)
     VALUES(iid,n,entry->>'name',coalesce(entry->>'unit','szt.'),coalesce((entry->>'quantity')::numeric,1),(entry->>'price_net')::numeric,
       CASE WHEN rate IN ('23','8','5','0') THEN rate::numeric ELSE 0 END,rate,CASE WHEN rate='zw' THEN coalesce(nullif(entry->>'vat_exemption_reason',''),substring(k.xml_content from '<(?:[[:alnum:]_]+:)?P_19A[^>]*>([^<]+)</'),substring(k.xml_content from '<(?:[[:alnum:]_]+:)?P_19B[^>]*>([^<]+)</'),substring(k.xml_content from '<(?:[[:alnum:]_]+:)?P_19C[^>]*>([^<]+)</')) ELSE NULL END,
       coalesce((entry->>'value_net')::numeric,0),0,coalesce((entry->>'value_gross')::numeric,0));
   END LOOP;
   -- Preserve official totals (rounding may differ from the local line calculator).
   UPDATE public.invoices SET total_net=coalesce(k.net_amount,0),total_vat=coalesce(k.vat_amount,0),total_gross=k.gross_amount WHERE id=iid;
 ELSE iid:=i.id;
 END IF;
 PERFORM public.reconcile_local_invoice_with_ksef_atomic(iid,k.ksef_reference_number);
 IF public.linked_sales_ksef(iid) IS DISTINCT FROM k.id THEN RAISE EXCEPTION 'Kwota do zapłaty lub waluta faktury lokalnej i KSeF nie zgadza się.'; END IF;
 SELECT paid_amount INTO before_amount FROM public.invoices WHERE id=iid;
 -- Existing ledger entries are preserved; historical flags alone do not invent payments.
 INSERT INTO public.ksef_invoice_payments(ksef_invoice_id,amount,payment_date,bank_match_id,payment_source,notes,created_by)
 SELECT k.id,coalesce(m.document_amount,m.amount),b.transaction_date,m.id,'bank','Dopasowanie bankowe lokalnej faktury',m.created_by
 FROM public.bank_transaction_invoice_matches m JOIN public.bank_transactions b ON b.id=m.bank_transaction_id
 JOIN public.bank_statements st ON st.id=b.statement_id
 WHERE st.my_company_id=k.my_company_id AND m.invoice_id=iid AND coalesce(m.document_currency,m.currency)=upper(coalesce(k.currency,'PLN'))
 AND NOT EXISTS(SELECT 1 FROM public.ksef_invoice_payments p WHERE p.bank_match_id=m.id)
 ON CONFLICT(bank_match_id) WHERE bank_match_id IS NOT NULL DO NOTHING;
 SELECT coalesce(sum(amount),0) INTO ledger_amount FROM public.ksef_invoice_payments WHERE ksef_invoice_id=k.id;
 IF coalesce(before_amount,0)>ledger_amount+0.009 THEN
   INSERT INTO public.ksef_invoice_payments(ksef_invoice_id,amount,payment_date,notes)
   VALUES(k.id,before_amount-ledger_amount,coalesce(i.paid_date,current_date),'Przeniesienie potwierdzonej płatności z lokalnej faktury');
 END IF;
 PERFORM public.project_sales_ksef_payment(k.id);
 PERFORM set_config('app.ksef_sales_sync',coalesce(old_sync,''),true);
 RETURN iid;
END; $$;
REVOKE ALL ON FUNCTION public.ensure_local_sales_ksef(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_local_sales_ksef(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.ksef_local_sales_sync_issues(
 ksef_invoice_id uuid PRIMARY KEY REFERENCES public.ksef_invoices(id) ON DELETE CASCADE,
 error_message text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ksef_local_sales_sync_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY ksef_local_sales_issues_read ON public.ksef_local_sales_sync_issues FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.ksef_invoices k WHERE k.id=ksef_invoice_id AND public.finance_company_visible(k.my_company_id)));
GRANT SELECT ON public.ksef_local_sales_sync_issues TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_local_sales_ksef_after_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('app.ksef_sales_sync',true)='1' OR NEW.invoice_type<>'issued' THEN RETURN NULL; END IF;
 BEGIN
   PERFORM public.ensure_local_sales_ksef(NEW.id);
   DELETE FROM public.ksef_local_sales_sync_issues WHERE ksef_invoice_id=NEW.id;
 EXCEPTION WHEN OTHERS THEN
   INSERT INTO public.ksef_local_sales_sync_issues(ksef_invoice_id,error_message) VALUES(NEW.id,SQLERRM)
   ON CONFLICT(ksef_invoice_id) DO UPDATE SET error_message=excluded.error_message,updated_at=now();
 END;
 RETURN NULL;
END; $$;
CREATE OR REPLACE FUNCTION public.retry_local_sales_ksef(p_ksef uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE company uuid; iid uuid;
BEGIN
 SELECT my_company_id INTO company FROM public.ksef_invoices WHERE id=p_ksef AND invoice_type='issued';
 IF auth.uid() IS NULL OR NOT coalesce(public.finance_can_manage(),false)
 OR NOT coalesce(public.can_manage_invoice_company(company),false) THEN RAISE EXCEPTION 'Brak uprawnień do synchronizacji tej faktury.'; END IF;
 BEGIN
   iid:=public.ensure_local_sales_ksef(p_ksef);
   IF iid IS NULL THEN RAISE EXCEPTION 'Dokument nie jest gotową fakturą sprzedażową KSeF.'; END IF;
   DELETE FROM public.ksef_local_sales_sync_issues WHERE ksef_invoice_id=p_ksef;
   RETURN jsonb_build_object('invoiceId',iid);
 EXCEPTION WHEN OTHERS THEN
   INSERT INTO public.ksef_local_sales_sync_issues(ksef_invoice_id,error_message) VALUES(p_ksef,SQLERRM)
   ON CONFLICT(ksef_invoice_id) DO UPDATE SET error_message=excluded.error_message,updated_at=now();
   RETURN jsonb_build_object('error',SQLERRM);
 END;
END; $$;
REVOKE ALL ON FUNCTION public.retry_local_sales_ksef(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.retry_local_sales_ksef(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.ensure_local_sales_ksef_after_sync() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_ensure_local_sales_ksef AFTER INSERT OR UPDATE OF invoice_id,xml_content,invoice_number,gross_amount,currency,sync_status ON public.ksef_invoices
FOR EACH ROW EXECUTE FUNCTION public.ensure_local_sales_ksef_after_sync();

DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.recalculate_local_invoice_bank_payment(uuid)'::regprocedure);
 definition:=replace(definition, E'BEGIN\n', E'BEGIN\n  IF public.linked_sales_ksef(p_invoice_id) IS NOT NULL THEN\n    PERFORM public.project_sales_ksef_payment(public.linked_sales_ksef(p_invoice_id));\n    RETURN;\n  END IF;\n');
 EXECUTE definition;
END $$;

-- The existing lifecycle already takes MAX across aliases. Include bank ledger
-- entries whose match still points at the local identity of the same document.
DO $$ DECLARE definition text; needle text := 'm.id = p.bank_match_id AND m.ksef_invoice_id = k.id'; BEGIN
 definition:=pg_get_functiondef('public.event_invoice_lifecycle_state(uuid)'::regprocedure);
 IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja oceny rozliczenia wydarzenia. Migracja wymaga dostosowania.'; END IF;
 definition:=replace(definition,needle,'m.id = p.bank_match_id AND (m.ksef_invoice_id = k.id OR m.invoice_id = k.invoice_id)');
 EXECUTE definition;
END $$;

-- Existing sales documents are reconciled separately, so an ambiguous old document
-- does not roll back the others. Every failure remains visible for resolution.
DO $$ DECLARE k record; BEGIN
 FOR k IN SELECT id FROM public.ksef_invoices WHERE invoice_type='issued' ORDER BY id LOOP
   BEGIN
     PERFORM public.ensure_local_sales_ksef(k.id);
     DELETE FROM public.ksef_local_sales_sync_issues WHERE ksef_invoice_id=k.id;
   EXCEPTION WHEN OTHERS THEN
     INSERT INTO public.ksef_local_sales_sync_issues(ksef_invoice_id,error_message) VALUES(k.id,SQLERRM)
     ON CONFLICT(ksef_invoice_id) DO UPDATE SET error_message=excluded.error_message,updated_at=now();
   END;
 END LOOP;
END $$;
COMMIT;
