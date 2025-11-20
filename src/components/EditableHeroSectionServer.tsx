import { supabaseServer } from '@/lib/supabaseServer';
import EditableHeroWithMetadata from './EditableHeroWithMetadata';

interface EditableHeroSectionServerProps {
  section: string;
  pageSlug: string;
}

const DEFAULT_IMAGE = 'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1760341625716-d0b65e.jpg';

async function getHeroImageServer(section: string) {
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

  try {
    const { data: pageImage } = await supabaseServer
      .from(pageTableName)
      .select('*')
      .eq('section', 'hero')
      .eq('is_active', true)
      .maybeSingle();

    if (pageImage) {
      return {
        imageUrl: pageImage.image_url || DEFAULT_IMAGE,
        opacity: pageImage.opacity || 0.2,
        position: {
          posX: pageImage.image_metadata?.desktop?.position?.posX ?? 0,
          posY: pageImage.image_metadata?.desktop?.position?.posY ?? 0,
          scale: pageImage.image_metadata?.desktop?.position?.scale ?? 1,
        },
        title: pageImage.title || '',
        description: pageImage.description || '',
        labelText: pageImage.label_text || '',
        labelIcon: pageImage.label_icon || 'presentation',
        buttonText: pageImage.button_text || 'Zobacz inne oferty',
        whiteWordsCount: pageImage.white_words_count || 2,
      };
    }
  } catch (err) {
    console.log(`Tabela ${pageTableName} nie istnieje, próbuję site_images`);
  }

  try {
    const { data: siteImage } = await supabaseServer
      .from('site_images')
      .select('*')
      .eq('section', section)
      .eq('is_active', true)
      .maybeSingle();

    if (siteImage) {
      return {
        imageUrl: siteImage.desktop_url || DEFAULT_IMAGE,
        opacity: siteImage.opacity || 0.2,
        position: {
          posX: siteImage.image_metadata?.desktop?.position?.posX ?? 0,
          posY: siteImage.image_metadata?.desktop?.position?.posY ?? 0,
          scale: siteImage.image_metadata?.desktop?.position?.scale ?? 1,
        },
        title: '',
        description: '',
      };
    }
  } catch (err) {
    console.log('Brak obrazu w site_images');
  }

  return {
    imageUrl: DEFAULT_IMAGE,
    opacity: 0.2,
    position: { posX: 0, posY: 0, scale: 1 },
    title: '',
    description: '',
    labelText: '',
    labelIcon: 'presentation',
    buttonText: 'Zobacz inne oferty',
    whiteWordsCount: 2,
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
      initialTitle={heroData.title}
      initialDescription={heroData.description}
    />
  );
}
