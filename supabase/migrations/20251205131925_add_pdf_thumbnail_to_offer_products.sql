/*
  # Add PDF thumbnail support to offer products

  1. Changes
    - Add `pdf_thumbnail_url` column to `offer_products` table to store preview image of PDF page
    - This allows users to see a preview of the PDF content before generating the final offer

  2. Security
    - No RLS changes needed - inherits existing policies
*/

ALTER TABLE offer_products
ADD COLUMN IF NOT EXISTS pdf_thumbnail_url text;

COMMENT ON COLUMN offer_products.pdf_thumbnail_url IS 'URL to thumbnail/preview image of the PDF page';
