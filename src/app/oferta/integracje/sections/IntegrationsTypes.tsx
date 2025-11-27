'use client';

import { ArrowRight } from 'lucide-react';

interface IntegrationType {
  image: string;
  title: string;
  description: string;
}

interface IntegrationsTypesProps {
  title?: string;
  subtitle?: string;
  types?: IntegrationType[];
}

const defaultTypes: IntegrationType[] = [
  {
    image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80',
    title: 'Gry terenowe i fabularne',
    description: 'Scenariusze integracyjne z fabułą, zagadkami i zadaniami zespołowymi w plenerze',
  },
  {
    image: 'https://images.unsplash.com/photo-1529330294680-3bfc221f63d6?auto=format&fit=crop&w=800&q=80',
    title: 'Integracje outdoor',
    description: 'Survival light, zadania terenowe i wyzwania w terenie dla zespołów',
  },
  {
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
    title: 'Integracje indoor',
    description: 'Mobilny escape room, zagadki logiczne i gry integracyjne w sali',
  },
  {
    image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=800&q=80',
    title: 'Wieczory firmowe z programem',
    description: 'Imprezy firmowe z animatorami, konkursami i eventami integracyjnymi',
  },
  {
    image: 'https://images.unsplash.com/photo-1497493292307-31c376b6e479?auto=format&fit=crop&w=800&q=80',
    title: 'Integracje kreatywne',
    description: 'Video challenge, warsztaty team buildingowe i zadania kreatywne',
  },
  {
    image: 'https://images.unsplash.com/photo-1518600506278-4e8ef466b810?auto=format&fit=crop&w=800&q=80',
    title: 'Duże integracje 100-500+',
    description: 'Budowanie zespołu w dużych grupach z profesjonalną koordynacją',
  },
];

export default function IntegrationsTypes({
  title = 'Rodzaje integracji',
  subtitle = 'Dopasowane do Twojego zespołu',
  types = defaultTypes,
}: IntegrationsTypesProps) {
  return (
    <section className="bg-[#0f1119] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
            {title}
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            {subtitle}
          </p>
        </div>

        {/* Types Grid */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {types.map((type, index) => (
            <div
              key={index}
              className="group relative overflow-hidden rounded-2xl bg-[#1c1f33] transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl hover:shadow-[#d3bb73]/10"
            >
              {/* Image */}
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={type.image}
                  alt={type.title}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#1c1f33] via-[#1c1f33]/60 to-transparent" />
              </div>

              {/* Content */}
              <div className="relative p-6">
                <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">
                  {type.title}
                </h3>
                <p className="mb-4 font-light leading-relaxed text-[#e5e4e2]/70">
                  {type.description}
                </p>

                {/* Arrow */}
                <div className="flex items-center gap-2 text-[#d3bb73] transition-all group-hover:gap-4">
                  <span className="text-sm font-light">Dowiedz się więcej</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>

              {/* Border Animation */}
              <div className="absolute inset-x-0 bottom-0 h-1 w-0 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-500 group-hover:w-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
