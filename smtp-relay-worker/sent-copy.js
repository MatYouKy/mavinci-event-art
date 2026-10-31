import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { ImapFlow } from 'imapflow';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

// Compose once: SMTP and the Sent folder get the same Message-ID, MIME parts,
// and attachment bytes. Spool to disk to retain streaming brochure delivery.
export async function prepareSentMessage(options) {
  const directory = await mkdtemp(join(tmpdir(), 'mavinci-sent-'));
  const cleanup = () => rm(directory, { recursive: true, force: true }).catch(() => undefined);
  try {
    const message = new MailComposer({ ...options, newline: 'windows' }).compile();
    // Bcc recipients stay in the envelope, never in the delivered headers.
    message.keepBcc = false;
    const envelope = message.getEnvelope();
    const messageId = message.messageId();
    const path = join(directory, 'message.eml');
    await pipeline(message.createReadStream(), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    return { path, envelope, messageId, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// Always return a separate archive result. An IMAP failure after SMTP acceptance
// is NOT a failed delivery and must never trigger an automatic resend.
export async function saveSentCopy(config, smtpHost, message) {
  if (!config?.host || !config.username || !config.password) {
    return { status: 'unconfigured', warning: 'Wiadomość wysłana. Brak konfiguracji IMAP do zapisania kopii w folderze Wysłane.' };
  }
  let client;
  let timer;
  try {
    client = new ImapFlow({
      host: config.host, port: Number(config.port || (config.secure === false ? 143 : 993)),
      secure: config.secure !== false,
      auth: { user: config.username, pass: config.password },
      logger: false, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    client.on('error', () => {});
    timer = setTimeout(() => client.close(), 25000);
    await client.connect();
    const mailboxes = await client.list();
    const sent = mailboxes.filter(folder => folder.specialUse === '\\Sent' && !folder.flags?.has('\\Noselect'));
    if (sent.length !== 1) {
      return { status: 'failed', warning: 'Wiadomość wysłana. Nie rozpoznano jednoznacznie folderu Wysłane na serwerze pocztowym. Sprawdź ustawienia skrzynki.' };
    }
    const mailbox = sent[0].path;
    await client.mailboxOpen(mailbox);
    const matches = await client.search({ header: { 'message-id': message.messageId } }, { uid: true });
    for (const uid of (matches || []).slice(-10)) {
      const found = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
      if (found?.envelope?.messageId === message.messageId) return { status: 'saved', mailbox };
    }
    // Gmail's SMTP saves its own copy; indexing in IMAP can lag behind acceptance.
    if (client.capabilities.has('X-GM-EXT-1') && /^smtp\.(gmail|googlemail)\.com$/i.test(smtpHost || '')) {
      return { status: 'provider_managed', mailbox };
    }
    // ImapFlow APPEND requires a Buffer. Read only after locating the mailbox,
    // and only if the server has not already saved this Message-ID.
    const appended = await client.append(mailbox, await readFile(message.path), ['\\Seen']);
    if (!appended) throw new Error('APPEND failed');
    return { status: 'saved', mailbox };
  } catch {
    // Do not expose credentials or upstream authentication details.
    return { status: 'failed', warning: 'Wiadomość wysłana, ale nie potwierdzono zapisu kopii w folderze Wysłane na serwerze pocztowym. Nie wysyłaj jej ponownie.' };
  } finally {
    clearTimeout(timer);
    client?.close();
  }
}
