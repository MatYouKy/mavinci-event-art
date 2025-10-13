'use client';

import { useState } from 'react';

interface ResponsiveImageProps {
  desktop: string;
  mobile?: string;
  thumbnail?: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  priority?: boolean;
  onLoad?: () => void;
}

/**
 * Responsive image component that loads appropriate size based on viewport
 * Uses WebP format for better compression
 * Automatically generates srcset for responsive loading
 */
export default function ResponsiveImage({
  desktop,
  mobile,
  thumbnail,
  alt,
  className = '',
  loading = 'lazy',
  priority = false,
  onLoad,
}: ResponsiveImageProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleLoad = () => {
    setImageLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setImageError(true);
  };

  // Fallback to desktop if mobile/thumbnail not provided
  const mobileUrl = mobile || desktop;
  const thumbnailUrl = thumbnail || mobile || desktop;

  return (
    <div className={`relative ${className}`}>
      {!imageLoaded && !imageError && (
        <div className="absolute inset-0 bg-[#1c1f33]/20 animate-pulse" />
      )}

      <picture>
        {/* Mobile version - shown on screens < 768px */}
        <source
          media="(max-width: 767px)"
          srcSet={mobileUrl}
          type="image/webp"
        />

        {/* Desktop version - shown on screens >= 768px */}
        <source
          media="(min-width: 768px)"
          srcSet={desktop}
          type="image/webp"
        />

        {/* Fallback img tag */}
        <img
          src={desktop}
          alt={alt}
          loading={priority ? 'eager' : loading}
          onLoad={handleLoad}
          onError={handleError}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </picture>

      {imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1c1f33]/80">
          <span className="text-[#e5e4e2]/60 text-sm">Nie udało się załadować obrazu</span>
        </div>
      )}
    </div>
  );
}

/**
 * Helper function to check if URLs object has responsive versions
 */
export function hasResponsiveVersions(
  url: string | { desktop: string; mobile: string; thumbnail: string }
): url is { desktop: string; mobile: string; thumbnail: string } {
  return typeof url === 'object' && 'desktop' in url && 'mobile' in url;
}

/**
 * Helper function to get image URL from either string or responsive object
 */
export function getImageUrl(
  url: string | { desktop: string; mobile: string; thumbnail: string },
  size: 'desktop' | 'mobile' | 'thumbnail' = 'desktop'
): string {
  if (typeof url === 'string') {
    return url;
  }
  return url[size] || url.desktop;
}
