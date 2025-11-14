'use client';

import { useState } from 'react';
import { Users, Briefcase, LogOut, Home, Image, Volume2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import AdminTeamPanel from './AdminTeamPanel';
import AdminPortfolioPanel from './AdminPortfolioPanel';
import AdminSiteImagesPanel from './AdminSiteImagesPanel';
import { AdminNaglosnieniaPanel } from './AdminNaglosnieniaPanel';

type TabType = 'team' | 'portfolio' | 'images' | 'naglosnienia';

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('team');
  const { signOut } = useAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#1c1f33]">
      <div className="border-b border-[#d3bb73]/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <h1 className="text-2xl font-light text-[#e5e4e2]">Panel Administracyjny</h1>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
              >
                <Home className="h-5 w-5" />
                Powrót
              </button>
              <button
                onClick={signOut}
                className="flex items-center gap-2 rounded-lg bg-[#800020]/20 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
              >
                <LogOut className="h-5 w-5" />
                Wyloguj
              </button>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-2 border-b-2 px-6 py-3 transition-colors ${
                activeTab === 'team'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Users className="h-5 w-5" />
              Zespół
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`flex items-center gap-2 border-b-2 px-6 py-3 transition-colors ${
                activeTab === 'portfolio'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Briefcase className="h-5 w-5" />
              Portfolio
            </button>
            <button
              onClick={() => setActiveTab('images')}
              className={`flex items-center gap-2 border-b-2 px-6 py-3 transition-colors ${
                activeTab === 'images'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Image className="h-5 w-5" />
              Obrazy Strony
            </button>
            <button
              onClick={() => setActiveTab('naglosnienia')}
              className={`flex items-center gap-2 border-b-2 px-6 py-3 transition-colors ${
                activeTab === 'naglosnienia'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Volume2 className="h-5 w-5" />
              Nagłośnienia
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === 'team' && <AdminTeamPanel />}
        {activeTab === 'portfolio' && <AdminPortfolioPanel />}
        {activeTab === 'images' && <AdminSiteImagesPanel />}
        {activeTab === 'naglosnienia' && <AdminNaglosnieniaPanel />}
      </div>
    </div>
  );
}
