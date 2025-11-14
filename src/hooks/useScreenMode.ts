import { useState, useEffect } from 'react';

type ScreenMode = 'mobile' | 'desktop' | 'tablet';

export const useScreenMode = () => {
  const [screenMode, setScreenMode] = useState<ScreenMode>('desktop');

  useEffect(() => {
    const updateMode = () => {
      const width = window.innerWidth;

      if (width < 768) {
        setScreenMode('mobile');
      } else {
        setScreenMode('desktop');
      }
    };

    updateMode();

    window.addEventListener('resize', updateMode);
    return () => window.removeEventListener('resize', updateMode);
  }, []);

  const isMobile = screenMode === 'mobile';
  const isTablet = screenMode === 'tablet';
  const isDesktop = screenMode === 'desktop';

  return { isMobile, isTablet, isDesktop, screenMode };
};