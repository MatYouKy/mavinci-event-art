'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Save,
  ArrowLeft,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Type,
} from 'lucide-react';
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
  const [logoScale, setLogoScale] = useState(80);
  const [logoPositionX, setLogoPositionX] = useState(50);
  const [logoPositionY, setLogoPositionY] = useState(0);
  const [lineHeight, setLineHeight] = useState(1.6);
  const [history, setHistory] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [pages, setPages] = useState<string[]>(['']);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

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
            .map((line) => `<pre>${line || '\n'}</pre>`)
            .join('');

          console.log('Auto-converted plain content to HTML with <pre> tags');
        }

        setContentHtml(initialHtml);

        if (data.page_settings) {
          if (data.page_settings.logoScale) setLogoScale(data.page_settings.logoScale);
          if (data.page_settings.logoPositionX !== undefined)
            setLogoPositionX(data.page_settings.logoPositionX);
          if (data.page_settings.logoPositionY !== undefined)
            setLogoPositionY(data.page_settings.logoPositionY);
          if (data.page_settings.lineHeight) setLineHeight(data.page_settings.lineHeight);
          if (data.page_settings.pages && Array.isArray(data.page_settings.pages)) {
            setPages(data.page_settings.pages);
          } else if (initialHtml) {
            setPages([initialHtml]);
          }
        } else if (initialHtml) {
          setPages([initialHtml]);
        }
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

      const allContent = pages.join('\n\n--- PAGE BREAK ---\n\n');
      const plainText = allContent.replace(/<[^>]*>/g, '').trim();

      const updateData = {
        content: plainText || 'Szablon umowy',
        content_html: allContent,
        page_settings: {
          logoScale,
          logoPositionX,
          logoPositionY,
          lineHeight,
          pages,
          marginTop: 50,
          marginBottom: 50,
          marginLeft: 50,
          marginRight: 50,
          pageSize: 'A4',
        },
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
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    let editorElement = container.nodeType === 3 ? container.parentElement : container as HTMLElement;
    while (editorElement && !editorElement.classList.contains('contract-content-wysiwyg')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex(ref => ref === editorElement);
    if (pageIndex === -1) return;

    const textNode = document.createTextNode(placeholder);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const insertLogo = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    let editorElement = container.nodeType === 3 ? container.parentElement : container as HTMLElement;
    while (editorElement && !editorElement.classList.contains('contract-content-wysiwyg')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex(ref => ref === editorElement);
    if (pageIndex === -1) return;

    const img = document.createElement('img');
    img.src = '/erulers_logo_vect.png';
    img.style.maxWidth = '300px';
    img.style.height = 'auto';
    img.style.display = 'block';
    img.style.margin = '20px auto';

    range.insertNode(img);
    range.setStartAfter(img);
    range.setEndAfter(img);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const insertParagraphMarker = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    let editorElement = container.nodeType === 3 ? container.parentElement : container as HTMLElement;
    while (editorElement && !editorElement.classList.contains('contract-content-wysiwyg')) {
      editorElement = editorElement.parentElement;
    }

    if (!editorElement) return;

    const pageIndex = pageRefs.current.findIndex(ref => ref === editorElement);
    if (pageIndex === -1) return;

    const p = document.createElement('p');
    p.style.fontWeight = 'bold';
    p.style.textAlign = 'center';
    p.style.margin = '1.5em 0';
    p.innerHTML = '§ ';

    range.insertNode(p);
    range.setStart(p.firstChild!, 2);
    range.setEnd(p.firstChild!, 2);
    selection.removeAllRanges();
    selection.addRange(range);

    updatePageContent(pageIndex, editorElement.innerHTML);
  };

  const addNewPage = () => {
    const newPages = [...pages, ''];
    setPages(newPages);
    setCurrentPageIndex(newPages.length - 1);
    showSnackbar('Dodano nową stronę', 'success');
  };

  const updatePageContent = (pageIndex: number, content: string) => {
    const newPages = [...pages];
    newPages[pageIndex] = content;
    setPages(newPages);
  };

  const deletePage = (pageIndex: number) => {
    if (pages.length <= 1) {
      showSnackbar('Nie można usunąć ostatniej strony', 'error');
      return;
    }
    const newPages = pages.filter((_, i) => i !== pageIndex);
    setPages(newPages);
    if (currentPageIndex >= newPages.length) {
      setCurrentPageIndex(newPages.length - 1);
    }
    showSnackbar('Usunięto stronę', 'success');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0b14]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0b14]">
        <div className="text-[#e5e4e2]">Szablon nie został znaleziony</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0b14]">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="mx-auto max-w-[1400px] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/crm/contract-templates')}
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-xl font-light text-[#e5e4e2]">{template.name}</h1>
                <p className="text-sm text-[#e5e4e2]/40">Edytor WYSIWYG</p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="sticky top-[73px] z-30 border-b border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="mx-auto max-w-[1400px] px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => execCommand('bold')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Pogrubienie"
            >
              <Bold className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onClick={() => execCommand('italic')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Kursywa"
            >
              <Italic className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onClick={() => execCommand('underline')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Podkreślenie"
            >
              <Underline className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onClick={() => execCommand('justifyLeft')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Do lewej"
            >
              <AlignLeft className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onClick={() => execCommand('justifyCenter')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Wyśrodkuj"
            >
              <AlignCenter className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onClick={() => execCommand('justifyRight')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Do prawej"
            >
              <AlignRight className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onClick={() => execCommand('insertUnorderedList')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Lista"
            >
              <List className="h-4 w-4 text-[#e5e4e2]" />
            </button>
            <button
              onClick={() => execCommand('insertOrderedList')}
              className="rounded p-2 hover:bg-[#d3bb73]/10"
              title="Lista numerowana"
            >
              <ListOrdered className="h-4 w-4 text-[#e5e4e2]" />
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <select
              onChange={(e) => {
                const size = e.target.value;
                document.execCommand('fontSize', false, '7');
                const fontElements = document.getElementsByTagName('font');
                for (let i = 0; i < fontElements.length; i++) {
                  if (fontElements[i].size === '7') {
                    fontElements[i].removeAttribute('size');
                    fontElements[i].style.fontSize = size + 'pt';
                  }
                }
              }}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
            >
              <option value="">Czcionka</option>
              <option value="6">6pt</option>
              <option value="8">8pt</option>
              <option value="9">9pt</option>
              <option value="10">10pt</option>
              <option value="11">11pt</option>
              <option value="12">12pt</option>
              <option value="14">14pt</option>
              <option value="16">16pt</option>
              <option value="18">18pt</option>
              <option value="20">20pt</option>
              <option value="22">22pt</option>
              <option value="24">24pt</option>
              <option value="28">28pt</option>
              <option value="32">32pt</option>
              <option value="36">36pt</option>
              <option value="40">40pt</option>
              <option value="48">48pt</option>
              <option value="56">56pt</option>
              <option value="64">64pt</option>
              <option value="72">72pt</option>
            </select>

            <div className="ml-2 flex items-center gap-2">
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
                className="h-1 w-24 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
              />
              <span className="w-8 text-xs text-[#e5e4e2]">{lineHeight.toFixed(1)}</span>
            </div>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onClick={insertParagraphMarker}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
              title="Nowy paragraf (§)"
            >
              § Paragraf
            </button>

            <button
              onClick={addNewPage}
              className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/10"
              title="Dodaj nową stronę"
            >
              📄 Dodaj stronę
            </button>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <button
              onClick={insertLogo}
              className="rounded bg-[#d3bb73] px-3 py-1.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Wstaw Logo
            </button>

            <div className="ml-2 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/60">Skala:</span>
                <input
                  type="range"
                  min="20"
                  max="120"
                  value={logoScale}
                  onChange={(e) => setLogoScale(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                />
                <span className="w-8 text-xs text-[#e5e4e2]">{logoScale}%</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/60">Poz X:</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={logoPositionX}
                  onChange={(e) => setLogoPositionX(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                />
                <span className="w-8 text-xs text-[#e5e4e2]">{logoPositionX}%</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#e5e4e2]/60">Poz Y:</span>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={logoPositionY}
                  onChange={(e) => setLogoPositionY(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer appearance-none rounded-lg bg-[#0f1119] accent-[#d3bb73]"
                />
                <span className="w-8 text-xs text-[#e5e4e2]">{logoPositionY}mm</span>
              </div>
            </div>

            <div className="mx-2 h-6 w-px bg-[#d3bb73]/30" />

            <span className="text-xs text-[#e5e4e2]/60">Placeholdery:</span>

            {[
              { key: '{{client_first_name}}', label: 'Imię' },
              { key: '{{client_last_name}}', label: 'Nazwisko' },
              { key: '{{client_full_name}}', label: 'Imię i nazwisko' },
              { key: '{{client_email}}', label: 'Email' },
              { key: '{{client_phone}}', label: 'Telefon' },
              { key: '{{client_pesel}}', label: 'PESEL' },
              { key: '{{client_address}}', label: 'Adres (ulica)' },
              { key: '{{client_city}}', label: 'Miasto' },
              { key: '{{client_postal_code}}', label: 'Kod pocztowy' },
              { key: '{{client_nip}}', label: 'NIP (firma)' },
              { key: '{{event_name}}', label: 'Wydarzenie' },
              { key: '{{event_date}}', label: 'Data' },
              { key: '{{location_name}}', label: 'Nazwa lokalizacji' },
              { key: '{{location_address}}', label: 'Adres lokalizacji' },
              { key: '{{location_city}}', label: 'Miasto lokalizacji' },
              { key: '{{location_postal_code}}', label: 'Kod pocztowy lok.' },
              { key: '{{location_full}}', label: 'Pełny adres lok.' },
              { key: '{{total_price}}', label: 'Cena całkowita' },
              { key: '{{deposit_amount}}', label: 'Zadatek' },
            ].map((p) => (
              <button
                key={p.key}
                onClick={() => insertPlaceholder(p.key)}
                className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                title={p.key}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* A4 Editor */}
      <div className="min-h-screen bg-[#f5f5f5] py-8">
        <div className="mx-auto max-w-[230mm] px-4">
          {pages.map((pageContent, pageIndex) => (
            <div key={pageIndex} className="contract-a4-page-wysiwyg">
              {pageIndex === 0 && (
                <>
                  <div
                    className="contract-header-logo-wysiwyg"
                    style={{
                      justifyContent:
                        logoPositionX <= 33
                          ? 'flex-start'
                          : logoPositionX >= 67
                            ? 'flex-end'
                            : 'center',
                      marginTop: `${logoPositionY}mm`,
                    }}
                  >
                    <img
                      src="/erulers_logo_vect.png"
                      alt="EVENT RULERS"
                      style={{
                        maxWidth: `${logoScale}%`, // skalowanie samego logo
                        height: 'auto',
                      }}
                    />
                  </div>

                  <div className="contract-current-date-wysiwyg">
                    Olsztyn, {new Date().toLocaleDateString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                </>
              )}

              <div
                ref={(el) => {
                  pageRefs.current[pageIndex] = el;
                  if (el && el.innerHTML === '' && pageContent) {
                    el.innerHTML = pageContent;
                  }
                }}
                contentEditable={true}
                suppressContentEditableWarning
                dir="ltr"
                onInput={(e) => updatePageContent(pageIndex, e.currentTarget.innerHTML)}
                onBlur={(e) => updatePageContent(pageIndex, e.currentTarget.innerHTML)}
                className="contract-content-wysiwyg"
                style={{
                  outline: 'none',
                  direction: 'ltr',
                  unicodeBidi: 'embed',
                  textAlign: 'left',
                  lineHeight: String(lineHeight),
                }}
              />

              <div className="contract-footer-wysiwyg">
                <div className="footer-logo-wysiwyg">
                  <img src="/erulers_logo_vect.png" alt="EVENT RULERS" />
                </div>
                <div className="footer-info-wysiwyg">
                  <p><span className="font-bold">EVENT RULERS</span> – <span className="italic">Więcej niż Wodzireje!</span></p>
                  <p>www.eventrulers.pl | biuro@eventrulers.pl</p>
                  <p>tel: 698-212-279</p>
                </div>
              </div>

              {pages.length > 1 && (
                <button
                  onClick={() => deletePage(pageIndex)}
                  className="absolute right-2 top-2 rounded-lg bg-red-500/10 p-2 text-red-500 transition-colors hover:bg-red-500/20"
                  title="Usuń stronę"
                >
                  🗑️
                </button>
              )}

              <div className="absolute bottom-8 right-20 text-xs text-[#000]/50">
                Strona {pageIndex + 1} z {pages.length}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Styles */}
      <style jsx global>{`
        .contract-a4-page-wysiwyg {
          position: relative;
          width: 210mm;
          margin: 0 auto 20px auto;
          padding: 20mm 25mm 5mm;
          background: white;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          page-break-after: always;
          break-after: page;
          display: flex;
          flex-direction: column;
        }

        .contract-header-logo-wysiwyg {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          margin-bottom: 4mm;
          transition: all 0.2s ease;
        }

        .contract-header-logo-wysiwyg img {
          height: auto;
          object-fit: contain;
        }

        .contract-current-date-wysiwyg {
          position: absolute;
          top: 20mm;
          right: 20mm;
          text-align: right;
          font-size: 10pt;
          color: #333;
          font-weight: 500;
        }

        .contract-content-wysiwyg {
          flex: 1;
          min-height: 160mm;
          text-align: left;
          color: #000;
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          direction: ltr !important;
          unicode-bidi: embed !important;
          overflow-wrap: break-word;
          word-wrap: break-word;
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

        .contract-content-wysiwyg div[data-page-break='true'] {
          page-break-after: always;
          break-after: page;
          margin: 20px 0;
        }

        .contract-content-wysiwyg div[data-page-break='true'] hr {
          border: 1px dashed #d3bb73;
          margin: 20px 0;
        }

        @media print {
          .contract-content-wysiwyg div[data-page-break='true'] hr {
            display: none;
          }

          .contract-content-wysiwyg div[data-page-break='true'] {
            margin: 0;
            height: 0;
          }
        }

        .contract-footer-wysiwyg {
          margin-top: auto;
          width: 100%;
          min-height: 25mm;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding: 10px 0;
          background: white;
          pointer-events: none;
          flex-shrink: 0;
          position: relative;
        }

        .page-number-footer {
          position: absolute;
          top: -20px;
          right: 0;
          font-size: 10pt;
          color: #666;
          font-weight: 500;
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
          line-height: 1.2;
        }

        .footer-info-wysiwyg p {
          margin: 4px 0;
          color: #333;
        }
      `}</style>
    </div>
  );
}
