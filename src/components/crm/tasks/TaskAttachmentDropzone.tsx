'use client';

import { useRef, useState, type DragEvent } from 'react';
import { FileDown, Paperclip } from 'lucide-react';

/*
 * Strefa załączników w formularzu zadania (tablica firmowa i prywatna): przeciągnięcie plików z komputera (podświetlenie
 * przy przeciąganiu) albo „Dodaj pliki”. Foldery są pomijane z informacją. Jak `TaskAttachmentDropZone` na Macu.
 * Wklejenie zrzutu ekranu (⌘V) obsługuje formularz.
 */

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');

export default function TaskAttachmentDropzone({ disabled = false, onFiles }: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');

  const leave = () => {
    depth.current = 0;
    setOver(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    leave();
    if (disabled) return;
    const files: File[] = [];
    let folders = 0;
    for (const item of Array.from(event.dataTransfer.items || [])) {
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry?.isDirectory) { folders += 1; continue; }
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (!event.dataTransfer.items?.length) files.push(...Array.from(event.dataTransfer.files || []));
    setNote(folders ? 'Foldery nie są dodawane — przeciągnij pliki z ich wnętrza.' : '');
    if (files.length) onFiles(files);
  };

  return (
    <div>
      <div
        role="group"
        aria-label="Strefa upuszczania załączników"
        aria-disabled={disabled}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          if (!disabled) setOver(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        }}
        onDragLeave={(event) => {
          if (!hasFiles(event)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
          over ? 'border-[#d3bb73] bg-[#d3bb73]/15' : 'border-[#d3bb73]/30 bg-[#d3bb73]/[0.03]'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <FileDown className="h-7 w-7 text-[#d3bb73]" aria-hidden />
        <p className="text-sm text-[#e5e4e2]">{over ? 'Upuść, aby dodać pliki' : 'Przeciągnij pliki tutaj'}</p>
        <label className={`inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[#d3bb73]/20'}`}>
          <input
            type="file"
            multiple
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = '';
              setNote('');
              if (files.length) onFiles(files);
            }}
          />
          <Paperclip className="h-4 w-4" aria-hidden /> Dodaj pliki
        </label>
        <p className="text-xs text-[#e5e4e2]/60">
          Zdjęcia, PDF-y, dokumenty i inne pliki — możesz dodać kilka naraz albo wkleić zrzut ekranu (Ctrl+V / ⌘V).
        </p>
      </div>
      {note && <p role="status" className="mt-2 text-xs text-amber-200">{note}</p>}
    </div>
  );
}
