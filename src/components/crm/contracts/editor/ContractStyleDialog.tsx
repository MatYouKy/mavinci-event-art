'use client';

import { useEffect, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, X } from 'lucide-react';
import {
  CONTRACT_STYLE_LABELS,
  type ContractDocumentStyle,
  type ContractStyleId,
  type ContractTextAlign,
} from '@/lib/CRM/contracts/contractDocumentStyles';

export interface ContractStyleDialogProps {
  styleId: ContractStyleId;
  value: ContractDocumentStyle;
  fonts: Array<{ label: string; value: string }>;
  onSave: (value: ContractDocumentStyle) => void;
  onClose: () => void;
}

const SAMPLE: Record<ContractStyleId, string> = {
  title: 'UMOWA O ŚWIADCZENIE USŁUG',
  heading: 'Przedmiot umowy',
  point: 'Wykonawca zobowiązuje się do przygotowania i wykonania usług zamówionych dla wydarzenia.',
  subpoint: 'Zakres, liczba i ceny pozycji wynikają z zaakceptowanej oferty.',
  subsubpoint: 'w tym nagłośnienie, oświetlenie i obsługa techniczna,',
  body: 'Zamawiający i Wykonawca są dalej zwani łącznie „Stronami”, a każdy z osobna „Stroną”.',
  table: 'ZAMAWIAJĄCY',
};

const ALIGNMENTS: Array<{ value: ContractTextAlign; label: string; icon: typeof AlignLeft }> = [
  { value: 'left', label: 'Do lewej', icon: AlignLeft },
  { value: 'center', label: 'Do środka', icon: AlignCenter },
  { value: 'right', label: 'Do prawej', icon: AlignRight },
  { value: 'justify', label: 'Wyjustuj', icon: AlignJustify },
];

function NumberField({ label, value, step, min, max, unit, onChange }: {
  label: string; value: number; step: number; min: number; max: number; unit?: string; onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[#e5e4e2]/70">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(event) => {
            const next = Number(event.target.value.replace(',', '.'));
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          className="w-20 rounded border border-white/15 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
        />
        {unit && <span className="text-[#e5e4e2]/50">{unit}</span>}
      </span>
    </label>
  );
}

/** „Modyfikuj styl” jak w Wordzie: zmiana obowiązuje w całym dokumencie, w podglądzie i w PDF. */
export default function ContractStyleDialog({ styleId, value, fonts, onSave, onClose }: ContractStyleDialogProps) {
  const [draft, setDraft] = useState<ContractDocumentStyle>(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const update = (patch: Partial<ContractDocumentStyle>) => setDraft((current) => ({ ...current, ...patch }));
  const isPoint = styleId === 'point' || styleId === 'subpoint' || styleId === 'subsubpoint';
  const fontOptions = fonts.some((font) => font.value === draft.fontFamily)
    ? fonts
    : [{ label: draft.fontFamily.split(',')[0].replace(/["']/g, ''), value: draft.fontFamily }, ...fonts];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-style-dialog-title"
        className="w-full max-w-xl rounded-xl border border-white/10 bg-[#1c1f33] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 id="contract-style-dialog-title" className="text-base font-medium text-[#e5e4e2]">
            Modyfikuj styl: <span className="text-[#d3bb73]">{CONTRACT_STYLE_LABELS[styleId]}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/10 hover:text-[#e5e4e2]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-xs text-[#e5e4e2]/70">
              Czcionka
              <select
                value={draft.fontFamily}
                onChange={(event) => update({ fontFamily: event.target.value })}
                className="rounded border border-white/15 bg-[#0f1119] px-2 py-1.5 text-sm text-[#e5e4e2]"
              >
                {fontOptions.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
              </select>
            </label>
            <NumberField label="Rozmiar" value={draft.fontSizePt} step={0.5} min={5} max={48} unit="pt" onChange={(fontSizePt) => update({ fontSizePt })} />
            <div className="flex gap-1">
              {([['bold', 'B', 'font-bold'], ['italic', 'I', 'italic'], ['underline', 'U', 'underline']] as const).map(([key, letter, className]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={draft[key]}
                  onClick={() => update({ [key]: !draft[key] } as Partial<ContractDocumentStyle>)}
                  className={`h-8 w-8 rounded border text-sm ${className} ${draft[key] ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]' : 'border-white/15 text-[#e5e4e2] hover:bg-white/10'}`}
                >
                  {letter}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-[#e5e4e2]/70">
              Kolor
              <input type="color" value={draft.color} onChange={(event) => update({ color: event.target.value })} className="h-8 w-10 rounded border border-white/15 bg-transparent" />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 text-xs text-[#e5e4e2]/70">
              Wyrównanie
              <div className="flex gap-1">
                {ALIGNMENTS.map(({ value: align, label, icon: Icon }) => (
                  <button
                    key={align}
                    type="button"
                    title={label}
                    aria-pressed={draft.textAlign === align}
                    onClick={() => update({ textAlign: align })}
                    className={`flex h-8 w-8 items-center justify-center rounded border ${draft.textAlign === align ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]' : 'border-white/15 text-[#e5e4e2] hover:bg-white/10'}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
            <NumberField label="Interlinia" value={draft.lineHeight} step={0.05} min={0.7} max={3} unit="×" onChange={(lineHeight) => update({ lineHeight })} />
            <NumberField label="Odstęp przed" value={draft.spaceBeforePt} step={1} min={0} max={72} unit="pt" onChange={(spaceBeforePt) => update({ spaceBeforePt })} />
            <NumberField label="Odstęp po" value={draft.spaceAfterPt} step={1} min={0} max={72} unit="pt" onChange={(spaceAfterPt) => update({ spaceAfterPt })} />
            <NumberField
              label={isPoint ? 'Wcięcie numeru' : 'Wcięcie z lewej'}
              value={draft.indentPt}
              step={1}
              min={0}
              max={144}
              unit="pt"
              onChange={(indentPt) => update({ indentPt })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/80">
            <input type="checkbox" checked={draft.keepWithNext} onChange={(event) => update({ keepWithNext: event.target.checked })} className="accent-[#d3bb73]" />
            Razem z następnym (nie zostawiaj samotnie na dole strony)
          </label>

          <div className="rounded-lg bg-white px-4 py-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">Podgląd</div>
            <p
              style={{
                fontFamily: draft.fontFamily,
                fontSize: `${draft.fontSizePt}pt`,
                fontWeight: draft.bold ? 700 : 400,
                fontStyle: draft.italic ? 'italic' : 'normal',
                textDecoration: draft.underline ? 'underline' : 'none',
                color: draft.color,
                textAlign: draft.textAlign,
                lineHeight: draft.lineHeight,
                margin: `${draft.spaceBeforePt}pt 0 ${draft.spaceAfterPt}pt ${isPoint ? 0 : draft.indentPt}pt`,
              }}
            >
              {SAMPLE[styleId]}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/10">Anuluj</button>
          <button type="button" onClick={() => onSave(draft)} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90">
            Zastosuj w całym dokumencie
          </button>
        </div>
      </div>
    </div>
  );
}
