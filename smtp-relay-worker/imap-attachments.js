import { ImapFlow } from 'imapflow';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_PARTS = 100;
const normalizeId = (value) => String(value || '').trim().replace(/^<|>$/g, '');

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function attachmentParts(node, result = []) {
  if (!node) throw failure('INVALID_STRUCTURE');
  const filename = node.dispositionParameters?.filename || node.parameters?.name;
  const type = String(node.type || '').toLowerCase();
  const isAttachment = node.disposition === 'attachment' || filename ||
    type === 'message/rfc822' || (!node.childNodes?.length && !type.startsWith('text/'));
  if (isAttachment && !type.startsWith('multipart/')) {
    result.push({ ...node, filename, part: node.part || '1' });
  } else {
    for (const child of node.childNodes || []) attachmentParts(child, result);
  }
  return result;
}

export function registerAttachmentRoute(app, verifyAuth) {
  let active = 0;
  app.post('/api/imap/attachments', verifyAuth, async (req, res) => {
    const { imapConfig, message, mailbox = 'INBOX' } = req.body || {};
    if (!imapConfig?.host || !imapConfig.username || !imapConfig.password ||
        typeof message?.messageId !== 'string' || !normalizeId(message.messageId) ||
        message.messageId.length > 1000 || typeof mailbox !== 'string' || mailbox.length > 1000) {
      return res.status(400).json({ success: false, code: 'INVALID_REQUEST' });
    }
    if (active >= 3) return res.status(429).json({ success: false, code: 'BUSY' });
    active += 1;
    const client = new ImapFlow({
      host: imapConfig.host,
      port: Number(imapConfig.port || 993),
      secure: imapConfig.secure !== false,
      auth: { user: imapConfig.username, pass: imapConfig.password },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
    // Network errors must reject the request, never become an unhandled EventEmitter error.
    client.on('error', () => {});
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; client.close(); }, 45000);
    const disconnect = () => { if (!res.writableEnded) client.close(); };
    res.on('close', disconnect);
    try {
      await client.connect();
      const opened = await client.mailboxOpen(mailbox, { readOnly: true });
      const uidValidity = String(opened.uidValidity || '');
      const matchesIdentity = (email) => email &&
        normalizeId(email.envelope?.messageId) === normalizeId(message.messageId);
      let email = null;
      if (message.imapUid && message.imapUidValidity &&
          String(message.imapUidValidity) === uidValidity) {
        email = await client.fetchOne(String(message.imapUid), { envelope: true, bodyStructure: true }, { uid: true });
      }
      if (!matchesIdentity(email)) {
        email = null;
        const uids = await client.search({ header: { 'message-id': normalizeId(message.messageId) } }, { uid: true });
        for (const uid of (uids || []).slice(-10).reverse()) {
          const candidate = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true }, { uid: true });
          if (matchesIdentity(candidate)) { email = candidate; break; }
        }
      }
      if (!email) throw failure('MESSAGE_NOT_FOUND');
      const parts = attachmentParts(email.bodyStructure);
      if (parts.length > MAX_PARTS) throw failure('TOO_MANY_ATTACHMENTS');
      const attachments = [];
      let totalBytes = 0;
      for (const part of parts) {
        const downloaded = await client.download(String(email.uid), part.part, {
          uid: true, maxBytes: MAX_BYTES - totalBytes + 1,
        });
        if (!downloaded?.content) throw failure('DOWNLOAD_FAILED');
        const chunks = [];
        for await (const chunk of downloaded.content) {
          const bytes = Buffer.from(chunk);
          totalBytes += bytes.length;
          if (totalBytes > MAX_BYTES) {
            downloaded.content.destroy();
            throw failure('ATTACHMENTS_TOO_LARGE');
          }
          chunks.push(bytes);
        }
        const content = Buffer.concat(chunks);
        attachments.push({
          part: part.part,
          filename: String(downloaded.meta.filename || part.filename ||
            (part.type === 'message/rfc822' ? `wiadomosc-${part.part}.eml` : `zalacznik-${part.part}`))
            .replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 255),
          contentType: downloaded.meta.contentType || part.type || 'application/octet-stream',
          sizeBytes: content.length,
          content: content.toString('base64'),
        });
      }
      if (timedOut) throw failure('TIMEOUT');
      return res.json({ success: true, attachments });
    } catch (error) {
      const code = timedOut ? 'TIMEOUT' : error.code || 'IMAP_ERROR';
      // Never log mailbox passwords, message contents or upstream authentication errors.
      console.warn('Attachment import failed:', code);
      if (!res.destroyed) return res.status(code === 'MESSAGE_NOT_FOUND' ? 404 : 502).json({ success: false, code });
    } finally {
      clearTimeout(timeout);
      res.off('close', disconnect);
      client.close();
      active -= 1;
    }
  });
}
