import { Category } from './calculations.types';

export function guessCategory(categoryName: string | null, itemName: string): Category {
  const hay = `${categoryName ?? ''} ${itemName ?? ''}`.toLowerCase();
  const staffKeywords = [
    'dj',
    'prowadz',
    'obsług',
    'kelner',
    'hostess',
    'operator',
    'technik',
    'ochron',
    'mc ',
    'konferansjer',
    'animator',
    'muzyk',
    'artyst',
    'barmen',
    'fotograf',
    'kamerzyst',
    'ludzi',
    'staff',
    'personel',
  ];
  const transportKeywords = ['transport', 'logistyk', 'kierowc', 'dojazd', 'przewóz'];
  const equipmentKeywords = [
    'nagłośn',
    'oświetl',
    'multimedia',
    'scena',
    'sprzęt',
    'projektor',
    'ekran',
    'mikrofon',
    'konsoleta',
    'głośnik',
    'led',
    'kabel',
    'technika',
    'światło',
    'dźwięk',
  ];

  if (staffKeywords.some((k) => hay.includes(k))) return 'staff';
  if (transportKeywords.some((k) => hay.includes(k))) return 'transport';
  if (equipmentKeywords.some((k) => hay.includes(k))) return 'equipment';
  return 'other';
}