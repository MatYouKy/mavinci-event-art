import React from 'react';
import {
  Music,
  Mic2,
  Lightbulb,
  Gauge,
  Users,
  Award,
  Phone,
  Mail,
  MapPin,
} from 'lucide-react';

const TechnicalOfferBrochure = () => {
  return (
    <div className="bg-[#0f1119]">
      <style>{`
        @media print {
          .page-break {
            page-break-after: always;
            break-after: page;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
        }

        .brochure-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: #0f1119;
          position: relative;
          overflow: hidden;
        }
      `}</style>

      {/* STRONA 1 – OKŁADKA */}
      <div className="brochure-page page-break relative">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1119] via-[#0f1119] to-[#1c1f33]">
          <img
            src="https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920"
            alt="Stage"
            className="h-full w-full object-cover opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between p-16">
          <div className="flex items-center gap-3 text-white">
            <Music className="h-12 w-12 text-[#d3bb73]" strokeWidth={1.5} />
            <div>
              <h2 className="text-2xl font-light tracking-wider text-[#e5e4e2]">
                MAVINCI EVENT & ART
              </h2>
              <p className="text-sm tracking-widest text-[#d3bb73]">
                TECHNICAL EVENT SERVICES
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <h1 className="text-7xl font-bold leading-tight text-[#e5e4e2]">
              Kompleksowa
              <br />
              obsługa
              <br />
              techniczna
            </h1>
            <div className="h-1 w-32 bg-[#d3bb73]" />
            <p className="max-w-2xl text-2xl font-light leading-relaxed text-[#e5e4e2]/80">
              Scena • dźwięk • oświetlenie
              <br />
              Elegancka realizacja wydarzeń premium
            </p>
          </div>

          <div className="text-sm tracking-wider text-[#e5e4e2]/60">
            2024 / MAVINCI EVENT & ART
          </div>
        </div>
      </div>

      {/* STRONA 2 – O NAS */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#111321] via-[#0f1119] to-[#1c1f33] p-16">
        <div className="mx-auto max-w-4xl space-y-12">
          <div className="space-y-4 text-center">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">O nas</h2>
            <div className="mx-auto h-1 w-24 bg-[#d3bb73]" />
          </div>

          <div className="my-12 grid grid-cols-3 gap-8">
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#d3bb73]">
                <Award className="h-10 w-10 text-[#1c1f33]" />
              </div>
              <h3 className="text-3xl font-bold text-[#e5e4e2]">15+</h3>
              <p className="font-medium text-[#e5e4e2]/70">Lat doświadczenia</p>
            </div>
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#d3bb73]">
                <Users className="h-10 w-10 text-[#1c1f33]" />
              </div>
              <h3 className="text-3xl font-bold text-[#e5e4e2]">500+</h3>
              <p className="font-medium text-[#e5e4e2]/70">Zrealizowanych eventów</p>
            </div>
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#d3bb73]">
                <Gauge className="h-10 w-10 text-[#1c1f33]" />
              </div>
              <h3 className="text-3xl font-bold text-[#e5e4e2]">100%</h3>
              <p className="font-medium text-[#e5e4e2]/70">Zaangażowania</p>
            </div>
          </div>

          <div className="space-y-6 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/90 p-10 shadow-xl">
            <p className="text-xl leading-relaxed text-[#e5e4e2]/80">
              Jesteśmy zespołem realizatorów, techników i producentów wydarzeń.
              Łączymy doświadczenie ze świata eventów korporacyjnych, konferencji
              oraz produkcji artystycznych. Dbamy o to, by technika była
              niewidocznym, ale perfekcyjnie działającym tłem Twojego wydarzenia.
            </p>
            <p className="text-xl leading-relaxed text-[#e5e4e2]/80">
              Pracujemy w hotelach, centrach konferencyjnych, halach oraz
              nietypowych przestrzeniach. Zapewniamy profesjonalny sprzęt,
              przemyślane projekty techniczne i zespół, który rozumie
              specyfikę pracy z klientem premium.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-6">
            <img
              src="https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Konferencja"
              className="h-64 w-full rounded-xl object-cover shadow-lg"
            />
            <img
              src="https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Scena konferencyjna"
              className="h-64 w-full rounded-xl object-cover shadow-lg"
            />
          </div>
        </div>
      </div>

      {/* STRONA 3 – SCENA */}
      <div className="brochure-page page-break bg-[#0b0d16] p-16">
        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16 bg-[#d3bb73]" />
              <Music className="h-12 w-12 text-[#d3bb73]" />
              <div className="h-px w-16 bg-[#d3bb73]" />
            </div>
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Scena</h2>
            <p className="text-xl text-[#e5e4e2]/70">
              Stabilna baza dla konferencji, gali i koncertu
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-[#2b304a] bg-[#151827] p-8">
                <h3 className="text-2xl font-bold text-[#d3bb73]">
                  Konstrukcje sceniczne
                </h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Sceny modułowe od 6×4 m do dużych konstrukcji plenerowych</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Zadaszenia certyfikowane – bezpieczeństwo w każdych warunkach</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Systemy trussowe do scen, stoisk i zabudów multimedialnych</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Podesty, scenki mobilne, risery dla zespołów</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-4 rounded-xl border border-[#2b304a] bg-[#151827] p-8">
                <h3 className="text-2xl font-bold text-[#d3bb73]">
                  Dodatkowe elementy
                </h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Barierki sceniczne i strefy bezpieczeństwa</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Schody, rampy oraz podjazdy dla gości i artystów</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Wykończenia: wykładziny, listwy maskujące, blackbox</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-6">
              <img
                src="https://images.pexels.com/photos/1916824/pexels-photo-1916824.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Konstrukcja sceniczna"
                className="h-72 w-full rounded-xl object-cover shadow-2xl"
              />
              <img
                src="https://images.pexels.com/photos/2147029/pexels-photo-2147029.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Montaż sceny"
                className="h-64 w-full rounded-xl object-cover shadow-2xl"
              />
            </div>
          </div>
        </div>
      </div>

      {/* STRONA 4 – DŹWIĘK */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#0b0d16] via-[#111321] to-[#0b0d16] p-16">
        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16 bg-[#d3bb73]" />
              <Mic2 className="h-12 w-12 text-[#d3bb73]" />
              <div className="h-px w-16 bg-[#d3bb73]" />
            </div>
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Dźwięk</h2>
            <p className="text-xl text-[#e5e4e2]/70">
              Czytelne brzmienie – od prelekcji po koncert
            </p>
          </div>

          <div className="mb-10 grid grid-cols-2 gap-6">
            <img
              src="https://images.pexels.com/photos/442540/pexels-photo-442540.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Sprzęt nagłośnieniowy"
              className="h-80 w-full rounded-xl object-cover shadow-2xl"
            />
            <img
              src="https://images.pexels.com/photos/1626481/pexels-photo-1626481.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Konsoleta mikserska"
              className="h-80 w-full rounded-xl object-cover shadow-2xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4 rounded-xl border border-[#d3bb73]/30 bg-[#151827]/90 p-8 backdrop-blur">
              <h3 className="text-2xl font-bold text-[#d3bb73]">
                Systemy nagłośnienia
              </h3>
              <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Systemy line array do dużych sal i plenerów</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Subbasy o wysokiej dynamice – muzyka na żywo i DJ</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Monitory sceniczne oraz in-ear monitoring dla artystów</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Dogłośnienia strefowe, front fill, delay</span>
                </li>
              </ul>
            </div>

            <div className="space-y-4 rounded-xl border border-[#d3bb73]/30 bg-[#151827]/90 p-8 backdrop-blur">
              <h3 className="text-2xl font-bold text-[#d3bb73]">
                Mikrofony i stoły mikserskie
              </h3>
              <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Mikrofony bezprzewodowe premium – handheld, headset, lav</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Mikrofony pojemnościowe do wokalu i instrumentów</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Konsole cyfrowe 32–64 kanały z zapisami scen</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Procesory DSP, systemy automatycznej korekcji</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/40 bg-[#800020]/20 p-8">
            <p className="text-center text-lg leading-relaxed text-[#e5e4e2]">
              <span className="font-bold text-[#d3bb73]">
                Doświadczeni realizatorzy dźwięku
              </span>{' '}
              dbają o każdy detal – od pierwszego mikrofonu na sali
              po ostatni akord na scenie.
            </p>
          </div>
        </div>
      </div>

      {/* STRONA 5 – OŚWIETLENIE */}
      <div className="brochure-page page-break bg-[#05060a] p-16">
        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16 bg-[#d3bb73]" />
              <Lightbulb className="h-12 w-12 text-[#d3bb73]" />
              <div className="h-px w-16 bg-[#d3bb73]" />
            </div>
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Oświetlenie</h2>
            <p className="text-xl text-[#e5e4e2]/70">
              Światło, które buduje atmosferę i scenariusz
            </p>
          </div>

          <div className="my-10 grid grid-cols-3 gap-6">
            <img
              src="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Scenic lights 1"
              className="h-56 w-full rounded-xl object-cover shadow-2xl"
            />
            <img
              src="https://images.pexels.com/photos/1763067/pexels-photo-1763067.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Scenic lights 2"
              className="h-56 w-full rounded-xl object-cover shadow-2xl"
            />
            <img
              src="https://images.pexels.com/photos/1160993/pexels-photo-1160993.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Scenic lights 3"
              className="h-56 w-full rounded-xl object-cover shadow-2xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#29163b] via-[#1c1f33] to-[#29163b] p-8 backdrop-blur">
                <h3 className="text-2xl font-bold text-[#d3bb73]">
                  Oświetlenie sceniczne
                </h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Ruchome głowy, profile, beam – pełne spektrum kolorystyczne</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>LED PAR i bary – równomierne wash&apos;e sceny i sali</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Światło architektoniczne dla elewacji i wnętrz</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Stroboskopy i blindery dla koncertów i gali</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#0c2738] via-[#1c1f33] to-[#0c2738] p-8 backdrop-blur">
                <h3 className="text-2xl font-bold text-[#d3bb73]">
                  Efekty specjalne
                </h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Lasery, efekty gobo, sceniczne projekcje logo</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Ciężki dym na wejścia, finały i highlight&apos;y</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Wytwornice dymu i hazer&apos;y do budowania plastyki światła</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#402019] via-[#1c1f33] to-[#402019] p-8 backdrop-blur">
                <h3 className="text-2xl font-bold text-[#d3bb73]">Sterowanie</h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Profesjonalne konsolety oświetleniowe i systemy DMX</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Preprogramowane show, dostosowane do scenariusza eventu</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Synchronizacja światła z dźwiękiem i multimediami</span>
                  </li>
                </ul>
              </div>

              <img
                src="https://images.pexels.com/photos/1047442/pexels-photo-1047442.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Light control"
                className="h-64 w-full rounded-xl object-cover shadow-2xl"
              />
            </div>
          </div>
        </div>
      </div>

      {/* STRONA 6 – REALIZACJE */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#0b0d16] via-[#111321] to-[#0b0d16] p-16">
        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Realizacje</h2>
            <div className="mx-auto h-1 w-24 bg-[#d3bb73]" />
            <p className="text-xl text-[#e5e4e2]/70">
              Wybrane projekty z naszego portfolio
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Festival"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Festiwal muzyczny
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Scena główna • kilkanaście tysięcy uczestników
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Concert"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Koncert w hali
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Nagłośnienie 360° • dedykowany design światła
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Corporate Event"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Event korporacyjny
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Konferencja • gala • afterparty w jednej produkcji
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/1916824/pexels-photo-1916824.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Outdoor Festival"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Event plenerowy
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Dwie sceny • pełna obsługa techniczna
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-6">
            <img
              src="https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Detail 1"
              className="h-48 w-full rounded-xl object-cover shadow-xl"
            />
            <img
              src="https://images.pexels.com/photos/1763067/pexels-photo-1763067.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Detail 2"
              className="h-48 w-full rounded-xl object-cover shadow-xl"
            />
            <img
              src="https://images.pexels.com/photos/1677710/pexels-photo-1677710.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Detail 3"
              className="h-48 w-full rounded-xl object-cover shadow-xl"
            />
          </div>
        </div>
      </div>

      {/* STRONA 7 – NASZE USŁUGI */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#111321] via-[#0f1119] to-[#111321] p-16">
        <div className="mx-auto max-w-4xl space-y-12">
          <div className="space-y-4 text-center">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">
              Nasze usługi
            </h2>
            <div className="mx-auto h-1 w-24 bg-[#d3bb73]" />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl transition-all">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Music className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Koncerty i festiwale
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Pełna obsługa techniczna scen muzycznych – od klubowych
                koncertów po duże plenerowe produkcje.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl transition-all">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Users className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Konferencje i biznes
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Konferencje, premiery produktów, gale – elegancka oprawa
                techniczna w hotelach i centrach konferencyjnych.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl transition-all">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Award className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Gale i wydarzenia specjalne
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Uroczyste gale, jubileusze, wydarzenia brandingowe – światło,
                dźwięk i scenografia pracujące na prestiż marki.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl transition-all">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Gauge className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Wynajem sprzętu
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Profesjonalne systemy audio, oświetlenie i konstrukcje sceniczne
                dostępne w opcji dry hire lub z obsługą.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] p-10 text-white shadow-2xl">
            <h3 className="mb-6 text-3xl font-bold">
              Dlaczego warto z nami pracować?
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  <p className="text-lg">Ponad 15 lat doświadczenia w branży</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  <p className="text-lg">Sprzęt premium i przemyślane projekty techniczne</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  <p className="text-lg">Zespół, który rozumie realia eventów korporacyjnych</p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  <p className="text-lg">Wysoka kultura pracy z klientem i gośćmi</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  <p className="text-lg">Elastyczność – dopasowanie do miejsca i scenariusza</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white" />
                  <p className="text-lg">Bezpieczeństwo i powtarzalna jakość realizacji</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="brochure-page bg-slate-900 p-16">
        <div className="max-w-4xl mx-auto space-y-12 h-full flex flex-col justify-between">
          <div className="text-center space-y-4">
            <h2 className="text-5xl font-bold text-white">Kontakt</h2>
            <div className="h-1 w-24 bg-amber-500 mx-auto"></div>
            <p className="text-xl text-gray-400">Skontaktuj się z nami i porozmawiajmy o Twoim projekcie</p>
          </div>

          <div className="grid grid-cols-2 gap-12">
            <div className="space-y-8">
              <div className="bg-slate-800/50 backdrop-blur rounded-2xl p-8 border border-amber-500/20">
                <h3 className="text-2xl font-bold text-amber-500 mb-6">Manager Projektu</h3>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Phone className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm mb-1">Telefon</p>
                      <p className="text-white text-xl font-semibold">+48 123 456 789</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Mail className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm mb-1">Email</p>
                      <p className="text-white text-xl font-semibold">manager@techstage.pl</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm mb-1">Biuro</p>
                      <p className="text-white text-xl font-semibold">ul. Przykładowa 123</p>
                      <p className="text-white text-xl font-semibold">00-001 Warszawa</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl p-8 text-center">
                <p className="text-white text-lg font-semibold mb-2">Dostępność 24/7</p>
                <p className="text-white/90">Jesteśmy do Twojej dyspozycji przez całą dobę</p>
              </div>
            </div>

            <div className="flex flex-col justify-center">
              <img
                src="https://images.pexels.com/photos/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Manager"
                className="w-full h-96 object-cover rounded-2xl shadow-2xl mb-8"
              />

              <div className="bg-slate-800/50 backdrop-blur rounded-xl p-6 border border-amber-500/20 text-center">
                <h4 className="text-2xl font-bold text-white mb-2">Jan Kowalski</h4>
                <p className="text-amber-500 text-lg font-semibold mb-3">Manager Projektów</p>
                <p className="text-gray-400 leading-relaxed">
                  Z pasją realizuję projekty eventowe od ponad 15 lat.
                  Chętnie pomogę w stworzeniu Twojego wymarzonego wydarzenia.
                </p>
              </div>
            </div>
          </div>

          <div className="text-center space-y-4 pt-8 border-t border-slate-800">
            <div className="flex items-center justify-center gap-3 text-white">
              <Music className="w-10 h-10 text-amber-500" strokeWidth={1.5} />
              <div>
                <h2 className="text-xl font-light tracking-wider">PROFESSIONAL STAGE SERVICES</h2>
                <p className="text-sm tracking-widest text-gray-400">www.techstage.pl</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechnicalOfferBrochure;


