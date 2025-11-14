import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { FC } from 'react';
import { Action, ResponsiveActionBar } from '../ResponsiveActionBar';

interface CrmHeaderProps {
  title: string;
  actions?: Action[];
  backButtonPath?: string;
}

export const CrmHeader: FC<CrmHeaderProps> = ({ title, actions, backButtonPath }) => {
  const router = useRouter();
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#d3bb73]/10 bg-[#0f1119]/80 backdrop-blur-sm py-2 px-3">
      {backButtonPath && (
        <button
          onClick={() => router.push(backButtonPath)}
          className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
        >
          <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
        </button>
      )}
      <h2 className="text-xl md:text-2xl font-light text-[#e5e4e2]">{title}</h2>
      {actions && (
        <div className="ml-auto">
          <ResponsiveActionBar actions={actions} />
        </div>
      )}
    </div>
  );
};
