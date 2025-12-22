/*
  # Włączenie realtime dla notyfikacji

  Dodaje obsługę realtime dla tabeli notifications, aby aktualizacje metadata
  były natychmiast widoczne w NotificationCenter.
*/

-- Enable realtime for notifications table
ALTER TABLE notifications REPLICA IDENTITY FULL;

COMMENT ON TABLE notifications IS
'System notyfikacji z włączonym realtime do śledzenia aktualizacji metadata';
