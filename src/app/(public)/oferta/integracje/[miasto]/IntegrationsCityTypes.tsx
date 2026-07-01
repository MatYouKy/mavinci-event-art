'use client';

import Image from 'next/image';
import { PolishCityCases } from '@/lib/polishCityCases';

interface TypeItem {
  title: string;
  description: string;
  keywords?: string;
  image: string;
}

type Props = {
  types: TypeItem[];
  cityCases: PolishCityCases;
};

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export default function IntegrationsCityTypes({ types, cityCases }: Props) {
  const prep = cityCases.locative_preposition || 'w';

  if (!types || types.length === 0) return null;

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
          Rodzaje integracji {prep} {capitalize(cityCases.locative)}
        </h2>
        <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
          Wybierz format lub pozwol nam zaproponowac idealny scenariusz integracji {prep} {capitalize(cityCases.locative)}
        </p>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {types.map((type, idx) => (
            <div
              key={idx}
              className="group overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] transition-all duration-300 hover:border-[#d3bb73]/40"
            >
              <div className="relative aspect-[16/9] overflow-hidden">
                <Image
                  src={type.image}
                  alt={`${type.title} ${prep} ${capitalize(cityCases.locative)}`}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-110"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/20 to-transparent" />
              </div>
              <div className="p-5">
                <h3 className="mb-2 text-lg font-medium text-[#d3bb73]">{type.title}</h3>
                <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{type.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
