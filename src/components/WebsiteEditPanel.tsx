'use client';

import { useState } from 'react';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { Edit, X, Home, Briefcase, Users, Image, FileText, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function WebsiteEditPanel() {
  const { canEdit, loading, employee } = useWebsiteEdit();
  const [isOpen, setIsOpen] = useState(false);

  if (loading || !canEdit) {
    return null;
  }

  return (
    <>
      {/* Floating Edit Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="hover:shadow-3xl group fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#d3bb73] text-[#1c1f33] shadow-2xl transition-all hover:bg-[#d3bb73]/90"
          title="Edytuj stronę WWW"
        >
          <Edit className="h-6 w-6 transition-transform group-hover:scale-110" />
        </button>
      )}

      {/* Edit Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-80 overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
          {/* Header */}
          <div className="border-b border-[#d3bb73]/20 bg-gradient-to-r from-[#d3bb73]/20 to-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit className="h-5 w-5 text-[#d3bb73]" />
                <h3 className="font-medium text-[#e5e4e2]">Edycja strony</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 transition-colors hover:bg-[#d3bb73]/10"
              >
                <X className="h-5 w-5 text-[#e5e4e2]/60" />
              </button>
            </div>
            {employee && (
              <p className="mt-1 text-xs text-[#e5e4e2]/60">
                Zalogowany: {employee.nickname || employee.name}
              </p>
            )}
          </div>

          {/* Quick Links */}
          <div className="max-h-96 space-y-1 overflow-y-auto p-3">
            <Link
              href="/admin/dashboard"
              onClick={() => setIsOpen(false)}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d3bb73]/20 transition-colors group-hover:bg-[#d3bb73]/30">
                <Home className="h-4 w-4 text-[#d3bb73]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[#e5e4e2]">Panel administracyjny</p>
                <p className="text-xs text-[#e5e4e2]/60">Zarządzaj treścią strony</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
            </Link>

            <Link
              href="/admin/site-images"
              onClick={() => setIsOpen(false)}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 transition-colors group-hover:bg-blue-500/30">
                <Image className="h-4 w-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[#e5e4e2]">Obrazy strony</p>
                <p className="text-xs text-[#e5e4e2]/60">Tła i zdjęcia</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
            </Link>

            <Link
              href="/portfolio"
              onClick={() => setIsOpen(false)}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/20 transition-colors group-hover:bg-green-500/30">
                <Briefcase className="h-4 w-4 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[#e5e4e2]">Portfolio</p>
                <p className="text-xs text-[#e5e4e2]/60">Zarządzaj projektami</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
            </Link>

            <Link
              href="/zespol"
              onClick={() => setIsOpen(false)}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 transition-colors group-hover:bg-purple-500/30">
                <Users className="h-4 w-4 text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[#e5e4e2]">Zespół</p>
                <p className="text-xs text-[#e5e4e2]/60">Edytuj członków zespołu</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
            </Link>

            <div className="my-2 h-px bg-[#d3bb73]/20" />

            <Link
              href="/crm"
              onClick={() => setIsOpen(false)}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/20 transition-colors group-hover:bg-orange-500/30">
                <FileText className="h-4 w-4 text-orange-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[#e5e4e2]">CRM</p>
                <p className="text-xs text-[#e5e4e2]/60">System zarządzania</p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
