'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, List, ListOrdered, Type } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function EditTemplateWYSIWYGPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const templateId = params.id as string;
  const editorRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<any>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [pages, setPages] = useState<string[]>(['']);
  const [logoSize, setLogoSize] = useState(80);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    fetchTemplate();
  }, [templateId]);

  useEffect(() => {
    if (editorRef.current && contentHtml && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = contentHtml;
      editorRef.current.setAttribute('dir', 'ltr');
      editorRef.current.style.direction = 'ltr';
      editorRef.current.style.textAlign = 'left';
      editorRef.current.style.unicodeBidi = 'embed';
      editorRef.current.style.lineHeight = String(lineHeight);
    }
  }, [contentHtml]);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.style.lineHeight = String(lineHeight);
    }
  }, [lineHeight]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (ctrlKey && e.key === 'b') {
        e.preventDefault();
        execCommand('bold');
      } else if (ctrlKey && e.key === 'i') {
        e.preventDefault();
        execCommand('italic');
      } else if (ctrlKey && e.key === 'u') {
        e.preventDefault();
        execCommand('underline');
      } else if (ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  const fetchTemplate = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('id', templateId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setTemplate(data);

        let initialHtml = data.content_html || '';

        if (!initialHtml && data.content) {
          initialHtml = data.content
            .split('\n')
            .map(line => `<pre>${line || '\n'}</pre>`)
            .join('');

          console.log('Auto-converted plain content to HTML with <pre> tags');
        }

        setContentHtml(initialHtml);
      }
    } catch (err: any) {
      console.error('Error:', err);
      showSnackbar(err.message || 'Błąd ładowania szablonu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!template?.name.trim()) {
      showSnackbar('Nazwa szablonu jest wymagana', 'error');
      return;
    }

    if (!contentHtml || contentHtml.trim() === '') {
      showSnackbar('Treść szablonu nie może być pusta', 'error');
      return;
    }

    try {
      setSaving(true);

      const plainText = contentHtml.replace(/<[^>]*>/g, '').trim();

      const updateData = {
        content: plainText || 'Szablon umowy',
        content_html: contentHtml,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('contract_templates')
        .update(updateData)
        .eq('id', templateId);

      if (error) throw error;

      showSnackbar('Szablon zapisany pomyślnie', 'success');
      await fetchTemplate();
    } catch (err: any) {
      console.error('Error saving template:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania szablonu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addToHistory = (content: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(content);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setContentHtml(history[newIndex]);
      if (editorRef.current) {
        editorRef.current.innerHTML = history[newIndex];
      }
    }
  };

  const redo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setContentHtml(history[newIndex]);
      if (editorRef.current) {
        editorRef.current.innerHTML = history[newIndex];
      }
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      const newContent = editorRef.current.innerHTML;
      setContentHtml(newContent);
      addToHistory(newContent);
    }
  };

  const insertPlaceholder = (placeholder: string) => {
    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.getRangeAt(0);
    const textNode = document.createTextNode(placeholder);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    const newContent = editorRef.current.innerHTML;
    setContentHtml(newContent);
    addToHistory(newContent);
  };

  const insertLogo = () => {
    const img = document.createElement('img');
    img.src = '/erulers_logo_vect.png';
    img.style.maxWidth = '300px';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '20px auto';

    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.getRangeAt(0);
    range.insertNode(img);
    range.setStartAfter(img);
    range.setEndAfter(img);
    selection.removeAllRanges();
    selection.addRange(range);

    const newContent = editorRef.current.innerHTML;
    setContentHtml(newContent);
    addToHistory(newContent);
  };

  const insertParagraphMarker = () => {
    const p = document.createElement('p');
    p.style.fontWeight = 'bold';
    p.style.textAlign = 'center';
    p.style.margin = '1.5em 0';
    p.innerHTML = '§ ';

    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.getRangeAt(0);
    range.insertNode(p);

    range.setStart(p.firstChild!, 2);
    range.setEnd(p.firstChild!, 2);
    selection.removeAllRanges();
    selection.addRange(range);

    const newContent = editorRef.current.innerHTML;
    setContentHtml(newContent);
    addToHistory(newContent);
  };

  const insertPageBreak = () => {
    const pageBreak = document.createElement('div');
    pageBreak.style.pageBreakAfter = 'always';
    pageBreak.style.breakAfter = 'page';
    pageBreak.style.height = '1px';
    pageBreak.style.backgroundColor = 'transparent';
    pageBreak.setAttribute('data-page-break', 'true');
    pageBreak.innerHTML = '<hr style="border: 1px dashed #d3bb73; margin: 20px 0;" />';

    const selection = window.getSelection();
    if (!selection || !editorRef.current) return;

    const range = selection.getRangeAt(0);
    range.insertNode(pageBreak);
    range.setStartAfter(pageBreak);
    range.setEndAfter(pageBreak);
    selection.removeAllRanges();
    selection.addRange(range);

    const newContent = editorRef.current.innerHTML;
    setContentHtml(newContent);
    addToHistory(newContent);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen bg-[#0a0b14] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Szablon nie został znaleziony</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b14]">
      {/* Header */}
      <div className="bg-[#1c1f33] border-b border-[#d3bb73]/20 sticky top-0 z-40">
        <div className="max-w-[1400px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/crm/contract-templates')}
                className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-light text-[#e5e4e2]">{template.name}</h1>
                <p className="text-sm text-[#e5e4e2]/40">Edytor WYSIWYG</p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-[#1c1f33] border-b border-[#d3bb73]/20 sticky top-[73px] z-30">
        <div className="max-w-[1400px] mx-auto px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => execCommand('bold')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Pogrubienie">
              <Bold className="w-4 h-4 text-[#e5e4e2]" />
            </button>
            <button onClick={() => execCommand('italic')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Kursywa">
              <Italic className="w-4 h-4 text-[#e5e4e2]" />
            </button>
            <button onClick={() => execCommand('underline')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Podkreślenie">
              <Underline className="w-4 h-4 text-[#e5e4e2]" />
            </button>

            <div className="h-6 w-px bg-[#d3bb73]/30 mx-2" />

            <button onClick={() => execCommand('justifyLeft')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Do lewej">
              <AlignLeft className="w-4 h-4 text-[#e5e4e2]" />
            </button>
            <button onClick={() => execCommand('justifyCenter')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Wyśrodkuj">
              <AlignCenter className="w-4 h-4 text-[#e5e4e2]" />
            </button>
            <button onClick={() => execCommand('justifyRight')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Do prawej">
              <AlignRight className="w-4 h-4 text-[#e5e4e2]" />
            </button>

            <div className="h-6 w-px bg-[#d3bb73]/30 mx-2" />

            <button onClick={() => execCommand('insertUnorderedList')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Lista">
              <List className="w-4 h-4 text-[#e5e4e2]" />
            </button>
            <button onClick={() => execCommand('insertOrderedList')} className="p-2 hover:bg-[#d3bb73]/10 rounded" title="Lista numerowana">
              <ListOrdered className="w-4 h-4 text-[#e5e4e2]" />
            </button>

            <div className="h-6 w-px bg-[#d3bb73]/30 mx-2" />

            <select
              onChange={(e) => execCommand('fontSize', e.target.value)}
              className="bg-[#0f1119] text-[#e5e4e2] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm"
            >
              <option value="3">12pt</option>
              <option value="4">14pt</option>
              <option value="5">16pt</option>
              <option value="6">18pt</option>
              <option value="7">24pt</option>
            </select>

            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-[#e5e4e2]/60">Odstęp linii:</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.1"
                value={lineHeight}
                onChange={(e) => {
                  const newValue = Number(e.target.value);
                  setLineHeight(newValue);
                  if (editorRef.current) {
                    editorRef.current.style.lineHeight = String(newValue);
                  }
                }}
                className="w-24 h-1 bg-[#0f1119] rounded-lg appearance-none cursor-pointer accent-[#d3bb73]"
              />
              <span className="text-xs text-[#e5e4e2] w-8">{lineHeight.toFixed(1)}</span>
            </div>

            <div className="h-6 w-px bg-[#d3bb73]/30 mx-2" />

            <button onClick={insertParagraphMarker} className="px-3 py-1.5 bg-[#0f1119] text-[#d3bb73] border border-[#d3bb73]/20 rounded text-sm font-medium hover:bg-[#d3bb73]/10" title="Nowy paragraf (§)">
              § Paragraf
            </button>

            <button onClick={insertPageBreak} className="px-3 py-1.5 bg-[#0f1119] text-[#d3bb73] border border-[#d3bb73]/20 rounded text-sm font-medium hover:bg-[#d3bb73]/10" title="Podział strony">
              📄 Nowa strona
            </button>

            <div className="h-6 w-px bg-[#d3bb73]/30 mx-2" />

            <button onClick={insertLogo} className="px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] rounded text-sm font-medium hover:bg-[#d3bb73]/90">
              Wstaw Logo
            </button>

            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-[#e5e4e2]/60">Rozmiar logo:</span>
              <input
                type="range"
                min="20"
                max="120"
                value={logoSize}
                onChange={(e) => setLogoSize(Number(e.target.value))}
                className="w-24 h-1 bg-[#0f1119] rounded-lg appearance-none cursor-pointer accent-[#d3bb73]"
              />
              <span className="text-xs text-[#e5e4e2] w-8">{logoSize}%</span>
            </div>

            <div className="h-6 w-px bg-[#d3bb73]/30 mx-2" />

            <span className="text-xs text-[#e5e4e2]/60">Placeholdery:</span>

            {[
              { key: '{{client_name}}', label: 'Klient' },
              { key: '{{client_address}}', label: 'Adres' },
              { key: '{{client_nip}}', label: 'NIP' },
              { key: '{{event_name}}', label: 'Wydarzenie' },
              { key: '{{event_date}}', label: 'Data' },
              { key: '{{event_location}}', label: 'Lokalizacja' },
              { key: '{{total_price}}', label: 'Cena' },
            ].map((p) => (
              <button
                key={p.key}
                onClick={() => insertPlaceholder(p.key)}
                className="px-2 py-1 text-xs bg-[#0f1119] text-[#d3bb73] border border-[#d3bb73]/20 rounded hover:bg-[#d3bb73]/10"
                title={p.key}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* A4 Editor */}
      <div className="bg-[#f5f5f5] min-h-screen py-8">
        <div className="max-w-[230mm] mx-auto px-4">
          <div className="contract-a4-page-wysiwyg">
            <div className="contract-header-logo-wysiwyg" style={{ width: `${logoSize}%` }}>
              <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
            </div>

            <div className="contract-current-date-wysiwyg">
              {new Date().toLocaleDateString('pl-PL', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>

            <div
              ref={editorRef}
              contentEditable={true}
              suppressContentEditableWarning
              dir="ltr"
              onInput={(e) => setContentHtml(e.currentTarget.innerHTML)}
              onBlur={(e) => setContentHtml(e.currentTarget.innerHTML)}
              className="contract-content-wysiwyg"
              style={{ outline: 'none', direction: 'ltr', unicodeBidi: 'embed', textAlign: 'left' }}
            />

            <div className="contract-footer-wysiwyg">
              <div className="footer-logo-wysiwyg">
                <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
              </div>
              <div className="footer-info-wysiwyg">
                <p>EVENT RULERS – Więcej niż Wodzireje!</p>
                <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
                <p>tel: 698-212-279</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Styles */}
      <style jsx global>{`
        .contract-a4-page-wysiwyg {
          position: relative;
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto 20px auto;
          padding: 20mm 25mm 20mm 25mm;
          background: white;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
        }

        .contract-header-logo-wysiwyg {
          position: absolute;
          top: 15mm;
          left: 50%;
          transform: translateX(-50%);
          height: 40mm;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          transition: width 0.2s ease;
        }

        .contract-header-logo-wysiwyg img {
          width: 100%;
          height: auto;
          object-fit: contain;
        }

        .contract-current-date-wysiwyg {
          position: absolute;
          top: 15mm;
          right: 25mm;
          font-size: 10pt;
          color: #333;
          font-weight: 500;
          pointer-events: none;
        }

        .contract-content-wysiwyg {
          margin-top: 80mm;
          min-height: 400px;
          text-align: left;
          color: #000;
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          direction: ltr !important;
          unicode-bidi: embed !important;
        }

        .contract-content-wysiwyg * {
          direction: ltr !important;
          unicode-bidi: embed !important;
        }

        .contract-content-wysiwyg:focus {
          outline: 2px solid #d3bb73;
          outline-offset: 4px;
        }

        .contract-content-wysiwyg p {
          margin: 0 0 1em 0;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .contract-content-wysiwyg h1,
        .contract-content-wysiwyg h2,
        .contract-content-wysiwyg h3 {
          margin-top: 1.5em;
          margin-bottom: 0.75em;
          font-weight: bold;
          page-break-after: avoid;
          break-after: avoid;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .contract-content-wysiwyg h1 {
          font-size: 18pt;
          text-align: center;
        }

        .contract-content-wysiwyg h2 {
          font-size: 16pt;
        }

        .contract-content-wysiwyg h3 {
          font-size: 14pt;
        }

        .contract-content-wysiwyg strong,
        .contract-content-wysiwyg b {
          font-weight: bold;
        }

        .contract-content-wysiwyg em,
        .contract-content-wysiwyg i {
          font-style: italic;
        }

        .contract-content-wysiwyg u {
          text-decoration: underline;
        }

        .contract-content-wysiwyg ul,
        .contract-content-wysiwyg ol {
          margin: 1em 0;
          padding-left: 2em;
          list-style-position: outside;
        }

        .contract-content-wysiwyg ul {
          list-style-type: disc;
        }

        .contract-content-wysiwyg ol {
          list-style-type: decimal;
        }

        .contract-content-wysiwyg li {
          margin: 0.1em 0;
          display: list-item;
        }

        .contract-content-wysiwyg img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 10px auto;
        }

        .contract-content-wysiwyg div[data-page-break="true"] {
          page-break-after: always;
          break-after: page;
          margin: 20px 0;
        }

        .contract-content-wysiwyg div[data-page-break="true"] hr {
          border: 1px dashed #d3bb73;
          margin: 20px 0;
        }

        @media print {
          .contract-content-wysiwyg div[data-page-break="true"] hr {
            display: none;
          }

          .contract-content-wysiwyg div[data-page-break="true"] {
            margin: 0;
            height: 0;
          }
        }

        .contract-footer-wysiwyg {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 80%;
          height: 120px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 10px 0;
          background: white;
          pointer-events: none;
        }

        .contract-footer-wysiwyg::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
          background: #d3bb73;
        }

        .footer-logo-wysiwyg {
          display: none;
        }

        .footer-info-wysiwyg {
          text-align: center;
          font-size: 10pt;
          color: #333;
          line-height: 1.6;
        }

        .footer-info-wysiwyg p {
          margin: 4px 0;
          color: #333;
        }
      `}</style>
    </div>
  );
}
