'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { TrendingUp, FileSearch, Eye, Calendar } from 'lucide-react';

interface Stats {
  total: number;
  matched: number;
  watched: number;
  expiringSoon: number;
}

export default function TenderStats() {
  const [stats, setStats] = useState<Stats>({ total: 0, matched: 0, watched: 0, expiringSoon: 0 });

  useEffect(() => {
    const fetchStats = async () => {
      const [totalRes, matchedRes, watchedRes, expiringRes] = await Promise.all([
        supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .or('is_hidden.eq.false,is_hidden.is.null'),

        supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .eq('is_matched', true)
          .or('is_hidden.eq.false,is_hidden.is.null'),

        supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .eq('is_watched', true)
          .or('is_hidden.eq.false,is_hidden.is.null'),

        supabase
          .from('tenders')
          .select('id', { count: 'exact', head: true })
          .or('is_hidden.eq.false,is_hidden.is.null')
          .gte('submission_deadline', new Date().toISOString())
          .lte('submission_deadline', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      setStats({
        total: totalRes.count || 0,
        matched: matchedRes.count || 0,
        watched: watchedRes.count || 0,
        expiringSoon: expiringRes.count || 0,
      });
    };

    fetchStats();
  }, []);

  const cards = [
    { label: 'Wszystkie', value: stats.total, icon: FileSearch, color: 'text-[#d3bb73]' },
    { label: 'Dopasowane', value: stats.matched, icon: TrendingUp, color: 'text-green-400' },
    { label: 'Obserwowane', value: stats.watched, icon: Eye, color: 'text-blue-400' },
    {
      label: 'Termin < 7 dni',
      value: stats.expiringSoon,
      icon: Calendar,
      color: 'text-orange-400',
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Icon className={`h-4 w-4 ${card.color}`} />
              <span className="text-xs text-[#e5e4e2]/50">{card.label}</span>
            </div>
            <div className={`text-2xl font-light ${card.color}`}>{card.value}</div>
          </div>
        );
      })}
    </div>
  );
}
