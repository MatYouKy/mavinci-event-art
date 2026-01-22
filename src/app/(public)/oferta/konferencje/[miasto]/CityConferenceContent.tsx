type Props = {
  cityName: string;
};

export default function CityConferenceContent({ cityName }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1119] px-6 py-2">
      <div className="w-full max-w-4xl">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-12 grid max-w-3xl gap-6 md:grid-cols-3">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <div className="mb-2 text-3xl font-light text-[#d3bb73]">50-5000+</div>
              <div className="text-sm text-[#e5e4e2]/60">uczestników</div>
            </div>
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <div className="mb-2 text-3xl font-light text-[#d3bb73]">15+</div>
              <div className="text-sm text-[#e5e4e2]/60">lat doświadczenia</div>
            </div>
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <div className="mb-2 text-3xl font-light text-[#d3bb73]">3700+</div>
              <div className="text-sm text-[#e5e4e2]/60">zrealizowanych eventów</div>
            </div>
          </div>
        </div>

        <div className="mb-12 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Nagłośnienie i Audio</h3>
            <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
              <li>• Systemy line-array premium</li>
              <li>• Mikrofony wieloczęstotliwościowe</li>
              <li>• Monitory sceniczne</li>
              <li>• Realizacja dźwięku 5.1</li>
            </ul>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Multimedia i Wizualizacje</h3>
            <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
              <li>• Ekrany LED indoor/outdoor</li>
              <li>• Projekcje HD/4K</li>
              <li>• Kamery wielokamerowe</li>
              <li>• Streaming FullHD/4K</li>
            </ul>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Oświetlenie</h3>
            <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
              <li>• Oświetlenie konferencyjne</li>
              <li>• Oświetlenie sceniczne LED</li>
              <li>• Sterowanie DMX</li>
              <li>• Efekty specjalne</li>
            </ul>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h3 className="mb-3 text-lg font-medium text-[#d3bb73]">Scena i Konstrukcje</h3>
            <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
              <li>• Sceny modułowe</li>
              <li>• Konstrukcje kratowe</li>
              <li>• Blackbox i kurtyny</li>
              <li>• Bramy wejściowe</li>
            </ul>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#d3bb73]/10 via-[#d3bb73]/5 to-transparent p-2 text-center md:p-8 lg:p-12">
          <div className="absolute right-0 top-0 -z-10 h-64 w-64 rounded-full bg-[#d3bb73]/5 blur-3xl" />
          <div className="absolute bottom-0 left-0 -z-10 h-48 w-48 rounded-full bg-[#d3bb73]/5 blur-3xl" />

          <h2 className="mb-4 p-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Gotowy na profesjonalną obsługę?
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">
            Zobacz pełną ofertę obsługi konferencji, pakiety usług i nasze realizacje
          </p>

          <div className="flex w-full flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
            <a
              href="/oferta/konferencje"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-base font-medium text-[#1c1f33] shadow-md transition-all hover:scale-105 hover:bg-[#d3bb73]/90 hover:shadow-xl sm:w-auto sm:gap-3 sm:px-8 sm:py-4 sm:text-lg sm:shadow-lg"
            >
              Zobacz pełną ofertę
              <span className="h-4 w-4 transition-transform group-hover:translate-x-1 sm:h-5 sm:w-5">→</span>
            </a>

            <a
              href="/#kontakt"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-[#d3bb73] bg-transparent px-6 py-3 text-base font-medium text-[#d3bb73] transition-all hover:bg-[#d3bb73]/10 sm:w-auto sm:px-8 sm:py-4 sm:text-lg"
            >
              Skontaktuj się
            </a>
          </div>

          <div className="mt-12 border-t border-[#d3bb73]/20 pb-4 pt-8">
            <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-[#e5e4e2]/60">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                Bezpłatna wycena
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                Profesjonalny sprzęt
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                Doświadczony zespół
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                Realizacje w całej Polsce
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 space-y-1 text-center text-xs text-[#e5e4e2]/40">
          <p>
            Obsługa konferencji {cityName} | Nagłośnienie konferencyjne {cityName} | Technika AV {cityName} | Streaming konferencji {cityName}
          </p>
          <p>
            Realizacja live {cityName} | Multimedia konferencje {cityName} | Wynajem sprzętu eventowego {cityName}
          </p>
          <p>
            Profesjonalna obsługa eventów {cityName} | Konferencje biznesowe {cityName} | Eventy firmowe {cityName}
          </p>
        </div>
      </div>
    </div>
  );
}