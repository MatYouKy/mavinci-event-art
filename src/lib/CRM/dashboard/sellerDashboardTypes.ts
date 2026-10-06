export type SellerMoneyTotals = {
  currency: string;
  invoiced_events: number;
  invoiced_gross: number;
  paid_gross: number;
  outstanding_gross: number;
  overdue_gross: number;
};

export type SellerFinancialReport = {
  scope: 'own_sales';
  basis: 'event_date';
  date_from: string;
  date_to: string;
  totals: Omit<SellerMoneyTotals, 'currency'> & { sold_events: number };
  currency_totals: SellerMoneyTotals[];
  months: {
    key: string;
    label: string;
    currency: string;
    events: number;
    invoiced_gross: number;
    paid_gross: number;
  }[];
  events: {
    id: string;
    name: string;
    event_date: string;
    status: string;
    currency: string;
    invoiced_gross: number;
    paid_gross: number;
    outstanding_gross: number;
  }[];
};
