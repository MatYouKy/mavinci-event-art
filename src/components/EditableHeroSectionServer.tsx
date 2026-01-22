import { cookies } from 'next/headers';
async function getHeroImageServer(section: string, pageSlug: string, citySlug?: string) {
  noStore();

  const cleanSection = section.replace('-hero', '');

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

  const supabase = createSupabaseServerClient(cookies());

  let query = supabase.from(pageTableName).select('*').eq('is_active', true);

  query = isUniversalTable ? query.eq('page_slug', pageSlug) : query.eq('section', 'hero');

  const { data: pageImage, error } = await query.maybeSingle();

  if (error) {
    console.error(`Hero fetch error for section=${section} table=${pageTableName}`, error);
    // fallback na defaulty zamiast throw (żeby strona działała)
    return getHeroDefaults(section);
  }

  if (!pageImage) {
    return getHeroDefaults(section);
  }

  let baseData = pageImage;

  if (cleanSection === 'konferencje' && citySlug) {
    const { data: city } = await supabase
      .from('conferences_cities')
      .select('name')
      .eq('slug', citySlug)
      .maybeSingle();
    // jeżeli w title nie ma miasta, to doklej
    if (!baseData?.title?.toLowerCase().includes(city?.name?.toLowerCase())) {
      baseData.title = `${baseData?.title} ${city?.name}`;
    }

    baseData.description = `${baseData?.description} ${city?.name}`;
    baseData.labelText = `${baseData?.labelText} ${city?.name}`;
    baseData.labelIcon = `${baseData?.labelIcon} ${city?.name}`;
  }

  return {
    imageUrl: pageImage.image_url ?? '',
    opacity: pageImage.opacity ?? 0.2,
    position: {
      posX: pageImage.image_metadata?.desktop?.position?.posX ?? 0,
      posY: pageImage.image_metadata?.desktop?.position?.posY ?? 0,
      scale: pageImage.image_metadata?.desktop?.position?.scale ?? 1,
    },
    title: baseData.title ?? '',
    description: pageImage.description ?? '',
    labelText: pageImage.label_text ?? '',
    labelIcon: pageImage.label_icon ?? '',
    buttonText: pageImage.button_text ?? 'Zobacz inne oferty',
    whiteWordsCount: pageImage.white_words_count ?? 2,
  };
}

function getHeroDefaults(section: string) {
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

import { unstable_noStore as noStore } from 'next/cache';
import EditableHeroWithMetadata from './EditableHeroWithMetadata'; // server-only plik
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export default async function EditableHeroSectionServer({
  section,
  pageSlug,
  initialImageUrl,
  initialTitle,
  initialDescription,
  whiteWordsCount,
}) {
  noStore();
  const heroData = await getHeroImageServer(section, pageSlug);

  return (
    <EditableHeroWithMetadata
      section={section}
      pageSlug={pageSlug}
      whiteWordsCount={whiteWordsCount || heroData.whiteWordsCount}
      labelText={heroData.labelText}
      labelIcon={heroData.labelIcon}
      buttonText={heroData.buttonText}
      initialImageUrl={initialImageUrl || heroData.imageUrl}
      initialOpacity={heroData.opacity}
      initialPosition={heroData.position}
      initialTitle={initialTitle || heroData.title}
      initialDescription={initialDescription || heroData.description}
    />
  );
}
