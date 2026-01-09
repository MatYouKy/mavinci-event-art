const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY?.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  ? (process.env.SUPABASE_SERVICE_ROLE_KEY.includes('"role":"service_role"') ? 'service_role' : 'anon')
  : 'MISSING';

console.log('\n⚠️  KEY TYPE DETECTED:', keyType);
if (keyType === 'anon') {
  console.log('❌ ERROR: Using ANON key instead of SERVICE_ROLE key!');
  console.log('   Worker will NOT be able to access email accounts due to RLS.');
  console.log('   Please update .env with the correct SERVICE_ROLE key from Supabase Dashboard.');
  console.log('   Location: Settings > API > service_role (secret)\n');
}

const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5) * 60 * 1000;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES_PER_SYNC) || 100;

function formatImapSinceDate(date) {
  const d = new Date(date);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = getMonthName(d.getUTCMonth() + 1);
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function safeDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

async function syncAccount(account) {
  console.log(`\n[${new Date().toISOString()}] Synchronizing: ${account.email_address}`);

  try {
    const config = {
      imap: {
        user: account.imap_username,
        password: account.imap_password,
        host: account.imap_host,
        port: account.imap_port,
        tls: !!account.imap_use_ssl,
        tlsOptions: {
          rejectUnauthorized: false,
          servername: account.imap_host,
        },
        authTimeout: 30000,
        connTimeout: 30000,
      },
    };

    console.log(`  → Connecting to ${account.imap_host}:${account.imap_port}...`);
    const connection = await imapSimple.connect(config);
    console.log('  ✓ Connected');

    await connection.openBox('INBOX');
    console.log('  ✓ INBOX opened');

    const searchCriteria = ['ALL'];
    const fetchOptions = {
      // '' gets the full raw message
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
      struct: true,
    };

    console.log('  → Searching for messages...');
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`  ✓ Found ${messages.length} total messages in INBOX`);

    const recentMessages = messages.slice(-MAX_MESSAGES);
    console.log(`  → Processing last ${recentMessages.length} messages`);

    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const item of recentMessages) {
      const all = item.parts.find((part) => part.which === '');
      if (!all || !all.body) {
        errorCount++;
        continue;
      }

      try {
        const parsed = await simpleParser(all.body);

        // Prefer stable dedupe identifiers:
        // - Message-ID header if present
        // - otherwise IMAP UID (very stable per mailbox)
        const uid = item?.attributes?.uid;
        const messageId =
          (parsed.messageId && String(parsed.messageId).trim()) ||
          (uid ? `imap-uid:${uid}` : `${Date.now()}-${Math.random()}`);

        const { data: existing, error: existingError } = await supabase
          .from('received_emails')
          .select('id')
          .eq('email_account_id', account.id)
          .eq('message_id', messageId)
          .maybeSingle();

        if (existingError) {
          console.error('  ✗ Error checking existing email:', existingError);
          errorCount++;
          continue;
        }

        if (existing) {
          skippedCount++;
          continue;
        }

        // IMPORTANT FIX:
        // received_date should reflect mailbox/internal receipt time, not Date header.
        // Use IMAP INTERNALDATE when possible.
        const internalDate = item?.attributes?.date ? new Date(item.attributes.date) : null;
        const receivedDate =
          internalDate && !Number.isNaN(internalDate.getTime())
            ? internalDate
            : parsed.date && !Number.isNaN(new Date(parsed.date).getTime())
              ? new Date(parsed.date)
              : new Date();

        const emailData = {
          email_account_id: account.id,
          message_id: messageId,
          from_address: parsed.from?.text || '',
          to_address: parsed.to?.text || account.email_address,
          subject: parsed.subject || '(No subject)',
          body_text: parsed.text || '',
          body_html: parsed.html || '',
          received_date: receivedDate,
          has_attachments: Array.isArray(parsed.attachments) && parsed.attachments.length > 0,
          raw_headers: parsed.headers
            ? Object.fromEntries(
                Object.entries(parsed.headers).map(([k, v]) => [
                  k,
                  Array.isArray(v) ? v.join(', ') : v,
                ]),
              )
            : {},
          is_read: false,
          is_starred: false,
        };

        const { data: insertedEmail, error: insertError } = await supabase
          .from('received_emails')
          .insert(emailData)
          .select()
          .single();

        if (insertError) {
          if (insertError.code === '23505') {
            skippedCount++;
          } else {
            console.error(`  ✗ Error inserting email:`, insertError);
            errorCount++;
          }
        } else {
          syncedCount++;
          const receivedDateStr = parsed.date ? new Date(parsed.date).toLocaleString('pl-PL') : 'unknown';
          console.log(`  ✓ Synced [${receivedDateStr}]: ${parsed.subject || '(No subject)'}`);

          // Process attachments if any
          if (parsed.attachments && parsed.attachments.length > 0) {
            console.log(`    📎 Processing ${parsed.attachments.length} attachment(s)...`);

            for (const attachment of parsed.attachments) {
              try {
                const fileName = attachment.filename || `attachment-${Date.now()}`;
                const contentType = attachment.contentType || 'application/octet-stream';
                const buffer = attachment.content;
                const sizeBytes = buffer.length;

                // Generate storage path: email-attachments/received/{email_id}/{filename}
                const storagePath = `received/${insertedEmail.id}/${fileName}`;

                // Upload to Supabase Storage
                const { error: uploadError } = await supabase.storage
                  .from('email-attachments')
                  .upload(storagePath, buffer, {
                    contentType: contentType,
                    upsert: false,
                  });

                if (uploadError) {
                  console.error(`    ✗ Failed to upload attachment ${fileName}:`, uploadError.message);
                  continue;
                }

                // Insert attachment record
                const { error: attachmentError } = await supabase
                  .from('email_attachments')
                  .insert({
                    email_id: insertedEmail.id,
                    email_type: 'received',
                    filename: fileName,
                    content_type: contentType,
                    size_bytes: sizeBytes,
                    storage_path: storagePath,
                  });

                if (attachmentError) {
                  console.error(`    ✗ Failed to save attachment record ${fileName}:`, attachmentError.message);
                } else {
                  console.log(`    ✓ Saved attachment: ${fileName} (${(sizeBytes / 1024).toFixed(1)} KB)`);
                }
              } catch (attachError) {
                console.error(`    ✗ Error processing attachment:`, attachError.message);
              }
            }
          }
        }
      } catch (parseError) {
        console.error('  ✗ Parse error:', parseError.message);
        errorCount++;
      }
    }

    await connection.end();
    console.log(`  ✓ Disconnected`);
    console.log(`  📊 Results: ${syncedCount} new, ${skippedCount} skipped, ${errorCount} errors`);

    await supabase
      .from('employee_email_accounts')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', account.id);

  } catch (error) {
    console.error(`  ✗ Failed to sync ${account.email_address}:`, error.message);
    await supabase
      .from('employee_email_accounts')
      .update({
        last_sync_at: new Date().toISOString()
      })
      .eq('id', account.id);
  }
}

async function syncAllAccounts() {
  console.log('\n════════════════════════════════════════════');
  console.log(' 📧 IMAP SYNC WORKER - Starting sync cycle');
  console.log('════════════════════════════════════════════\n');

  try {
    const { data: accounts, error } = await supabase
      .from('employee_email_accounts')
      .select('*')
      .eq('is_active', true)
      .not('imap_host', 'is', null);

    if (error) {
      console.error('❌ Error fetching accounts:', error);
      return;
    }

    if (!accounts || accounts.length === 0) {
      console.log('⚠️  No active email accounts found with IMAP configuration.');
      return;
    }

    console.log(`✓ Found ${accounts.length} active account(s) to sync\n`);

    for (const account of accounts) {
      await syncAccount(account);
    }

    console.log('\n════════════════════════════════════════════');
    console.log(' ✅ Sync cycle completed');
    console.log('════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Fatal error in sync cycle:', error);
  }
}

syncAllAccounts();

setInterval(() => {
  syncAllAccounts();
}, SYNC_INTERVAL);

console.log(`\n🔄 IMAP Worker running. Syncing every ${SYNC_INTERVAL / 1000 / 60} minutes.`);
console.log(`📦 Processing last ${MAX_MESSAGES} messages per account.\n`);
