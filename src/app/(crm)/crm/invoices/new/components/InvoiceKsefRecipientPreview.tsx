'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';

type RecipientRecord = {
  id: string;
  name: string;
  nip: string | null;
  ksef_internal_id: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
};

/** Preview of a new document only; issued documents use their persisted recipient snapshot. */
export default function InvoiceKsefRecipientPreview({
  organizationId,
  buyerOrganizationId,
}: {
  organizationId: string;
  buyerOrganizationId: string;
}) {
  const [result, setResult] = useState<{
    organizationId: string;
    data: RecipientRecord | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setResult(null);
    void (async () => {
      try {
        const { data, error } = await (supabase.from as any)('organizations')
          .select('id, name, nip, ksef_internal_id, address, postal_code, city')
          .eq('id', organizationId).maybeSingle();
        if (active) setResult({ organizationId, data: data ?? null, error: Boolean(error || !data) });
      } catch {
        if (active) setResult({ organizationId, data: null, error: true });
      }
    })();
    return () => { active = false; };
  }, [organizationId]);

  if (!result || result.organizationId !== organizationId) {
    return <p className="text-sm text-[#e5e4e2]/60" role="status">Odczytywanie odbiorcy faktury…</p>;
  }
  if (result.error || !result.data) {
    return <p className="rounded-xl bg-[#d3bb73]/10 p-4 text-sm text-[#d3bb73]" role="alert">
      Nie udało się odczytać odbiorcy wydarzenia. Sprawdź jego dane przed wystawieniem faktury.
    </p>;
  }
  const recipient = result.data;
  if (recipient.id === buyerOrganizationId && !recipient.ksef_internal_id?.trim()) return null;

  return (
    <section className="rounded-xl bg-[#d3bb73]/5 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-[#d3bb73]">Osobny odbiorca na fakturze i w KSeF</h3>
        <Link href={`/crm/contacts/${recipient.id}`} target="_blank" rel="noopener noreferrer"
          className="text-xs text-[#d3bb73] underline underline-offset-4">
          Dane odbiorcy
        </Link>
      </div>
      <p className="mt-2 font-medium text-[#e5e4e2]">{recipient.name}</p>
      <p className="mt-1 text-[#e5e4e2]/65">
        {[recipient.address, [recipient.postal_code, recipient.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
      </p>
      {recipient.nip && <p className="mt-1 text-[#e5e4e2]/65">NIP: {recipient.nip}</p>}
      {recipient.ksef_internal_id && (
        <p className="mt-2 text-[#d3bb73]">Numer identyfikacji wewnętrznej KSeF: {recipient.ksef_internal_id}</p>
      )}
      <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/55">
        Odbiorca nie zastępuje nabywcy. Jego dane zostaną zapisane przy fakturze; późniejsza edycja kontaktu nie zmieni wystawionego dokumentu.
      </p>
    </section>
  );
}
