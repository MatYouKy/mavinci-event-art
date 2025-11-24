'use client';

import React from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectIconById } from '@/store/slices/customIconSlice';

// pomocnicze łączenie klas (albo użyj tailwind-merge, clsx itd.)
function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

interface CustomIconProps {
  iconId: string | null | undefined;
  className?: string;
  // opcjonalnie fallback (np. literka)
  fallback?: React.ReactNode;
}

export const CustomIcon: React.FC<CustomIconProps> = ({
  iconId,
  className,
  fallback = null,
}) => {
  const icon = useAppSelector(
    iconId ? selectIconById(iconId) : () => undefined
  );

  if (!icon) {
    return fallback ? <>{fallback}</> : null;
  }

  // Dodaj class do SVG dla lepszej kontroli
  let svgCode = icon.svg_code;

  // Jeśli SVG nie ma class, dodaj
  if (!svgCode.includes('class=')) {
    svgCode = svgCode.replace('<svg', '<svg class="w-full h-full"');
  }

  // Upewnij się że SVG ma currentColor
  if (!svgCode.includes('currentColor')) {
    svgCode = svgCode.replace(
      '<svg',
      '<svg stroke="currentColor" fill="none"'
    );
  }

  return (
    <span
      className={cn('inline-flex items-center justify-center', className)}
      style={{ color: 'inherit', width: '1em', height: '1em', fontSize: 'inherit' }}
      dangerouslySetInnerHTML={{ __html: svgCode }}
    />
  );
};