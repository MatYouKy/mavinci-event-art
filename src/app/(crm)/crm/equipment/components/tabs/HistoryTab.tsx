import { History } from 'lucide-react';

export function HistoryTab({ history }: { history: any[] }) {
  if (!history?.length) {
    return (
      <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
        <History className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Brak historii zdarzeń</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {history.map((e: any) => (
        <div key={e.id} className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-medium text-blue-400">{e.event_type}</span>
            <span className="text-xs text-[#e5e4e2]/40">{new Date(e.event_date || e.created_at).toLocaleString('pl-PL')}</span>
          </div>
          {e.notes && <div className="text-sm text-[#e5e4e2]/60">{e.notes}</div>}
        </div>
      ))}
    </div>
  );
}