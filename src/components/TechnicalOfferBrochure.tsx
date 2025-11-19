'use client';

import React, { useEffect } from 'react';
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
  Sparkles,
  Tv,
  Radio,
  Download,
} from 'lucide-react';

const TechnicalOfferBrochure = () => {
  useEffect(() => {
    const styleId = 'brochure-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @media print {
          .page-break {
            page-break-after: always;
            break-after: page;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
            margin: 0;
            padding: 0;
          }
          .no-print {
            display: none !important;
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

        /* Siatka kropek */
        .brochure-page::before {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          background-image:
            radial-gradient(circle, rgba(211, 187, 115, 0.15) 1px, transparent 1px);
          background-size: 30px 30px;
          top: 0;
          left: 0;
          pointer-events: none;
          opacity: 0.4;
        }

        /* Wzór linii */
        .brochure-page::after {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          background-image:
            repeating-linear-gradient(
              45deg,
              transparent,
              transparent 50px,
              rgba(211, 187, 115, 0.03) 50px,
              rgba(211, 187, 115, 0.03) 51px
            );
          top: 0;
          left: 0;
          pointer-events: none;
        }

        .decorative-shape {
          position: absolute;
          pointer-events: none;
        }

        /* Duży złoty gradient circle */
        .shape-1 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(211, 187, 115, 0.15) 0%, transparent 70%);
          border-radius: 50%;
          top: -150px;
          right: -150px;
          opacity: 0.6;
        }

        /* Siatka złotych kwadratów */
        .shape-2 {
          width: 400px;
          height: 400px;
          background-image:
            linear-gradient(rgba(211, 187, 115, 0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(211, 187, 115, 0.08) 1px, transparent 1px);
          background-size: 40px 40px;
          bottom: -100px;
          left: -100px;
          opacity: 0.5;
          transform: rotate(15deg);
        }

        /* Koncentryczne okręgi */
        .shape-3 {
          width: 300px;
          height: 300px;
          background-image:
            radial-gradient(circle, transparent 40%, rgba(211, 187, 115, 0.1) 40%, rgba(211, 187, 115, 0.1) 41%, transparent 41%),
            radial-gradient(circle, transparent 60%, rgba(211, 187, 115, 0.08) 60%, rgba(211, 187, 115, 0.08) 61%, transparent 61%),
            radial-gradient(circle, transparent 80%, rgba(211, 187, 115, 0.06) 80%, rgba(211, 187, 115, 0.06) 81%, transparent 81%);
          top: 30%;
          right: 5%;
          opacity: 0.7;
        }

        /* Hexagon pattern */
        .shape-4 {
          width: 350px;
          height: 350px;
          background-image:
            repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(211, 187, 115, 0.06) 40px, rgba(211, 187, 115, 0.06) 42px),
            repeating-linear-gradient(60deg, transparent, transparent 40px, rgba(211, 187, 115, 0.06) 40px, rgba(211, 187, 115, 0.06) 42px),
            repeating-linear-gradient(120deg, transparent, transparent 40px, rgba(211, 187, 115, 0.06) 40px, rgba(211, 187, 115, 0.06) 42px);
          bottom: 20%;
          left: 10%;
          opacity: 0.6;
          transform: rotate(-20deg);
        }

        /* Spirala z kropek */
        .shape-5 {
          width: 250px;
          height: 250px;
          background-image:
            radial-gradient(circle, rgba(211, 187, 115, 0.2) 2px, transparent 2px);
          background-size: 25px 25px;
          top: 50%;
          left: -80px;
          opacity: 0.5;
          transform: rotate(30deg);
        }

        /* Duże kropki rozmieszczone */
        .shape-6 {
          width: 300px;
          height: 300px;
          background-image:
            radial-gradient(circle, rgba(211, 187, 115, 0.12) 3px, transparent 3px);
          background-size: 50px 50px;
          bottom: 10%;
          right: 10%;
          opacity: 0.6;
        }
      `;
      document.head.appendChild(style);
    }

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, []);

  const handleDownloadPDF = () => {
    const printContent = document.getElementById('brochure-content');
    const originalContent = document.body.innerHTML;

    if (printContent) {
      document.body.innerHTML = printContent.innerHTML;
      window.print();
      document.body.innerHTML = originalContent;
      window.location.reload();
    }
  };

  return (
    <div className="bg-[#0f1119]">
      {/* Floating Download Button */}
      <div className="no-print fixed top-8 right-8 z-50">
        <button
          onClick={handleDownloadPDF}
          className="group flex items-center gap-3 bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] hover:from-[#c1a85f] hover:to-[#d3bb73] text-[#1c1f33] font-bold px-6 py-4 rounded-xl shadow-2xl transition-all duration-300 hover:scale-105 hover:shadow-[#d3bb73]/50"
        >
          <Download className="w-6 h-6 group-hover:animate-bounce" />
          <span className="text-lg">Pobierz PDF</span>
        </button>
      </div>

      <div id="brochure-content">
        {/* STRONA 1 – OKŁADKA */}
        <div className="brochure-page page-break relative">
          {/* Decorative Shapes */}
          <div className="decorative-shape shape-1"></div>
          <div className="decorative-shape shape-3"></div>
          <div className="decorative-shape shape-5"></div>

        <div className="absolute inset-0 bg-gradient-to-br from-[#0f1119] via-[#1c1f33] to-[#0f1119]">
          <img
            src="https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920"
            alt="Stage"
            className="h-full w-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/80 to-transparent" />
        </div>

        <div className="relative z-10 flex h-full flex-col justify-between p-16">
          <div className="flex items-center gap-4">
            <img
              src="/logo mavinci-simple.svg"
              alt="Mavinci Logo"
              className="h-16 w-16"
            />
            <div>
              <h2 className="text-3xl font-bold tracking-wider text-[#e5e4e2]">
                MAVINCI
              </h2>
              <p className="text-sm tracking-[0.3em] text-[#d3bb73] uppercase">
                Event & Art
              </p>
            </div>
          </div>

          <div className="space-y-8">
            <h1 className="text-7xl font-bold leading-tight text-[#e5e4e2]">
              Kompleksowa
              <br />
              obsługa
              <br />
              eventowa
            </h1>
            <div className="h-1 w-32 bg-[#d3bb73]" />
            <p className="max-w-2xl text-2xl font-light leading-relaxed text-[#e5e4e2]/90">
              Nagłośnienie • Oświetlenie • Scena • Multimedia
              <br />
              <span className="text-[#d3bb73]">Premium events dla wymagających klientów</span>
            </p>
          </div>

          <div className="text-sm tracking-wider text-[#e5e4e2]/60">
            2024 / MAVINCI EVENT & ART
          </div>
        </div>
      </div>

      {/* STRONA 2 – O NAS */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#0f1119] via-[#1c1f33] to-[#0f1119] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-2"></div>
        <div className="decorative-shape shape-4"></div>
        <div className="decorative-shape shape-6"></div>

        <div className="mx-auto max-w-4xl space-y-12">
          <div className="space-y-4 text-center">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Mavinci Event & Art</h2>
            <div className="mx-auto h-1 w-24 bg-[#d3bb73]" />
            <p className="text-xl text-[#d3bb73]">Profesjonalna obsługa techniczna wydarzeń</p>
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
                <Sparkles className="h-10 w-10 text-[#1c1f33]" />
              </div>
              <h3 className="text-3xl font-bold text-[#e5e4e2]">Premium</h3>
              <p className="font-medium text-[#e5e4e2]/70">Sprzęt i obsługa</p>
            </div>
          </div>

          <div className="space-y-6 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/90 p-10 shadow-xl">
            <p className="text-xl leading-relaxed text-[#e5e4e2]/90">
              Mavinci Event & Art to zespół specjalistów z pasją do perfekcji.
              Realizujemy konferencje, gale, koncerty i wydarzenia korporacyjne
              na najwyższym poziomie. Łączymy nowoczesny sprzęt z wieloletnim
              doświadczeniem i dbałością o każdy detal.
            </p>
            <p className="text-xl leading-relaxed text-[#e5e4e2]/90">
              Pracujemy w najlepszych hotelach, centrach konferencyjnych i przestrzeniach
              eventowych w Polsce. Nasi klienci to firmy z sektora premium, które
              oczekują nie tylko sprawnej techniki, ale także kultury obsługi
              i zrozumienia dla specyfiki prestiżowych wydarzeń.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-6">
            <img
              src="https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Konferencja Mavinci"
              className="h-64 w-full rounded-xl object-cover shadow-lg"
            />
            <img
              src="https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Event Mavinci"
              className="h-64 w-full rounded-xl object-cover shadow-lg"
            />
          </div>
        </div>
      </div>

      {/* STRONA 3 – NAGŁOŚNIENIE */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#0b0d16] via-[#1c1f33] to-[#0b0d16] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-1"></div>
        <div className="decorative-shape shape-3"></div>
        <div className="decorative-shape shape-6"></div>

        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16 bg-[#d3bb73]" />
              <Mic2 className="h-12 w-12 text-[#d3bb73]" />
              <div className="h-px w-16 bg-[#d3bb73]" />
            </div>
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Nagłośnienie</h2>
            <p className="text-xl text-[#e5e4e2]/70">
              Krystalicznie czysty dźwięk – od konferencji po koncert
            </p>
          </div>

          <div className="mb-10 grid grid-cols-2 gap-6">
            <img
              src="https://images.pexels.com/photos/442540/pexels-photo-442540.jpeg?auto=compress&cs=tinysrgb&w=800"
              alt="Sprzęt nagłośnieniowy Mavinci"
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
                Systemy audio premium
              </h3>
              <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Line array najwyższej klasy – czytelny dźwięk dla 50-5000 osób</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Subbasy i systemy niskotonowe – potężny bas bez przesterowań</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Monitory sceniczne i in-ear dla artystów</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Systemy strefowe, delay, front fill – pokrycie całej sali</span>
                </li>
              </ul>
            </div>

            <div className="space-y-4 rounded-xl border border-[#d3bb73]/30 bg-[#151827]/90 p-8 backdrop-blur">
              <h3 className="text-2xl font-bold text-[#d3bb73]">
                Mikrofony i realizacja
              </h3>
              <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Mikrofony bezprzewodowe Shure, Sennheiser – handheld, headset, lav</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Mikrofony studyjne do instrumentów i nagrań</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Konsole cyfrowe 32-64 kanały (Yamaha, Allen & Heath)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1 text-[#d3bb73]">•</span>
                  <span>Realizatorzy dźwięku z wieloletnim doświadczeniem</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/40 bg-[#1c1f33]/80 p-8">
            <p className="text-center text-lg leading-relaxed text-[#e5e4e2]">
              <span className="font-bold text-[#d3bb73]">
                Doświadczeni realizatorzy
              </span>{' '}
              dbają o perfekcyjne brzmienie – od pierwszej próby mikrofonu
              po ostatni akord finałowego show.
            </p>
          </div>
        </div>
      </div>

      {/* STRONA 4 – OŚWIETLENIE */}
      <div className="brochure-page page-break bg-[#05060a] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-2"></div>
        <div className="decorative-shape shape-4"></div>
        <div className="decorative-shape shape-5"></div>

        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16 bg-[#d3bb73]" />
              <Lightbulb className="h-12 w-12 text-[#d3bb73]" />
              <div className="h-px w-16 bg-[#d3bb73]" />
            </div>
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Oświetlenie</h2>
            <p className="text-xl text-[#e5e4e2]/70">
              Światło, które tworzy atmosferę i buduje emocje
            </p>
          </div>

          <div className="my-10 grid grid-cols-3 gap-6">
            <img
              src="https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Oświetlenie sceniczne Mavinci"
              className="h-56 w-full rounded-xl object-cover shadow-2xl"
            />
            <img
              src="https://images.pexels.com/photos/1763067/pexels-photo-1763067.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Light show"
              className="h-56 w-full rounded-xl object-cover shadow-2xl"
            />
            <img
              src="https://images.pexels.com/photos/1160993/pexels-photo-1160993.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Stage lights"
              className="h-56 w-full rounded-xl object-cover shadow-2xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#29163b] via-[#1c1f33] to-[#29163b] p-8">
                <h3 className="text-2xl font-bold text-[#d3bb73]">
                  Oświetlenie sceniczne
                </h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Ruchome głowy LED – pełne spektrum kolorów RGB/RGBW</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>LED PAR i bary – równomierne wash sceny i sali</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Profilowe reflektory, beam lights, spot lights</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Uplighty architektoniczne dla przestrzeni i elewacji</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#0c2738] via-[#1c1f33] to-[#0c2738] p-8">
                <h3 className="text-2xl font-bold text-[#d3bb73]">
                  Efekty specjalne
                </h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Lasery RGB, projekcje gobo z logo klienta</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Ciężki dym na wejścia, finały i momenty kluczowe</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Hazer do plastyki światła i atmosfery</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#402019] via-[#1c1f33] to-[#402019] p-8">
                <h3 className="text-2xl font-bold text-[#d3bb73]">Sterowanie</h3>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Konsole oświetleniowe DMX – pełna kontrola show</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Preprogramowane scenariusze dopasowane do eventu</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Synchronizacja światła z dźwiękiem i wideo</span>
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

      {/* STRONA 5 – SCENA & MULTIMEDIA */}
      <div className="brochure-page page-break bg-[#0b0d16] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-1"></div>
        <div className="decorative-shape shape-3"></div>
        <div className="decorative-shape shape-6"></div>

        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-16 bg-[#d3bb73]" />
              <Music className="h-12 w-12 text-[#d3bb73]" />
              <div className="h-px w-16 bg-[#d3bb73]" />
            </div>
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Scena & Multimedia</h2>
            <p className="text-xl text-[#e5e4e2]/70">
              Solidna podstawa i nowoczesne rozwiązania AV
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="space-y-4 rounded-xl border border-[#2b304a] bg-[#151827] p-8">
                <div className="flex items-center gap-3">
                  <Music className="h-8 w-8 text-[#d3bb73]" />
                  <h3 className="text-2xl font-bold text-[#d3bb73]">
                    Konstrukcje sceniczne
                  </h3>
                </div>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Sceny modułowe od 4×3 m do dużych konstrukcji</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Zadaszenia i konstrukcje trussowe – bezpieczne i stabilne</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Podesty, risery, schody, rampy</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Wykończenia: wykładziny, listwy, blackbox</span>
                  </li>
                </ul>
              </div>

              <div className="space-y-4 rounded-xl border border-[#2b304a] bg-[#151827] p-8">
                <div className="flex items-center gap-3">
                  <Tv className="h-8 w-8 text-[#d3bb73]" />
                  <h3 className="text-2xl font-bold text-[#d3bb73]">
                    Multimedia & LED
                  </h3>
                </div>
                <ul className="space-y-3 text-lg text-[#e5e4e2]/80">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Projektory Full HD i 4K – prezentacje premium</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Ekrany LED modułowe – żywy obraz na żywo</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Kamery i realizacja wideo live</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-[#d3bb73]">•</span>
                    <span>Streaming online i nagrania eventów</span>
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
                alt="LED screen"
                className="h-64 w-full rounded-xl object-cover shadow-2xl"
              />
            </div>
          </div>
        </div>
      </div>

      {/* STRONA 6 – REALIZACJE */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#0b0d16] via-[#1c1f33] to-[#0b0d16] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-2"></div>
        <div className="decorative-shape shape-4"></div>
        <div className="decorative-shape shape-5"></div>

        <div className="mx-auto max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Nasze realizacje</h2>
            <div className="mx-auto h-1 w-24 bg-[#d3bb73]" />
            <p className="text-xl text-[#e5e4e2]/70">
              Wybrane projekty z portfolio Mavinci
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/2747449/pexels-photo-2747449.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Konferencja korporacyjna"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/90 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Konferencja Tech Summit
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    500 uczestników • full HD streaming • 3 sale równolegle
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/1105666/pexels-photo-1105666.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Gala firmowa"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/90 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Gala jubileuszowa
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Elegancka oprawa • light show • live band
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Premiera produktu"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/90 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Premiera produktu
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Brand activation • multimedia • VIP guests
                  </p>
                </div>
              </div>
            </div>

            <div className="group relative overflow-hidden rounded-xl shadow-2xl">
              <img
                src="https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Koncert plenerowy"
                className="h-64 w-full transform object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/90 to-transparent p-6">
                <div>
                  <h3 className="text-2xl font-bold text-[#e5e4e2]">
                    Festiwal miejski
                  </h3>
                  <p className="text-[#e5e4e2]/80">
                    Outdoor stage • 2000+ attendees • full production
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-6">
            <img
              src="https://images.pexels.com/photos/1763067/pexels-photo-1763067.jpeg?auto=compress&cs=tinysrgb&w=600"
              alt="Detail 1"
              className="h-48 w-full rounded-xl object-cover shadow-xl"
            />
            <img
              src="https://images.pexels.com/photos/1160993/pexels-photo-1160993.jpeg?auto=compress&cs=tinysrgb&w=600"
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

      {/* STRONA 7 – USŁUGI */}
      <div className="brochure-page page-break bg-gradient-to-br from-[#0f1119] via-[#1c1f33] to-[#0f1119] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-1"></div>
        <div className="decorative-shape shape-3"></div>
        <div className="decorative-shape shape-6"></div>

        <div className="mx-auto max-w-4xl space-y-12">
          <div className="space-y-4 text-center">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">
              Nasze usługi
            </h2>
            <div className="mx-auto h-1 w-24 bg-[#d3bb73]" />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Users className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Konferencje biznesowe
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Kompleksowa obsługa techniczna konferencji, seminariów i szkoleń.
                Nagłośnienie sali, prezentacje multimedia, transmisje online.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Award className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Gale i eventy premium
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Elegancka oprawa techniczna gal, jubileuszy i wydarzeń VIP.
                Światło, dźwięk i scenografia na najwyższym poziomie.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Music className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Koncerty i festiwale
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Pełna produkcja techniczna koncertów – od klubowych po festiwalowe.
                Line array, stage, lighting design, realizacja dźwięku.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border-2 border-[#d3bb73]/30 bg-[#1c1f33]/90 p-8 shadow-xl">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]">
                <Gauge className="h-8 w-8 text-[#1c1f33]" />
              </div>
              <h3 className="text-2xl font-bold text-[#e5e4e2]">
                Wynajem sprzętu
              </h3>
              <p className="text-lg leading-relaxed text-[#e5e4e2]/80">
                Profesjonalny sprzęt audio, lighting i video w opcji dry hire
                lub z obsługą techniczną i realizatorem.
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-r from-[#d3bb73] to-[#c1a85f] p-10 shadow-2xl">
            <h3 className="mb-6 text-3xl font-bold text-[#1c1f33]">
              Dlaczego Mavinci?
            </h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-[#1c1f33]" />
                  <p className="text-lg text-[#1c1f33]">15+ lat doświadczenia w branży eventowej</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-[#1c1f33]" />
                  <p className="text-lg text-[#1c1f33]">Sprzęt premium renomowanych marek</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-[#1c1f33]" />
                  <p className="text-lg text-[#1c1f33]">Doświadczeni realizatorzy i technicy</p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-[#1c1f33]" />
                  <p className="text-lg text-[#1c1f33]">Kultura obsługi klienta premium</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-[#1c1f33]" />
                  <p className="text-lg text-[#1c1f33]">Elastyczność i indywidualne podejście</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-[#1c1f33]" />
                  <p className="text-lg text-[#1c1f33]">Bezpieczeństwo i powtarzalna jakość</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* STRONA 8 – KONTAKT */}
      <div className="brochure-page bg-gradient-to-br from-[#0f1119] via-[#1c1f33] to-[#0f1119] p-16">
        {/* Decorative Shapes */}
        <div className="decorative-shape shape-2"></div>
        <div className="decorative-shape shape-4"></div>
        <div className="decorative-shape shape-5"></div>

        <div className="max-w-4xl mx-auto space-y-12 h-full flex flex-col justify-between">
          <div className="text-center space-y-4">
            <h2 className="text-5xl font-bold text-[#e5e4e2]">Kontakt</h2>
            <div className="h-1 w-24 bg-[#d3bb73] mx-auto"></div>
            <p className="text-xl text-[#e5e4e2]/70">Porozmawiajmy o Twoim projekcie</p>
          </div>

          <div className="grid grid-cols-2 gap-12">
            <div className="space-y-8">
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-2xl p-8 border border-[#d3bb73]/30">
                <h3 className="text-2xl font-bold text-[#d3bb73] mb-6">Dane kontaktowe</h3>

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Phone className="w-6 h-6 text-[#d3bb73]" />
                    </div>
                    <div>
                      <p className="text-[#e5e4e2]/60 text-sm mb-1">Telefon</p>
                      <p className="text-[#e5e4e2] text-xl font-semibold">+48 123 456 789</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Mail className="w-6 h-6 text-[#d3bb73]" />
                    </div>
                    <div>
                      <p className="text-[#e5e4e2]/60 text-sm mb-1">Email</p>
                      <p className="text-[#e5e4e2] text-xl font-semibold">kontakt@mavinci.pl</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <MapPin className="w-6 h-6 text-[#d3bb73]" />
                    </div>
                    <div>
                      <p className="text-[#e5e4e2]/60 text-sm mb-1">Biuro</p>
                      <p className="text-[#e5e4e2] text-xl font-semibold">Polska</p>
                      <p className="text-[#e5e4e2]/80 text-lg">Działamy w całym kraju</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-[#d3bb73] to-[#c1a85f] rounded-2xl p-8 text-center">
                <p className="text-[#1c1f33] text-lg font-bold mb-2">Dostępność 24/7</p>
                <p className="text-[#1c1f33]/90">W przypadku pilnych zleceń jesteśmy do dyspozycji</p>
              </div>
            </div>

            <div className="flex flex-col justify-center space-y-8">
              <div className="bg-[#1c1f33]/80 backdrop-blur rounded-xl p-8 border border-[#d3bb73]/30">
                <h3 className="text-3xl font-bold text-[#e5e4e2] mb-4">Mavinci Event & Art</h3>
                <p className="text-[#d3bb73] text-lg font-semibold mb-4">Profesjonalna obsługa techniczna eventów</p>
                <p className="text-[#e5e4e2]/80 leading-relaxed mb-6">
                  Od ponad 15 lat realizujemy wydarzenia na najwyższym poziomie.
                  Konferencje, gale, koncerty i eventy korporacyjne – każdy projekt
                  traktujemy indywidualnie i z pełnym zaangażowaniem.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-[#e5e4e2]/80">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    <span>Nagłośnienie premium</span>
                  </div>
                  <div className="flex items-center gap-3 text-[#e5e4e2]/80">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    <span>Oświetlenie sceniczne i architektoniczne</span>
                  </div>
                  <div className="flex items-center gap-3 text-[#e5e4e2]/80">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    <span>Konstrukcje sceniczne i multimedia</span>
                  </div>
                  <div className="flex items-center gap-3 text-[#e5e4e2]/80">
                    <div className="h-2 w-2 rounded-full bg-[#d3bb73]" />
                    <span>Realizacja i streaming online</span>
                  </div>
                </div>
              </div>

              <img
                src="https://images.pexels.com/photos/2182970/pexels-photo-2182970.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Mavinci team"
                className="w-full h-64 object-cover rounded-2xl shadow-2xl"
              />
            </div>
          </div>

          <div className="text-center space-y-4 pt-8 border-t border-[#d3bb73]/20">
            <div className="flex items-center justify-center gap-4">
              <img
                src="/logo mavinci-simple.svg"
                alt="Mavinci Logo"
                className="h-12 w-12"
              />
              <div>
                <h2 className="text-2xl font-bold tracking-wider text-[#e5e4e2]">MAVINCI</h2>
                <p className="text-sm tracking-[0.3em] text-[#d3bb73] uppercase">Event & Art</p>
              </div>
            </div>
            <p className="text-[#e5e4e2]/60">www.mavinci.pl</p>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default TechnicalOfferBrochure;
