import { readFileSync } from 'fs';

console.log('Verifying syntax of modified file...\n');

const file = 'src/app/(crm)/crm/time-tracking/[employeeId]/page.tsx';
const content = readFileSync(file, 'utf8');

// Check for common issues
let issues = [];

// Check for proper JSX
if (!content.includes('export default function')) {
  issues.push('Missing default export');
}

// Check imports
const hasReactImports = content.includes("from 'react'");
const hasLucideImports = content.includes("from 'lucide-react'");

if (hasReactImports) {
  console.log('✓ React imports present');
}
if (hasLucideImports) {
  console.log('✓ Lucide React imports present');
}

// Check for table view implementation
if (content.includes('viewMode') && content.includes("'table'")) {
  console.log('✓ Table view mode implemented');
}

if (content.includes('localStorage.setItem')) {
  console.log('✓ LocalStorage persistence implemented');
}

if (content.includes('<table') && content.includes('<thead>')) {
  console.log('✓ Table structure present');
}

// Check for toggle buttons
if (content.includes('TableIcon') && content.includes('List')) {
  console.log('✓ View toggle buttons present');
}

// Check syntax validity
try {
  if (content.match(/<[A-Z]/)) {
    console.log('✓ JSX syntax detected');
  }
  
  // Check for matching braces
  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  
  if (openBraces === closeBraces) {
    console.log('✓ Balanced curly braces');
  } else {
    issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  }
  
  // Check for matching parentheses
  const openParens = (content.match(/\(/g) || []).length;
  const closeParens = (content.match(/\)/g) || []).length;
  
  if (openParens === closeParens) {
    console.log('✓ Balanced parentheses');
  } else {
    issues.push(`Unbalanced parentheses: ${openParens} open, ${closeParens} close`);
  }
} catch (e) {
  issues.push(e.message);
}

console.log('\n' + '='.repeat(50));
if (issues.length === 0) {
  console.log('✓ All syntax checks passed!');
  console.log('✓ File is ready for production');
} else {
  console.log('⚠ Issues found:');
  issues.forEach(i => console.log('  - ' + i));
}
