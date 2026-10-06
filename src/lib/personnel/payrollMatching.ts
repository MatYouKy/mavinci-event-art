export type PersonnelPaymentBreakdown = {
  id: string;
  amount: number;
  paymentType: string;
  totalAmount: number | null;
  netConfirmed: boolean;
  linkedTransactionId: string | null;
};

export function salaryPaymentNeedsNetConfirmation(payment: PersonnelPaymentBreakdown) {
  return payment.paymentType === 'salary'
    && !payment.netConfirmed
    && !payment.linkedTransactionId;
}

/** Local, permission-scoped payroll metadata. Never included in the AI request. */
export async function loadPersonnelPaymentBreakdowns(
  supabase: any,
  paymentIds: string[],
): Promise<Map<string, PersonnelPaymentBreakdown>> {
  const ids = [...new Set(paymentIds.filter(Boolean))];
  const payments = new Map<string, PersonnelPaymentBreakdown>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await supabase
      .from('personnel_contract_payments')
      .select('id,amount,payment_type,payroll_total_amount,payroll_net_confirmed,bank_transaction_id')
      .in('id', ids.slice(offset, offset + 100));
    if (error) throw error;
    for (const payment of data || []) {
      payments.set(payment.id, {
        id: payment.id,
        amount: Math.abs(Number(payment.amount || 0)),
        paymentType: payment.payment_type || 'other',
        totalAmount: payment.payroll_total_amount == null ? null : Number(payment.payroll_total_amount),
        netConfirmed: payment.payroll_net_confirmed === true,
        linkedTransactionId: payment.bank_transaction_id || null,
      });
    }
  }
  return payments;
}
