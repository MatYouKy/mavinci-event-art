type Props = {
  query: string; // np. "Olsztyn, Polska" albo "Warmińsko-Mazurskie"
  height?: number;
};

export default function CityMapEmbed({ query, height = 360 }: Props) {
  const src = `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;

  return (
    <section aria-label="Mapa" className="mx-auto w-full max-w-7xl px-6 py-10">
      <div className="overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <iframe
          title={`Mapa: ${query}`}
          src={src}
          width="100%"
          height={height}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          style={{ border: 0 }}
        />
      </div>
    </section>
  );
}