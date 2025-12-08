'use client';

import { FileText, Download, Send, ExternalLink, Pencil, Trash2, RefreshCw } from 'lucide-react';

interface OfferActionsProps {
  offer: any;
  generatingPdf: boolean;
  canSendEmail: boolean;
  onGeneratePdf: () => void;
  onDownloadPdf: () => void;
  onSendEmail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGoToEvent: () => void;
}

export default function OfferActions({
  offer,
  generatingPdf,
  canSendEmail,
  onGeneratePdf,
  onDownloadPdf,
  onSendEmail,
  onEdit,
  onDelete,
  onGoToEvent,
}: OfferActionsProps) {
  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Akcje</h2>

      <div className="grid grid-cols-2 gap-3">
        {!offer.generated_pdf_url ? (
          <button
            onClick={onGeneratePdf}
            disabled={generatingPdf}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Generuje PDF łącząc wszystkie strony produktów"
          >
            {generatingPdf ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Generowanie...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Generuj PDF
              </>
            )}
          </button>
        ) : (
          <>
            <button
              onClick={onDownloadPdf}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
              title="Pobierz wygenerowany PDF"
            >
              <Download className="w-4 h-4" />
              Pobierz PDF
            </button>
            {canSendEmail && (
              <button
                onClick={onSendEmail}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors"
              >
                <Send className="w-4 h-4" />
                Wyślij Email
              </button>
            )}
          </>
        )}

        <button
          onClick={onGoToEvent}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/20 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Przejdź do Eventu
        </button>

        <button
          onClick={onEdit}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
        >
          <Pencil className="w-4 h-4" />
          Edytuj
        </button>

        <button
          onClick={onDelete}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors col-span-2"
        >
          <Trash2 className="w-4 h-4" />
          Usuń Ofertę
        </button>
      </div>
    </div>
  );
}
