'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function AnalyticsDashboard() {
  const [stats, setStats] = useState({
    totalVisits: 0,
    uniqueVisitors: 0,
    avgTimeOnPage: 0,
    contactForms: 0,
  });

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    // Total visits (last 30 days)
    const { count: totalVisits } = await supabase
      .from('page_analytics')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    // Unique visitors
    const { data: sessions } = await supabase
      .from('page_analytics')
      .select('session_id')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    const uniqueVisitors = new Set(sessions?.map(s => s.session_id)).size;

    // Avg time
    const { data: times } = await supabase
      .from('page_analytics')
      .select('time_on_page')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .gt('time_on_page', 0);

    const avgTimeOnPage = times?.reduce((acc, t) => acc + t.time_on_page, 0) / (times?.length || 1);

    // Contact forms
    const { count: contactForms } = await supabase
      .from('contact_form_submissions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    setStats({
      totalVisits: totalVisits || 0,
      uniqueVisitors,
      avgTimeOnPage: Math.round(avgTimeOnPage || 0),
      contactForms: contactForms || 0,
    });
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-light text-[#e5e4e2] mb-8">Analytics Dashboard</h1>

      <div className="grid grid-cols-4 gap-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.totalVisits}
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Wizyty (30 dni)</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.uniqueVisitors}
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Unikalni</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.avgTimeOnPage}s
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Śr. czas</div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="text-3xl font-light text-[#d3bb73] mb-2">
            {stats.contactForms}
          </div>
          <div className="text-sm text-[#e5e4e2]/60">Formularze</div>
        </div>
      </div>
    </div>
  );
}