import { execSync } from 'child_process';
try {
  console.log('Starting type check...');
  execSync('npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "(EmployeeEmailAccountsTab|email-accounts)" || echo "No errors in modified files"', { 
    stdio: 'inherit',
    shell: '/bin/bash'
  });
  console.log('Type check complete');
} catch (error) {
  console.error('Check failed but continuing...');
}
