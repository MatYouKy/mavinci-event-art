/*
  # Add Hero Section Configuration Fields

  1. Changes
    - Add `title` field to store hero section title
    - Add `label_text` field to store label/tag text
    - Add `label_icon` field to store icon name
    - Add `button_text` field to store button text
    - Add `white_words_count` field to configure title styling

  2. Applied to Tables
    - konferencje_page_images
    - streaming_page_images
    - integracje_page_images
    - kasyno_page_images
    - symulatory-vr_page_images
    - naglosnienie_page_images
    - quizy-teleturnieje_page_images
    - technika-sceniczna_page_images
    - wieczory-tematyczne_page_images
*/

-- Add configuration fields to konferencje_page_images
ALTER TABLE konferencje_page_images
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'presentation',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to streaming_page_images
ALTER TABLE streaming_page_images
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'video',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to integracje_page_images
ALTER TABLE integracje_page_images
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'plug',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to kasyno_page_images
ALTER TABLE kasyno_page_images
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'casino',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to "symulatory-vr_page_images"
ALTER TABLE "symulatory-vr_page_images"
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'vr',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to naglosnienie_page_images
ALTER TABLE naglosnienie_page_images
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'mic',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to "quizy-teleturnieje_page_images"
ALTER TABLE "quizy-teleturnieje_page_images"
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'gamepad',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to "technika-sceniczna_page_images"
ALTER TABLE "technika-sceniczna_page_images"
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'theater',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;

-- Add configuration fields to "wieczory-tematyczne_page_images"
ALTER TABLE "wieczory-tematyczne_page_images"
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS label_text TEXT,
ADD COLUMN IF NOT EXISTS label_icon TEXT DEFAULT 'party',
ADD COLUMN IF NOT EXISTS button_text TEXT DEFAULT 'Zobacz inne oferty',
ADD COLUMN IF NOT EXISTS white_words_count INTEGER DEFAULT 2;