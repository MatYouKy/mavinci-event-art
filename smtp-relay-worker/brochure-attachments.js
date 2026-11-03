import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_PDF_BYTES = 30_000_000;

function storageOrigin() {
  try {
    const url = new URL(process.env.SUPABASE_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function brochureAttachmentsConfigured() {
  return Boolean(storageOrigin());
}

function validateStoredPdf(source) {
  const origin = storageOrigin();
  if (!origin) throw new Error('W usłudze SMTP ustaw SUPABASE_URL swojego projektu, aby wysyłać zapisane broszury.');
  let url;
  try { url = new URL(source?.url); } catch { throw new Error('Nieprawidłowy adres zapisanego PDF.'); }
  if (source.kind !== 'brochure-storage-v1' || url.origin !== origin
    || url.username || url.password || url.hash
    || !url.pathname.startsWith('/storage/v1/object/sign/generated-brochures/')
    || !url.searchParams.get('token')
    || !Number.isSafeInteger(source.sizeBytes) || source.sizeBytes <= 0 || source.sizeBytes > MAX_PDF_BYTES) {
    throw new Error('Nieprawidłowy zapisany załącznik broszury (maksymalnie 30 MB).');
  }
  return url;
}

// Download to a private temporary file BEFORE SMTP DATA. Neither the Edge
// Function nor this worker needs to hold a base64 copy of the PDF in memory.
// Only our configured Supabase project is allowed; redirects are forbidden.
export async function prepareRelayAttachments(attachments) {
  if (!Array.isArray(attachments)) throw new Error('Nieprawidłowa lista załączników.');
  let directory;
  const cleanup = async () => {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  };
  try {
    const prepared = [];
    for (const attachment of attachments) {
      const metadata = {
        filename: attachment.filename,
        contentType: attachment.contentType || 'application/octet-stream',
        contentDisposition: attachment.contentDisposition || 'attachment',
        cid: attachment.cid || undefined,
      };
      if (!attachment.storageAttachment) {
        if (typeof attachment.content !== 'string') throw new Error('Brak treści załącznika.');
        prepared.push({ ...metadata, content: Buffer.from(attachment.content, 'base64') });
        continue;
      }
      const source = attachment.storageAttachment;
      const url = validateStoredPdf(source);
      directory ||= await mkdtemp(join(tmpdir(), 'mavinci-brochure-mail-'));
      const path = join(directory, `${prepared.length}.pdf`);
      let bytes = 0;
      try {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
        if (!response.ok || !response.body) throw new Error('Download failed');
        const declaredSize = response.headers.get('content-length');
        if (declaredSize && Number(declaredSize) !== source.sizeBytes) {
          await response.body.cancel();
          throw new Error('Size mismatch');
        }
        await pipeline(
          Readable.fromWeb(response.body),
          new Transform({
            transform(chunk, encoding, callback) {
              bytes += chunk.length;
              callback(bytes > source.sizeBytes || bytes > MAX_PDF_BYTES
                ? new Error('Size limit exceeded') : null, chunk);
            },
          }),
          createWriteStream(path, { flags: 'wx', mode: 0o600 }),
        );
        if (bytes !== source.sizeBytes) throw new Error('Incomplete download');
      } catch {
        // Never expose the signed URL/token through fetch error messages.
        throw new Error('Nie udało się pobrać całego PDF broszury. Wiadomość nie została wysłana. Spróbuj ponownie.');
      }
      prepared.push({ ...metadata, path });
    }
    return { attachments: prepared, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
