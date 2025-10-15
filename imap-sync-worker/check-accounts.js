const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAccounts() {
  console.log('\n=== Checking Email Accounts ===\n');

  console.log('Supabase URL:', process.env.SUPABASE_URL);
  console.log('Service Role Key:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Set' : '✗ Not set');

  // Check which key type is being used
  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY?.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY.includes('"role":"service_role"') ? 'service_role' : 'anon')
    : 'MISSING';

  console.log('Key Type:', keyType);
  if (keyType === 'anon') {
    console.log('\n❌ CRITICAL ERROR: You are using ANON key instead of SERVICE_ROLE key!');
    console.log('   This is why the worker cannot see email accounts.');
    console.log('\n   Fix: Update your .env file with the SERVICE_ROLE key:');
    console.log('   1. Go to: https://supabase.com/dashboard/project/fuuljhhuhfojtmmfmskq/settings/api');
    console.log('   2. Copy "service_role" key (NOT "anon" key!)');
    console.log('   3. Update SUPABASE_SERVICE_ROLE_KEY in .env');
    console.log('   4. Restart worker: pm2 restart mavinci-imap-sync\n');
  }
  console.log('');

  // Sprawdź wszystkie konta
  const { data: allAccounts, error: allError } = await supabase
    .from('employee_email_accounts')
    .select('*');

  if (allError) {
    console.error('❌ Error fetching accounts:', allError.message);
    return;
  }

  console.log(`Total accounts in database: ${allAccounts?.length || 0}\n`);

  if (!allAccounts || allAccounts.length === 0) {
    console.log('❌ No email accounts found in database!');
    console.log('\nPlease add an email account in CRM:');
    console.log('  1. Go to CRM > Employees');
    console.log('  2. Click on your profile');
    console.log('  3. Go to "Konta Email" tab');
    console.log('  4. Add your email account\n');
    return;
  }

  // Pokaż wszystkie konta
  allAccounts.forEach((account, index) => {
    console.log(`Account ${index + 1}:`);
    console.log(`  Email: ${account.email_address}`);
    console.log(`  Active: ${account.is_active ? '✓ Yes' : '✗ No'}`);
    console.log(`  IMAP: ${account.imap_host}:${account.imap_port}`);
    console.log(`  SSL: ${account.imap_use_ssl ? '✓ Yes' : '✗ No'}`);
    console.log(`  Username: ${account.imap_username || '(not set)'}`);
    console.log(`  Password: ${account.imap_password ? '✓ Set' : '✗ Not set'}`);
    console.log(`  Created: ${account.created_at}`);
    console.log('');
  });

  // Sprawdź aktywne konta
  const { data: activeAccounts, error: activeError } = await supabase
    .from('employee_email_accounts')
    .select('*')
    .eq('is_active', true);

  if (activeError) {
    console.error('❌ Error fetching active accounts:', activeError.message);
    return;
  }

  console.log(`Active accounts: ${activeAccounts?.length || 0}\n`);

  if (!activeAccounts || activeAccounts.length === 0) {
    console.log('❌ No ACTIVE email accounts found!');
    console.log('\nPossible solutions:');
    console.log('  1. Check if "is_active" column is set to TRUE in database');
    console.log('  2. Make sure you saved the account after adding it in CRM');
    console.log('  3. Check RLS policies - worker uses SERVICE_ROLE_KEY\n');

    console.log('Run this SQL in Supabase to activate all accounts:');
    console.log('  UPDATE employee_email_accounts SET is_active = true;\n');
  } else {
    console.log('✅ Found active accounts ready for sync!\n');
    activeAccounts.forEach((account) => {
      console.log(`  ✓ ${account.email_address}`);
    });
    console.log('');
  }
}

checkAccounts().catch(console.error);
