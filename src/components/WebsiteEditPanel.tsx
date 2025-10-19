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
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#1c1f33] rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center group"
          title="Edytuj stronę WWW"
        >
          <Edit className="w-6 h-6 group-hover:scale-110 transition-transform" />
        </button>
      )}

      {/* Edit Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#d3bb73]/20 to-transparent p-4 border-b border-[#d3bb73]/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit className="w-5 h-5 text-[#d3bb73]" />
                <h3 className="text-[#e5e4e2] font-medium">Edycja strony</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#e5e4e2]/60" />
              </button>
            </div>
            {employee && (
              <p className="text-xs text-[#e5e4e2]/60 mt-1">
                Zalogowany: {employee.nickname || employee.name}
              </p>
            )}
          </div>

          {/* Quick Links */}
          <div className="p-3 space-y-1 max-h-96 overflow-y-auto">
            <Link
              href="/admin/dashboard"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#d3bb73]/10 transition-colors group"
            >
              <div className="w-8 h-8 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center group-hover:bg-[#d3bb73]/30 transition-colors">
                <Home className="w-4 h-4 text-[#d3bb73]" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#e5e4e2] font-medium">Panel administracyjny</p>
                <p className="text-xs text-[#e5e4e2]/60">Zarządzaj treścią strony</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
            </Link>

            <Link
              href="/admin/site-images"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#d3bb73]/10 transition-colors group"
            >
              <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                <Image className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#e5e4e2] font-medium">Obrazy strony</p>
                <p className="text-xs text-[#e5e4e2]/60">Tła i zdjęcia</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
            </Link>

            <Link
              href="/portfolio"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#d3bb73]/10 transition-colors group"
            >
              <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center group-hover:bg-green-500/30 transition-colors">
                <Briefcase className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#e5e4e2] font-medium">Portfolio</p>
                <p className="text-xs text-[#e5e4e2]/60">Zarządzaj projektami</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
            </Link>

            <Link
              href="/zespol"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#d3bb73]/10 transition-colors group"
            >
              <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                <Users className="w-4 h-4 text-purple-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#e5e4e2] font-medium">Zespół</p>
                <p className="text-xs text-[#e5e4e2]/60">Edytuj członków zespołu</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
            </Link>

            <div className="h-px bg-[#d3bb73]/20 my-2" />

            <Link
              href="/crm"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#d3bb73]/10 transition-colors group"
            >
              <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center group-hover:bg-orange-500/30 transition-colors">
                <FileText className="w-4 h-4 text-orange-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[#e5e4e2] font-medium">CRM</p>
                <p className="text-xs text-[#e5e4e2]/60">System zarządzania</p>
              </div>
              <ChevronRight className="w-4 h-4 text-[#e5e4e2]/40" />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
