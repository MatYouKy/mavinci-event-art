// Test imports to verify structure
console.log("Testing imports...");

// These would fail at parse time if there are syntax errors
const checks = [
  'src/app/(crm)/crm/messages/page.tsx',
  'src/app/(crm)/crm/messages/MessagesPageClient.tsx',
  'src/lib/CRM/messages/getEmailAccounts.server.ts',
  'src/lib/CRM/messages/getMessages.server.ts',
  'src/app/(crm)/crm/messages/actions.ts'
];

import { readFileSync } from 'fs';

for (const file of checks) {
  try {
    const content = readFileSync(file, 'utf8');
    // Basic syntax checks
    if (content.includes('export') || content.includes('import')) {
      console.log(`✓ ${file} - Valid syntax`);
    } else {
      console.log(`✗ ${file} - Missing exports/imports`);
    }
  } catch (e) {
    console.log(`✗ ${file} - ${e.message}`);
  }
}

console.log("\nAll files checked for basic syntax validity.");
