-- Ustaw wszystkich członków zespołu jako widocznych
UPDATE team_members SET is_visible = true WHERE is_visible = false OR is_visible IS NULL;
