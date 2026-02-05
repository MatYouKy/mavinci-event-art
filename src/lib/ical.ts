function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function toIcsUtc(dt: string | Date) {
  const d = typeof dt === 'string' ? new Date(dt) : dt;
  // YYYYMMDDTHHMMSSZ
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Escape wg iCalendar:
 * \ => \\
 * ; => \;
 * , => \,
 * newline => \n
 */
export function icsEscape(input?: string | null) {
  if (!input) return '';
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Line folding (RFC 5545): max 75 octets; praktycznie – tnij na ~70 znaków
 * i kontynuuj od nowej linii zaczynając spacją.
 */
export function foldLine(line: string, limit = 70) {
  if (line.length <= limit) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    out += (i === 0 ? '' : '\r\n ') + line.slice(i, i + limit);
    i += limit;
  }
  return out;
}