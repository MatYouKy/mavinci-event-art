'use client';

import { Loader2, QrCode } from 'lucide-react';
import { useSellerPortalContext } from '@/lib/seller/portal';
import SellerQrMaterials from '@/components/seller/SellerQrMaterials';

export default function SellerMaterialsPage() {
  const { context, loading, error, reload } = useSellerPortalContext();
  if (loading) return <p role="status" className="flex items-center justify-center gap-2 p-10 text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie…</p>;
  if (!context) return <div role="alert" className="space-y-3 p-10 text-center text-white/60"><p>{error || 'Brak dostępu do portalu sprzedawcy.'}</p><button type="button" onClick={() => void reload()} className="inline-flex min-h-10 items-center rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73]">Spróbuj ponownie</button></div>;
  return <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header><h1 className="flex items-center gap-3 text-2xl font-light uppercase"><QrCode className="h-6 w-6 text-[#d3bb73]" />Materiały dla hotelu</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Postaw kartę z kodem QR w recepcji, pokojach lub restauracji. Gość zeskanuje kod telefonem i wyśle zapytanie o wydarzenie — bez logowania.</p></header>
      <SellerQrMaterials context={context} />
    </div>
  </div>;
}
