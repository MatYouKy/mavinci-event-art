import React from 'react';
import { FileText, Plus, Download, Trash2 } from 'lucide-react';

interface EmployeeDocument {
  id: string;
  name: string;
  description?: string | null;
  file_url: string;
  uploaded_at: string;
  expiry_date?: string | null;
}

interface EmployeeDocumentsTabProps {
  documents: EmployeeDocument[];
  onAddDocument: () => void;
  onDeleteDocument: (id: string) => void;
}

export const EmployeeDocumentsTab: React.FC<EmployeeDocumentsTabProps> = ({
  documents,
  onAddDocument,
  onDeleteDocument,
}) => {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-light text-[#e5e4e2]">Dokumenty</h3>

        <button
          onClick={onAddDocument}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj dokument
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="py-12 text-center">
          <FileText className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak dokumentów</p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const isExpired =
              doc.expiry_date && new Date(doc.expiry_date) < new Date();

            return (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-[#d3bb73]" />

                    <div>
                      <h4 className="font-medium text-[#e5e4e2]">{doc.name}</h4>

                      {doc.description && (
                        <p className="text-sm text-[#e5e4e2]/60">
                          {doc.description}
                        </p>
                      )}

                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-[#e5e4e2]/40">
                          {new Date(doc.uploaded_at).toLocaleDateString('pl-PL')}
                        </span>

                        {doc.expiry_date && (
                          <>
                            <span className="text-xs text-[#e5e4e2]/40">•</span>

                            <span
                              className={`text-xs ${
                                isExpired ? 'text-red-400' : 'text-[#e5e4e2]/40'
                              }`}
                            >
                              Ważny do:{' '}
                              {new Date(doc.expiry_date).toLocaleDateString('pl-PL')}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
                  >
                    <Download className="h-4 w-4 text-[#d3bb73]" />
                  </a>

                  <button
                    onClick={() => onDeleteDocument(doc.id)}
                    className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};