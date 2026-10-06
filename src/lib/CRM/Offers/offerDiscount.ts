import { roundMoney } from './offerTotals';
export type OfferDiscountMode = 'amount' | 'percent' | 'target';
export function calculateOfferDiscount(listNet: number, taxPercent: number, mode: OfferDiscountMode, input: string) {
  const value = input.trim() === '' ? 0 : Number(input.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(listNet) || listNet < 0 ||
    (mode === 'percent' ? value > 100 : value > listNet)) return null;
  const discount = roundMoney(mode === 'percent' ? listNet * value / 100 : mode === 'target' ? listNet - value : value);
  const net = roundMoney(listNet - discount);
  const tax = roundMoney(net * taxPercent / 100);
  return { subtotal: listNet, discount_amount: discount, discount_percent: listNet > 0 ? discount / listNet * 100 : 0,
    tax_amount: tax, total_amount: roundMoney(net + tax), net };
}
