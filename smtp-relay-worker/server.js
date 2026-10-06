import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';
import { registerAttachmentRoute } from './imap-attachments.js';
import { timingSafeEqual } from 'node:crypto';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3005;
const RELAY_SECRET = process.env.RELAY_SECRET;

if (!RELAY_SECRET) {
  console.error('❌ RELAY_SECRET is required in .env file');
  process.exit(1);
}

function verifyAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(RELAY_SECRET);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

app.post('/api/send-email', verifyAuth, async (req, res) => {
  try {
    const {
      smtpConfig,
      to,
      cc,
      bcc,
      subject,
      body,
      replyTo,
      inReplyTo,
      references,
      attachments = [],
    } = req.body;

    if (!smtpConfig || !to || !subject || !body) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: smtpConfig, to, subject, body',
      });
    }

    console.log(`📧 [${new Date().toISOString()}] Sending email to: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   SMTP: ${smtpConfig.host}:${smtpConfig.port}`);
    console.log(`   Attachments: ${attachments.length}`);

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.port === 465,
      auth: {
        user: smtpConfig.username,
        pass: smtpConfig.password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    });

    console.log('🔌 Verifying SMTP connection...');
    try {
      await transporter.verify();
      console.log('✅ SMTP connection verified');
    } catch (verifyError) {
      console.error('❌ SMTP verification failed:', verifyError.message);
      return res.status(500).json({
        success: false,
        error: `SMTP connection failed: ${verifyError.message}`,
      });
    }

    const normalizeEmailList = (value) => {
      if (!value || typeof value !== 'string') return undefined;
    
      const emails = value
        .split(/[;,]/)
        .map((email) => email.trim())
        .filter(Boolean);
    
      return emails.length ? emails.join(', ') : undefined;
    };
    
    // The SMTP login can be a technical mailbox. Keep the visible sender and
    // Reply-To on the employee account selected in CRM.
    const fromEmail = smtpConfig.from || smtpConfig.username;
    const replyToEmail = smtpConfig.replyTo || smtpConfig.from || replyTo;
    
    const mailOptions = {
      from: `"${smtpConfig.fromName || fromEmail}" <${fromEmail}>`,
      to: normalizeEmailList(to),
      cc: normalizeEmailList(cc),
      bcc: normalizeEmailList(bcc),
      subject,
      html: body,
      replyTo: replyToEmail,
      inReplyTo: inReplyTo || undefined,
      references: Array.isArray(references) && references.length > 0 ? references : undefined,
      attachments: attachments.map((att) => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.contentType || 'application/octet-stream',
        contentDisposition: att.contentDisposition || 'attachment',
        cid: att.cid || undefined,
      })),
    };

    console.log('MAIL FROM DEBUG:', {
      smtpUsername: smtpConfig.username,
      smtpFrom: smtpConfig.from,
      finalFrom: mailOptions.from,
      replyTo: mailOptions.replyTo,
    });

    console.log('📮 Sending email...');
    const info = await transporter.sendMail(mailOptions);

    console.log(`✅ Email sent successfully. MessageId: ${info.messageId}`);

    return res.json({
      success: true,
      messageId: info.messageId,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/api/imap/read-state', verifyAuth, async (req, res) => {
  const { imapConfig, messages, targetReadState, mailbox = 'INBOX' } = req.body;

  if (!imapConfig?.host || !imapConfig?.username || !imapConfig?.password) {
    return res.status(400).json({ success: false, error: 'Missing IMAP configuration' });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.json({ success: true, states: [] });
  }

  const client = new ImapFlow({
    host: imapConfig.host,
    port: Number(imapConfig.port || 993),
    secure: imapConfig.secure !== false,
    auth: {
      user: imapConfig.username,
      pass: imapConfig.password,
    },
    logger: false,
  });

  try {
    await client.connect();
    const openedMailbox = await client.mailboxOpen(mailbox);
    const uidValidity = String(openedMailbox?.uidValidity || client.mailbox?.uidValidity || '');
    const states = [];
    const normalizedMessageId = (value) => String(value || '').replace(/[<>]/g, '').trim();
    const buildState = (message, email, isRead) => ({
      id: message.id,
      found: true,
      isRead,
      uid: Number(email?.uid || message.imapUid || 0) || null,
      uidValidity,
      mailbox,
      flags: email?.flags ? Array.from(email.flags) : isRead ? ['\\Seen'] : [],
    });

    if (typeof targetReadState === 'boolean') {
      for (const message of messages.slice(0, 50)) {
        if (!message?.messageId) continue;
        const expectedId = normalizedMessageId(message.messageId);
        const cachedUidIsValid = message.imapUid && message.imapUidValidity &&
          String(message.imapUidValidity) === uidValidity;
        let email = cachedUidIsValid
          ? await client.fetchOne(String(message.imapUid), { envelope: true, flags: true }, { uid: true })
          : null;
        if (!email || normalizedMessageId(email.envelope?.messageId) !== expectedId) {
          email = null;
          const matches = await client.search(
            { header: { 'message-id': message.messageId } }, { uid: true },
          );
          const exact = [];
          if (matches.length) {
            for await (const candidate of client.fetch(matches.join(','), { envelope: true, flags: true }, { uid: true })) {
              if (normalizedMessageId(candidate.envelope?.messageId) === expectedId) exact.push(candidate);
            }
          }
          // Duplicate Message-IDs without a verified UID are ambiguous.
          if (exact.length === 1) email = exact[0];
        }
        if (!email) {
          states.push({ id: message.id, found: false });
          continue;
        }
        if (targetReadState) {
          await client.messageFlagsAdd(email.uid, ['\\Seen'], { uid: true });
          email.flags.add('\\Seen');
        } else {
          await client.messageFlagsRemove(email.uid, ['\\Seen'], { uid: true });
          email.flags.delete('\\Seen');
        }
        states.push(buildState(message, email, targetReadState));
      }
    } else {
      const idsByMessageId = new Map(
        messages.map((message) => [normalizedMessageId(message.messageId), message]),
      );
      const messagesByUid = new Map(
        messages
          .filter(
            (message) =>
              message.imapUid &&
              (!message.imapUidValidity || String(message.imapUidValidity) === uidValidity),
          )
          .map((message) => [Number(message.imapUid), message]),
      );
      const resolvedIds = new Set();

      if (messagesByUid.size > 0) {
        const uidSet = [...messagesByUid.keys()].join(',');
        for await (const email of client.fetch(uidSet, { envelope: true, flags: true }, { uid: true })) {
          const message = messagesByUid.get(Number(email.uid));
          if (!message) continue;
          resolvedIds.add(message.id);
          states.push(buildState(message, email, email.flags?.has('\\Seen') || false));
        }
      }

      // Pierwsza synchronizacja starszych rekordów nie ma jeszcze UID. Szukamy
      // ich po Message-ID, a znalezione UID zapisujemy do kolejnych szybkich przebiegów.
      const start = Math.max(1, Number(client.mailbox.exists || 0) - 1999);
      for await (const email of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
        const message = idsByMessageId.get(normalizedMessageId(email.envelope?.messageId));
        if (!message || resolvedIds.has(message.id)) continue;
        resolvedIds.add(message.id);
        states.push(buildState(message, email, email.flags?.has('\\Seen') || false));
      }
    }

    return res.json({ success: true, states });
  } catch (error) {
    console.error('❌ IMAP read-state synchronization failed:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    await client.logout().catch(() => undefined);
  }
});

registerAttachmentRoute(app, verifyAuth);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'smtp-relay-worker',
    capabilities: ['imap-attachments-v1'],
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, process.env.RELAY_HOST || '0.0.0.0', () => {
  console.log('');
  console.log('┌─────────────────────────────────────────────┐');
  console.log('│  📮 SMTP Relay Worker                      │');
  console.log('├─────────────────────────────────────────────┤');
  console.log(`│  Port: ${PORT}                               │`);
  console.log(`│  Status: ✅ Running                         │`);
  console.log('│  Endpoint: POST /api/send-email            │');
  console.log('│  Health: GET /health                       │');
  console.log('└─────────────────────────────────────────────┘');
  console.log('');
  console.log('⏳ Waiting for requests...');
  console.log('');
});
