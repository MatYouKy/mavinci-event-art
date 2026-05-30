'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileSearch, Settings, BarChart3 } from 'lucide-react';

const navItems = [
  { href: '/crm/tenders', label: 'Przetargi', icon: FileSearch },
  { href: '/crm/tenders/config', label: 'Konfiguracja filtrów', icon: Settings },
];

export default function CrmSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-[#d3bb73]/10 bg-[#0f1119]">
      <div className="flex items-center gap-3 border-b border-[#d3bb73]/10 px-6 py-5">
        <BarChart3 className="h-6 w-6 text-[#d3bb73]" />
        <span className="text-lg font-medium text-[#e5e4e2]">Monitor Przetargów</span>
      </div>

      <nav className="flex-1 px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-[#d3bb73]/10 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/60 hover:bg-[#1c1f33] hover:text-[#e5e4e2]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-[#d3bb73]/10 px-4 py-4">
        <div className="rounded-lg bg-[#1c1f33] px-3 py-2 text-xs text-[#e5e4e2]/40">
          Źródła: BZP, TED, Baza Konkurencyjności
        </div>
      </div>
    </aside>
  );
}
