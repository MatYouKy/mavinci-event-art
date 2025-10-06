'use client';

import { useEffect, useRef, useState } from 'react';
import { getSiteImage, getImageStyle, SiteImage } from '../lib/siteImages';
import { useEditMode } from '../contexts/EditModeContext';
import SiteImageEditor from './SiteImageEditor';

export default function DividerTwo() {
  const [scrollProgress, setScrollProgress] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const [image, setImage] = useState<SiteImage | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { isEditMode } = useEditMode();

  const loadImage = async () => {
    const img = await getSiteImage('divider2');
    setImage(img);
  };

  useEffect(() => {
    loadImage();

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    const handleScroll = () => {
      if (!sectionRef.current) return;

      const rect = sectionRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const sectionMiddle = rect.top + rect.height / 2;

      if (rect.top <= windowHeight && rect.bottom >= 0) {
        const distanceFromCenter = windowHeight / 2 - sectionMiddle;
        const maxDistance = windowHeight / 2 + rect.height / 2;
        const progress = Math.max(0, Math.min(1, (distanceFromCenter + maxDistance) / (maxDistance * 2)));
        setScrollProgress(progress);
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  const backgroundStyle = image
    ? getImageStyle(image, isMobile)
    : { backgroundImage: 'url(https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=1920)' };

  return (
    <section ref={sectionRef} className="relative h-[60vh] md:h-[70vh] overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-fixed"
        style={backgroundStyle}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/85 via-[#800020]/75 to-[#1c1f33]/85"></div>
        <SiteImageEditor
          section="divider2"
          image={image}
          isEditMode={isEditMode}
          onUpdate={loadImage}
          position="bottom-right"
        />
      </div>

      <div className="relative z-10 h-full flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl w-full">
          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            <div
              className="text-center transform transition-all duration-1000"
              style={{
                opacity: Math.pow(scrollProgress, 0.5),
                transform: `translateY(${(1 - Math.pow(scrollProgress, 0.5)) * 80}px) scale(${0.8 + scrollProgress * 0.2})`,
              }}
            >
              <div className="mb-6 inline-flex items-center justify-center w-24 h-24 rounded-full bg-[#d3bb73]/20 backdrop-blur-sm border-2 border-[#d3bb73]/50 shadow-lg shadow-[#d3bb73]/20">
                <svg className="w-12 h-12 text-[#d3bb73]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Kreacja</h3>
              <p className="text-[#e5e4e2]/90 font-light leading-relaxed text-base md:text-lg">
                Unikalne koncepcje dopasowane do Twojej marki
              </p>
            </div>

            <div
              className="text-center transform transition-all duration-1000 delay-150"
              style={{
                opacity: Math.pow(scrollProgress, 0.5),
                transform: `translateY(${(1 - Math.pow(scrollProgress, 0.5)) * 80}px) scale(${0.8 + scrollProgress * 0.2})`,
              }}
            >
              <div className="mb-6 inline-flex items-center justify-center w-24 h-24 rounded-full bg-[#d3bb73]/20 backdrop-blur-sm border-2 border-[#d3bb73]/50 shadow-lg shadow-[#d3bb73]/20">
                <svg className="w-12 h-12 text-[#d3bb73]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <h3 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Precyzja</h3>
              <p className="text-[#e5e4e2]/90 font-light leading-relaxed text-base md:text-lg">
                Perfekcyjne wykonanie każdego elementu
              </p>
            </div>

            <div
              className="text-center transform transition-all duration-1000 delay-300"
              style={{
                opacity: Math.pow(scrollProgress, 0.5),
                transform: `translateY(${(1 - Math.pow(scrollProgress, 0.5)) * 80}px) scale(${0.8 + scrollProgress * 0.2})`,
              }}
            >
              <div className="mb-6 inline-flex items-center justify-center w-24 h-24 rounded-full bg-[#d3bb73]/20 backdrop-blur-sm border-2 border-[#d3bb73]/50 shadow-lg shadow-[#d3bb73]/20">
                <svg className="w-12 h-12 text-[#d3bb73]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              </div>
              <h3 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Magia</h3>
              <p className="text-[#e5e4e2]/90 font-light leading-relaxed text-base md:text-lg">
                Niezapomniane wrażenia dla Twoich gości
              </p>
            </div>
          </div>

          <div
            className="mt-16 text-center transform transition-all duration-1000 delay-500"
            style={{
              opacity: Math.pow(scrollProgress, 0.5),
              transform: `translateY(${(1 - Math.pow(scrollProgress, 0.5)) * 40}px)`,
            }}
          >
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="h-px w-16 bg-gradient-to-r from-transparent to-[#d3bb73]"></div>
              <span className="text-[#d3bb73] text-base md:text-lg font-light tracking-widest uppercase">
                Excellence in Every Detail
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[#d3bb73]"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxjaXJjbGUgY3g9IjQwIiBjeT0iNDAiIHI9IjIiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyIvPjwvZz48L3N2Zz4=')] opacity-30"></div>
      </div>
    </section>
  );
}
