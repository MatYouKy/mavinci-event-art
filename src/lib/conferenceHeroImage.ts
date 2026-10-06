const ORIGINAL_HERO = 'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1763637265757-ut62t.jpg';

/** Pre-sized versions of the current conference photo; new CMS uploads keep their own URL. */
export function conferenceHeroImage(src: string) {
  if (src !== ORIGINAL_HERO) return { src };
  return {
    src: '/images/conferences/hero-1280.webp',
    srcSet: [480, 768, 1280, 1920].map(width => `/images/conferences/hero-${width}.webp ${width}w`).join(', '),
  };
}
