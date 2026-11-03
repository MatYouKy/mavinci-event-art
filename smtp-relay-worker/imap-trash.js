import { ImapFlow } from 'imapflow';

const normalizeId = value => String(value || '').trim().replace(/^<|>$/g, '');
const fail = code => Object.assign(new Error(code), { code });

export function registerTrashRoute(app, verifyAuth) {
  const pending = new Set();
  app.post('/api/imap/trash', verifyAuth, async (req, res) => {
    const { imapConfig: config, message, action, kind } = req.body || {};
    if (!config?.host || !config.username || !config.password || !['trash','restore'].includes(action)
      || !['received','sent'].includes(kind) || typeof message?.messageId !== 'string'
      || !normalizeId(message.messageId) || message.messageId.length > 1000
      || /[\r\n\0]/.test(message.messageId)
      || [message.mailbox,message.originalMailbox].some(value => value != null && (typeof value !== 'string' || value.length > 1000 || /[\r\n\0]/.test(value)))) {
      return res.status(400).json({ success: false, code: 'INVALID_REQUEST' });
    }
    const key = JSON.stringify([config.host,config.username,message.messageId]);
    if (pending.size >= 3 || pending.has(key)) return res.status(429).json({ success: false, code: 'BUSY' });
    pending.add(key);
    const client = new ImapFlow({ host: config.host,port: Number(config.port || 993),secure: config.secure !== false,
      auth: { user: config.username,pass: config.password },logger: false,
      connectionTimeout: 15000,greetingTimeout: 10000,socketTimeout: 15000 });
    client.on('error', () => {});
    const timer = setTimeout(() => client.close(),45000);
    const disconnect = () => { if (!res.writableEnded) client.close(); };
    res.on('close',disconnect);
    try {
      await client.connect();
      // Never fall back to COPY + global EXPUNGE: it can purge unrelated mail.
      if (!client.capabilities.has('MOVE')) throw fail('MOVE_UNSUPPORTED');
      const folders = (await client.list()).filter(folder => !folder.flags?.has('\\Noselect'));
      const special = (use, names) => {
        const flagged = folders.filter(folder => folder.specialUse === use);
        const matches = flagged.length ? flagged : folders.filter(folder => names.includes(folder.name.toLowerCase()));
        if (matches.length !== 1) throw fail('FOLDER_AMBIGUOUS');
        return matches[0].path;
      };
      const trash = special('\\Trash',['trash','deleted messages','deleted items','kosz']);
      const original = message.originalMailbox || (action === 'trash' && message.mailbox !== trash ? message.mailbox : null)
        || (kind === 'received' ? 'INBOX' : special('\\Sent',['sent','sent items','sent messages','wysłane']));
      const source = action === 'trash' ? (message.mailbox || original) : trash;
      const destination = action === 'trash' ? trash : original;
      if (!folders.some(folder => folder.path === destination) || (action === 'restore' && destination === trash)) throw fail('FOLDER_AMBIGUOUS');
      const find = async (folder, cached = false, uidOverride = null, validityOverride = null) => {
        if (!folders.some(entry => entry.path === folder)) return null;
        const opened = await client.mailboxOpen(folder);
        const validity = String(opened.uidValidity || '');
        const uid = uidOverride || (cached ? message.imapUid : null);
        const expectedValidity = validityOverride || (cached ? message.imapUidValidity : null);
        const matches = email => email && normalizeId(email.envelope?.messageId) === normalizeId(message.messageId);
        if (uid && expectedValidity && String(expectedValidity) === validity && /^\d+$/.test(String(uid))) {
          const email = await client.fetchOne(String(uid),{ envelope: true },{ uid: true });
          if (matches(email)) return { uid: email.uid,uidValidity: validity };
        }
        const uids = await client.search({ header: { 'message-id': normalizeId(message.messageId) } },{ uid: true });
        if (uids && uids.length > 20) throw fail('MESSAGE_AMBIGUOUS');
        const exact = [];
        for (const candidate of uids || []) {
          const email = await client.fetchOne(String(candidate),{ envelope: true },{ uid: true });
          if (matches(email)) exact.push(email);
        }
        if (exact.length > 1) throw fail('MESSAGE_AMBIGUOUS');
        return exact.length ? { uid: exact[0].uid,uidValidity: validity } : null;
      };
      const email = await find(source,source === message.mailbox);
      let target;
      if (email && source !== destination) {
        const moved = await client.messageMove(String(email.uid),destination,{ uid: true });
        if (!moved) throw fail('MOVE_UNCONFIRMED');
        target = await find(destination,false,moved.uidMap?.get(email.uid),moved.uidValidity);
      } else {
        // A previous request may have moved the message before its response was
        // lost. Confirm the destination; do not copy, delete or resend anything.
        target = source === destination ? email : await find(destination);
      }
      if (!target) throw fail('MESSAGE_NOT_FOUND');
      return res.json({ success: true,mailbox: destination,originalMailbox: original,...target });
    } catch (error) {
      const allowed = ['MOVE_UNSUPPORTED','FOLDER_AMBIGUOUS','MESSAGE_AMBIGUOUS','MOVE_UNCONFIRMED','MESSAGE_NOT_FOUND'];
      return res.status(503).json({ success: false,code: allowed.includes(error.code) ? error.code : 'IMAP_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);res.off('close',disconnect);client.close();pending.delete(key);
    }
  });
}
