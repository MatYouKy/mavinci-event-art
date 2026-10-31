-- Reakcje w komunikatorze, jak w Messengerze: każdy uczestnik rozmowy może zareagować na dowolną wiadomość.
-- Dotąd aplikacje zapisywały reakcję bezpośrednio w employee_messages, a RLS pozwala zmieniać tylko własne
-- wiadomości — reakcja na cudzą wiadomość znikała po odświeżeniu i nie docierała do drugiej osoby.
-- Usunięcie reakcji wpisywało NULL do kolumny NOT NULL, więc też się nie zapisywało.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_chat_message_reaction(p_message_id uuid, p_emoji text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  me uuid := private.current_employee_id();
  result jsonb;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Brak konta pracownika.' USING ERRCODE = '42501';
  END IF;
  IF p_emoji IS NOT NULL AND (length(btrim(p_emoji)) = 0 OR length(p_emoji) > 16) THEN
    RAISE EXCEPTION 'Nieprawidłowa reakcja.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.employee_messages m
  SET reactions = CASE
    WHEN p_emoji IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('emoji', p_emoji, 'user_id', me)
  END
  WHERE m.id = p_message_id
    AND EXISTS (
      SELECT 1 FROM public.employee_conversation_participants p
      WHERE p.conversation_id = m.conversation_id AND p.employee_id = me
    )
    -- Usunąć można tylko własną reakcję.
    AND (p_emoji IS NOT NULL OR coalesce(m.reactions->>'user_id', me::text) = me::text)
  RETURNING m.reactions INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brak dostępu do wiadomości.' USING ERRCODE = '42501';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_chat_message_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_chat_message_reaction(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
