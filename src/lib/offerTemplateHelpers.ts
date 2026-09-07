/**
 * Helper functions for processing offer templates and generating documents
 */

import { DecisionMaker } from '@/components/crm/events/calculations/EventContractTab';

/**
 * Converts a number to Polish words
 * @param amount - Amount to convert
 * @returns Amount in words (e.g., "pięć tysięcy złotych")
 */
export function numberToWords(amount: number): string {
  if (!amount || amount === 0) return 'zero złotych';

  const ones = [
    '',
    'jeden',
    'dwa',
    'trzy',
    'cztery',
    'pięć',
    'sześć',
    'siedem',
    'osiem',
    'dziewięć',
  ];
  const teens = [
    'dziesięć',
    'jedenaście',
    'dwanaście',
    'trzynaście',
    'czternaście',
    'piętnaście',
    'szesnaście',
    'siedemnaście',
    'osiemnaście',
    'dziewiętnaście',
  ];
  const tens = [
    '',
    '',
    'dwadzieścia',
    'trzydzieści',
    'czterdzieści',
    'pięćdziesiąt',
    'sześćdziesiąt',
    'siedemdziesiąt',
    'osiemdziesiąt',
    'dziewięćdziesiąt',
  ];
  const hundreds = [
    '',
    'sto',
    'dwieście',
    'trzysta',
    'czterysta',
    'pięćset',
    'sześćset',
    'siedemset',
    'osiemset',
    'dziewięćset',
  ];

  const convertGroup = (num: number): string => {
    let result = '';

    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const o = num % 10;

    if (h > 0) result += hundreds[h] + ' ';

    if (t === 1) {
      result += teens[o] + ' ';
    } else {
      if (t > 1) result += tens[t] + ' ';
      if (o > 0) result += ones[o] + ' ';
    }

    return result.trim();
  };

  const totalCents = Math.round(amount * 100);
  const wholeAmount = Math.floor(totalCents / 100);
  const cents = totalCents % 100;
  let intAmount = wholeAmount;

  let result = '';

  if (intAmount >= 1000000) {
    const millions = Math.floor(intAmount / 1000000);
    result += convertGroup(millions);
    if (millions === 1) result += ' milion ';
    else if (millions % 10 >= 2 && millions % 10 <= 4 && (millions % 100 < 10 || millions % 100 >= 20))
      result += ' miliony ';
    else result += ' milionów ';
    intAmount %= 1000000;
  }

  if (intAmount >= 1000) {
    const thousands = Math.floor(intAmount / 1000);
    result += convertGroup(thousands);
    if (thousands === 1) result += ' tysiąc ';
    else if (thousands % 10 >= 2 && thousands % 10 <= 4 && (thousands % 100 < 10 || thousands % 100 >= 20))
      result += ' tysiące ';
    else result += ' tysięcy ';
    intAmount %= 1000;
  }

  if (intAmount > 0) {
    result += convertGroup(intAmount) + ' ';
  }

  if (wholeAmount === 1) {
    result += 'złoty';
  } else if (wholeAmount % 10 >= 2 && wholeAmount % 10 <= 4 && (wholeAmount % 100 < 10 || wholeAmount % 100 >= 20)) {
    result += 'złote';
  } else {
    result += 'złotych';
  }

  if (cents > 0) {
    result += ` ${convertGroup(cents)} `;
    if (cents === 1) {
      result += 'grosz';
    } else if (cents % 10 >= 2 && cents % 10 <= 4 && (cents % 100 < 10 || cents % 100 >= 20)) {
      result += 'grosze';
    } else {
      result += 'groszy';
    }
  }

  return result.trim();
}

interface OfferItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number | null;
  total: number;
}

/**
 * Generates an HTML bullet list from offer items
 * @param items - Array of offer items
 * @returns HTML string with formatted list
 */
export function generateOfferItemsTable(items: OfferItem[]): string {
  if (!items || items.length === 0) {
    return '<span data-contract-offer-items="true" style="font:inherit;color:#888;font-style:italic;">Brak pozycji w ofercie</span>';
  }

  const escapeItemText = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const formatQuantity = (value: unknown) => {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 1) return '';
    return `${quantity.toLocaleString('pl-PL', { maximumFractionDigits: 3 })}x `;
  };

  const listItems = items.map((item) => {
    const label = `${formatQuantity(item.quantity)}${escapeItemText(item.name || 'Produkt')}`;
    return `<span style="display:block;font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;margin:0 0 2pt;padding-left:1.2em;text-indent:-1.2em;"><span aria-hidden="true">•</span> <strong style="font-family:inherit;font-size:inherit;line-height:inherit;">${label}</strong></span>`;
  }).join('');

  // Używamy wyłącznie elementów inline. Placeholder często znajduje się w <p>
  // albo <font>; wstawienie tam <ul> tworzy niepoprawny HTML, który przeglądarka
  // przenosi poza akapit i nadaje mu domyślną, większą czcionkę.
  return `<span data-contract-offer-items="true" style="font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;color:inherit;">${listItems}</span>`;
}

export function generateDecisionMakersListTable(items: DecisionMaker[]): string {
  if (!items || items.length === 0) {
    return '<span data-contract-decision-makers="true" style="font:inherit;color:#888;font-style:italic;">Brak osób decyzyjnych</span>';
  }

  const escapeItemText = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const listItems = items
    .map((item) => {
      const name = escapeItemText(
        item.contact.full_name ||
          [item.contact.first_name, item.contact.last_name].filter(Boolean).join(' ') ||
          'Osoba decyzyjna',
      );
      return `<span style="display:block;font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;margin:0 0 2pt;padding-left:1.2em;text-indent:-1.2em;"><span aria-hidden="true">•</span> <strong style="font-family:inherit;font-size:inherit;line-height:inherit;">${name}</strong></span>`;
    })
    .join('');

  // Ten sam bezpieczny format co OFFER_ITEMS_TABLE. Placeholder może znajdować
  // się wewnątrz <p> lub <li>, dlatego nie wstawiamy w nim blokowego <ul>.
  return `<span data-contract-decision-makers="true" style="font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;color:inherit;">${listItems}</span>`;
}

/**
 * Replaces variable placeholders in template content with actual values
 * @param template - Template content with {{variable_name}} placeholders
 * @param variables - Map of variable names to their values
 * @returns Content with all placeholders replaced
 */
export function replaceVariables(
  template: string,
  variables: Record<string, string>
): string {
  if (!template) return '';

  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const placeholder = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g');
    result = result.replace(placeholder, value || '');
  }

  return result;
}

/**
 * Replaces the {{OFFER_ITEMS_TABLE}} placeholder in template content
 * @param content - Template content with placeholders
 * @param items - Array of offer items
 * @returns Content with placeholder replaced by HTML table
 */
export function replaceOfferItemsTablePlaceholder(
  content: string,
  items: OfferItem[]
): string {
  const tableHTML = generateOfferItemsTable(items);
  return content.replace(/\{\{OFFER_ITEMS_TABLE\}\}/g, tableHTML);
}

/**
 * Fetches offer items from database
 * @param offerId - Offer ID
 * @returns Array of offer items
 */
export async function fetchOfferItems(offerId: string): Promise<OfferItem[]> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase
    .from('offer_items')
    .select('*')
    .eq('offer_id', offerId)
    .order('display_order', { ascending: true });

  if (error) {
    console.error('Error fetching offer items:', error);
    return [];
  }

  return data || [];
}
