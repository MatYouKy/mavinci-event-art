export type WeddingChoiceLike = {
  attraction_key?: string | null;
  attraction_name?: string | null;
};

const WEDDING_RECEPTION_GAME_ALIASES = new Set([
  'familiada',
  'familiada weselna',
  'test zgodnosci',
  'wykup fantow',
  'wykupowanie fantow',
  'zbieranie na wozek',
  'wybor nowej pary mlodej',
  'wybor nowej pary mlode',
  'skok przez line',
  'alkogogle',
  'alkogoogle',
  'alkogogle i sztafeta',
  'alkogoogle i sztafeta',
  'krzeselka',
  'krzeselka z fantami',
  'jaka to melodia',
]);

export function normalizeWeddingChoiceName(value: string | null | undefined) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isWeddingReceptionGame(choice: WeddingChoiceLike) {
  if (choice.attraction_key?.startsWith('wedding-game:')) return true;

  return [choice.attraction_key, choice.attraction_name]
    .map(normalizeWeddingChoiceName)
    .some((value) => WEDDING_RECEPTION_GAME_ALIASES.has(value));
}
