/*
  # Enable realtime for employee assignments

  Włącza realtime publikację dla tabeli employee_assignments, aby umożliwić
  automatyczne odświeżanie widoku zespołu w czasie rzeczywistym gdy pracownik
  akceptuje lub odrzuca zaproszenie do wydarzenia.
*/

-- Włącz realtime dla tabeli employee_assignments
ALTER PUBLICATION supabase_realtime ADD TABLE employee_assignments;
