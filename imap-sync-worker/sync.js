const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SYNC_INTERVAL = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 5) * 60 * 1000;
const MAX_MESSAGES = parseInt(process.env.MAX_MESSAGES_PER_SYNC) || 50;

async function syncAccount(account) {
  console.log(`\n[${new Date().toISOString()}] Synchronizing: ${account.email_address}`);

  try {
    const config = {
      imap: {
        user: account.imap_username,
        password: account.imap_password,
        host: account.imap_host,
        port: account.imap_port,
        tls: account.imap_use_ssl,
        tlsOptions: {
          rejectUnauthorized: false,
          servername: account.imap_host
        },
        authTimeout: 30000,
        connTimeout: 30000
      }
    };

    console.log(`  → Connecting to ${account.imap_host}:${account.imap_port}...`);
    const connection = await imapSimple.connect(config);
    console.log('  ✓ Connected');

    await connection.openBox('INBOX');
    console.log('  ✓ INBOX opened');

    const searchCriteria = ['ALL'];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
      struct: true
    };

    console.log('  → Searching for messages...');
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log(`  ✓ Found ${messages.length} messages`);

    const recentMessages = messages.slice(-MAX_MESSAGES);
    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const item of recentMessages) {
      const all = item.parts.find(part => part.which === '');
      if (!all || !all.body) {
        errorCount++;
        continue;
      }

      try {
        const parsed = await simpleParser(all.body);
        const messageId = parsed.messageId || `${Date.now()}-${Math.random()}`;

        const { data: existing } = await supabase
          .from('received_emails')
          .select('id')
          .eq('email_account_id', account.id)
          .eq('message_id', messageId)
          .maybeSingle();

        if (existing) {
          skippedCount++;
          continue;
        }

        const emailData = {
          email_account_id: account.id,
          message_id: messageId,
          from_address: parsed.from?.text || '',
          to_address: parsed.to?.text || account.email_address,
          subject: parsed.subject || '(No subject)',
          body_text: parsed.text || '',
          body_html: parsed.html || '',
          received_date: parsed.date || new Date(),
          has_attachments: parsed.attachments && parsed.attachments.length > 0,
          raw_headers: parsed.headers ? Object.fromEntries(
            Object.entries(parsed.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])
          ) : {},
          is_read: false,
          is_starred: false
        };

        const { error: insertError } = await supabase
          .from('received_emails')
          .insert(emailData);

        if (insertError) {
          if (insertError.code === '23505') {
            skippedCount++;
          } else {
            console.error(`  ✗ Error inserting email:`, insertError);
            errorCount++;
          }
        } else {
          syncedCount++;
          console.log(`  ✓ Synced: ${parsed.subject || '(No subject)'}`);
        }
      } catch (parseError) {
        console.error('  ✗ Parse error:', parseError.message);
        errorCount++;
      }
    }

    connection.end();

    console.log(`\n  Summary for ${account.email_address}:`);
    console.log(`    • New messages synced: ${syncedCount}`);
    console.log(`    • Already in database: ${skippedCount}`);
    console.log(`    • Errors: ${errorCount}`);

    await supabase
      .from('employee_email_accounts')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: errorCount > 0 ? 'partial' : 'success'
      })
      .eq('id', account.id);

    return { success: true, synced: syncedCount, errors: errorCount };
  } catch (error) {
    console.error(`\n  ✗ Error syncing account ${account.email_address}:`, error.message);

    await supabase
      .from('employee_email_accounts')
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_sync_error: error.message
      })
      .eq('id', account.id);

    return { success: false, error: error.message };
  }
}

async function syncAll() {
  console.log('\n' + '='.repeat(80));
  console.log(`IMAP SYNC STARTED: ${new Date().toISOString()}`);
  console.log('='.repeat(80));

  try {
    const { data: accounts, error } = await supabase
      .from('employee_email_accounts')
      .select('*')
      .eq('is_active', true);

    if (error) {
      console.error('Error fetching email accounts:', error);
      return;
    }

    if (!accounts || accounts.length === 0) {
      console.log('\nNo active email accounts found.');
      return;
    }

    console.log(`\nFound ${accounts.length} active email account(s)\n`);

    let totalSynced = 0;
    let totalErrors = 0;

    for (const account of accounts) {
      const result = await syncAccount(account);
      if (result.success) {
        totalSynced += result.synced || 0;
        totalErrors += result.errors || 0;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('SYNC COMPLETED');
    console.log(`  • Total messages synced: ${totalSynced}`);
    console.log(`  • Total errors: ${totalErrors}`);
    console.log(`  • Next sync in ${SYNC_INTERVAL / 60000} minutes`);
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('\n✗ Fatal error during sync:', error);
  }
}

console.log('\n' + '='.repeat(80));
console.log('MAVINCI IMAP SYNC WORKER');
console.log('='.repeat(80));
console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);
console.log(`Sync interval: ${SYNC_INTERVAL / 60000} minutes`);
console.log(`Max messages per sync: ${MAX_MESSAGES}`);
console.log('='.repeat(80) + '\n');

syncAll();

setInterval(syncAll, SYNC_INTERVAL);

process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n✗ Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('\n✗ Unhandled rejection:', error);
});
