/*
  # Dodanie zdjęcia miniaturki do zadań

  1. Zmiany
    - Dodano kolumnę `thumbnail_url` do tabeli `tasks`
    - Kolumna przechowuje URL do zdjęcia miniaturki zadania

  2. Szczegóły
    - Kolumna jest opcjonalna (NULL)
    - Typ: TEXT
    - Zdjęcia są przechowywane w bucket 'event-files' w folderze 'task-thumbnails'
*/

-- Dodaj kolumnę thumbnail_url do tabeli tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN tasks.thumbnail_url IS 'URL do zdjęcia miniaturki zadania';
