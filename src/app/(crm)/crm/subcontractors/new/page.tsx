'use client';
import { useRouter } from 'next/navigation';
import SubcontractorProfileForm from '@/components/crm/subcontractors/SubcontractorProfileForm';
export default function NewSubcontractor() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-4xl p-4">
      <SubcontractorProfileForm
        onCancel={() => router.push('/crm/subcontractors')}
        onSaved={(s) =>
          router.push(
            `/crm/subcontractors/${s.id}${s.default_settlement_type === 'civil_contract' ? '?tab=contracts&new=1' : '?tab=services'}`,
          )
        }
      />
    </main>
  );
}
