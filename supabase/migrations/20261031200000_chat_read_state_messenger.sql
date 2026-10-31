BEGIN;

-- Komunikator jak Messenger:
--  1. Znaczniki „przeczytane” i „dostarczone” zawsze w czasie serwera i tylko do przodu.
--     Wcześniej aplikacje zapisywały czas zegara urządzenia: przy spóźnionym zegarze przeczytana
--     wiadomość zostawała nieprzeczytana (licznik pokazywał 1, choć ostatnia wiadomość była Twoja).
--     Wyzwalacz obejmuje też starsze wersje aplikacji mobilnej, bez ich aktualizacji.
--  2. Wysłanie wiadomości oznacza przeczytanie rozmowy do tej chwili (jak w Messengerze).
--  3. Rozmowa zna nadawcę ostatniej wiadomości (lista: „Ty: …” zamiast pogrubienia własnej wiadomości).
--  4. Jedno źródło liczników nieprzeczytanych (CRM i aplikacja) oraz oznaczanie „dostarczono” przy odbiorze.
--  5. Licznik na ikonie aplikacji w powiadomieniu push (send-chat-push).

-- 1. Znaczniki w czasie serwera --------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.normalize_chat_read_markers()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Każda zmiana znacznika przez aplikację oznacza „teraz”; znacznik nigdy się nie cofa.
  IF NEW.last_read_at IS DISTINCT FROM OLD.last_read_at THEN
    NEW.last_read_at := greatest(coalesce(OLD.last_read_at, '-infinity'::timestamptz), now());
  END IF;
  IF NEW.last_delivered_at IS DISTINCT FROM OLD.last_delivered_at THEN
    NEW.last_delivered_at := greatest(coalesce(OLD.last_delivered_at, '-infinity'::timestamptz), now());
  END IF;
  -- Przeczytana wiadomość jest też dostarczona.
  IF NEW.last_read_at IS NOT NULL THEN
    NEW.last_delivered_at := greatest(coalesce(NEW.last_delivered_at, '-infinity'::timestamptz), NEW.last_read_at);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS normalize_chat_read_markers ON public.employee_conversation_participants;
CREATE TRIGGER normalize_chat_read_markers BEFORE UPDATE OF last_read_at, last_delivered_at
  ON public.employee_conversation_participants
  FOR EACH ROW EXECUTE FUNCTION private.normalize_chat_read_markers();

-- 2–3. Ostatnia wiadomość i znacznik nadawcy -----------------------------------------------------
ALTER TABLE public.employee_conversations
  ADD COLUMN IF NOT EXISTS last_message_sender_id uuid REFERENCES public.employees(id) ON DELETE SET NULL;

-- Wiadomości osób usuniętych z listy pracowników zostają w historii; nadawca pozostaje wtedy pusty.
UPDATE public.employee_conversations c SET last_message_sender_id = latest.sender_id
FROM (
  SELECT DISTINCT ON (conversation_id) conversation_id, sender_id
  FROM public.employee_messages ORDER BY conversation_id, created_at DESC
) latest
JOIN public.employees sender ON sender.id = latest.sender_id
WHERE latest.conversation_id = c.id AND c.last_message_sender_id IS DISTINCT FROM latest.sender_id;

-- Ta sama definicja co wcześniej, plus nadawca ostatniej wiadomości i znacznik odczytu nadawcy.
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.employee_conversations
  SET last_message_at = NEW.created_at, last_message_preview = LEFT(NEW.content, 100),
      last_message_sender_id = (SELECT e.id FROM public.employees e WHERE e.id = NEW.sender_id)
  WHERE id = NEW.conversation_id;
  -- Własna wiadomość nigdy nie jest „nieprzeczytana” dla nadawcy, a odpowiedź oznacza przeczytanie rozmowy.
  UPDATE public.employee_conversation_participants
  SET last_read_at = now(), last_delivered_at = now()
  WHERE conversation_id = NEW.conversation_id AND employee_id = NEW.sender_id;
  RETURN NEW;
END;
$$;

-- 4. Liczniki i znaczniki dla aplikacji ----------------------------------------------------------
-- Nieprzeczytane = wiadomości innych osób nowsze niż mój znacznik odczytu.
CREATE OR REPLACE FUNCTION public.get_chat_unread_counts()
RETURNS TABLE (conversation_id uuid, unread_count bigint, last_incoming_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.conversation_id, count(m.id), max(m.created_at)
  FROM public.employee_conversation_participants p
  LEFT JOIN public.employee_messages m
    ON m.conversation_id = p.conversation_id
   AND m.sender_id <> p.employee_id
   AND m.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz)
  WHERE p.employee_id = private.current_employee_id()
  GROUP BY p.conversation_id;
$$;

CREATE OR REPLACE FUNCTION public.mark_chat_read(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.employee_conversation_participants p
  SET last_read_at = now(), last_delivered_at = now()
  FROM public.employee_conversations c
  WHERE p.conversation_id = p_conversation_id AND c.id = p.conversation_id
    AND p.employee_id = private.current_employee_id()
    -- Bez nowych wiadomości nie zapisujemy (mniej zdarzeń realtime u pozostałych uczestników).
    AND coalesce(c.last_message_at, '-infinity'::timestamptz) > coalesce(p.last_read_at, '-infinity'::timestamptz);
END;
$$;

-- „Dostarczono”: aplikacja odbiorcy otrzymała wiadomość (otwarta lista, push, powrót do aplikacji).
CREATE OR REPLACE FUNCTION public.mark_chat_delivered(p_conversation_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.employee_conversation_participants p
  SET last_delivered_at = now()
  FROM public.employee_conversations c
  WHERE c.id = p.conversation_id
    AND p.employee_id = private.current_employee_id()
    AND (p_conversation_id IS NULL OR p.conversation_id = p_conversation_id)
    AND c.last_message_sender_id IS DISTINCT FROM p.employee_id
    AND coalesce(c.last_message_at, '-infinity'::timestamptz) > coalesce(p.last_delivered_at, '-infinity'::timestamptz);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

-- 5. Licznik na ikonie aplikacji (wywołuje send-chat-push kluczem serwisowym).
CREATE OR REPLACE FUNCTION public.chat_unread_totals(p_employee_ids uuid[])
RETURNS TABLE (employee_id uuid, unread_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p.employee_id, count(m.id)
  FROM public.employee_conversation_participants p
  LEFT JOIN public.employee_messages m
    ON m.conversation_id = p.conversation_id
   AND m.sender_id <> p.employee_id
   AND m.created_at > coalesce(p.last_read_at, '-infinity'::timestamptz)
  WHERE p.employee_id = ANY(p_employee_ids)
  GROUP BY p.employee_id;
$$;

REVOKE ALL ON FUNCTION private.normalize_chat_read_markers() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_chat_unread_counts(), public.mark_chat_read(uuid), public.mark_chat_delivered(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_unread_counts(), public.mark_chat_read(uuid), public.mark_chat_delivered(uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_unread_totals(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_unread_totals(uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
