// app/oferta/konferencje/CityLocalIntroServer.tsx
import React from 'react';

type CityCases = {
  nominative: string;
  genitive: string;
  dative: string;
  accusative: string;
  instrumental: string;
  locative: string;
  vocative: string;
};

export default function CityLocalIntroServer({
  cityName,
  citySlug,
  cityCases,
}: {
  cityName: string;
  citySlug: string;
  cityCases: CityCases;
}) {
  // To jest “local layer” – ma być REALNIE inny per miasto (miasto w odmianie + 2 akapity)
  return (
    <section className="px-6 pt-6">
      <div className="mx-auto max-w-7xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 md:p-10">
        <h2 className="text-2xl font-light text-[#e5e4e2] md:text-3xl">
          Obsługa konferencji w {cityCases.locative} — technika AV, multimedia i streaming
        </h2>

        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <p className="text-sm leading-6 text-[#e5e4e2]/70">
            Realizujemy konferencje w {cityCases.locative} i okolicach: nagłośnienie prelegentów, mikrofony
            wieloczęstotliwościowe, ekrany LED/projekcje, realizację wideo i streaming. Działamy kompleksowo —
            od projektu technicznego po realizację na miejscu.
          </p>

          <p className="text-sm leading-6 text-[#e5e4e2]/70">
            Jeśli planujesz wydarzenie biznesowe w {cityCases.locative}, przygotujemy wycenę i dobierzemy sprzęt
            do sali, liczby uczestników i agendy. Zobacz także pełną ofertę konferencyjną oraz realizacje.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/oferta/konferencje"
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            Pełna oferta konferencji
          </a>
          <a
            href={`/#kontakt`}
            className="rounded-lg border border-[#d3bb73] px-4 py-2 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            Zapytaj o wycenę
          </a>
          <a
            href={`/oferta/konferencje/${citySlug}#realizacje`}
            className="rounded-lg border border-[#d3bb73]/40 px-4 py-2 text-sm font-medium text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10"
          >
            Realizacje w {cityCases.locative}
          </a>
        </div>
      </div>
    </section>
  );
}