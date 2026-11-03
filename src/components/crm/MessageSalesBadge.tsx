'use client';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { hasMessageInquiry, salesAiLabel, type MessageSalesContext } from '@/lib/CRM/messages/salesContext';
const stages: Record<string,string> = { new: 'Nowe', contacted: 'Kontakt', qualified: 'Zakwalifikowane', offer: 'Oferta', negotiation: 'Negocjacje', won: 'Wygrane', lost: 'Przegrane' };
export default function MessageSalesBadge({ sales, onOpen }: { sales?: MessageSalesContext; onOpen?: (id: string) => void }) {
  if (!sales || !hasMessageInquiry(sales)) return null;
  return <div className="inline-flex flex-wrap items-center gap-1 text-xs">
    {sales.inquiries.map(i => <div key={i.id} className="inline-flex items-center gap-2 rounded bg-[#d3bb73]/15 px-2 py-1 text-[#d3bb73]">
      {onOpen ? <button type="button" onClick={e => { e.stopPropagation(); onOpen(i.id); }}>W lejku · {i.archived ? 'Archiwum' : stages[i.stage || ''] || 'Zapytanie'}</button> : <span>W lejku · {i.archived ? 'Archiwum' : stages[i.stage || ''] || 'Zapytanie'}</span>}
      {i.ownerId ? <div className="inline-flex" title={`Opiekun: ${i.ownerName || 'Przypisany pracownik'}`} aria-label={`Opiekun: ${i.ownerName || 'Przypisany pracownik'}`}>
        <EmployeeAvatar employeeId={i.ownerId} avatarUrl={i.ownerAvatarUrl} avatarMetadata={i.ownerAvatarMetadata} employeeName={i.ownerName || 'Przypisany pracownik'} size={28} showHoverEffect={false} />
      </div> : <span>Bez opiekuna</span>}
    </div>)}
    {salesAiLabel(sales.aiStatus) && <span className={`rounded px-2 py-1 ${sales.aiStatus === 'failed' || sales.aiStatus === 'manual_review' ? 'bg-amber-500/10 text-amber-200' : 'bg-white/5 text-white/55'}`}>{salesAiLabel(sales.aiStatus)}</span>}
  </div>;
}
