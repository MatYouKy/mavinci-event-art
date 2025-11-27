'use client';

import React from 'react';
import { useAppSelector } from '@/store/hooks';
import { selectIconById } from '@/store/slices/customIconSlice';

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

interface CustomIconProps {
  iconId: string | null | undefined;
  className?: string;
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

  let svgCode = icon.svg_code;

  svgCode = svgCode
    .replace(/stroke="[^"]*"/g, 'stroke="currentColor"')
    .replace(/fill="[^"]*"/g, 'fill="currentColor"')
    .replace(/<svg/, '<svg class="w-full h-full"');

  if (!svgCode.includes('stroke="currentColor"')) {
    svgCode = svgCode.replace('<svg', '<svg stroke="currentColor"');
  }

  return (
    <span
      className={cn('inline-flex items-center justify-center', className)}
      dangerouslySetInnerHTML={{ __html: svgCode }}
    />
  );
};