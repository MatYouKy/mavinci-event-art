const imapSimple = require('imap-simple');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConnection() {
  console.log('\n' + '='.repeat(80));
  console.log('IMAP CONNECTION TEST');
  console.log('='.repeat(80) + '\n');

  try {
    console.log('1. Testing Supabase connection...');
    const { data: accounts, error } = await supabase
      .from('employee_email_accounts')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (error) {
      console.error('✗ Supabase connection failed:', error.message);
      process.exit(1);
    }

    if (!accounts || accounts.length === 0) {
      console.log('✗ No active email accounts found in database.');
      console.log('\nPlease add an email account in CRM first:');
      console.log('  1. Go to CRM > Employees');
      console.log('  2. Select your profile');
      console.log('  3. Go to "Konta Email" tab');
      console.log('  4. Add your email account with IMAP credentials\n');
      process.exit(1);
    }

    console.log('✓ Supabase connected successfully');
    console.log(`✓ Found ${accounts.length} active email account(s)\n`);

    const account = accounts[0];
    console.log(`2. Testing IMAP connection for: ${account.email_address}`);
    console.log(`   Host: ${account.imap_host}:${account.imap_port}`);
    console.log(`   SSL: ${account.imap_use_ssl ? 'Yes' : 'No'}`);
    console.log(`   Username: ${account.imap_username}\n`);

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

    console.log('   Connecting...');
    const connection = await imapSimple.connect(config);
    console.log('   ✓ IMAP connection successful!');

    console.log('   Opening INBOX...');
    await connection.openBox('INBOX');
    console.log('   ✓ INBOX opened successfully');

    console.log('   Fetching message count...');
    const messages = await connection.search(['ALL'], {
      bodies: ['HEADER'],
      struct: true
    });
    console.log(`   ✓ Found ${messages.length} messages in INBOX`);

    connection.end();

    console.log('\n' + '='.repeat(80));
    console.log('✓ ALL TESTS PASSED!');
    console.log('='.repeat(80));
    console.log('\nYour IMAP configuration is correct.');
    console.log('You can now run the sync worker with: node sync.js\n');

  } catch (error) {
    console.log('\n' + '='.repeat(80));
    console.log('✗ TEST FAILED');
    console.log('='.repeat(80));
    console.error('\nError:', error.message);

    if (error.message.includes('AUTHENTICATIONFAILED')) {
      console.log('\nPossible solutions:');
      console.log('  1. Check if username and password are correct');
      console.log('  2. Enable "Less secure apps" in your email provider settings');
      console.log('  3. Use an "App Password" instead of your regular password');
      console.log('  4. Check if IMAP is enabled in your email account\n');
    } else if (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
      console.log('\nPossible solutions:');
      console.log('  1. Check if the IMAP host and port are correct');
      console.log('  2. Check your firewall settings');
      console.log('  3. Try using a different port (993 for SSL, 143 for non-SSL)\n');
    }

    process.exit(1);
  }
}

testConnection();
