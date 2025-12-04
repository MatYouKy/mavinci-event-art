/**
 * Helper functions for processing offer templates and generating documents
 */

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

  let intAmount = Math.floor(amount);
  const cents = Math.round((amount - intAmount) * 100);

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

  if (intAmount === 1) {
    result += 'złoty';
  } else if (intAmount % 10 >= 2 && intAmount % 10 <= 4 && (intAmount % 100 < 10 || intAmount % 100 >= 20)) {
    result += 'złote';
  } else {
    result += 'złotych';
  }

  if (cents > 0) {
    result += ' ' + cents.toString().padStart(2, '0') + '/100';
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
    return '<p style="color: #888; font-style: italic;">Brak pozycji w ofercie</p>';
  }

  const listItems = items.map((item) => {
    let itemHTML = `<li><strong>${item.name}</strong>`;

    // if (item.description) {
    //   itemHTML += `<br/><span style="margin-left: 0; font-size: 10pt; color: #333;">${item.description}</span>`;
    // }

    itemHTML += '</li>';
    return itemHTML;
  }).join('\n');

  return `<ul style="padding-left: 10mm; list-style-type: disc; font-family: Arial, sans-serif; font-size: 10pt;">
${listItems}
</ul>`;
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
