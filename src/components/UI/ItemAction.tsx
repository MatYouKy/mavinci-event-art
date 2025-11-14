'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Eye, Edit, Trash2, MoreVertical } from 'lucide-react';
import clsx from 'clsx';

type ItemActionsProps = {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: (e?: React.MouseEvent) => void;
  /** Czy pokazywać akcje edycji/usuwania */
  canManage?: boolean;
  /** Tailwindowy breakpoint, poniżej którego pokażemy 3-kropki (domyślnie 'md') */
  collapseBelow?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Dodatkowe klasy dla kontenera */
  className?: string;
  /** Czy pokazać podpowiedzi tekstowe (title) */
  withTitles?: boolean;
};

export const ItemActions: React.FC<ItemActionsProps> = ({
  onView,
  onEdit,
  onDelete,
  canManage = false,
  collapseBelow = 'md',
  className,
  withTitles = true,
}) => {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Zamknij menu po kliknięciu poza
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!popRef.current) return;
      if (!popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const collapseHidden = `hidden ${collapseBelow}:flex`; // np. "hidden md:flex"
  const menuOnly = `${collapseBelow}:hidden`; // np. "md:hidden"

  return (
    <div className={clsx('relative', className)} ref={popRef} onClick={(e) => e.stopPropagation()}>
      {/* Inline actions – widoczne na >= breakpoint */}
      <div className={clsx('flex items-center gap-2', collapseHidden)}>
        {onView && <button
          onClick={onView}
          title={withTitles ? 'Podgląd' : undefined}
          aria-label="Podgląd"
          className="flex items-center justify-center gap-2 bg-[#0f1119] text-[#e5e4e2] px-2 py-2 rounded-lg hover:bg-white/20 transition-colors text-sm"
        >
          <Eye className="w-4 h-4" />
        </button>}

        {canManage && (
          <>
            {onEdit && (
              <button
                onClick={onEdit}
                title={withTitles ? 'Edytuj' : undefined}
                aria-label="Edytuj"
                className="flex items-center justify-center bg-transparent text-[#e5e4e2] px-2 py-2 rounded-lg hover:bg-white/20 transition-colors"
              >
                <Edit className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => onDelete?.(e)}
                title={withTitles ? 'Usuń' : undefined}
                aria-label="Usuń"
                className="flex items-center justify-center bg-transparent text-red-400 px-2 py-2 rounded-lg hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </>
        )}
      </div>

      {/* 3-dot menu – widoczne tylko poniżej breakpointu */}
      <div className={clsx('relative', menuOnly)}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Więcej akcji"
          className="inline-flex items-center justify-center rounded-lg p-2 text-[#e5e4e2] hover:bg-white/20 transition-colors"
        >
          <MoreVertical className="h-5 w-5" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 min-w-[160px] overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] shadow-lg"
          >
            {onView && <button
              onClick={() => {
                onView();
                setOpen(false);
              }}
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#0f1119] transition-colors"
            >
              <Eye className="w-4 h-4" />
              Podgląd
            </button>}

            {canManage && onEdit && (
              <button
                onClick={() => {
                  onEdit();
                  setOpen(false);
                }}
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#0f1119] transition-colors"
              >
                <Edit className="w-4 h-4" />
                Edytuj
              </button>
            )}

            {canManage && onDelete && (
              <button
                onClick={(e) => {
                  onDelete?.(e as any);
                  setOpen(false);
                }}
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Usuń
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};