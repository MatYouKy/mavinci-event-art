import React, { FC } from 'react';
import { Package } from 'lucide-react';
import { iconMap } from '../ConferencesPage';
import { useMobile } from '@/hooks/useMobile';

interface AdvantagesSectionProps {
  advantages: any[];
}

export const AdvantagesSection: FC<AdvantagesSectionProps> = ({ advantages }) => {
  const isMobile = useMobile();
  const getIcon = (iconName: string) => {
    const Icon = iconMap[iconName] || Package;
    return Icon;
  };
  return (
    <section className="bg-[#1c1f33]/30 px-6 py-12 md:px-12 md:py-20">
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-8 text-center text-4xl font-light text-[#e5e4e2] md:mb-16">
          Dlaczego <span className="text-[#d3bb73]">MAVINCI?</span>
        </h2>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {advantages.map((adv) => {
            const Icon = getIcon(adv.icon_name);
            return isMobile ? (
              <AdvantageMobileItem title={adv.title} description={adv.description} Icon={Icon} />
            ) : (
              <AdvantageDesktopItem title={adv.title} description={adv.description} Icon={Icon} />
            );
          })}
        </div>
      </div>
    </section>
  );
};

const AdvantageDesktopItem: FC<{ title: string; description: string; Icon: React.ElementType }> = ({
  title,
  description,
  Icon,
}) => {
  return (
    <div className="flex gap-4">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]">
        <Icon className="h-6 w-6 text-[#1c1f33]" />
      </div>
      <div>
        <h3 className="mb-2 text-xl font-medium text-[#e5e4e2]">{title}</h3>
        <p className="text-sm text-[#e5e4e2]/70">{description}</p>
      </div>
    </div>
  );
};

const AdvantageMobileItem: FC<{ title: string; description: string; Icon: React.ElementType }> = ({
  title,
  description,
  Icon,
}) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#d3bb73]">
          <Icon className="h-4 w-4 text-[#1c1f33]" />
        </div>
        <h3 className="mb-2 text-base font-medium text-[#e5e4e2]">{title}</h3>
      </div>
      <p className="text-xs text-[#e5e4e2]/70">{description}</p>
    </div>
  );
};
