/*
  # Dodaj wymiary PDF do szablonów ofert

  1. Zmiany
    - Dodaj kolumny pdf_width i pdf_height do tabeli offer_page_templates
    - Pozwól na dynamiczne dostosowanie rozmiaru podglądu do rzeczywistych wymiarów PDF
*/

ALTER TABLE offer_page_templates
ADD COLUMN IF NOT EXISTS pdf_width integer DEFAULT 595,
ADD COLUMN IF NOT EXISTS pdf_height integer DEFAULT 842;

COMMENT ON COLUMN offer_page_templates.pdf_width IS 'Szerokość PDF w pikselach (domyślnie A4: 595px)';
COMMENT ON COLUMN offer_page_templates.pdf_height IS 'Wysokość PDF w pikselach (domyślnie A4: 842px)';