'use client';

import { useSearchParams } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { Suspense } from 'react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const message = searchParams.get('message') || 'Wystąpił błąd podczas przetwarzania zaproszenia';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33] p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-6 flex justify-center">
            <XCircle className="h-16 w-16 text-red-500" />
          </div>

          <h1 className="mb-4 text-center text-2xl font-semibold text-[#e5e4e2]">
            Wystąpił problem
          </h1>

          <div className="mb-6 text-center">
            <p className="text-red-400">{message}</p>
          </div>

          <div className="space-y-3">
            <a
              href="https://mavinci.pl"
              className="block w-full rounded-lg bg-[#d3bb73]/20 px-6 py-3 text-center font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/30"
            >
              Przejdź do strony głównej
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvitationErrorPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33]" />}>
      <ErrorContent />
    </Suspense>
  );
}
