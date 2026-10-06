'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Package } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

const BUCKET = 'offer-product-pages';

function normalizeSource(value: string) {
  const source = value.trim();
  if (/^https?:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      const storageOrigin = new URL(supabase.storage.from(BUCKET).getPublicUrl('').data.publicUrl).origin;
      const prefix = new RegExp('^/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/' + BUCKET + '/');
      if (url.origin === storageOrigin && prefix.test(url.pathname)) {
        return decodeURIComponent(url.pathname.replace(prefix, ''));
      }
    } catch {
      return '';
    }
    return source;
  }
  return source.replace(/^\/+/, '').replace(/^(?:public\/)?offer-product-pages\//, '');
}

export default function SellerPricingThumbnail({
  imagePath,
  fallbackPath,
  name,
}: {
  imagePath?: string | null;
  fallbackPath?: string | null;
  name: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [url, setUrl] = useState('');
  const sources = useMemo(() => Array.from(new Set(
    [imagePath, fallbackPath].filter((value): value is string => Boolean(value?.trim())).map(normalizeSource).filter(Boolean),
  )), [imagePath, fallbackPath]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: '120px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUrl('');
    const source = sources[Math.floor(attempt / 2)];
    if (!nearViewport || !source) return;
    const resolve = async () => {
      try {
        if (/^https?:\/\//i.test(source)) {
          setUrl(source);
          return;
        }
        // Fetch a small rendition; retain a lazy original fallback for storage
        // installations without image transformations.
        const options = attempt % 2 === 0
          ? { transform: { width: 128, height: 96, resize: 'cover' as const, quality: 60 } }
          : undefined;
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(source, 3600, options);
        if (error || !data?.signedUrl) throw error || new Error('Brak miniatury');
        if (!cancelled) setUrl(data.signedUrl);
      } catch {
        if (!cancelled) setAttempt((current) => current + 1);
      }
    };
    void resolve();
    return () => { cancelled = true; };
  }, [attempt, nearViewport, sources]);

  return (
    <div ref={containerRef} className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-[#d3bb73]/60">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={name}
          width={64}
          height={48}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => { setUrl(''); setAttempt((current) => current + 1); }}
        />
      ) : <Package aria-hidden="true" className="h-5 w-5" />}
    </div>
  );
}
