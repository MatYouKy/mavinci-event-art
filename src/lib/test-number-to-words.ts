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

console.log('\n=== Przykłady dla szablonów ===\n');

console.log('Budżet: 4500 zł');
console.log('Budżet słownie:', numberToWords(4500));
console.log('');

console.log('Zadatek: 2250 zł');
console.log('Zadatek słownie:', numberToWords(2250));
console.log('');

console.log('Kwota: 15750 zł');
console.log('Kwota słownie:', numberToWords(15750));
