'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Head from 'next/head';
import {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  ChevronDown, Mail
} from 'lucide-react';
import ContactFormWithTracking from '@/components/ContactFormWithTracking';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const iconMap: Record<string, any> = {
  Mic, Camera, Lightbulb, Monitor, Wifi, Settings,
  Award, Shield, Users, Video, FileSearch, MapPin,
  MessageSquare, Search, FileText, CheckCircle, Play, Package,
  Volume2: Mic, Presentation: Monitor, Truck: Package
};

export default function ConferencesPage() {
  const [heroData, setHeroData] = useState<any>(null);
  const [problems, setProblems] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [caseStudies, setCaseStudies] = useState<any[]>([]);
  const [advantages, setAdvantages] = useState<any[]>([]);
  const [process, setProcess] = useState<any[]>([]);
  const [pricing, setPricing] = useState<any[]>([]);
  const [faq, setFaq] = useState<any[]>([]);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [isContactFormOpen, setIsContactFormOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [
      heroRes,
      problemsRes,
      servicesRes,
      packagesRes,
      caseStudiesRes,
      advantagesRes,
      processRes,
      pricingRes,
      faqRes
    ] = await Promise.all([
      supabase.from('conferences_hero').select('*').eq('is_active', true).single(),
      supabase.from('conferences_problems').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_services').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_packages').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_case_studies').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_advantages').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_process').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_pricing').select('*').eq('is_active', true).order('display_order'),
      supabase.from('conferences_faq').select('*').eq('is_active', true).order('display_order')
    ]);

    if (heroRes.data) setHeroData(heroRes.data);
    if (problemsRes.data) setProblems(problemsRes.data);
    if (servicesRes.data) setServices(servicesRes.data);
    if (packagesRes.data) setPackages(packagesRes.data);
    if (caseStudiesRes.data) setCaseStudies(caseStudiesRes.data);
    if (advantagesRes.data) setAdvantages(advantagesRes.data);
    if (processRes.data) setProcess(processRes.data);
    if (pricingRes.data) setPricing(pricingRes.data);
    if (faqRes.data) setFaq(faqRes.data);
  };

  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Settings;
    return Icon;
  };

  if (!heroData) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen bg-[#0f1119] flex items-center justify-center">
          <div className="text-[#d3bb73]">Ładowanie...</div>
        </div>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Obsługa Konferencji - Profesjonalne Nagłośnienie i Multimedia | MAVINCI</title>
        <meta
          name="description"
          content="Kompleksowa obsługa techniczna konferencji: nagłośnienie, multimedia, streaming live, realizacja wideo. Pakiety dla 50-500+ uczestników. Północna i centralna Polska."
        />
        <meta
          name="keywords"
          content="obsługa konferencji, nagłośnienie konferencyjne, technika AV, streaming konferencji, obsługa multimedialna, realizacja live, kamery konferencje, oświetlenie sceniczne"
        />
        <meta property="og:title" content="Obsługa Konferencji - MAVINCI Event & ART" />
        <meta property="og:description" content="Profesjonalne nagłośnienie, multimedia i realizacja live dla konferencji. Pakiety BASIC, STANDARD, PRO." />
        <meta property="og:type" content="website" />
        <link rel="canonical" href="https://mavinci.pl/uslugi/konferencje" />
      </Head>
      <Navbar />
      <div className="min-h-screen bg-[#0f1119] pt-20">
        {/* Hero Section */}
        <section className="relative py-24 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]" />
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-20 w-72 h-72 bg-[#d3bb73] rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-20 w-96 h-96 bg-[#d3bb73] rounded-full blur-3xl" />
          </div>

          <div className="relative max-w-7xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-light text-[#e5e4e2] mb-6">
              {heroData.title}
            </h1>
            <p className="text-xl text-[#e5e4e2]/80 mb-8 max-w-3xl mx-auto">
              {heroData.subtitle}
            </p>

            <div className="flex flex-wrap gap-4 justify-center mb-8">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="px-8 py-4 bg-[#d3bb73] text-[#1c1f33] font-medium rounded-lg hover:bg-[#c5ad65] transition-all shadow-lg hover:shadow-xl"
              >
                {heroData.cta_primary}
              </button>
              {heroData.cta_secondary && (
                <button
                  onClick={() => setIsContactFormOpen(true)}
                  className="px-8 py-4 bg-[#1c1f33] text-[#d3bb73] font-medium rounded-lg border border-[#d3bb73]/30 hover:border-[#d3bb73] transition-all"
                >
                  {heroData.cta_secondary}
                </button>
              )}
            </div>

            <div className="flex items-center justify-center gap-2 text-[#e5e4e2]/60">
              <MapPin className="w-5 h-5 text-[#d3bb73]" />
              <span>{heroData.trust_badge}</span>
            </div>
          </div>
        </section>

        {/* Problems and Solutions */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Najczęstsze problemy organizatorów konferencji
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16 max-w-2xl mx-auto">
              I nasze profesjonalne rozwiązania
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {problems.map((problem) => {
                const Icon = getIcon(problem.icon_name);
                return (
                  <div key={problem.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6 hover:border-[#d3bb73]/40 transition-all">
                    <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-[#d3bb73]" />
                    </div>
                    <h3 className="text-xl font-medium text-[#e5e4e2] mb-3">
                      {problem.title}
                    </h3>
                    <p className="text-[#e5e4e2]/60 mb-4 text-sm">
                      <span className="text-red-400">Problem:</span> {problem.problem_description}
                    </p>
                    <p className="text-[#e5e4e2]/80 text-sm">
                      <span className="text-[#d3bb73]">Rozwiązanie:</span> {problem.solution_description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Technical Services */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Zakres obsługi technicznej
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Kompleksowa realizacja audio-video dla Twojej konferencji
            </p>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {services.map((service) => {
                const Icon = getIcon(service.icon_name);
                return (
                  <div key={service.id} className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6">
                    <div className="w-14 h-14 bg-[#d3bb73] rounded-full flex items-center justify-center mb-4">
                      <Icon className="w-7 h-7 text-[#1c1f33]" />
                    </div>
                    <h3 className="text-2xl font-medium text-[#e5e4e2] mb-3">
                      {service.category_name}
                    </h3>
                    <p className="text-[#e5e4e2]/70 mb-4">
                      {service.category_description}
                    </p>
                    <ul className="space-y-2">
                      {service.services_list.map((item: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2 text-[#e5e4e2]/60 text-sm">
                          <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Packages */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Gotowe pakiety konferencyjne
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Wybierz pakiet dopasowany do wielkości Twojego eventu
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              {packages.map((pkg) => (
                <div key={pkg.id} className={`bg-[#1c1f33] border rounded-xl p-8 ${pkg.package_level === 'pro' ? 'border-[#d3bb73] shadow-xl shadow-[#d3bb73]/20' : 'border-[#d3bb73]/20'}`}>
                  <div className="text-center mb-6">
                    <h3 className="text-2xl font-medium text-[#d3bb73] mb-2">
                      {pkg.package_name}
                    </h3>
                    <p className="text-[#e5e4e2]/60 text-sm mb-4">
                      {pkg.target_audience}
                    </p>
                    <div className="text-3xl font-light text-[#e5e4e2]">
                      {pkg.price_info}
                    </div>
                  </div>

                  <p className="text-[#e5e4e2]/80 mb-6">
                    {pkg.description}
                  </p>

                  <div className="space-y-4 mb-6">
                    {Object.entries(pkg.features).map(([category, items]: [string, any]) => (
                      <div key={category}>
                        <h4 className="text-[#d3bb73] text-sm font-medium mb-2 uppercase">
                          {category}
                        </h4>
                        <ul className="space-y-1">
                          {items.map((item: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                              <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => setIsContactFormOpen(true)}
                    className={`w-full py-3 rounded-lg font-medium transition-all ${
                      pkg.package_level === 'pro'
                        ? 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#c5ad65]'
                        : 'bg-[#d3bb73]/10 text-[#d3bb73] border border-[#d3bb73]/30 hover:bg-[#d3bb73]/20'
                    }`}
                  >
                    Zapytaj o wycenę
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Case Studies */}
        <section className="py-20 px-6">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Nasze realizacje
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Przykłady obsłużonych konferencji i eventów
            </p>

            <div className="space-y-12">
              {caseStudies.map((study) => (
                <div key={study.id} className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-8">
                  <div className="grid md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-2xl font-medium text-[#e5e4e2] mb-2">
                        {study.project_name}
                      </h3>
                      {study.client_name && (
                        <p className="text-[#d3bb73] mb-4">{study.client_name}</p>
                      )}
                      <p className="text-[#e5e4e2]/60 mb-6">{study.event_type}</p>

                      {study.attendees_count && (
                        <div className="flex items-center gap-2 text-[#e5e4e2]/80 mb-4">
                          <Users className="w-5 h-5 text-[#d3bb73]" />
                          <span>{study.attendees_count} uczestników</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Wyzwanie</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.challenge}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Rozwiązanie</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.solution}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Rezultat</h4>
                        <p className="text-[#e5e4e2]/70 text-sm">{study.result}</p>
                      </div>

                      <div>
                        <h4 className="text-[#d3bb73] font-medium mb-2">Wykorzystany sprzęt</h4>
                        <div className="flex flex-wrap gap-2">
                          {study.equipment_used.map((eq: string, idx: number) => (
                            <span key={idx} className="text-xs px-3 py-1 bg-[#d3bb73]/10 text-[#e5e4e2]/80 rounded-full">
                              {eq}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Advantages */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
              Dlaczego MAVINCI?
            </h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {advantages.map((adv) => {
                const Icon = getIcon(adv.icon_name);
                return (
                  <div key={adv.id} className="flex gap-4">
                    <div className="w-12 h-12 bg-[#d3bb73] rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-[#1c1f33]" />
                    </div>
                    <div>
                      <h3 className="text-xl font-medium text-[#e5e4e2] mb-2">
                        {adv.title}
                      </h3>
                      <p className="text-[#e5e4e2]/70 text-sm">
                        {adv.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Process */}
        <section className="py-20 px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Proces współpracy
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Krok po kroku do profesjonalnej realizacji
            </p>

            <div className="space-y-6">
              {process.map((step) => {
                const Icon = getIcon(step.icon_name);
                return (
                  <div key={step.id} className="flex gap-6 items-start">
                    <div className="w-16 h-16 bg-[#d3bb73] rounded-full flex items-center justify-center flex-shrink-0">
                      <Icon className="w-8 h-8 text-[#1c1f33]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-2xl font-medium text-[#e5e4e2]">
                          {step.step_title}
                        </h3>
                        {step.duration_info && (
                          <span className="text-xs text-[#d3bb73] px-3 py-1 bg-[#d3bb73]/10 rounded-full">
                            {step.duration_info}
                          </span>
                        )}
                      </div>
                      <p className="text-[#e5e4e2]/70">
                        {step.step_description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="py-20 px-6 bg-[#1c1f33]/30">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4 text-center">
              Orientacyjne ceny
            </h2>
            <p className="text-[#e5e4e2]/60 text-center mb-16">
              Finalna wycena zależy od zakresu technicznego i specyfiki wydarzenia
            </p>

            <div className="grid md:grid-cols-3 gap-8">
              {pricing.map((tier) => (
                <div key={tier.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
                  <h3 className="text-xl font-medium text-[#e5e4e2] mb-2">
                    {tier.tier_name}
                  </h3>
                  <p className="text-[#e5e4e2]/60 text-sm mb-4">
                    {tier.tier_description}
                  </p>

                  <div className="mb-4">
                    <div className="text-3xl font-light text-[#d3bb73] mb-1">
                      {tier.price_range}
                    </div>
                    <div className="text-[#e5e4e2]/60 text-sm">
                      {tier.attendees_range}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {tier.whats_included.map((item: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                        <CheckCircle className="w-4 h-4 text-[#d3bb73] mt-0.5 flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 text-center">
              <button
                onClick={() => setIsContactFormOpen(true)}
                className="px-8 py-4 bg-[#d3bb73] text-[#1c1f33] font-medium rounded-lg hover:bg-[#c5ad65] transition-all"
              >
                Zapytaj o szczegółową wycenę
              </button>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-16 text-center">
              Najczęściej zadawane pytania
            </h2>

            <div className="space-y-4">
              {faq.map((item, idx) => (
                <div key={item.id} className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-[#d3bb73]/5 transition-colors"
                  >
                    <span className="text-lg text-[#e5e4e2] font-medium pr-4">
                      {item.question}
                    </span>
                    <ChevronDown className={`w-5 h-5 text-[#d3bb73] transition-transform flex-shrink-0 ${expandedFaq === idx ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedFaq === idx && (
                    <div className="px-6 pb-4 text-[#e5e4e2]/70">
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact CTA */}
        <section className="py-20 px-6 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
          <div className="max-w-4xl mx-auto text-center">
            <div className="w-20 h-20 bg-[#d3bb73] rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="w-10 h-10 text-[#1c1f33]" />
            </div>
            <h2 className="text-4xl font-light text-[#e5e4e2] mb-4">
              Porozmawiajmy o Twojej konferencji
            </h2>
            <p className="text-xl text-[#e5e4e2]/70 mb-8">
              Odpowiadamy w ciągu 24 godzin
            </p>
            <button
              onClick={() => setIsContactFormOpen(true)}
              className="px-10 py-4 bg-[#d3bb73] text-[#1c1f33] font-medium rounded-lg hover:bg-[#c5ad65] transition-all text-lg"
            >
              Wyceń swoją konferencję
            </button>
          </div>
        </section>

        <ContactFormWithTracking
          isOpen={isContactFormOpen}
          onClose={() => setIsContactFormOpen(false)}
          sourcePage="Konferencje"
          sourceSection="conferences"
          defaultEventType="Konferencja"
        />
      </div>
      <Footer />
    </>
  );
}
