const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
};

function decodeCodePoint(entity: string, value: number): string {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0x10ffff ||
    (value >= 0xd800 && value <= 0xdfff)
  ) {
    return entity;
  }

  return String.fromCodePoint(value);
}

/** Dekoduje encje XML/HTML zwracane m.in. w danych faktur KSeF. */
export function decodeTextEntities(value?: string | null): string {
  if (!value) return '';

  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|apos|gt|lt|quot));/gi,
    (entity, decimalCode, hexadecimalCode, namedEntity) => {
      if (decimalCode) return decodeCodePoint(entity, Number(decimalCode));
      if (hexadecimalCode) {
        return decodeCodePoint(entity, Number.parseInt(hexadecimalCode, 16));
      }

      return NAMED_ENTITIES[String(namedEntity).toLowerCase()] || entity;
    },
  );
}
