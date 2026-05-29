/**
 * Quick test for numberToWords function
 * Run with: node -r ts-node/register src/lib/test-number-to-words.ts
 */

import { numberToWords } from './offerTemplateHelpers';

console.log('=== Test konwersji liczb na słowa ===\n');

const testCases = [
  0,
  1,
  2,
  5,
  10,
  15,
  20,
  25,
  100,
  150,
  500,
  1000,
  1500,
  2500,
  5000,
  10000,
  15000,
  50000,
  100000,
  250000,
  500000,
  1000000,
  1500000,
  4500,
  4500.50,
  7250.75,
];

testCases.forEach((num) => {
  console.log(`${num.toLocaleString('pl-PL')} zł => ${numberToWords(num)}`);
});