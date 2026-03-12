'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, Save, Eye, Edit3 } from 'lucide-react';
import dynamic from 'next/dynamic';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

interface Props {
  productId: string;
  initialClauses: string | null;
  canEdit: boolean;
  onSave: (clauses: string) => Promise<void>;
}

const modules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['clean'],
  ],
};

const formats = [
  'header',
  'bold',
  'italic',
  'underline',
  'list',
  'bullet',
  'align',
];

export function ProductContractClauses({ productId, initialClauses, canEdit, onSave }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [clauses, setClauses] = useState(initialClauses || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setClauses(initialClauses || '');
  }, [initialClauses]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(clauses);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setClauses(initialClauses || '');
    setIsEditing(false);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Rekomendowane klauzule umowy
              </h3>
              <p className="text-sm text-gray-600">
                Dodatkowe paragrafy automatycznie wstawiane do umów zawierających ten produkt
              </p>
            </div>
          </div>

          {canEdit && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancel}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Zapisywanie...' : 'Zapisz'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  <Edit3 className="h-4 w-4" />
                  Edytuj
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        {!clauses && !isEditing ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-center">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <p className="mt-2 text-sm font-medium text-gray-900">
              Brak rekomendowanych klauzul
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Ten produkt nie ma zdefiniowanych dodatkowych postanowień umowy
            </p>
            {canEdit && (
              <button
                onClick={() => setIsEditing(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Edit3 className="h-4 w-4" />
                Dodaj klauzule
              </button>
            )}
          </div>
        ) : isEditing ? (
          <div className="contract-clauses-editor">
            <style jsx global>{`
              .contract-clauses-editor .ql-container {
                background: white;
                border: 1px solid #e5e7eb;
                border-radius: 0 0 8px 8px;
                font-family: 'Arial', sans-serif;
              }

              .contract-clauses-editor .ql-toolbar {
                background: #f9fafb;
                border: 1px solid #e5e7eb;
                border-radius: 8px 8px 0 0;
                border-bottom: none;
              }

              .contract-clauses-editor .ql-editor {
                min-height: 300px;
                font-size: 14px;
                line-height: 1.8;
                color: #000000;
              }

              .contract-clauses-editor .ql-editor p {
                margin-bottom: 1em;
                color: #000000;
              }

              .contract-clauses-editor .ql-editor h1,
              .contract-clauses-editor .ql-editor h2,
              .contract-clauses-editor .ql-editor h3 {
                font-weight: bold;
                margin-top: 1.2em;
                margin-bottom: 0.8em;
                color: #000000;
              }

              .contract-clauses-editor .ql-editor ul,
              .contract-clauses-editor .ql-editor ol {
                padding-left: 24px;
                margin-bottom: 1em;
              }

              .contract-clauses-editor .ql-editor li {
                margin-bottom: 0.5em;
              }
            `}</style>
            <ReactQuill
              theme="snow"
              value={clauses}
              onChange={setClauses}
              modules={modules}
              formats={formats}
              placeholder="Wpisz rekomendowane klauzule umowy..."
            />
            <div className="mt-4 space-y-3 rounded-lg bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                <strong>Wskazówka:</strong> Te klauzule będą automatycznie dodawane do umów,
                które zawierają ten produkt. Możesz użyć zmiennych takich jak{' '}
                <code className="rounded bg-blue-100 px-1 py-0.5">{'{{nazwa_produktu}}'}</code>,{' '}
                <code className="rounded bg-blue-100 px-1 py-0.5">{'{{klient}}'}</code>, itp.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-blue-900 hover:text-blue-700">
                  Przykład klauzul dla streamingu →
                </summary>
                <div className="mt-2 rounded bg-white p-3 text-xs text-gray-700">
                  <p className="font-semibold">§X. POSTANOWIENIA DOTYCZĄCE TRANSMISJI ONLINE</p>
                  <p className="mt-2">
                    1. Zleceniodawca zobowiązany jest do zapewnienia stabilnego łącza internetowego
                    o przepustowości minimum 50 Mb/s upload.
                  </p>
                  <p className="mt-1">
                    2. W przypadku braku odpowiedniej infrastruktury sieciowej, Zleceniobiorca
                    zastrzega sobie prawo do odmowy realizacji usługi streamingu.
                  </p>
                  <p className="mt-1">
                    3. Zleceniobiorca nie ponosi odpowiedzialności za przerwanie transmisji
                    spowodowane problemami z łączem internetowym po stronie Zleceniodawcy.
                  </p>
                </div>
              </details>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-6">
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: clauses }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
