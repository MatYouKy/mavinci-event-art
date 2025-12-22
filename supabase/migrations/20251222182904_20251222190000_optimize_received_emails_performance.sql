/*
  # Optymalizacja wydajności received_emails
  
  1. Changes
    - Dodanie composite index dla (email_account_id, received_date DESC)
    - To przyspieszy zapytania sortujące po dacie dla konkretnego konta
    - Usuwa potrzebę dwóch osobnych indeksów
    
  2. Performance
    - Zapytania z filtrem email_account_id + sortowanie po received_date będą znacznie szybsze
    - Zmniejszenie timeout errors przy pobieraniu listy wiadomości
*/

-- Dodaj composite index dla email_account_id + received_date
-- To jest najczęściej używane zapytanie
CREATE INDEX IF NOT EXISTS idx_received_emails_account_date 
ON received_emails (email_account_id, received_date DESC);

-- Dodaj index dla kombinacji account + is_read (dla filtrowania nieprzeczytanych)
CREATE INDEX IF NOT EXISTS idx_received_emails_account_read 
ON received_emails (email_account_id, is_read, received_date DESC);

-- Dodaj index dla assigned_to + received_date (dla filtrowania przypisanych)
CREATE INDEX IF NOT EXISTS idx_received_emails_assigned_date 
ON received_emails (assigned_to, received_date DESC) 
WHERE assigned_to IS NOT NULL;
