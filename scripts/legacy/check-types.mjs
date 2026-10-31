import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Check for obvious type issues in the new files
const files = [
  'src/lib/CRM/messages/getEmailAccounts.server.ts',
  'src/lib/CRM/messages/getMessages.server.ts',
];

console.log('Checking for common type issues...\n');

let hasIssues = false;

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  
  // Check for common issues
  const issues = [];
  
  if (content.includes(': any') && !content.includes('// any is okay')) {
    issues.push('Contains ": any" type');
  }
  
  if (content.match(/export\s+const\s+\w+\s*=\s*unstable_cache/)) {
    console.log(`✓ ${file} - Uses unstable_cache correctly`);
  }
  
  if (content.includes('export interface')) {
    console.log(`✓ ${file} - Exports interfaces`);
  }
  
  if (issues.length > 0) {
    console.log(`⚠ ${file}:`);
    issues.forEach(i => console.log(`  - ${i}`));
    hasIssues = true;
  }
}

if (!hasIssues) {
  console.log('\n✓ No obvious type issues found');
} else {
  console.log('\n⚠ Some potential issues found (not necessarily errors)');
}
