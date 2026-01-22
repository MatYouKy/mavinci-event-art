'use client';

import { useSearchParams } from 'next/navigation';
import { CheckCircle } from 'lucide-react';
import { Suspense } from 'react';

function SuccessContent() {
  const searchParams = useSearchParams();
  const eventName = searchParams.get('event');
  const type = searchParams.get('type') || 'accepted';

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33] p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-6 flex justify-center">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>

          <h1 className="mb-4 text-center text-2xl font-semibold text-[#e5e4e2]">
            {type === 'accepted' ? 'Zaproszenie zaakceptowane!' : 'Zaproszenie odrzucone'}
          </h1>

          <div className="mb-6 text-center text-[#e5e4e2]/80">
            {type === 'accepted' ? (
              <>
                <p className="mb-4">
                  {eventName ? (
                    <>
                      Zaakceptowałeś zaproszenie do wydarzenia <strong className="text-[#d3bb73]">{eventName}</strong>.
                    </>
                  ) : (
                    'Zaproszenie zostało zaakceptowane pomyślnie.'
                  )}
                </p>
                <p className="text-sm text-[#e5e4e2]/60">
                  Wkrótce otrzymasz więcej informacji na temat szczegółów wydarzenia.
                </p>
              </>
            ) : (
              <p>
                {eventName ? (
                  <>
                    Odrzuciłeś zaproszenie do wydarzenia <strong className="text-[#d3bb73]">{eventName}</strong>.
                  </>
                ) : (
                  'Zaproszenie zostało odrzucone.'
                )}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <a
              href="https://mavinci.pl"
              className="block w-full rounded-lg bg-[#d3bb73] px-6 py-3 text-center font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
            >
              Przejdź do strony głównej
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvitationSuccessPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0f1119] to-[#1c1f33]" />}>
      <SuccessContent />
    </Suspense>
  );
}
