'use client';

import { useEffect, useState } from 'react';
import { History, User, Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface HistoryEntry {
  id: string;
  change_type: string;
  change_description: string;
  created_at: string;
  changed_by_employee?: {
    name: string;
    surname: string;
    avatar_url?: string;
  };
}

interface OfferHistoryProps {
  offerId: string;
}

export default function OfferHistory({ offerId }: OfferHistoryProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();

    const channel = supabase
      .channel('offer-history-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'offer_history',
          filter: `offer_id=eq.${offerId}`,
        },
        () => {
          fetchHistory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [offerId]);

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('offer_history')
        .select(
          `
          *,
          changed_by_employee:employees!changed_by(name, surname, avatar_url)
        `
        )
        .eq('offer_id', offerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case 'created':
        return 'text-green-400';
      case 'status_changed':
        return 'text-blue-400';
      case 'item_added':
        return 'text-purple-400';
      case 'item_removed':
        return 'text-red-400';
      case 'generated_pdf':
        return 'text-[#d3bb73]';
      default:
        return 'text-[#e5e4e2]/60';
    }
  };

  if (loading) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex items-center gap-2 text-[#e5e4e2]/60">
          <History className="w-5 h-5 animate-spin" />
          Ładowanie historii...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h2 className="text-lg font-light text-[#e5e4e2] mb-4 flex items-center gap-2">
        <History className="w-5 h-5" />
        Historia Zmian
      </h2>

      {history.length === 0 ? (
        <div className="text-center py-8 text-[#e5e4e2]/60">
          Brak historii zmian
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="flex gap-3 p-3 bg-[#0d0f1a] border border-[#d3bb73]/10 rounded-lg"
            >
              {entry.changed_by_employee?.avatar_url ? (
                <img
                  src={entry.changed_by_employee.avatar_url}
                  alt="Avatar"
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-[#d3bb73]/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-[#d3bb73]" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${getChangeTypeColor(entry.change_type)}`}>
                      {entry.change_description}
                    </p>
                    {entry.changed_by_employee && (
                      <p className="text-xs text-[#e5e4e2]/60 mt-0.5">
                        {entry.changed_by_employee.name} {entry.changed_by_employee.surname}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[#e5e4e2]/60 whitespace-nowrap">
                    <Clock className="w-3 h-3" />
                    {new Date(entry.created_at).toLocaleString('pl-PL', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
