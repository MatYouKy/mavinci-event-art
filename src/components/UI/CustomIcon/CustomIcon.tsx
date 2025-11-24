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

  return (
    <span
      className={cn('inline-block', className)}
      // svg_code to całe <svg ...>...</svg>
      dangerouslySetInnerHTML={{ __html: icon.svg_code }}
    />
  );
};