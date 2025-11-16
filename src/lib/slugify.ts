export function slugify(text: string): string {
  const polishMap: Record<string, string> = {
    'ą': 'a',
    'ć': 'c',
    'ę': 'e',
    'ł': 'l',
    'ń': 'n',
    'ó': 'o',
    'ś': 's',
    'ź': 'z',
    'ż': 'z',
    'Ą': 'a',
    'Ć': 'c',
    'Ę': 'e',
    'Ł': 'l',
    'Ń': 'n',
    'Ó': 'o',
    'Ś': 's',
    'Ź': 'z',
    'Ż': 'z'
  };

  return text
    .split('')
    .map(char => polishMap[char] || char)
    .join('')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
