'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, Save, Eye, CreditCard as Edit3 } from 'lucide-react';
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
      const trimmedClauses = clauses.trim();
      await onSave(trimmedClauses);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving clauses:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setClauses(initialClauses || '');
    setIsEditing(false);
  };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 shadow-sm">
      <div className="border-b border-gray-700 bg-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-100">
                Rekomendowane klauzule umowy
              </h3>
              <p className="text-sm text-gray-400">
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
                    className="rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600"
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
                  className="flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600"
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
        {(!clauses || clauses.trim() === '' || clauses === '<p><br></p>') && !isEditing ? (
          <div className="rounded-lg border-2 border-dashed border-gray-700 bg-gray-800 p-8 text-center">
            <FileText className="mx-auto h-12 w-12 text-gray-600" />
            <p className="mt-2 text-sm font-medium text-gray-200">
              Brak rekomendowanych klauzul
            </p>
            <p className="mt-1 text-sm text-gray-400">
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

              /* Dark theme for prose */
              .prose-invert p {
                color: #e5e7eb;
              }

              .prose-invert strong {
                color: #f3f4f6;
                font-weight: 600;
              }

              .prose-invert h1,
              .prose-invert h2,
              .prose-invert h3 {
                color: #f9fafb;
              }

              .prose-invert li {
                color: #e5e7eb;
              }

              .prose-invert ol,
              .prose-invert ul {
                color: #e5e7eb;
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
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
            <style jsx>{`
              div :global(p) {
                color: #e5e7eb;
                margin-bottom: 1em;
                line-height: 1.7;
              }
              div :global(strong) {
                color: #f3f4f6;
                font-weight: 600;
              }
              div :global(em) {
                color: #d1d5db;
              }
              div :global(h1),
              div :global(h2),
              div :global(h3) {
                color: #f9fafb;
                font-weight: bold;
                margin-top: 1.5em;
                margin-bottom: 0.8em;
              }
              div :global(ul),
              div :global(ol) {
                color: #e5e7eb;
                padding-left: 1.5em;
                margin-bottom: 1em;
              }
              div :global(li) {
                color: #e5e7eb;
                margin-bottom: 0.5em;
              }
            `}</style>
            <div dangerouslySetInnerHTML={{ __html: clauses }} />
          </div>
        )}
      </div>
    </div>
  );
}
