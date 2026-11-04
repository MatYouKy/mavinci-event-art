/** Kwota słownie po polsku, jak na fakturach: „piętnaście tysięcy sześćset sześćdziesiąt siedem złotych 20/100”. */

const UNITS = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

/** [1, 2–4, 5+] — odmiana rzeczowników po liczebniku. */
type Forms = readonly [string, string, string];

const SCALES: Forms[] = [
  ['', '', ''],
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['milion', 'miliony', 'milionów'],
  ['miliard', 'miliardy', 'miliardów'],
];

const CURRENCIES: Record<string, Forms> = {
  PLN: ['złoty', 'złote', 'złotych'],
  EUR: ['euro', 'euro', 'euro'],
  USD: ['dolar', 'dolary', 'dolarów'],
  GBP: ['funt', 'funty', 'funtów'],
  CHF: ['frank', 'franki', 'franków'],
  CZK: ['korona czeska', 'korony czeskie', 'koron czeskich'],
};

function pick(count: number, forms: Forms) {
  if (count === 1) return forms[0];
  const mod10 = count % 10;
  const mod100 = count % 100;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
}

function triple(value: number) {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const words = [HUNDREDS[hundreds]];
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else words.push(TENS[Math.floor(rest / 10)], UNITS[rest % 10]);
  return words.filter(Boolean).join(' ');
}

export function integerInWordsPl(value: number): string {
  let number = Math.floor(Math.abs(value));
  if (number === 0) return 'zero';
  const parts: string[] = [];
  let scale = 0;
  while (number > 0 && scale < SCALES.length) {
    const chunk = number % 1000;
    if (chunk > 0) {
      // „tysiąc”, nie „jeden tysiąc”.
      const words = scale > 0 && chunk === 1 ? '' : triple(chunk);
      parts.unshift([words, scale > 0 ? pick(chunk, SCALES[scale]) : ''].filter(Boolean).join(' '));
    }
    number = Math.floor(number / 1000);
    scale += 1;
  }
  return parts.join(' ');
}

export function amountInWordsPl(amount: number, currencyCode = 'PLN'): string {
  const cents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  const code = (currencyCode || 'PLN').toUpperCase();
  const forms = CURRENCIES[code];
  const sign = Number(amount) < 0 ? 'minus ' : '';
  const words = integerInWordsPl(whole);
  return forms
    ? `${sign}${words} ${pick(whole, forms)} ${fraction}/100`
    : `${sign}${words} ${fraction}/100 ${code}`;
}
