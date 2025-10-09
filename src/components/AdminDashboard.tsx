'use client';

import { useState } from 'react';
import { Users, Briefcase, LogOut, Home, Image, Volume2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from 'next/navigation';;
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <h1 className="text-2xl font-light text-[#e5e4e2]">Panel Administracyjny</h1>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
              >
                <Home className="w-5 h-5" />
                Powrót
              </button>
              <button
                onClick={signOut}
                className="flex items-center gap-2 px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Wyloguj
              </button>
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-colors ${
                activeTab === 'team'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Users className="w-5 h-5" />
              Zespół
            </button>
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-colors ${
                activeTab === 'portfolio'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Briefcase className="w-5 h-5" />
              Portfolio
            </button>
            <button
              onClick={() => setActiveTab('images')}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-colors ${
                activeTab === 'images'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Image className="w-5 h-5" />
              Obrazy Strony
            </button>
            <button
              onClick={() => setActiveTab('naglosnienia')}
              className={`flex items-center gap-2 px-6 py-3 border-b-2 transition-colors ${
                activeTab === 'naglosnienia'
                  ? 'border-[#d3bb73] text-[#d3bb73]'
                  : 'border-transparent text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
              }`}
            >
              <Volume2 className="w-5 h-5" />
              Nagłośnienia
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'team' && <AdminTeamPanel />}
        {activeTab === 'portfolio' && <AdminPortfolioPanel />}
        {activeTab === 'images' && <AdminSiteImagesPanel />}
        {activeTab === 'naglosnienia' && <AdminNaglosnieniaPanel />}
      </div>
    </div>
  );
}
