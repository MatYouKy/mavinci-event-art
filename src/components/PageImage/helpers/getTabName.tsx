export const getTableName = (sectionName: string) => {
  const cleanSection = sectionName.replace('-hero', '');

  // Mapowanie dla stron usług według rzeczywistych nazw tabel w bazie
  const serviceMapping: Record<string, string> = {
    'konferencje': 'konferencje_page_images',
    'streaming': 'streaming_page_images',
    'integracje': 'integracje_page_images',
    'kasyno': 'kasyno_page_images',
    'symulatory-vr': 'symulatory-vr_page_images',
    'naglosnienie': 'naglosnienie_page_images',
    'quizy-teleturnieje': 'quizy-teleturnieje_page_images',
    'technika-sceniczna': 'technika-sceniczna_page_images',
    'wieczory-tematyczne': 'wieczory-tematyczne_page_images',
    'zespol': 'team_page_images',
  };

  return serviceMapping[cleanSection] || `${cleanSection}_page_images`;
};