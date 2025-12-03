/**
 * Helper functions for processing offer templates and generating documents
 */

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
 * Generates an HTML table from offer items
 * @param items - Array of offer items
 * @returns HTML string with formatted table
 */
export function generateOfferItemsTable(items: OfferItem[]): string {
  if (!items || items.length === 0) {
    return '<p style="color: #888; font-style: italic;">Brak pozycji w ofercie</p>';
  }

  const calculateSubtotal = (quantity: number, unitPrice: number): number => {
    return quantity * unitPrice;
  };

  const calculateDiscountAmount = (subtotal: number, discountPercent: number | null): number => {
    if (!discountPercent) return 0;
    return subtotal * (discountPercent / 100);
  };

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: 'PLN',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  let tableHTML = `
<table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-family: Arial, sans-serif;">
  <thead>
    <tr style="background-color: #d3bb73; color: #1c1f33;">
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: left; font-weight: 600;">Lp.</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: left; font-weight: 600;">Nazwa</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: left; font-weight: 600;">Opis</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: center; font-weight: 600;">Ilość</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: center; font-weight: 600;">Jedn.</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: right; font-weight: 600;">Cena jedn.</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: right; font-weight: 600;">Rabat</th>
      <th style="border: 1px solid #999; padding: 10px 8px; text-align: right; font-weight: 600;">Wartość</th>
    </tr>
  </thead>
  <tbody>
`;

  let totalSum = 0;

  items.forEach((item, index) => {
    const subtotal = calculateSubtotal(item.quantity, item.unit_price);
    const discountAmount = calculateDiscountAmount(subtotal, item.discount_percent);
    const itemTotal = subtotal - discountAmount;
    totalSum += itemTotal;

    const rowBg = index % 2 === 0 ? '#f9f9f9' : '#ffffff';

    tableHTML += `
    <tr style="background-color: ${rowBg};">
      <td style="border: 1px solid #ddd; padding: 8px; text-align: left;">${index + 1}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: 500;">${item.name}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 0.9em; color: #555;">${item.description || '-'}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.quantity}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${item.unit}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${formatCurrency(item.unit_price)}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">${item.discount_percent ? `${item.discount_percent}%` : '-'}</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: 600;">${formatCurrency(itemTotal)}</td>
    </tr>
`;
  });

  tableHTML += `
  </tbody>
  <tfoot>
    <tr style="background-color: #d3bb73; color: #1c1f33; font-weight: 700;">
      <td colspan="7" style="border: 1px solid #999; padding: 10px 8px; text-align: right; font-size: 1.1em;">SUMA:</td>
      <td style="border: 1px solid #999; padding: 10px 8px; text-align: right; font-size: 1.1em;">${formatCurrency(totalSum)}</td>
    </tr>
  </tfoot>
</table>
`;

  return tableHTML;
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
