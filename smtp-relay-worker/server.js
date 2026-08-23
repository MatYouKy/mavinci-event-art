import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';

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
  const authHeader = req.headers.authorization;

  console.log('🔐 Authorization check:');
  console.log(
    `   Received header: ${authHeader ? authHeader.substring(0, 20) + '...' : 'MISSING'}`,
  );
  console.log(`   Expected: Bearer ${RELAY_SECRET.substring(0, 10)}...`);

  if (!authHeader) {
    console.log('❌ No authorization header provided');
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: No authorization header',
    });
  }

  if (!authHeader.startsWith('Bearer ')) {
    console.log('❌ Invalid authorization format (should be "Bearer <token>")');
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid authorization format',
    });
  }

  const providedSecret = authHeader.replace('Bearer ', '');
  const expectedSecret = RELAY_SECRET;

  if (providedSecret !== expectedSecret) {
    console.log('❌ Secret mismatch');
    console.log(`   Provided length: ${providedSecret.length}`);
    console.log(`   Expected length: ${expectedSecret.length}`);
    console.log(
      `   First 10 chars match: ${providedSecret.substring(0, 10) === expectedSecret.substring(0, 10)}`,
    );
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid relay secret',
    });
  }

  console.log('✅ Authorization successful');
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
    
    const fromEmail = smtpConfig.username;
    const replyToEmail = smtpConfig.replyTo || smtpConfig.from || replyTo;
    
    const mailOptions = {
      from: `"${smtpConfig.fromName || fromEmail}" <${fromEmail}>`,
      to: normalizeEmailList(to),
      cc: normalizeEmailList(cc),
      bcc: normalizeEmailList(bcc),
      subject,
      html: body,
      replyTo: replyToEmail,
      attachments: attachments.map((att) => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.contentType || 'application/octet-stream',
        contentDisposition: att.contentDisposition || 'attachment',
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
  const { imapConfig, messages, markAsRead } = req.body;

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
    await client.mailboxOpen('INBOX');
    const states = [];

    if (markAsRead === true) {
      for (const message of messages.slice(0, 10)) {
        if (!message?.messageId) continue;
        const matches = await client.search(
          { header: { 'message-id': message.messageId } },
          { uid: true },
        );
        const uid = matches.at(-1);
        if (!uid) {
          states.push({ id: message.id, found: false });
          continue;
        }
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        states.push({ id: message.id, found: true, isRead: true });
      }
    } else {
      const idsByMessageId = new Map(
        messages.map((message) => [String(message.messageId).replace(/[<>]/g, ''), message.id]),
      );
      const start = Math.max(1, Number(client.mailbox.exists || 0) - 499);
      for await (const email of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
        const normalizedMessageId = String(email.envelope?.messageId || '').replace(/[<>]/g, '');
        const id = idsByMessageId.get(normalizedMessageId);
        if (!id) continue;
        states.push({ id, found: true, isRead: email.flags?.has('\\Seen') || false });
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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'smtp-relay-worker',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
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
