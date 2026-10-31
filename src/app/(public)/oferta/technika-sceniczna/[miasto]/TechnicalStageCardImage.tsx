import 'server-only';

/** Only the optimized uploader creates these folders and all three variants.
 * Legacy files retain their real URL; never guess a missing thumbnail. */
export default function TechnicalStageCardImage({ src, alt }: { src: string; alt: string }) {
  const optimized = /\/technical-stage-(features|gallery)-optimized\/[^/]+-desktop\.webp$/.test(src);
  const mobile = optimized ? src.replace(/-desktop\.webp$/, '-mobile.webp') : null;
  const thumbnail = optimized ? src.replace(/-desktop\.webp$/, '-thumb.webp') : src;
  return <picture>
    {mobile && <source media="(max-width: 767px)" srcSet={mobile} />}
    <img src={thumbnail} alt={alt} width={800} height={500} loading="lazy" decoding="async"
      className="aspect-[16/10] w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.02]" />
  </picture>;
}
