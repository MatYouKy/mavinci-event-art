'use client';

import { ChangeEvent, DragEvent, KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';

type ImageDropzoneProps = {
  onFiles: (files: File[]) => void | Promise<void>;
  label?: string;
  hint?: string;
  multiple?: boolean;
  allowPdf?: boolean;
  accept?: string;
  invalidFileMessage?: string;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  preview?: ReactNode;
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export function ImageDropzone({
  onFiles,
  label = 'Przeciągnij zdjęcie tutaj',
  hint = 'lub kliknij, aby wybrać · JPG, PNG, WEBP',
  multiple = false,
  allowPdf = false,
  accept,
  invalidFileMessage = 'Wybierz pliki w formatach podanych poniżej pola dodawania.',
  disabled = false,
  busy = false,
  className = 'min-h-28',
  preview,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptFiles = (source: FileList | File[]) => {
    if (disabled || busy) return;
    const files = Array.from(source);
    if (!files.length) return;
    if (accept) {
      const formats = accept.toLowerCase().split(',').map((format) => format.trim()).filter(Boolean);
      const supported = files.every((file) => formats.some((format) =>
        format.startsWith('.') ? file.name.toLowerCase().endsWith(format)
          : format.endsWith('/*') ? file.type.toLowerCase().startsWith(format.slice(0, -1))
            : file.type.toLowerCase() === format,
      ));
      if (!supported) {
        setError(invalidFileMessage);
        return;
      }
      setError(null);
      void onFiles(multiple ? files : files.slice(0, 1));
      return;
    }
    const images = files.filter((file) => IMAGE_TYPES.includes(file.type) || file.type.startsWith('image/') || (allowPdf && file.type === 'application/pdf'));
    if (images.length === 0) {
      setError(allowPdf ? 'Wybierz PDF lub plik graficzny.' : 'Wybierz plik graficzny.');
      return;
    }
    setError(null);
    void onFiles(multiple ? images : images.slice(0, 1));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    acceptFiles(event.dataTransfer.files);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) acceptFiles(event.target.files);
    event.target.value = '';
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || busy) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    inputRef.current?.click();
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled || busy ? -1 : 0}
        aria-disabled={disabled || busy}
        aria-label={preview ? `Zmień zdjęcie: ${label}` : label}
        aria-busy={busy}
        onClick={() => !disabled && !busy && inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled && !busy) setDragActive(true); }}
        onDragOver={(event) => { event.preventDefault(); if (!disabled && !busy) setDragActive(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
        onDrop={handleDrop}
        className={`relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed text-center outline-none transition focus-visible:ring-2 focus-visible:ring-[#d3bb73]/30 ${preview ? '' : 'px-4 py-4'} ${className} ${dragActive ? 'border-[#d3bb73]/45 bg-[#d3bb73]/12 shadow-[0_0_0_2px_rgba(211,187,115,0.08)]' : 'border-white/10 bg-[#0f1119] hover:border-[#d3bb73]/25 hover:bg-[#d3bb73]/[0.04]'} ${(disabled || busy) ? 'cursor-not-allowed opacity-45' : ''}`}
      >
        {preview && <div className="pointer-events-none absolute inset-0">{preview}</div>}
        <div className={`pointer-events-none flex flex-col items-center ${preview ? 'absolute inset-x-0 bottom-0 bg-black/65 px-3 py-2.5' : ''}`}>
          {busy ? <Loader2 className="mb-2 h-5 w-5 animate-spin text-[#d3bb73]" /> : !preview ? <ImagePlus className="mb-2 h-5 w-5 text-[#d3bb73]" /> : null}
          <p className={`text-xs ${preview ? 'text-white/90' : 'text-[#e5e4e2]/70'}`}>{busy ? (allowPdf || accept ? 'Wysyłanie pliku…' : 'Wysyłanie zdjęcia...') : dragActive ? (allowPdf || accept ? 'Upuść plik tutaj' : 'Upuść zdjęcie tutaj') : preview ? 'Kliknij lub przeciągnij, aby zmienić' : label}</p>
          {!busy && !preview && <p className="mt-1 text-[10px] text-[#e5e4e2]/30">{hint}</p>}
        </div>
        <input ref={inputRef} type="file" multiple={multiple} accept={accept ?? (allowPdf ? 'image/*,application/pdf' : 'image/*')} disabled={disabled || busy} className="hidden" onChange={handleInput} />
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-300/80">{error}</p>}
    </div>
  );
}
