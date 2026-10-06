/** Scale the whole order, never the advance documents being settled. */
export function scaleFinalOrderNet<T extends { quantity: number; price_net: number }>(items: T[], target: number): T[] {
  const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
  if (!Number.isFinite(target) || target <= 0 || !items.length) throw new Error('Podaj dodatnią pełną wartość zamówienia netto.');
  if (items.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.price_net) || item.price_net < 0)) throw new Error('Najpierw popraw ilości i ceny pozycji zamówienia.');
  const total = items.reduce((sum, item) => sum + cents(item.quantity * item.price_net), 0);
  if (total <= 0 && items.length > 1) throw new Error('Uzupełnij ceny pozycji przed proporcjonalnym przeliczeniem zamówienia.');
  const targetCents = cents(target);
  let distributed = 0;
  let cumulativeWeight = 0;
  const result = items.map((item, index) => {
    cumulativeWeight += cents(item.quantity * item.price_net);
    const part = index === items.length - 1 ? targetCents - distributed : Math.round(targetCents * cumulativeWeight / total) - distributed;
    distributed += part;
    return { ...item, price_net: Math.round(part / 100 / item.quantity * 10000) / 10000 };
  });
  if (result.some(item=>item.price_net<0) || result.reduce((sum,item)=>sum+cents(item.quantity*item.price_net),0)!==targetCents) throw new Error('Nie można dokładnie rozdzielić tej kwoty przy obecnych ilościach. Popraw ceny poszczególnych pozycji.');
  return result;
}
export function orderNetFromAdvancePercent(net: number, percent: number): number {
  if (!Number.isFinite(net) || net <= 0 || !Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('Podaj procent od ponad 0 do 100% dla sumy wybranych zaliczek.');
  return Math.round((net * 100 / percent + Number.EPSILON) * 100) / 100;
}
