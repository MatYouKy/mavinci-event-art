# Czat spotkania

Każde spotkanie może mieć rozmowę grupową w Komunikatorze: organizator i zaproszeni pracownicy piszą do siebie także przed
odpowiedzią na zaproszenie — prośba o inny termin, ustalenia, pytania o temat spotkania. Pliki (np. agenda) dodaje się
w czacie jak w każdej rozmowie; ostatnie pliki widać też w szczegółach spotkania. Migracja
`20261202150000_meeting_chat.sql`.

## Gdzie

- **Szczegóły spotkania** — sekcja „Czat spotkania”: liczba wiadomości i nowych, „Otwórz czat” (z licznikiem
  nieprzeczytanych) i „Pliki z czatu” (ostatnie 5 z 20 zwracanych; kliknięcie otwiera plik). Widzi ją organizator
  i uczestnicy spotkania.
  - CRM: okno szczegółów na stronie Spotkań i strona spotkania (`MeetingChatSection`) — rozmowa otwiera się w panelu
    Komunikatora obok szczegółów (`crm-chat-open-conversation`).
  - Mac: panel szczegółów na ekranie Spotkań (`MeetingChatBox`) — rozmowa w Komunikatorze okna (`Workspace.openChat`).
  - Telefon i tablet: okno szczegółów spotkania (`MeetingChatCard`) — szczegóły się zamykają, otwiera się rozmowa
    w Komunikatorze (`navigateToChat`).
- **Komunikator** — rozmowa „Spotkanie: <tytuł> (DD.MM)” na liście rozmów; wiadomości, pliki, reakcje, odczytania
  i powiadomienia push na telefon jak w każdej rozmowie grupowej.

## Zasady (baza)

- `employee_conversations.meeting_id` — rozmowa przypięta do spotkania, najwyżej jedna na spotkanie (w spotkaniu
  cyklicznym każdy termin ma swoją rozmowę). Usunięcie spotkania z bazy zostawia rozmowę (bez powiązania).
- `meeting_chat(p_meeting_id, p_create)` — tylko organizator albo uczestnik spotkania (aktywny pracownik, nie portal
  sprzedawcy). Zwraca `conversation_id`, `member` (czy pytający jest w rozmowie), `messages`, `unread` i `files`
  (ostatnie 20 załączników: nazwa, adres, rozmiar, nadawca, data). `p_create = true` („Otwórz czat”) zakłada rozmowę przy
  pierwszym otwarciu (autor rozmowy — organizator spotkania) i uzupełnia skład o wszystkich aktywnych pracowników
  spotkania i organizatora.
- Skład rozmowy idzie za spotkaniem (`sync_meeting_chat_members`): dodanie pracownika do spotkania dodaje go do rozmowy,
  usunięcie — usuwa (organizator zostaje). Osoby spoza firmy (kontakty) nie są w czacie.
- Tytuł rozmowy zmienia się razem z tytułem i datą spotkania (`sync_meeting_chat_title`, `meeting_chat_title`).
- Polityki Komunikatora: rozmowy spotkania nie da się założyć, przemianować ani usunąć ręcznie, a autor rozmowy nie
  dodaje ani nie usuwa w niej osób — skład wynika ze spotkania. Własne wyjście z rozmowy działa jak dotąd (ponowne
  „Otwórz czat” przywraca uczestnika spotkania do rozmowy). Zwykłe rozmowy — bez zmian.
- Pliki: koszyk `chat-attachments` (jak w Komunikatorze).
- Natywne API Maca: `GET /bridge/native/v1/meetings?op=chat&id=…`, `POST { op: 'chatOpen', id }` (w trybie testowym
  otwarcie nowej rozmowy jest zablokowane jak inne zapisy).
