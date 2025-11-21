export const getTableName = (sectionName: string) => {
  const cleanSection = sectionName.replace('-hero', '');

  // Mapowanie dla stron z dedykowanymi tabelami
  const dedicatedTables: Record<string, string> = {
    'konferencje': 'konferencje_page_images',
    'kasyno': 'kasyno_page_images',
    'naglosnienie': 'naglosnienie_page_images',
    'zespol': 'team_page_images',
    'about': 'about_page_images',
    'portfolio': 'portfolio_page_images',
  };

  // Jeśli strona ma dedykowaną tabelę, użyj jej
  if (dedicatedTables[cleanSection]) {
    return dedicatedTables[cleanSection];
  }

  // Dla wszystkich innych usług użyj uniwersalnej tabeli
  return 'service_hero_images';
};