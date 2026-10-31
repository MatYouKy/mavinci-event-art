import 'server-only';
import Link from 'next/link';
import { OLSZTYN_THEMED_PARTY_PATH, THEMED_PARTY_PATH } from '@/lib/SEO/themedPartyContent';

export default function ThemedPartyOlsztynLink({ portfolio = false }: { portfolio?: boolean }) {
  return <section className="mx-auto max-w-7xl px-5 py-12 text-[#e5e4e2] sm:px-6">
    <div className="rounded-2xl bg-[#291320] p-6 sm:p-8">
      <h2 className="text-2xl font-light uppercase">{portfolio ? 'Zaplanuj podobny wieczór dla swojej firmy' : 'Imprezy tematyczne dla firm w Olsztynie'}</h2>
      <p className="mt-4 max-w-3xl leading-7 text-white/75">{portfolio ? 'Ten projekt pokazuje możliwości oprawy wydarzenia. Dla Twojej firmy dobierzemy motyw, muzykę, program i technikę do miejsca oraz uczestników.' : 'Szukasz pomysłu na integrację tematyczną lub wieczór po konferencji? Poznaj motywy, przykłady realizacji i sposób organizacji wydarzeń w Olsztynie oraz okolicach.'}</p>
      <div className="mt-5 flex flex-wrap gap-x-7 gap-y-2">
        <Link href={OLSZTYN_THEMED_PARTY_PATH} className="inline-flex min-h-11 items-center text-[#d3bb73] underline underline-offset-4">Wieczory i imprezy tematyczne — Olsztyn</Link>
        <Link href={`${THEMED_PARTY_PATH}/lokalizacje`} className="inline-flex min-h-11 items-center text-white/75 underline underline-offset-4">Sprawdź inne lokalizacje</Link>
      </div>
    </div>
  </section>;
}
