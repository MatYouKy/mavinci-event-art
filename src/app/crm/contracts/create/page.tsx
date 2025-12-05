'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function CreateContractPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/crm/contracts');
  }, [router]);

  return null;
}
