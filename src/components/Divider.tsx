'use client';

import { useState, useEffect } from 'react';
import { getSiteImage, getImageStyle, SiteImage } from '../lib/siteImages';

export default function Divider() {
  const [image, setImage] = useState<SiteImage | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const loadImage = async () => {
      const img = await getSiteImage('divider1');
      setImage(img);
    };
    loadImage();

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const backgroundStyle = image
    ? getImageStyle(image, isMobile)
    : { backgroundImage: 'url(https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=1920)' };

  return (
    <section className="relative h-[60vh] md:h-[70vh] overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed"
        style={backgroundStyle}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/80 via-[#800020]/70 to-[#1c1f33]/80"></div>
      </div>

      <div className="relative z-10 h-full flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl text-center">
          <div className="mb-8 animate-[fadeIn_1s_ease-out]">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#d3bb73]"></div>
              <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase">
                Twój Event, Nasza Pasja
              </span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#d3bb73]"></div>
            </div>
          </div>

          <h2 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-light text-[#e5e4e2] mb-8 leading-tight animate-[fadeIn_1.2s_ease-out]">
            Każdy szczegół ma znaczenie
          </h2>

          <p className="text-lg md:text-xl text-[#e5e4e2]/90 font-light leading-relaxed max-w-2xl mx-auto mb-10 animate-[fadeIn_1.4s_ease-out]">
            Od koncepcji po realizację – tworzymy doświadczenia, które zostają w pamięci na lata
          </p>

          <div className="animate-[fadeIn_1.6s_ease-out]">
            <button className="group inline-flex items-center gap-3 px-10 py-5 bg-[#d3bb73] text-[#1c1f33] rounded-full text-base md:text-lg font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/50">
              Porozmawiajmy o Twoim Evencie
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItaDJ2LTJoLTJ6bTAtNGgydjJoLTJ2LTJ6bS0yIDJoMnYyaC0ydi0yem0wLTJoMnYyaC0ydi0yem0wIDRoMnYyaC0ydi0yem0wIDRoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yeiIvPjwvZz48L2c+PC9zdmc+')] opacity-20"></div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}
