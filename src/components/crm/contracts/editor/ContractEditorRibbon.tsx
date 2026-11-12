'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  ChevronDown,
  Hash,
  Indent,
  Italic,
  List,
  ListOrdered,
  Outdent,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table,
  Underline,
  Undo2,
} from 'lucide-react';
import {
  CONTRACT_STYLE_HINTS,
  CONTRACT_STYLE_LABELS,
  type ContractDocumentStyles,
  type ContractStyleId,
} from '@/lib/CRM/contracts/contractDocumentStyles';
import { CONTRACT_PLACEHOLDER_GROUPS } from '@/lib/CRM/contracts/contractPlaceholderGroups';
import { CONTRACT_CLAUSE_SLOTS } from '@/lib/CRM/contracts/contractClauseSlots';
import { applyContractStyle, currentContractStyle } from './contractEditorExtensions';

type RibbonTab = 'home' | 'insert' | 'conditions' | 'layout' | 'view';

const TABS: Array<{ id: RibbonTab; label: string }> = [
  { id: 'home', label: 'Narzędzia główne' },
  { id: 'insert', label: 'Wstaw' },
  { id: 'conditions', label: 'Warunki' },
  { id: 'layout', label: 'Układ' },
  { id: 'view', label: 'Podgląd' },
];

/** Style w galerii (tabela ma swój styl, ale nadaje się go wstawiając tabelę). */
const GALLERY_STYLES: ContractStyleId[] = ['title', 'heading', 'point', 'subpoint', 'subsubpoint', 'body', 'table'];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = (keys: string) => (isMac ? keys.replace('Mod', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace(/-/g, '') : keys.replace('Mod', 'Ctrl').replace(/-/g, '+'));

const SIGNATURE_TABLE = `<table style="width:100%;margin-top:14pt;border-collapse:collapse;"><tbody><tr>
<td style="width:50%;" data-style="table"><p>ZAMAWIAJĄCY</p><p style="padding-top:35pt;">……………………………………</p></td>
<td style="width:50%;" data-style="table"><p>WYKONAWCA</p><p style="padding-top:35pt;">……………………………………</p></td>
</tr></tbody></table>`;

function RibbonButton({ label, hint, active, disabled, onClick, children }: {
  label: string; hint?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-[#e5e4e2] transition-colors disabled:opacity-30 ${
        active ? 'bg-[#d3bb73]/25 text-[#d3bb73]' : 'hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

function RibbonGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-between border-r border-white/10 px-3 last:border-r-0">
      <div className="flex min-h-[60px] flex-wrap items-center gap-0.5">{children}</div>
      <div className="pt-1 text-center text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">{title}</div>
    </div>
  );
}

/** Menu rozwijane wstążki (pola, klauzule) — zamyka się po wyborze, kliknięciu obok i Esc. */
function RibbonMenu({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-[60px] flex-col items-center justify-center gap-1 rounded px-2 text-xs text-[#e5e4e2] ${open ? 'bg-white/10' : 'hover:bg-white/10'}`}
      >
        {icon}
        <span className="flex items-center gap-0.5">{label}<ChevronDown className="h-3 w-3" /></span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-80 overflow-y-auto rounded-lg border border-white/10 bg-[#1c1f33] p-1 shadow-2xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function StyleCard({ id, styles, active, onApply, onModify }: {
  id: ContractStyleId; styles: ContractDocumentStyles; active: boolean; onApply: () => void; onModify: () => void;
}) {
  const style = styles.styles[id];
  return (
    <div className={`group relative flex h-[60px] w-[92px] flex-col overflow-hidden rounded border bg-white text-left ${active ? 'border-[#d3bb73] ring-2 ring-[#d3bb73]/60' : 'border-white/20 hover:border-[#d3bb73]/70'}`}>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onApply}
        onContextMenu={(event) => { event.preventDefault(); onModify(); }}
        title={`${CONTRACT_STYLE_LABELS[id]} — kliknij, aby nadać; prawy przycisk: Modyfikuj…`}
        className="flex flex-1 flex-col px-1.5 pt-1"
      >
        <span
          className="truncate text-black"
          style={{
            fontFamily: style.fontFamily,
            fontSize: `${Math.min(13, Math.max(9, style.fontSizePt + 2))}px`,
            fontWeight: style.bold ? 700 : 400,
            fontStyle: style.italic ? 'italic' : 'normal',
            textDecoration: style.underline ? 'underline' : 'none',
            color: style.color,
          }}
        >
          {CONTRACT_STYLE_HINTS[id]}
        </span>
        <span className="mt-auto truncate pb-1 text-[10px] text-neutral-500">{CONTRACT_STYLE_LABELS[id]}</span>
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onModify}
        title="Modyfikuj styl…"
        className="absolute right-0.5 top-0.5 hidden rounded bg-neutral-100 px-1 text-[10px] text-neutral-600 hover:bg-neutral-200 group-hover:block"
      >
        Zmień
      </button>
    </div>
  );
}

export interface ContractEditorRibbonProps {
  editor: Editor | null;
  documentStyles: ContractDocumentStyles;
  onModifyStyle: (id: ContractStyleId) => void;
  /** Zawartość zakładki „Warunki” (warunki, opcje umowy, scalanie, symulacja) — z ekranu szablonu. */
  conditions: ReactNode;
  /** Zawartość zakładki „Układ” (logo, stopka, czcionka dokumentu) — z ekranu szablonu. */
  layout: ReactNode;
  /** Zawartość zakładki „Podgląd” (strony, wydruk, PDF). */
  view: ReactNode;
}

/** Wstążka edytora umowy jak w Wordzie: Narzędzia główne, Wstaw, Układ, Podgląd. */
export default function ContractEditorRibbon({ editor, documentStyles, onModifyStyle, conditions, layout, view }: ContractEditorRibbonProps) {
  const [tab, setTab] = useState<RibbonTab>('home');
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        underline: current.isActive('underline'),
        strike: current.isActive('strike'),
        align: (['left', 'center', 'right', 'justify'] as const).find((value) => current.isActive({ textAlign: value })) || null,
        ordered: current.isActive('orderedList'),
        bullet: current.isActive('bulletList'),
        inList: current.isActive('listItem'),
        inTable: current.isActive('table'),
        style: currentContractStyle(current),
        color: (current.getAttributes('textStyle').color as string | undefined) || '#000000',
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        canSink: current.can().sinkListItem('listItem'),
        canLift: current.can().liftListItem('listItem'),
      };
    },
  });
  const run = (action: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    if (editor) action(editor.chain().focus()).run();
  };
  const insert = (html: string) => run((chain) => chain.insertContent(html));

  return (
    <div className="border-b border-white/10 bg-[#161827]">
      <div className="flex gap-1 px-3 pt-1" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-t px-3 py-1.5 text-sm ${tab === item.id ? 'bg-[#1c1f33] text-[#d3bb73]' : 'text-[#e5e4e2]/70 hover:text-[#e5e4e2]'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-[86px] items-stretch overflow-x-auto bg-[#1c1f33] py-1.5">
        {tab === 'home' && (
          <>
            <RibbonGroup title="Edycja">
              <RibbonButton label="Cofnij" hint={shortcut('Mod-Z')} disabled={!state?.canUndo} onClick={() => run((c) => c.undo())}><Undo2 className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Ponów" hint={shortcut('Mod-Shift-Z')} disabled={!state?.canRedo} onClick={() => run((c) => c.redo())}><Redo2 className="h-4 w-4" /></RibbonButton>
            </RibbonGroup>
            <RibbonGroup title="Czcionka">
              <RibbonButton label="Pogrubienie" hint={shortcut('Mod-B')} active={state?.bold} onClick={() => run((c) => c.toggleBold())}><Bold className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Kursywa" hint={shortcut('Mod-I')} active={state?.italic} onClick={() => run((c) => c.toggleItalic())}><Italic className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Podkreślenie" hint={shortcut('Mod-U')} active={state?.underline} onClick={() => run((c) => c.toggleUnderline())}><Underline className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Przekreślenie" hint={shortcut('Mod-Shift-S')} active={state?.strike} onClick={() => run((c) => c.toggleStrike())}><Strikethrough className="h-4 w-4" /></RibbonButton>
              <label title="Kolor tekstu" className="flex h-7 cursor-pointer items-center gap-1 rounded px-1.5 text-xs text-[#e5e4e2] hover:bg-white/10">
                <span className="font-semibold" style={{ borderBottom: `3px solid ${state?.color || '#000'}` }}>A</span>
                <input
                  type="color"
                  value={state?.color || '#000000'}
                  onChange={(event) => run((c) => c.setColor(event.target.value))}
                  className="h-0 w-0 opacity-0"
                />
              </label>
              <RibbonButton
                label="Wyczyść formatowanie"
                hint="zostaje sam styl akapitu"
                onClick={() => run((c) => c.unsetAllMarks().unsetTextAlign())}
              >
                <RemoveFormatting className="h-4 w-4" />
              </RibbonButton>
            </RibbonGroup>
            <RibbonGroup title="Akapit">
              <RibbonButton label="Do lewej" hint={shortcut('Mod-Shift-L')} active={state?.align === 'left'} onClick={() => run((c) => c.setTextAlign('left'))}><AlignLeft className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Do środka" hint={shortcut('Mod-Shift-E')} active={state?.align === 'center'} onClick={() => run((c) => c.setTextAlign('center'))}><AlignCenter className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Do prawej" hint={shortcut('Mod-Shift-R')} active={state?.align === 'right'} onClick={() => run((c) => c.setTextAlign('right'))}><AlignRight className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Wyjustuj" hint={shortcut('Mod-Shift-J')} active={state?.align === 'justify'} onClick={() => run((c) => c.setTextAlign('justify'))}><AlignJustify className="h-4 w-4" /></RibbonButton>
              <span className="mx-1 h-5 w-px bg-white/10" />
              <RibbonButton label="Lista numerowana" hint={shortcut('Mod-Shift-7')} active={state?.ordered} onClick={() => run((c) => c.toggleOrderedList())}><ListOrdered className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Lista punktowana" hint={shortcut('Mod-Shift-8')} active={state?.bullet} onClick={() => run((c) => c.toggleBulletList())}><List className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Zmniejsz poziom" hint="Shift+Tab" disabled={!state?.canLift} onClick={() => run((c) => c.liftListItem('listItem'))}><Outdent className="h-4 w-4" /></RibbonButton>
              <RibbonButton label="Zwiększ poziom" hint="Tab" disabled={!state?.canSink} onClick={() => run((c) => c.sinkListItem('listItem'))}><Indent className="h-4 w-4" /></RibbonButton>
            </RibbonGroup>
            <RibbonGroup title="Style">
              <div className="flex gap-1">
                {GALLERY_STYLES.map((id) => (
                  <StyleCard
                    key={id}
                    id={id}
                    styles={documentStyles}
                    active={state?.style === id}
                    onApply={() => editor && applyContractStyle(editor, id)}
                    onModify={() => onModifyStyle(id)}
                  />
                ))}
              </div>
            </RibbonGroup>
          </>
        )}
        {tab === 'insert' && (
          <>
            <RibbonGroup title="Dane umowy">
              <RibbonMenu label="Pole" icon={<Braces className="h-5 w-5" />}>
                {(close) => CONTRACT_PLACEHOLDER_GROUPS.filter((group) => !('clauseSlots' in group)).map((group) => (
                  <div key={group.label} className="py-1">
                    <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-[#e5e4e2]/45">{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { insert(item.key); close(); }}
                        className="flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm text-[#e5e4e2] hover:bg-white/10"
                      >
                        <span>{item.label}</span>
                        <span className="truncate font-mono text-[10px] text-[#d3bb73]/80">{item.key}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </RibbonMenu>
              <RibbonMenu label="Klauzule" icon={<ListOrdered className="h-5 w-5" />}>
                {(close) => (
                  <>
                    <div className="px-2 py-1 text-xs text-[#e5e4e2]/60">Miejsce, w które generator wstawi klauzule produktów z kategorii:</div>
                    {CONTRACT_CLAUSE_SLOTS.map((slot) => (
                      <button
                        key={slot.name}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          run((c) => c.insertContent({ type: 'contractClauseSlot', attrs: { name: slot.name, label: slot.label } }));
                          close();
                        }}
                        className="block w-full rounded px-2 py-1 text-left text-sm text-[#e5e4e2] hover:bg-white/10"
                      >
                        {slot.label}
                      </button>
                    ))}
                  </>
                )}
              </RibbonMenu>
            </RibbonGroup>
            <RibbonGroup title="Paragrafy">
              <RibbonButton
                label="Nagłówek § (numer automatyczny)"
                onClick={() => insert('<p data-style="heading" style="text-align:center">§n</p><p data-style="body"></p>')}
              >
                <Hash className="h-4 w-4" /><span className="ml-1 text-xs">§ n</span>
              </RibbonButton>
            </RibbonGroup>
            <RibbonGroup title="Tabele">
              <RibbonButton label="Tabela 2 × 2" onClick={() => run((c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }))}>
                <Table className="h-4 w-4" /><span className="ml-1 text-xs">Tabela</span>
              </RibbonButton>
              <RibbonButton label="Miejsca na podpisy stron" onClick={() => insert(SIGNATURE_TABLE)}>
                <Table className="h-4 w-4" /><span className="ml-1 text-xs">Podpisy</span>
              </RibbonButton>
              {state?.inTable && (
                <>
                  <RibbonButton label="Wiersz poniżej" onClick={() => run((c) => c.addRowAfter())}><span className="text-xs">+ wiersz</span></RibbonButton>
                  <RibbonButton label="Kolumna z prawej" onClick={() => run((c) => c.addColumnAfter())}><span className="text-xs">+ kolumna</span></RibbonButton>
                  <RibbonButton label="Usuń wiersz" onClick={() => run((c) => c.deleteRow())}><span className="text-xs">− wiersz</span></RibbonButton>
                  <RibbonButton label="Usuń kolumnę" onClick={() => run((c) => c.deleteColumn())}><span className="text-xs">− kolumna</span></RibbonButton>
                  <RibbonButton label="Usuń tabelę" onClick={() => run((c) => c.deleteTable())}><span className="text-xs">Usuń tabelę</span></RibbonButton>
                </>
              )}
            </RibbonGroup>
          </>
        )}
        {tab === 'conditions' && conditions}
        {tab === 'layout' && layout}
        {tab === 'view' && view}
      </div>
    </div>
  );
}

export { RibbonGroup, RibbonButton };
