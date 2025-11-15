'use client';

import { useState, useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface CasinoLegalPopupProps {
  content: string;
  onAccept: () => void;
}

export default function CasinoLegalPopup({ content, onAccept }: CasinoLegalPopupProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const hasAccepted = localStorage.getItem('casino-legal-accepted');
    if (!hasAccepted) {
      setIsVisible(true);
    } else {
      onAccept();
    }
  }, [onAccept]);

  const handleAccept = () => {
    localStorage.setItem('casino-legal-accepted', 'true');
    setIsVisible(false);
    onAccept();
  };

  if (!isVisible) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes casinoFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes casinoSlideUp {
            from {
              opacity: 0;
              transform: translateY(30px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          .casino-popup-overlay {
            animation: casinoFadeIn 0.3s ease-in-out;
          }
          .casino-popup-content {
            animation: casinoSlideUp 0.4s ease-out;
          }
        `
      }} />
      <div className="casino-popup-overlay fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-md">
        <div
          className="casino-popup-content relative max-w-2xl mx-4 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/30 rounded-2xl overflow-hidden shadow-2xl"
          style={{
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 100px rgba(0, 0, 0, 0.3)'
          }}
        >
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>

        <div className="p-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="flex-shrink-0 w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-[#d3bb73]" />
            </div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">Informacja prawna</h2>
          </div>

          <div className="prose prose-invert max-w-none mb-8">
            <p className="text-[#e5e4e2]/80 font-light leading-relaxed whitespace-pre-line">
              {content}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleAccept}
              className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              Rozumiem i akceptuję
            </button>
          </div>

          <p className="text-[#e5e4e2]/50 text-xs text-center mt-4">
            Aby kontynuować, zaakceptuj powyższe warunki
          </p>
        </div>
      </div>
    </div>
    </>
  );
}
