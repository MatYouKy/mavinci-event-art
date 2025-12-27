import { unstable_noStore as noStore } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import EditableHeroWithMetadata from './EditableHeroWithMetadata';
import { useSnackbar } from '../contexts/SnackbarContext';

// Create server-side supabase client inline to avoid env issues
const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    global: {
      fetch: (url, options = {}) => {
        return fetch(url, { ...options, cache: 'no-store' });
      },
    },
  });
};

interface EditableHeroSectionServerProps {
  section: string;
  pageSlug: string;
}

async function getHeroImageServer(section: string, pageSlug: string) {
  noStore();
  const { showSnackbar } = useSnackbar();
  const cleanSection = section.replace('-hero', '');

  // Mapowanie dla stron z dedykowanymi tabelami
  const dedicatedTables: Record<string, string> = {
    konferencje: 'konferencje_page_images',
    kasyno: 'kasyno_page_images',
    naglosnienie: 'naglosnienie_page_images',
    zespol: 'team_page_images',
    about: 'about_page_images',
    portfolio: 'portfolio_page_images',
    dj: 'dj_hero_page_images',

  };

  const pageTableName = dedicatedTables[cleanSection] || 'service_hero_images';
  const isUniversalTable = pageTableName === 'service_hero_images';

  const supabase = getSupabaseClient();

  let query = supabase
    .from(pageTableName)
    .select('*')
    .eq('is_active', true);

  // Dla uniwersalnej tabeli używamy page_slug, dla dedykowanych section='hero'
  if (isUniversalTable) {
    query = query.eq('page_slug', pageSlug);
  } else {
    query = query.eq('section', 'hero');
  }

  const { data: pageImage, error } = await query.maybeSingle();

  if (error) {
    showSnackbar('Błąd podczas pobierania hero dla ${section}:', 'error');
    throw error;
  }

  if (!pageImage) {
    showSnackbar('Brak danych hero w ${pageTableName} dla sekcji: ${section}', 'error');
    throw new Error('Brak danych hero w ${pageTableName} dla sekcji: ${section}');
    // Zwróć domyślne wartości bazowane na sekcji
    const sectionDefaults: Record<string, any> = {
      'naglosnienie-hero': {
        title: 'Nagłośnienie Eventów',
        description: 'Profesjonalne systemy nagłośnieniowe',
        labelText: 'Profesjonalne Nagłośnienie',
        labelIcon: 'Music',
      },
      'kasyno-hero': {
        title: 'Kasyno Eventowe',
        description: 'Profesjonalne stoły do gier',
        labelText: 'Wieczory w Kasynie',
        labelIcon: 'Dices',
      },
      'konferencje-hero': {
        title: 'Techniczna obsługa konferencji',
        description: 'Profesjonalne nagłośnienie i multimedia',
        labelText: 'Konferencje',
        labelIcon: 'Users',
      },
    };

    const defaults = sectionDefaults[section] || {
      title: 'Profesjonalne usługi eventowe',
      description: 'Kompleksowa obsługa wydarzeń',
      labelText: 'Eventy',
      labelIcon: 'Sparkles',
    };

    return {
      imageUrl: '',
      opacity: 0.2,
      position: { posX: 0, posY: 0, scale: 1 },
      ...defaults,
      buttonText: 'Zobacz inne oferty',
      whiteWordsCount: 2,
    };
  }

  return {
    imageUrl: pageImage.image_url,
    opacity: pageImage.opacity || 0.2,
    position: {
      posX: pageImage.image_metadata?.desktop?.position?.posX ?? 0,
      posY: pageImage.image_metadata?.desktop?.position?.posY ?? 0,
      scale: pageImage.image_metadata?.desktop?.position?.scale ?? 1,
    },
    title: pageImage.title || '',
    description: pageImage.description || '',
    labelText: pageImage.label_text || '',
    labelIcon: pageImage.label_icon || '',
    buttonText: pageImage.button_text || 'Zobacz inne oferty',
    whiteWordsCount: pageImage.white_words_count || 2,
  };
}

export default async function EditableHeroSectionServer({
  section,
  pageSlug,
}: EditableHeroSectionServerProps) {
  const heroData = await getHeroImageServer(section, pageSlug);

  return (
    <EditableHeroWithMetadata
      section={section}
      pageSlug={pageSlug}
      whiteWordsCount={heroData.whiteWordsCount}
      labelText={heroData.labelText}
      labelIcon={heroData.labelIcon}
      buttonText={heroData.buttonText}
      initialImageUrl={heroData.imageUrl}
      initialOpacity={heroData.opacity}
      initialPosition={heroData.position}
      initialTitle={heroData.title}
      initialDescription={heroData.description}
    />
  );
}
