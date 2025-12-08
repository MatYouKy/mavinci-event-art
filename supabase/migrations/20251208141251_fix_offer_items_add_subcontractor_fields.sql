/*
  # Add subcontractor fields to offer_items

  1. Changes
    - Add needs_subcontractor boolean column to offer_items
    - Add subcontractor_id uuid column to offer_items
    - Add foreign key constraint to subcontractors table

  2. Purpose
    - Track which offer items require subcontractor services
    - Link offer items to specific subcontractors
*/

-- Add needs_subcontractor column
ALTER TABLE offer_items 
ADD COLUMN IF NOT EXISTS needs_subcontractor boolean DEFAULT false;

-- Add subcontractor_id column
ALTER TABLE offer_items 
ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE SET NULL;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_offer_items_needs_subcontractor 
ON offer_items(needs_subcontractor) WHERE needs_subcontractor = true;

CREATE INDEX IF NOT EXISTS idx_offer_items_subcontractor_id 
ON offer_items(subcontractor_id) WHERE subcontractor_id IS NOT NULL;
