'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, Save, Eye, CreditCard as Edit3, ChevronDown, Plus } from 'lucide-react';
import dynamic from 'next/dynamic';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';

interface Props {
  productId: string;
  initialClauses: string | null;
  canEdit: boolean;
  onSave: (clauses: string) => Promise<void>;
}

const toolbarOptions = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ align: [] }],
  ['clean'],
];

const formats = [
  'header',
  'bold',
  'italic',
  'underline',
  'list',
  'bullet',
  'align',
];

const PLACEHOLDERS = [
  { group: 'Klient', items: [
    { value: '{{contact_first_name}}', label: 'Imię kontaktu', description: 'Jan' },
    { value: '{{contact_last_name}}', label: 'Nazwisko kontaktu', description: 'Kowalski' },
    { value: '{{contact_full_name}}', label: 'Pełne imię i nazwisko', description: 'Jan Kowalski' },
    { value: '{{contact_email}}', label: 'Email kontaktu', description: 'jan@example.com' },
    { value: '{{contact_phone}}', label: 'Telefon kontaktu', description: '+48 123 456 789' },
    { value: '{{contact_address}}', label: 'Adres kontaktu', description: 'ul. Przykładowa 1' },
    { value: '{{contact_city}}', label: 'Miasto kontaktu', description: 'Warszawa' },
    { value: '{{contact_postal_code}}', label: 'Kod pocztowy', description: '00-001' },
    { value: '{{contact_pesel}}', label: 'PESEL', description: '12345678901' },
  ]},
  { group: 'Organizacja', items: [
    { value: '{{organization_name}}', label: 'Nazwa firmy', description: 'ABC Sp. z o.o.' },
    { value: '{{organization_legal_form}}', label: 'Forma prawna', description: 'Spółka z o.o.' },
    { value: '{{organization_nip}}', label: 'NIP', description: '1234567890' },
    { value: '{{organization_regon}}', label: 'REGON', description: '123456789' },
    { value: '{{organization_krs}}', label: 'KRS', description: '0000123456' },
    { value: '{{legal_representative_full_name}}', label: 'Przedstawiciel prawny', description: 'Jan Kowalski' },
    { value: '{{legal_representative_title}}', label: 'Stanowisko przedstawiciela', description: 'Prezes' },
    { value: '{{decision_makers_list}}', label: 'Lista decydentów', description: 'Lista osób decyzyjnych' },
    { value: '{{primary_contact_full_name}}', label: 'Główny kontakt', description: 'Jan Kowalski' },
    { value: '{{primary_contact_email}}', label: 'Email głównego kontaktu', description: 'kontakt@firma.pl' },
    { value: '{{primary_contact_phone}}', label: 'Telefon głównego kontaktu', description: '+48 123 456 789' },
    { value: '{{primary_contact_position}}', label: 'Stanowisko głównego kontaktu', description: 'Kierownik' },
  ]},
  { group: 'Wydarzenie', items: [
    { value: '{{event_name}}', label: 'Nazwa wydarzenia', description: 'Konferencja 2024' },
    { value: '{{event_date}}', label: 'Data wydarzenia (pełna)', description: '15 marca 2024 r., 10:00' },
    { value: '{{event_date_only}}', label: 'Data wydarzenia (tylko data)', description: '15 marca 2024 r.' },
    { value: '{{event_end_date}}', label: 'Data zakończenia (pełna)', description: '15 marca 2024 r., 18:00' },
    { value: '{{event_end_date_only}}', label: 'Data zakończenia (tylko data)', description: '15 marca 2024 r.' },
    { value: '{{event_time_start}}', label: 'Godzina rozpoczęcia', description: '10:00' },
    { value: '{{event_time_end}}', label: 'Godzina zakończenia', description: '18:00' },
  ]},
  { group: 'Lokalizacja', items: [
    { value: '{{location_name}}', label: 'Nazwa lokalizacji', description: 'Centrum Konferencyjne' },
    { value: '{{location_full}}', label: 'Pełny adres lokalizacji', description: 'Centrum Konferencyjne, ul. Przykładowa 1, 00-001 Warszawa' },
    { value: '{{location_address}}', label: 'Adres lokalizacji', description: 'ul. Przykładowa 1' },
    { value: '{{location_city}}', label: 'Miasto lokalizacji', description: 'Warszawa' },
    { value: '{{location_postal_code}}', label: 'Kod pocztowy lokalizacji', description: '00-001' },
  ]},
  { group: 'Finanse', items: [
    { value: '{{budget}}', label: 'Wartość umowy (liczba)', description: '10000.00 PLN' },
    { value: '{{budget_words}}', label: 'Wartość umowy (słownie)', description: 'dziesięć tysięcy złotych' },
    { value: '{{deposit_amount}}', label: 'Zaliczka (liczba)', description: '3000.00 PLN' },
    { value: '{{deposit_words}}', label: 'Zaliczka (słownie)', description: 'trzy tysiące złotych' },
  ]},
  { group: 'Oferta', items: [
    { value: '{{offer_items}}', label: 'Tabela pozycji oferty', description: 'Tabela z pozycjami oferty' },
  ]},
];

export function ProductContractClauses({ productId, initialClauses, canEdit, onSave }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [clauses, setClauses] = useState(initialClauses || '');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [cursorPosition, setCursorPosition] = useState<number | null>(null);
  const quillRef = useRef<any>(null);

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

  const insertPlaceholder = (placeholder: string) => {
    console.log('insertPlaceholder called with:', placeholder);

    // Small delay to ensure React has updated the DOM
    setTimeout(() => {
      // Get the Quill instance
      const quill = quillRef.current?.getEditor?.();

      if (!quill) {
        console.error('Quill editor not available');
        // Fallback: append to end of content
        setClauses(prev => {
          const withSpace = prev.trim() ? prev + ' ' : prev;
          return withSpace + `<strong>${placeholder}</strong>`;
        });
        setSelectedGroup('');
        return;
      }

      // Ensure editor has focus
      quill.focus();

      try {
      // Get current selection or cursor position
      const selection = quill.getSelection();
      let position: number;

      if (selection) {
        position = selection.index;
      } else if (cursorPosition !== null) {
        position = cursorPosition;
      } else {
        position = quill.getLength() - 1;
      }

      console.log('Inserting at position:', position, 'from selection:', selection, 'stored:', cursorPosition);

      // Insert the placeholder text with bold formatting
      quill.insertText(position, placeholder, { bold: true });

        // Move cursor to after the inserted text
        const newPosition = position + placeholder.length;
        quill.setSelection(newPosition, 0);

        console.log('Successfully inserted placeholder');
      } catch (error) {
        console.error('Error inserting placeholder:', error);
        // Fallback
        setClauses(prev => prev + `<strong>${placeholder}</strong>`);
      }

      setSelectedGroup('');
    }, 50); // Small delay for React state update
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

            <div className="mb-3 space-y-2">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-700 bg-gray-800 p-3">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Plus className="h-4 w-4 text-blue-400" />
                  <span className="font-medium">Wstaw zmienną:</span>
                </div>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="rounded-md border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Wybierz kategorię...</option>
                  {PLACEHOLDERS.map((group) => (
                    <option key={group.group} value={group.group}>
                      {group.group}
                    </option>
                  ))}
                </select>

                {selectedGroup && (
                  <select
                    value=""
                    onChange={(e) => {
                      console.log('Select onChange triggered:', e.target.value);
                      const value = e.target.value;
                      if (value) {
                        console.log('Calling insertPlaceholder with:', value);
                        insertPlaceholder(value);
                      } else {
                        console.log('Empty value, skipping insert');
                      }
                    }}
                    className="flex-1 min-w-[300px] rounded-md border border-gray-600 bg-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Wybierz zmienną...</option>
                    {PLACEHOLDERS.find((g) => g.group === selectedGroup)?.items.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label} - {item.description}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedGroup && (
                <div className="text-xs text-gray-400 px-3">
                  💡 Wybierz zmienną z listy - zostanie wstawiona w miejscu kursora w edytorze
                </div>
              )}
            </div>

            <ReactQuill
              ref={quillRef}
              theme="snow"
              value={clauses}
              onChange={(content, delta, source, editor) => {
                setClauses(content);
                // Track cursor position
                try {
                  const selection = editor.getSelection();
                  if (selection) {
                    setCursorPosition(selection.index);
                  }
                } catch (e) {
                  // Ignore errors
                }
              }}
              onChangeSelection={(range) => {
                if (range) {
                  setCursorPosition(range.index);
                }
              }}
              modules={{ toolbar: toolbarOptions }}
              formats={formats}
              placeholder="Wpisz rekomendowane klauzule umowy..."
            />
            <div className="mt-4 space-y-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
              <p className="text-sm text-blue-300">
                <strong className="text-blue-200">Wskazówka:</strong> Te klauzule będą automatycznie dodawane do umów,
                które zawierają ten produkt. Użyj dropdownów &quot;Wstaw zmienną&quot; powyżej, aby dodać dynamiczne pola.
              </p>
              <p className="text-xs text-gray-400">
                Zmienne są automatycznie wypełniane danymi z wydarzenia, klienta i organizacji podczas generowania umowy.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-blue-300 hover:text-blue-200">
                  Przykład klauzul dla streamingu →
                </summary>
                <div className="mt-2 rounded-lg border border-gray-700 bg-gray-800 p-3 text-xs text-gray-300">
                  <p className="font-semibold text-gray-100">§X. POSTANOWIENIA DOTYCZĄCE TRANSMISJI ONLINE</p>
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
