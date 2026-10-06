'use client';

import CommissionSettlementsPanel from '@/components/crm/commissions/CommissionSettlementsPanel';

type AccountType = 'employee' | 'contact' | 'organization';

/** Compatibility wrapper: all account views use the same payout ledger and balances. */
export default function CommissionAccountCard({
  accountType,
  accountId,
  className = '',
}: {
  accountType: AccountType;
  accountId: string;
  className?: string;
}) {
  return <div className={className}>
    <CommissionSettlementsPanel mode="crm" accountType={accountType} accountId={accountId} />
  </div>;
}
