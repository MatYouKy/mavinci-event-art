/*
  # Włącz Realtime dla systemu zadań

  1. Problem
    - Tabele tasks i task_assignees nie mają włączonego Realtime
    - Zmiany w zadaniach nie są widoczne w czasie rzeczywistym dla innych użytkowników
    
  2. Rozwiązanie
    - Dodaj tabele do publikacji supabase_realtime
    - Włącz REPLICA IDENTITY FULL dla prawidłowego trackowania zmian
*/

-- Enable realtime for tasks table
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER TABLE tasks REPLICA IDENTITY FULL;

-- Enable realtime for task_assignees table
ALTER PUBLICATION supabase_realtime ADD TABLE task_assignees;
ALTER TABLE task_assignees REPLICA IDENTITY FULL;

COMMENT ON TABLE tasks IS 'Zadania - z włączonym Realtime';
COMMENT ON TABLE task_assignees IS 'Przypisania zadań - z włączonym Realtime';
