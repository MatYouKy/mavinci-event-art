-- Aggregates only: sellers may see the final value of their own sale without
-- receiving invoice records issued by another employee.
CREATE OR REPLACE FUNCTION public.get_event_list_invoice_budgets(p_event_ids uuid[])
RETURNS TABLE(event_id uuid, amounts jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH RECURSIVE allowed AS MATERIALIZED (
   SELECT e.id FROM public.events e
   WHERE auth.uid() IS NOT NULL AND e.id=ANY(p_event_ids)
     AND public.employee_can_access_company(public.current_invoice_employee_id(), e.my_company_id)
     AND (public.invoice_finance_is_admin()
       OR public.invoice_sales_event_owned(e.id)
       OR (public.invoice_finance_scope()='company' AND public.can_view_event_commercials(e.id,false)))
 ), allocations AS MATERIALIZED (
   SELECT a.invoice_id,a.event_id,a.allocation_weight/nullif(sum(a.allocation_weight) OVER(PARTITION BY a.invoice_id),0) AS ratio
   FROM public.invoice_event_allocations a
   UNION ALL
   SELECT i.id,i.event_id,1::numeric FROM public.invoices i
   WHERE i.event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id)
 ), issued AS MATERIALIZED (
   SELECT i.* FROM public.invoices i WHERE i.status IN ('issued','sent','paid','overdue') AND NOT coalesce(i.is_proforma,false)
 ), roots AS (
   SELECT i.id,i.id AS root_id,ARRAY[i.id] AS path FROM issued i WHERE i.invoice_type IN ('vat','final')
     AND NOT EXISTS(SELECT 1 FROM public.invoice_settlements s JOIN issued f ON f.id=s.final_invoice_id WHERE s.advance_invoice_id=i.id AND f.invoice_type='final')
   UNION ALL
   SELECT c.id,r.root_id,r.path||c.id FROM issued c JOIN roots r ON c.related_invoice_id=r.id
   WHERE c.invoice_type='corrective' AND NOT c.id=ANY(r.path)
 ), totals AS (
   SELECT a.event_id,upper(coalesce(i.currency_code,'PLN')) AS currency,
     round(sum((CASE WHEN i.invoice_type='final'
       THEN coalesce(nullif(i.settlement_summary->>'invoiceTotalGross','')::numeric,i.total_gross)
       ELSE i.total_gross END)*a.ratio),2) AS amount
   FROM issued i JOIN roots r ON r.id=i.id JOIN allocations a ON a.invoice_id=i.id
   JOIN allowed e ON e.id=a.event_id WHERE a.ratio>0
   GROUP BY a.event_id,upper(coalesce(i.currency_code,'PLN'))
 )
 SELECT e.id,coalesce(jsonb_agg(jsonb_build_object('currency',t.currency,'amount',t.amount) ORDER BY t.currency)
   FILTER(WHERE t.currency IS NOT NULL),'[]'::jsonb)
 FROM allowed e LEFT JOIN totals t ON t.event_id=e.id GROUP BY e.id
$$;
REVOKE ALL ON FUNCTION public.get_event_list_invoice_budgets(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_event_list_invoice_budgets(uuid[]) TO authenticated;
