-- Gotowość produktu do oferty (`src/lib/CRM/Offers/productReadiness.ts`): wymagania, które nie dotyczą produktu.
-- Klucze: cost, equipment, staff, clauses; wartość: {"reason": "...", "by": "<employee id>", "at": "<ISO>"}.
-- Zapis jak pozostałe pola produktu (uprawnienia z polityk offer_products).

alter table public.offer_products
  add column if not exists readiness_exemptions jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'offer_products_readiness_exemptions_check') then
    alter table public.offer_products
      add constraint offer_products_readiness_exemptions_check check (
        jsonb_typeof(readiness_exemptions) = 'object'
        and (readiness_exemptions - array['cost', 'equipment', 'staff', 'clauses']) = '{}'::jsonb
      );
  end if;
end $$;

comment on column public.offer_products.readiness_exemptions is
  'Wymagania gotowości do oferty, które nie dotyczą produktu (koszt, sprzęt, obsada, klauzule) — z powodem, autorem i datą.';

-- Wpis „nie dotyczy” nie zmienia treści produktu — nie unieważnia wersji angielskiej (jak updated_at i pola EN).
CREATE OR REPLACE FUNCTION public.product_translation_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (to_jsonb(NEW) - ARRAY['updated_at','translation_revision','english_content','english_source_revision','english_version','english_updated_at','readiness_exemptions'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','translation_revision','english_content','english_source_revision','english_version','english_updated_at','readiness_exemptions']) THEN
   NEW.translation_revision := OLD.translation_revision + 1;
 END IF;
 RETURN NEW;
END $$;
