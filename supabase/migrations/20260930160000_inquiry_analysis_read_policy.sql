BEGIN;
-- Qualify the outer row: tasks also has inquiry_id, so the old unqualified
-- condition compared tasks.id with tasks.inquiry_id and hid existing analyses.
-- Task RLS still decides whether the caller can access the related inquiry.
ALTER POLICY sales_analyses_read ON public.inquiry_analyses
 USING (EXISTS (
   SELECT 1 FROM public.tasks t
   WHERE t.id = inquiry_analyses.inquiry_id AND t.is_inquiry
 ));
ALTER POLICY sales_activity_read ON public.inquiry_activity
 USING (EXISTS (
   SELECT 1 FROM public.tasks t
   WHERE t.id = inquiry_activity.inquiry_id AND t.is_inquiry
 ));
NOTIFY pgrst, 'reload schema';
COMMIT;
