"use client";
import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';
import { PRODUCT_SECTION_OPEN_EVENT, requestProductReadinessRefresh } from './productSectionEvents';

export default function ProductSettingsDrawer({ title, description, children, canEdit = false, render, anchor }: {
  title: string; description?: string; children?: ReactNode; canEdit?: boolean; render?: (editing: boolean) => ReactNode;
  /** `id` sekcji — „Uzupełnij” w panelu gotowości otwiera ją i przewija do niej. */
  anchor?: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!anchor) return;
    const openSection = (event: Event) => { if ((event as CustomEvent<string>).detail === anchor) setOpen(true); };
    window.addEventListener(PRODUCT_SECTION_OPEN_EVENT, openSection);
    return () => window.removeEventListener(PRODUCT_SECTION_OPEN_EVENT, openSection);
  }, [anchor]);
  const toggle = () => {
    if (open) requestProductReadinessRefresh();
    setOpen(!open);
  };
  const toggleEditing = () => {
    if (editing) requestProductReadinessRefresh();
    setEditing(!editing);
  };
  return <section id={anchor} className="min-w-0 scroll-mt-6 rounded-xl bg-white/[0.035]">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={toggle} className="flex w-full items-center justify-between gap-4 rounded-xl p-5 text-left hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/40">
      <span><span className="block text-base font-medium text-[#e5e4e2]">{title}</span>{description && <span className="mt-1 block text-xs leading-relaxed text-[#e5e4e2]/50">{description}</span>}</span>
      <ChevronDown className={`h-5 w-5 shrink-0 text-[#d3bb73] transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    <div id={id} hidden={!open} className="min-w-0 px-3 pb-3 sm:px-4 sm:pb-4">
      {render && canEdit && <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        {editing && <span className="text-xs text-[#e5e4e2]/50">Zmiany zatwierdzisz przy poszczególnych pozycjach.</span>}
        <button type="button" onClick={toggleEditing} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73]"><Pencil className="h-4 w-4" />{editing ? 'Zakończ edycję' : 'Edytuj'}</button>
      </div>}
      {render ? render(editing && canEdit) : children}
    </div>
  </section>;
}
