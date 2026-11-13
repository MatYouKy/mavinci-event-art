'use client';

import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import type { ContractDocumentStyles } from '@/lib/CRM/contracts/contractDocumentStyles';
import { cleanContractPasteHtml } from '@/lib/CRM/contracts/contractPasteCleaner';
import { finalizeContractEditorHtml, prepareContractHtmlForEditor } from '@/lib/CRM/contracts/contractEditorHtml';
import {
  ContractAttributes,
  ContractClauseSlot,
  ContractConditions,
  ContractConditionSection,
  ContractPlaceholders,
  ContractShortcuts,
  ContractStructure,
} from './contractEditorExtensions';
import { buildContractEditorCss } from './contractEditorCss';

export interface ContractDocumentEditorProps {
  /** Zapisany HTML szablonu (`page_settings.flowContent`). */
  content: string;
  documentStyles: ContractDocumentStyles;
  /** HTML w formie do zapisu — wywoływane z opóźnieniem po zmianach. */
  onChange: (html: string) => void;
  onReady?: (editor: Editor) => void;
  /** Komunikat po wklejeniu (np. pominięte obrazki z Worda). */
  onNotice?: (message: string) => void;
  /** Nagłówek kartki (logo) — taki jak na pierwszej stronie PDF. */
  header?: React.ReactNode;
  editable?: boolean;
}

/** Edytor treści umowy na kartce A4 — style akapitów jak w Wordzie, wklejanie bez obcego formatowania. */
export default function ContractDocumentEditor({
  content,
  documentStyles,
  onChange,
  onReady,
  onNotice,
  header,
  editable = true,
}: ContractDocumentEditorProps) {
  const changeTimer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onNoticeRef = useRef(onNotice);
  onChangeRef.current = onChange;
  onNoticeRef.current = onNotice;

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: true },
      }),
      TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false, allowBase64: false }),
      ContractAttributes,
      ContractClauseSlot,
      ContractConditionSection,
      ContractConditions,
      ContractPlaceholders,
      ContractStructure,
      ContractShortcuts,
    ],
    content: prepareContractHtmlForEditor(content),
    editorProps: {
      attributes: { class: 'contract-content contract-editor-content', lang: 'pl', spellcheck: 'true' },
      // Wklejenie do pustego akapitu: pierwszy wklejony akapit zachowuje swój styl i wyrównanie (np. tytuł z Worda).
      handlePaste: (view, _event, slice) => {
        const { $from, empty } = view.state.selection;
        const first = slice.content.firstChild;
        if (!empty || slice.openStart === 0 || !first || first.type.name !== 'paragraph') return false;
        if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0 || $from.depth !== 1) return false;
        const position = $from.before();
        const tr = view.state.tr.replaceSelection(slice);
        const target = tr.doc.nodeAt(position);
        if (target?.type.name === 'paragraph') {
          tr.setNodeMarkup(position, undefined, { ...target.attrs, contractStyle: first.attrs.contractStyle, textAlign: first.attrs.textAlign });
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      transformPastedHTML: (html) => {
        const result = cleanContractPasteHtml(html);
        if (result.removedImages) {
          onNoticeRef.current?.(
            result.removedImages === 1
              ? 'Obrazek z Worda nie został wklejony — logo ustawisz w zakładce Układ.'
              : `Pominięto ${result.removedImages} obrazki z Worda — logo ustawisz w zakładce Układ.`,
          );
        }
        return result.html;
      },
    },
    onUpdate: ({ editor: current }) => {
      if (changeTimer.current !== null) window.clearTimeout(changeTimer.current);
      changeTimer.current = window.setTimeout(() => {
        changeTimer.current = null;
        onChangeRef.current(finalizeContractEditorHtml(current.getHTML()));
      }, 250);
    },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  useEffect(() => () => {
    if (changeTimer.current !== null) window.clearTimeout(changeTimer.current);
  }, []);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  const css = useMemo(() => buildContractEditorCss(documentStyles), [documentStyles]);

  return (
    <div className="contract-editor-canvas">
      <style>{css}</style>
      <div className="contract-editor-sheet" data-theme-preserve>
        {header}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Aktualna treść edytora w formie do zapisu (np. przy „Zapisz” bez czekania na opóźnienie zmian). */
export const contractEditorHtml = (editor: Editor) => finalizeContractEditorHtml(editor.getHTML());
