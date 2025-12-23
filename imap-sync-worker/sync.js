const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

<<<<<<< HEAD
const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY?.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
  ? (process.env.SUPABASE_SERVICE_ROLE_KEY.includes('"role":"service_role"') ? 'service_role' : 'anon')
=======
// Debug: Check which key is being used
const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY?.includes(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
)
  ? process.env.SUPABASE_SERVICE_ROLE_KEY.includes('"role":"service_role"')
    ? 'service_role'
    : 'anon'
>>>>>>> c7477ac (update sync)
  : 'MISSING';

console.log('\n⚠️  KEY TYPE DETECTED:', keyType);
if (keyType === 'anon') {
  console.log('❌ ERROR: Using ANON key instead of SERVICE_ROLE key!');
  console.log('   Worker will NOT be able to access email accounts due to RLS.');
  console.log('   Please update .env with the correct SERVICE_ROLE key from Supabase Dashboard.');
  console.log('   Location: Settings > API > service_role (secret)\n');
}

<<<<<<< HEAD
const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5) * 60 * 1000;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES_PER_SYNC) || 100;
=======
const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 5) * 60 * 1000;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES_PER_SYNC, 10) || 50;

// How many days back to search from last sync (IMAP SINCE is day-granular, so we overlap)
const OVERLAP_DAYS = parseInt(process.env.SYNC_SINCE_OVERLAP_DAYS, 10) || 2;

function getMonthName(month) {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return months[month - 1];
}
>>>>>>> c7477ac (update sync)

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

<<<<<<< HEAD
    const searchCriteria = ['ALL'];
=======
    // IMPORTANT FIX:
    // Do NOT base "since" on parsed email Date header (can be stale / wrong).
    // Instead base it on worker's last_sync_at (your system clock), with overlap.
    const lastSyncAt = safeDate(account.last_sync_at);
    let searchCriteria;

    if (lastSyncAt) {
      const sinceDate = new Date(lastSyncAt);
      sinceDate.setUTCDate(sinceDate.getUTCDate() - OVERLAP_DAYS);
      const imapSince = formatImapSinceDate(sinceDate);

      // ✅ Correct format for imap-simple / node-imap
      searchCriteria = [['SINCE', imapSince]];

      console.log(
        `  → Searching for messages SINCE (overlap ${OVERLAP_DAYS}d): ${imapSince} (last_sync_at: ${lastSyncAt.toISOString()})`,
      );
    } else {
      searchCriteria = ['ALL'];
      console.log('  → Searching for all messages (first sync)');
    }

>>>>>>> c7477ac (update sync)
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

<<<<<<< HEAD
=======
    // Sort by IMAP INTERNALDATE (node-imap puts it in attributes.date) when available
    const sorted = messages.slice().sort((a, b) => {
      const ad = a?.attributes?.date ? new Date(a.attributes.date).getTime() : 0;
      const bd = b?.attributes?.date ? new Date(b.attributes.date).getTime() : 0;
      return ad - bd;
    });

    // Always cap processing per sync to avoid huge runs.
    const recentMessages = sorted.length > MAX_MESSAGES ? sorted.slice(-MAX_MESSAGES) : sorted;

>>>>>>> c7477ac (update sync)
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

        const { error: insertError } = await supabase.from('received_emails').insert(emailData);

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
<<<<<<< HEAD
      .update({ last_sync_at: new Date().toISOString() })
=======
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: errorCount > 0 ? 'partial' : 'success',
        last_sync_error: null,
      })
>>>>>>> c7477ac (update sync)
      .eq('id', account.id);

  } catch (error) {
    console.error(`  ✗ Failed to sync ${account.email_address}:`, error.message);
    await supabase
      .from('employee_email_accounts')
      .update({
<<<<<<< HEAD
        last_sync_at: new Date().toISOString()
=======
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_error: error.message,
>>>>>>> c7477ac (update sync)
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
<<<<<<< HEAD
      await syncAccount(account);
=======
      const result = await syncAccount(account);
      if (result.success) totalSynced += result.synced || 0;
      if (result.errors) totalErrors += result.errors;
      if (!result.success) totalErrors += 1; // licz chociaż 1 błąd per konto
>>>>>>> c7477ac (update sync)
    }

    console.log('\n════════════════════════════════════════════');
    console.log(' ✅ Sync cycle completed');
    console.log('════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Fatal error in sync cycle:', error);
  }
}

<<<<<<< HEAD
syncAllAccounts();
=======
console.log('\n' + '='.repeat(80));
console.log('MAVINCI IMAP SYNC WORKER');
console.log('='.repeat(80));
console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
console.log(`Sync interval: ${SYNC_INTERVAL / 60000} minutes`);
console.log(`Max messages per sync: ${MAX_MESSAGES}`);
console.log(`Overlap days for SINCE: ${OVERLAP_DAYS}`);
console.log('='.repeat(80) + '\n');
>>>>>>> c7477ac (update sync)

setInterval(() => {
  syncAllAccounts();
}, SYNC_INTERVAL);

console.log(`\n🔄 IMAP Worker running. Syncing every ${SYNC_INTERVAL / 1000 / 60} minutes.`);
console.log(`📦 Processing last ${MAX_MESSAGES} messages per account.\n`);
