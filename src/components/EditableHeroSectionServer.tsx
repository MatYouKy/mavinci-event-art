import { unstable_noStore as noStore } from 'next/cache';
import { supabaseServer } from '@/lib/supabaseServer';
import EditableHeroWithMetadata from './EditableHeroWithMetadata';

interface EditableHeroSectionServerProps {
  section: string;
  pageSlug: string;
}

async function getHeroImageServer(section: string) {
  noStore();

  const cleanSection = section.replace('-hero', '');

  const serviceMapping: Record<string, string> = {
    konferencje: 'konferencje_page_images',
    streaming: 'streaming_page_images',
    integracje: 'integracje_page_images',
    kasyno: 'kasyno_page_images',
    'symulatory-vr': 'symulatory-vr_page_images',
    naglosnienie: 'naglosnienie_page_images',
    'quizy-teleturnieje': 'quizy-teleturnieje_page_images',
    'technika-sceniczna': 'technika-sceniczna_page_images',
    'wieczory-tematyczne': 'wieczory-tematyczne_page_images',
    zespol: 'team_page_images',
  };

  const pageTableName = serviceMapping[cleanSection] || `${cleanSection}_page_images`;

  const { data: pageImage, error } = await supabaseServer
    .from(pageTableName)
    .select('*')
    .eq('section', 'hero')
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error(`[SERVER] Błąd podczas pobierania hero dla ${section}:`, error);
  }

  if (!pageImage) {
    console.log(`[SERVER] Brak danych hero w ${pageTableName} dla sekcji: ${section}`);
    return {
      imageUrl: '',
      opacity: 0.2,
      position: { posX: 0, posY: 0, scale: 1 },
      title: '',
      description: '',
      labelText: '',
      labelIcon: '',
      buttonText: 'Zobacz inne oferty',
      whiteWordsCount: 2,
    };
  }

  console.log(`[SERVER] Loaded hero data for ${section}:`, {
    title: pageImage.title,
    label_text: pageImage.label_text,
    label_icon: pageImage.label_icon,
    description: pageImage.description?.substring(0, 50),
  });

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
  const heroData = await getHeroImageServer(section);

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
