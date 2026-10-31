-- Apply with the normal migration workflow. No service or uploaded image is deleted.
-- Historical URLs remain aliases; renaming a service no longer changes its published address.
BEGIN;

CREATE TABLE IF NOT EXISTS public.service_slug_aliases (
  old_slug text PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES public.conferences_service_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_slug_aliases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS service_slug_aliases_service_id_idx ON public.service_slug_aliases(service_id);
REVOKE ALL ON public.service_slug_aliases FROM anon, authenticated;
GRANT SELECT ON public.service_slug_aliases TO anon, authenticated;
CREATE POLICY "Read aliases of published services" ON public.service_slug_aliases
  FOR SELECT TO anon, authenticated USING (EXISTS (
    SELECT 1 FROM public.conferences_service_items s WHERE s.id = service_id AND s.is_active = true
  ));

CREATE OR REPLACE FUNCTION public.slugify(text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT regexp_replace(regexp_replace(
    translate(lower(btrim(coalesce($1, ''))), 'ąćęłńóśźż', 'acelnoszz'),
    '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.generate_slug_from_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  base_slug text;
  suffix integer := 1;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN NEW.slug := OLD.slug; END IF;
    -- The title and other content can change independently of the URL.
    IF NEW.slug IS NOT DISTINCT FROM OLD.slug AND coalesce(NEW.slug, '') <> '' THEN RETURN NEW; END IF;
  END IF;
  NEW.slug := public.slugify(coalesce(nullif(btrim(NEW.slug), ''), NEW.name));
  IF NEW.slug = '' THEN RAISE EXCEPTION 'Adres uslugi musi zawierac litery lub cyfry'; END IF;
  IF NEW.slug IN ('konferencje', 'kasyno', 'naglosnienie', 'dj-eventowy', 'streaming', 'symulatory-vr',
    'quizy-teleturnieje', 'wieczory-tematyczne', 'integracje', 'technika-sceniczna', 'inactive') THEN
    RAISE EXCEPTION 'Ten adres jest zarezerwowany dla strony oferty';
  END IF;
  base_slug := NEW.slug;
  PERFORM pg_advisory_xact_lock(hashtext('service-slug:' || base_slug));
  WHILE EXISTS (SELECT 1 FROM public.conferences_service_items s WHERE s.slug = NEW.slug AND s.id IS DISTINCT FROM NEW.id)
     OR EXISTS (SELECT 1 FROM public.service_slug_aliases a WHERE a.old_slug = NEW.slug AND a.service_id IS DISTINCT FROM NEW.id) LOOP
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Adres jest juz uzywany przez inna usluge'; END IF;
    NEW.slug := base_slug || '-' || suffix;
    suffix := suffix + 1;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_slug_from_name() FROM PUBLIC;

DROP TRIGGER IF EXISTS generate_slug_trigger ON public.conferences_service_items;
CREATE TRIGGER generate_slug_trigger BEFORE INSERT OR UPDATE ON public.conferences_service_items
  FOR EACH ROW EXECUTE FUNCTION public.generate_slug_from_name();

CREATE OR REPLACE FUNCTION public.record_service_slug_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.slug IS DISTINCT FROM NEW.slug AND coalesce(OLD.slug, '') <> '' THEN
    IF EXISTS (SELECT 1 FROM public.service_slug_aliases WHERE old_slug = OLD.slug AND service_id <> NEW.id) THEN
      RAISE EXCEPTION 'Poprzedni adres jest przypisany do innej uslugi';
    END IF;
    INSERT INTO public.service_slug_aliases(old_slug, service_id) VALUES (OLD.slug, NEW.id)
      ON CONFLICT (old_slug) DO NOTHING;

    -- Move URL-keyed content without replacing an already configured destination.
    UPDATE public.service_hero_images SET page_slug = 'uslugi/' || NEW.slug
      WHERE page_slug = 'uslugi/' || OLD.slug
      AND NOT EXISTS (SELECT 1 FROM public.service_hero_images WHERE page_slug = 'uslugi/' || NEW.slug);
    UPDATE public.schema_org_page_metadata SET page_slug = 'uslugi/' || NEW.slug
      WHERE page_slug = 'uslugi/' || OLD.slug
      AND NOT EXISTS (SELECT 1 FROM public.schema_org_page_metadata WHERE page_slug = 'uslugi/' || NEW.slug);
    UPDATE public.schema_org_page_offers SET page_slug = 'uslugi/' || NEW.slug
      WHERE page_slug = 'uslugi/' || OLD.slug
      AND NOT EXISTS (SELECT 1 FROM public.schema_org_page_offers WHERE page_slug = 'uslugi/' || NEW.slug);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_service_slug_history() FROM PUBLIC;
CREATE TRIGGER service_slug_history AFTER UPDATE OF slug ON public.conferences_service_items
  FOR EACH ROW EXECUTE FUNCTION public.record_service_slug_history();

-- Corrections are pinned to the observed service ID and old slug. Later custom URL edits are preserved.
CREATE TEMP TABLE service_slug_repairs(id uuid PRIMARY KEY, old_slug text, new_slug text) ON COMMIT DROP;

INSERT INTO service_slug_repairs VALUES
('660a959c-e858-44de-8b7d-810a4781ae90','-generator-live-photo','ai-generator-live-photo'),
('66d1cece-add1-4643-a46d-6a31018dfbde','-lackbox-i-kurtyny-eventowe','blackbox-i-kurtyny-eventowe'),
('40e3e012-0646-4993-a7e5-e48e5dcbf843','-ramy-wej-ciowe-i-konstrukcje-','bramy-wejsciowe-i-konstrukcje-led'),
('00711564-46b4-4bb0-9434-f6460a6d0032','-randing-i-scenografia','branding-led-i-scenografia'),
('17dfacc0-be3d-4e56-9bf7-a3309f93894d','-randing-pod-event','branding-pod-event'),
('15bec9f9-4359-4b20-bb2a-ab7d25d1a593','-e-eventowi-i-klubowi','dj-e-eventowi-i-klubowi'),
('5dbe4ee2-c27c-486e-8526-7ff19688205f','-oradztwo-techniczne','doradztwo-techniczne'),
('69123d33-c117-4b0d-b771-e8204c4a8b7e','-fekty-specjalne-dym-haze-sparkular-','efekty-specjalne-dym-haze-sparkular'),
('b1dc8e24-a4c2-4d74-bf39-7ac36a83e550','ekrany-led-do-konferencji-i-gall','ekrany-led-do-konferencji-i-gal'),
('48ffe702-069b-4418-ae8b-0f133ee8f9f6','-krany-transparentne-i-siatki-projekcyjne','ekrany-transparentne-i-siatki-projekcyjne'),
('ed93c18e-3211-422b-8d81-283bba480bb3','-venty-zamkni-te-z-has-em','eventy-zamkniete-z-haslem'),
('5ace3c2b-53c6-4976-8f3a-19c48200d062','-otobudka-','fotobudka-ai'),
('a2dae5fd-4464-4073-9653-66144000eb3b','-ologramy-i-hologram-fan','hologramy-i-hologram-fan'),
('e13748e1-78d9-4529-9f97-c2604491aba1','-ierownik-techniczny-stage-manager-','kierownik-techniczny-stage-manager'),
('0ac8feaf-cfd3-41c4-8dbf-ee75a4af01d7','-ompleksowa-obs-uga-techniczna','kompleksowa-obsluga-techniczna'),
('c2087e9d-4389-4c44-b1d5-7f7300b7a116','-onstrukcje-kratowe-truss-','konstrukcje-kratowe-truss'),
('7f817372-ff7b-4a8b-9236-37089d2c4a4b','-onta-demonta-transport','montaz-demontaz-transport'),
('80e62081-d7c1-473d-b04b-2be969300e1f','-agrania-monta-e-realizacja-hybrydowa','nagrania-montaze-realizacja-hybrydowa'),
('8639ada7-5164-4d9b-b7e5-d33ceee7a463','-agrywanie-konferencji-i-gal','nagrywanie-konferencji-i-gal'),
('250639f3-b52d-4633-999f-e9f53a7a4947','-bs-uga-prezentacji-ower-oint-eynote','obsluga-prezentacji-powerpoint-keynote'),
('5016d7f5-641d-47ea-aa8b-ab8619c56466','-perowanie-materia-ami-wideo','operowanie-materialami-wideo'),
('86bb4f2c-2a39-40b6-9110-ebd9971041c5','-prawa-gal-i-ceremonii','oprawa-gal-i-ceremonii'),
('c0e8549d-74dd-4c77-b274-499ef9de1130','-prawa-muzyczna-event-w','oprawa-muzyczna-eventow'),
('8bde5451-2576-4d2f-badf-3d665035dcd6','-wietlenie-dekoracyjne-i-architektoniczne','oswietlenie-dekoracyjne-i-architektoniczne'),
('87a830dd-c36e-4f57-9c42-0f682683599c','-wietlenie-gal-i-ceremonii','oswietlenie-gal-i-ceremonii'),
('46c497e4-532d-4bd0-b1a1-9bb40d3a0722','-wietlenie-konferencyjne-face-light-','oswietlenie-konferencyjne-face-light'),
('7bd77e73-448e-4786-a83f-1c193c080717','-wietlenie-teatralne-i-sceniczne','oswietlenie-teatralne-i-sceniczne'),
('c03f6a4e-8c07-49a9-a905-3bdd205b07e6','pdesty-sceniczne-i-sceny-modulowe','podesty-sceniczne-i-sceny-modulowe'),
('04aebfad-c6ab-41a0-98e0-c507a4dffee2','-obraz-w-obrazie-','pip-obraz-w-obrazie'),
('a8dd1718-17e1-42e8-82d0-c2a0c8802df3','-re-check-techniczny-prelegent-w','pre-check-techniczny-prelegentow'),
('ceba713d-4902-4fca-9953-45a9a2335ba4','-rojekty-techniczne-i-wizualizacje-3-','projekty-techniczne-i-wizualizacje-3d'),
('807e810e-35df-4569-94e5-fc81c337ee76','-rzygotowanie-multimedi-w','przygotowanie-multimediow'),
('3372b10b-78c4-4615-a5dd-fd1ae8bb7920','-ciany-multimedialne-interaktywne','sciany-multimedialne-interaktywne'),
('11fcb11f-7491-412f-b4c0-8477ad4ce44f','-terowanie-i-realizacja','sterowanie-dmx-i-realizacja'),
('92a7a2a5-ec55-4b4c-9324-4b7281e87b8d','-tudio-live-i-telemosy','studio-live-i-telemosy'),
('c2e9412b-6a17-4d85-b2b5-15f4ab93728c','-ystemy-rejestracji-uczestnik-w','systemy-rejestracji-uczestnikow'),
('e48dc50c-2524-4575-933c-2768f178496d','-ydruki-foto','wydruki-foto'),
('90ace775-bbb5-4ca9-968a-fa2c44146ff5','-ou-ube-imeo-eams-oom','youtube-vimeo-teams-zoom');

DO $$
DECLARE
  repair record;
  current_slug text;
BEGIN
  FOR repair IN SELECT * FROM service_slug_repairs ORDER BY id LOOP
    SELECT slug INTO current_slug FROM public.conferences_service_items WHERE id = repair.id;
    IF NOT FOUND OR current_slug NOT IN (repair.old_slug, repair.new_slug) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.conferences_service_items WHERE slug = repair.new_slug AND id <> repair.id)
      OR EXISTS (SELECT 1 FROM public.service_slug_aliases WHERE old_slug IN (repair.old_slug, repair.new_slug) AND service_id <> repair.id) THEN
      RAISE EXCEPTION 'Konflikt adresu %; migracja wycofana bez czesciowych zmian', repair.new_slug;
    END IF;
    INSERT INTO public.service_slug_aliases(old_slug, service_id) VALUES (repair.old_slug, repair.id)
      ON CONFLICT (old_slug) DO NOTHING;
    UPDATE public.conferences_service_items SET slug = repair.new_slug, updated_at = now()
      WHERE id = repair.id AND slug = repair.old_slug;
  END LOOP;
END;
$$;

UPDATE public.conferences_service_items SET name = 'Podesty sceniczne i sceny modułowe', updated_at = now()
  WHERE id = 'c03f6a4e-8c07-49a9-a905-3bdd205b07e6' AND name = 'Pdesty sceniczne i sceny modułowe';
COMMIT;
