'use client';
import type { ComponentType, Ref } from 'react';
export type EventNavigationItem = { id: string; label: string; icon: ComponentType<{ className?: string }> };
export default function EventNavigation({ tabs, activeTab, onChange, scrollRef }: {
  tabs: EventNavigationItem[]; activeTab: string; onChange: (id: string) => void; scrollRef?: Ref<HTMLDivElement>;
}) {
  return <div ref={scrollRef} role="tablist" aria-label="Zakładki wydarzenia" data-crm-tabs="true" className="flex gap-2 overflow-x-auto overscroll-x-contain border-b border-[#d3bb73]/10">
    {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} data-crm-tab-active={activeTab === id ? 'true' : 'false'} onClick={() => onChange(id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === id ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}><Icon className="h-4 w-4" />{label}</button>)}
  </div>;
}
