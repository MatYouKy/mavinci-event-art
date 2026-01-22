'use client';

import { Plus, Mail, Users, Send } from 'lucide-react';

export default function MailingPage() {
  const campaigns = [
    {
      id: '1',
      name: 'Newsletter Październik 2025',
      subject: 'Nowości w ofercie Mavinci Events',
      status: 'sent' as const,
      sent_at: '2025-10-01',
      recipients_count: 42,
      opened_count: 28,
      clicked_count: 12,
    },
    {
      id: '2',
      name: 'Promocja wieczory integracyjne',
      subject: 'Specjalna oferta na integracje firmowe',
      status: 'scheduled' as const,
      scheduled_at: '2025-10-10',
      recipients_count: 35,
      opened_count: 0,
      clicked_count: 0,
    },
  ];

  const statusColors = {
    draft: 'bg-gray-500/20 text-gray-400',
    scheduled: 'bg-yellow-500/20 text-yellow-400',
    sent: 'bg-green-500/20 text-green-400',
  };

  const statusLabels = {
    draft: 'Szkic',
    scheduled: 'Zaplanowana',
    sent: 'Wysłana',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Kampanie mailingowe</h2>
        <button className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
          <Plus className="w-4 h-4" />
          Nowa kampania
        </button>
      </div>

      <div className="grid gap-4">
        {campaigns.map((campaign) => (
          <div
            key={campaign.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-4 flex-1">
                <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
                  <Mail className="w-6 h-6 text-[#d3bb73]" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-medium text-[#e5e4e2]">
                      {campaign.name}
                    </h3>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        statusColors[campaign.status]
                      }`}
                    >
                      {statusLabels[campaign.status]}
                    </span>
                  </div>
                  <p className="text-sm text-[#e5e4e2]/70 mb-1">
                    Temat: {campaign.subject}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/60">
                    <Users className="w-3 h-3" />
                    {campaign.recipients_count} odbiorców
                    {campaign.status === 'sent' && (
                      <>
                        <span>•</span>
                        <span>Wysłana: {new Date(campaign.sent_at).toLocaleDateString('pl-PL')}</span>
                      </>
                    )}
                    {campaign.status === 'scheduled' && (
                      <>
                        <span>•</span>
                        <span>Zaplanowana: {new Date(campaign.scheduled_at!).toLocaleDateString('pl-PL')}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {campaign.status === 'sent' && (
              <div className="pt-4 border-t border-[#d3bb73]/10 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl font-light text-[#e5e4e2]">
                    {campaign.recipients_count}
                  </div>
                  <div className="text-xs text-[#e5e4e2]/60">Wysłane</div>
                </div>
                <div>
                  <div className="text-2xl font-light text-[#d3bb73]">
                    {campaign.opened_count}
                  </div>
                  <div className="text-xs text-[#e5e4e2]/60">Otwarte</div>
                </div>
                <div>
                  <div className="text-2xl font-light text-green-400">
                    {campaign.clicked_count}
                  </div>
                  <div className="text-xs text-[#e5e4e2]/60">Kliknięcia</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
