'use client';

import { useState, useRef, useEffect } from 'react';
import { FileText, Save, CreditCard as Edit3, Plus, RotateCcw } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  normalizeContractClausePointListHtml,
  parseContractClausesByCategory,
  type ContractClauseCategory,
  type ContractClausesByCategory,
} from '@/lib/CRM/contracts/contractClauseContent';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';
const ReactQuillWithRef = ReactQuill as React.ComponentType<any>;

const CATEGORY_OPTIONS: Array<{ value: ContractClauseCategory; label: string }> = [
  { value: 'requirements', label: 'Wymagania organizacyjne i techniczne' },
  { value: 'obligations', label: 'Obowiązki zamawiającego' },
  { value: 'risks', label: 'Ryzyka i odpowiedzialność' },
  { value: 'general', label: 'Postanowienia dodatkowe' },
];

interface Props {
  productId: string;
  productVariantId?: string | null;
  productVariantName?: string | null;
  isInherited?: boolean;
  initialClauses: string | null;
  initialCategory: ContractClauseCategory;
  canEdit: boolean;
  onSave: (clausesByCategory: ContractClausesByCategory) => Promise<void>;
  onResetInheritance?: () => Promise<void>;
}

const formats = [
  'header',
  'bold',
  'italic',
  'underline',
  'blockquote',
  'list',
  'bullet',
  'indent',
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
    { value: '{{event_schedule_contract}}', label: 'Pełny termin wydarzenia', description: 'Obsługuje wydarzenia jedno- i wielodniowe' },
  ]},
  { group: 'Lokalizacja', items: [
    { value: '{{location_name}}', label: 'Nazwa lokalizacji', description: 'Centrum Konferencyjne' },
    { value: '{{location_full}}', label: 'Pełny adres lokalizacji', description: 'Centrum Konferencyjne, ul. Przykładowa 1, 00-001 Warszawa' },
    { value: '{{location_address}}', label: 'Adres lokalizacji', description: 'ul. Przykładowa 1' },
    { value: '{{location_city}}', label: 'Miasto lokalizacji', description: 'Warszawa' },
    { value: '{{location_postal_code}}', label: 'Kod pocztowy lokalizacji', description: '00-001' },
  ]},
  { group: 'Finanse', items: [
    { value: '{{budget}}', label: 'Kwota umowy (alias)', description: '10 000,00 zł' },
    { value: '{{budget_words}}', label: 'Kwota umowy (słownie)', description: 'dziesięć tysięcy złotych' },
    { value: '{{budget_netto}}', label: 'Kwota netto po rabacie', description: '10 000,00 zł' },
    { value: '{{budget_netto_words}}', label: 'Kwota netto (słownie)', description: 'dziesięć tysięcy złotych' },
    { value: '{{budget_brutto}}', label: 'Kwota brutto po rabacie', description: '12 300,00 zł' },
    { value: '{{budget_brutto_words}}', label: 'Kwota brutto (słownie)', description: 'dwanaście tysięcy trzysta złotych' },
    { value: '{{budget_before_discount_netto}}', label: 'Netto przed rabatem', description: '10 400,00 zł' },
    { value: '{{discount_amount}}', label: 'Rabat kwotowy netto', description: '400,00 zł' },
    { value: '{{discount_percent}}', label: 'Rabat procentowy', description: '3,85%' },
    { value: '{{deposit_amount}}', label: 'Zaliczka (liczba)', description: '3000.00 PLN' },
    { value: '{{deposit_words}}', label: 'Zaliczka (słownie)', description: 'trzy tysiące złotych' },
  ]},
  { group: 'Oferta', items: [
    { value: '{{offer_items}}', label: 'Tabela pozycji oferty', description: 'Tabela z pozycjami oferty' },
  ]},
];

export function ProductContractClauses({
  productId,
  productVariantId,
  productVariantName,
  isInherited = false,
  initialClauses,
  initialCategory,
  canEdit,
  onSave,
  onResetInheritance,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [category, setCategory] = useState(initialCategory);
  const createInitialClauses = (): ContractClausesByCategory =>
    parseContractClausesByCategory(initialClauses, initialCategory);
  const [clausesByCategory, setClausesByCategory] = useState<ContractClausesByCategory>(createInitialClauses);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [cursorPosition, setCursorPosition] = useState<number | null>(null);
  const quillRef = useRef<any>(null);
  const clauses = clausesByCategory[category] || '';
  const hasAnyClauses = CATEGORY_OPTIONS.some(({ value }) => {
    const content = clausesByCategory[value] || '';
    return content.trim() !== '' && content !== '<p><br></p>';
  });

  useEffect(() => {
    setClausesByCategory(createInitialClauses());
    setCategory(initialCategory);
  }, [initialClauses, initialCategory]);


  const handleSave = async () => {
    setIsSaving(true);
    try {
      const normalizedClauses = CATEGORY_OPTIONS.reduce<ContractClausesByCategory>((result, option) => {
        const normalized = normalizeContractClausePointListHtml(
          clausesByCategory[option.value] || '',
        );
        if (normalized && normalized !== '<p><br></p>') result[option.value] = normalized;
        return result;
      }, {});
      setClausesByCategory(normalizedClauses);
      await onSave(normalizedClauses);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving clauses:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setClausesByCategory(createInitialClauses());
    setCategory(initialCategory);
    setIsEditing(false);
  };

  const insertPlaceholder = (placeholder: string) => {
    // Small delay to ensure React has updated the DOM
    setTimeout(() => {
      // Get the Quill instance
      const quill = quillRef.current?.getEditor?.();

      if (!quill) {
        console.error('Quill editor not available');
        // Fallback: append to end of content
        setClausesByCategory((current) => {
          const currentClause = current[category] || '';
          const withSpace = currentClause.trim() ? currentClause + ' ' : currentClause;
          return { ...current, [category]: withSpace + `<strong>${placeholder}</strong>` };
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
      // Insert the placeholder text with bold formatting
      quill.insertText(position, placeholder, { bold: true });

        // Move cursor to after the inserted text
        const newPosition = position + placeholder.length;
        quill.setSelection(newPosition, 0);

      } catch (error) {
        console.error('Error inserting placeholder:', error);
        // Fallback
        setClausesByCategory((current) => ({
          ...current,
          [category]: (current[category] || '') + `<strong>${placeholder}</strong>`,
        }));
      }

      setSelectedGroup('');
    }, 50); // Small delay for React state update
  };

  const applyAutomaticPointLevel = (level: 0 | 1 | 2) => {
    const quill = quillRef.current?.getEditor?.();
    if (!quill) return;
    quill.focus();
    const selection = quill.getSelection() || {
      index: cursorPosition ?? Math.max(0, quill.getLength() - 1),
      length: 0,
    };
    quill.formatLine(
      selection.index,
      Math.max(1, selection.length),
      { list: 'ordered', indent: level === 0 ? false : level },
      'user',
    );
    quill.setSelection(selection.index, selection.length, 'silent');
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/30 bg-[#351020] shadow-sm">
      <div className="border-b border-[#d3bb73]/25 bg-[#411326] px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-2">
              <FileText className="h-5 w-5 text-[#d3bb73]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[#e5e4e2]">
                Rekomendowane klauzule umowy
              </h3>
              <p className="text-sm text-[#e5e4e2]/55">
                {productVariantName
                  ? `${productVariantName}: ${isInherited ? 'dziedziczy klauzule produktu bazowego' : 'własne klauzule wariantu'}`
                  : 'Dodatkowe paragrafy automatycznie wstawiane do umów zawierających ten produkt'}
              </p>
            </div>
          </div>

          {canEdit && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancel}
                    className="rounded-lg border border-[#d3bb73]/30 bg-[#210811] px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#5a1d37]"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] hover:bg-[#e2cd8d] disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Zapisywanie...' : 'Zapisz'}
                  </button>
                </>
              ) : (
                <>
                  {productVariantId && !isInherited && onResetInheritance && (
                    <button
                      type="button"
                      onClick={() => void onResetInheritance()}
                      className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#210811] px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#5a1d37]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Dziedzicz bazowe
                    </button>
                  )}
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#210811] px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#5a1d37]"
                  >
                    <Edit3 className="h-4 w-4" />
                    {isInherited ? 'Dostosuj wariant' : 'Edytuj'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        {!hasAnyClauses && !isEditing ? (
          <div className="rounded-lg border-2 border-dashed border-[#d3bb73]/30 bg-[#2c0b18] p-8 text-center">
            <FileText className="mx-auto h-12 w-12 text-[#d3bb73]/45" />
            <p className="mt-2 text-sm font-medium text-[#e5e4e2]">
              Brak rekomendowanych klauzul
            </p>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">
              Ten produkt nie ma zdefiniowanych dodatkowych postanowień umowy
            </p>
            {canEdit && (
              <button
                onClick={() => setIsEditing(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] hover:bg-[#e2cd8d]"
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
                background: #fffaf4;
                border: 1px solid rgba(211, 187, 115, 0.45);
                border-radius: 0 0 8px 8px;
                font-family: Georgia, serif;
              }

              .contract-clauses-editor .ql-toolbar {
                background: #411326;
                border: 1px solid rgba(211, 187, 115, 0.45);
                border-radius: 8px 8px 0 0;
                border-bottom: none;
              }

              .contract-clauses-editor .ql-editor {
                min-height: 300px;
                font-size: 12pt;
                line-height: 1.6;
                color: #000000;
              }

              .contract-clauses-editor .ql-editor p {
                margin-bottom: 0.5em;
                color: #000000;
              }

              .contract-clauses-editor .ql-editor h1,
              .contract-clauses-editor .ql-editor h2,
              .contract-clauses-editor .ql-editor h3 {
                font-weight: bold;
                margin-top: 0.7em;
                margin-bottom: 0.35em;
                color: #000000;
              }

              .contract-clauses-editor .ql-editor ul,
              .contract-clauses-editor .ql-editor ol {
                padding-left: 24px;
                margin-bottom: 0.5em;
              }

              .contract-clauses-editor .ql-editor li {
                margin-bottom: 0.2em;
              }

              .contract-clauses-editor .ql-editor ol li.ql-indent-1::before {
                content: counter(list-0) '.' counter(list-1) ' ';
              }

              .contract-clauses-editor .ql-editor ol li.ql-indent-2::before {
                content: counter(list-0) '.' counter(list-1) '.' counter(list-2) ' ';
              }

              .contract-clauses-editor .ql-editor ol li.ql-indent-3::before {
                content: counter(list-0) '.' counter(list-1) '.' counter(list-2) '.' counter(list-3) ' ';
              }

              .contract-clauses-editor .ql-editor blockquote {
                margin: 1em 0;
                border-left: 3px solid #d3bb73;
                padding-left: 1em;
              }

              .contract-clauses-editor .ql-toolbar .ql-stroke {
                stroke: #e5e4e2;
              }

              .contract-clauses-editor .ql-toolbar .ql-fill {
                fill: #e5e4e2;
              }

              .contract-clauses-editor .ql-toolbar .ql-picker {
                color: #e5e4e2;
              }

              .contract-clauses-editor .ql-toolbar button:hover .ql-stroke,
              .contract-clauses-editor .ql-toolbar button.ql-active .ql-stroke {
                stroke: #d3bb73;
              }

              .contract-clauses-editor .ql-toolbar button:hover .ql-fill,
              .contract-clauses-editor .ql-toolbar button.ql-active .ql-fill {
                fill: #d3bb73;
              }

              /* Dark theme for prose */
              .contract-clauses-editor .prose-invert p {
                color: #e5e7eb;
              }

              .contract-clauses-editor .prose-invert strong {
                color: #f3f4f6;
                font-weight: 600;
              }

              .contract-clauses-editor .prose-invert h1,
              .contract-clauses-editor .prose-invert h2,
              .contract-clauses-editor .prose-invert h3 {
                color: #f9fafb;
              }

              .contract-clauses-editor .prose-invert li {
                color: #e5e7eb;
              }

              .contract-clauses-editor .prose-invert ol,
              .contract-clauses-editor .prose-invert ul {
                color: #e5e7eb;
              }
            `}</style>

            <div className="mb-3 space-y-2">
              <label className="block text-sm text-[#e5e4e2]/70">
                Miejsce klauzuli w umowie
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as ContractClauseCategory)}
                  className="mt-1 w-full rounded-md border border-[#d3bb73]/30 bg-[#210811] px-3 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-[#e5e4e2]/45">
                  Każda pozycja trafia do osobnego placeholdera w szablonie umowy.
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#d3bb73]/25 bg-[#411326] p-3">
                <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <Plus className="h-4 w-4 text-[#d3bb73]" />
                  <span className="font-medium">Wstaw zmienną:</span>
                </div>
                <button
                  type="button"
                  onClick={() => insertPlaceholder('§n')}
                  className="rounded-md border border-[#d3bb73]/45 bg-[#d3bb73]/10 px-3 py-1.5 text-sm font-semibold text-[#d3bb73] hover:bg-[#d3bb73]/20"
                  title="Numer zostanie wyliczony w gotowej umowie"
                >
                  §n — automatyczny paragraf
                </button>
                <button
                  type="button"
                  onClick={() => applyAutomaticPointLevel(0)}
                  className="rounded-md border border-[#d3bb73]/45 bg-[#d3bb73]/10 px-3 py-1.5 text-sm font-semibold text-[#d3bb73] hover:bg-[#d3bb73]/20"
                  title="Numer punktu głównego wynika z kolejności klauzul w gotowej umowie"
                >
                  1. punkt główny
                </button>
                <button
                  type="button"
                  onClick={() => applyAutomaticPointLevel(1)}
                  className="rounded-md border border-[#d3bb73]/45 bg-[#d3bb73]/10 px-3 py-1.5 text-sm font-semibold text-[#d3bb73] hover:bg-[#d3bb73]/20"
                  title="Pierwszy poziom zagnieżdżenia jest liczony jako 1.1, 1.2, 1.3…"
                >
                  1.1 podpunkt
                </button>
                <button
                  type="button"
                  onClick={() => applyAutomaticPointLevel(2)}
                  className="rounded-md border border-[#d3bb73]/45 bg-[#d3bb73]/10 px-3 py-1.5 text-sm font-semibold text-[#d3bb73] hover:bg-[#d3bb73]/20"
                  title="Drugi poziom zagnieżdżenia jest liczony jako 1.1.1, 1.1.2…"
                >
                  1.1.1 podpunkt
                </button>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="rounded-md border border-[#d3bb73]/30 bg-[#210811] px-3 py-1.5 text-sm text-[#e5e4e2] hover:bg-[#5a1d37] focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
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
                      const value = e.target.value;
                      if (value) {
                        insertPlaceholder(value);
                      } else {
                      }
                    }}
                    className="min-w-[300px] flex-1 rounded-md border border-[#d3bb73]/30 bg-[#210811] px-3 py-1.5 text-sm text-[#e5e4e2] hover:bg-[#5a1d37] focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
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
                <div className="px-3 text-xs text-[#e5e4e2]/45">
                  💡 Wybierz zmienną z listy - zostanie wstawiona w miejscu kursora w edytorze
                </div>
              )}
              <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-2 text-xs leading-relaxed text-[#e5e4e2]/75">
                Tutaj określasz wyłącznie strukturę: paragraf, tytuł, akapit, listę, podpunkt
                i wyróżnienia. Wcięcia oraz świadomie ustawione wyrównanie są zachowywane.
                Font, rozmiar, interlinia i odstępy pobierane są z wybranego szablonu umowy.
              </div>
            </div>

            <ReactQuillWithRef
              ref={quillRef}
              theme="snow"
              value={clauses}
              onChange={(content, delta, source, editor) => {
                setClausesByCategory((current) => ({ ...current, [category]: content }));
                try {
                  const selection = editor.getSelection();
                  if (selection) {
                    setCursorPosition(selection.index);
                  }
                } catch (e) {
                }
              }}
              onChangeSelection={(range) => {
                if (range) {
                  setCursorPosition(range.index);
                }
              }}
              modules={{
                toolbar: [
                  [{ header: [1, 2, 3, false] }],
                  ['bold', 'italic', 'underline'],
                  ['blockquote'],
                  [{ list: 'ordered' }, { list: 'bullet' }],
                  [{ indent: '-1' }, { indent: '+1' }],
                  [{ align: [] }],
                  ['clean'],
                ],
              }}
              formats={formats}
              placeholder="Wpisz rekomendowane klauzule umowy..."
            />
            <div className="mt-4 space-y-3 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-4">
              <p className="text-sm text-[#e5e4e2]/80">
                <strong className="text-[#d3bb73]">Wskazówka:</strong> Te klauzule będą automatycznie dodawane do umów,
                które zawierają ten produkt. Użyj dropdownów &quot;Wstaw zmienną&quot; powyżej, aby dodać dynamiczne pola.
              </p>
              <p className="text-xs text-[#e5e4e2]/70">
                Wstaw <strong>§n</strong> na początku nowego paragrafu. W gotowej umowie system
                zastąpi kolejne wystąpienia przez §1, §2, §3 itd.
              </p>
              <p className="text-xs text-[#e5e4e2]/70">
                Punkty klauzul są numerowane dopiero w gotowej umowie. Użyj przycisków
                <strong> 1.</strong>, <strong>1.1</strong> i <strong>1.1.1</strong>; nie wpisuj numerów ręcznie.
                Tab tworzy podpunkt, a Shift+Tab wraca poziom wyżej.
              </p>
              <p className="text-xs text-[#e5e4e2]/45">
                Zmienne są automatycznie wypełniane danymi z wydarzenia, klienta i organizacji podczas generowania umowy.
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-[#d3bb73] hover:text-[#e2cd8d]">
                  Przykład klauzul dla streamingu →
                </summary>
                <div className="mt-2 rounded-lg border border-[#d3bb73]/20 bg-[#210811] p-3 text-xs text-[#e5e4e2]/70">
                  <p className="font-semibold text-[#e5e4e2]">§X. POSTANOWIENIA DOTYCZĄCE TRANSMISJI ONLINE</p>
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
          <div className="overflow-hidden rounded-lg border border-[#d3bb73]/25 bg-[#2c0b18]">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#411326] px-5 py-3">
              <div>
                <div className="text-sm font-medium text-[#e5e4e2]">Podgląd struktury klauzuli</div>
                <div className="mt-0.5 text-xs text-[#e5e4e2]/45">
                  Ostateczny wygląd nada wybrany szablon umowy
                </div>
              </div>
              <span className="rounded border border-[#d3bb73]/25 bg-[#d3bb73]/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#d3bb73]">
                bez dekoracji edytora
              </span>
            </div>
            <style jsx>{`
              .clause-structure-preview {
                color: #111827;
                font-family: Georgia, serif;
                font-size: 12pt;
                line-height: 1.6;
              }
              .clause-structure-preview :global(p) {
                margin: 0 0 6pt;
                color: inherit;
                text-align: justify;
              }
              .clause-structure-preview :global([data-contract-paragraph='true']) {
                margin: 8pt 0 4pt;
                text-align: center;
                font-weight: 700;
              }
              .clause-structure-preview :global([data-clause-role='title']) {
                margin: 4pt 0 3pt;
                text-align: left;
                font-weight: 700;
              }
              .clause-structure-preview :global([data-clause-align='left']) { text-align: left; }
              .clause-structure-preview :global([data-clause-align='center']) { text-align: center; }
              .clause-structure-preview :global([data-clause-align='right']) { text-align: right; }
              .clause-structure-preview :global([data-clause-align='justify']) { text-align: justify; }
              .clause-structure-preview :global([data-clause-indent='1']) { margin-left: 1.5em; }
              .clause-structure-preview :global([data-clause-indent='2']) { margin-left: 3em; }
              .clause-structure-preview :global([data-clause-indent='3']) { margin-left: 4.5em; }
              .clause-structure-preview :global([data-clause-indent='4']) { margin-left: 6em; }
              .clause-structure-preview :global(strong),
              .clause-structure-preview :global(b) {
                font-weight: 700;
              }
              .clause-structure-preview :global(h1),
              .clause-structure-preview :global(h2),
              .clause-structure-preview :global(h3) {
                margin: 4pt 0 3pt;
                color: inherit;
                font-size: 12pt;
                font-weight: 700;
              }
              .clause-structure-preview :global(ul),
              .clause-structure-preview :global(ol) {
                margin: 0 0 3pt;
                padding-left: 1.65em;
              }
              .clause-structure-preview :global(ul) {
                list-style-type: disc;
              }
              .clause-structure-preview :global(ol) {
                list-style-type: decimal;
              }
              .clause-structure-preview :global(ol[data-clause-marker='outline-decimal']) {
                list-style-type: decimal;
              }
              .clause-structure-preview :global(ol[data-clause-marker='outline-decimal'] ol[data-clause-marker='outline-decimal'] > li::marker) {
                content: counters(list-item, '.') ' ';
              }
              .clause-structure-preview :global(ol[data-clause-marker='lower-alpha']) {
                list-style-type: lower-alpha;
              }
              .clause-structure-preview :global(ol[data-clause-marker='lower-roman']) {
                list-style-type: lower-roman;
              }
              .clause-structure-preview :global(ol[data-clause-marker='decimal-paren'] > li::marker) {
                content: counter(list-item) '. ';
              }
              .clause-structure-preview :global(ol[data-clause-marker='lower-alpha-paren'] > li::marker) {
                content: counter(list-item, lower-alpha) '. ';
              }
              .clause-structure-preview :global(ol[data-clause-marker='lower-roman-paren'] > li::marker) {
                content: counter(list-item, lower-roman) '. ';
              }
              .clause-structure-preview :global(ol[data-clause-marker='bullet']) {
                list-style-type: disc;
              }
              .clause-structure-preview :global(li) {
                margin: 0 0 2pt;
                color: inherit;
              }
              .clause-structure-preview :global(blockquote) {
                margin: 4pt 0;
                border-left: 2px solid #6b7280;
                padding-left: 8pt;
              }
            `}</style>
            <div className="space-y-5 bg-white px-8 py-7">
              {CATEGORY_OPTIONS.map((option) => {
                const content = normalizeContractClausePointListHtml(
                  clausesByCategory[option.value] || '',
                );
                if (!content || content === '<p><br></p>') return null;
                return (
                  <section key={option.value}>
                    <div className="mb-2 border-b border-[#d3bb73]/45 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#6b213f]">
                      {option.label}
                    </div>
                    <div
                      className="clause-structure-preview"
                      suppressHydrationWarning
                      dangerouslySetInnerHTML={{ __html: content }}
                    />
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
