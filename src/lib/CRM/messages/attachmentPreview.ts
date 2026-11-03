export type AttachmentPreview = { kind: 'pdf' | 'image'; mime: string; extension: string };
const formats: Record<string, AttachmentPreview> = {
  pdf: { kind: 'pdf', mime: 'application/pdf', extension: 'pdf' },
  jpg: { kind: 'image', mime: 'image/jpeg', extension: 'jpg' },
  jpeg: { kind: 'image', mime: 'image/jpeg', extension: 'jpg' },
  png: { kind: 'image', mime: 'image/png', extension: 'png' },
  gif: { kind: 'image', mime: 'image/gif', extension: 'gif' },
  webp: { kind: 'image', mime: 'image/webp', extension: 'webp' },
  avif: { kind: 'image', mime: 'image/avif', extension: 'avif' },
  bmp: { kind: 'image', mime: 'image/bmp', extension: 'bmp' },
};

// Do not render active formats such as HTML or SVG from email attachments.
// Older archives sometimes only have a filename and application/octet-stream.
export function attachmentPreview(filename: string, contentType?: string | null): AttachmentPreview | null {
  const mime = (contentType || '').split(';')[0].trim().toLowerCase();
  const known = Object.values(formats).find(format => format.mime === mime);
  if (known) return known;
  if (mime && !['application/octet-stream', 'binary/octet-stream', 'application/unknown'].includes(mime)) return null;
  return formats[filename.split('.').pop()?.toLowerCase() || ''] || null;
}

export function matchesPreviewBytes(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (mime === 'application/pdf') return ascii(0, 5) === '%PDF-';
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  if (mime === 'image/gif') return ['GIF87a','GIF89a'].includes(ascii(0,6));
  if (mime === 'image/webp') return ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP';
  if (mime === 'image/avif') return ascii(4,8) === 'ftyp' && ['avif','avis'].includes(ascii(8,12));
  return mime === 'image/bmp' && ascii(0,2) === 'BM';
}
