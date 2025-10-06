'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import Draggable from 'react-draggable';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });

interface Logo {
  id: string;
  url: string;
  height: number;
  x: number;
  y: number;
}

interface ContractTemplateEditorProps {
  initialContent?: string;
  logos?: Logo[];
  pageSettings?: any;
  onChange?: (content: string, logos: Logo[]) => void;
}

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

export default function ContractTemplateEditor({
  initialContent = '',
  logos = [],
  pageSettings = { marginTop: 50, marginBottom: 50, marginLeft: 50, marginRight: 50 },
  onChange,
}: ContractTemplateEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [logoElements, setLogoElements] = useState<Logo[]>(logos);
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const quillRef = useRef<any>(null);

  useEffect(() => {
    if (onChange) {
      onChange(content, logoElements);
    }
  }, [content, logoElements]);

  const modules = {
    toolbar: [
      [{ header: [1, 2, 3, 4, 5, 6, false] }],
      [{ font: [] }],
      [{ size: ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      ['blockquote', 'code-block'],
      ['link'],
      ['clean'],
    ],
  };

  const formats = [
    'header',
    'font',
    'size',
    'bold',
    'italic',
    'underline',
    'strike',
    'color',
    'background',
    'align',
    'list',
    'bullet',
    'indent',
    'blockquote',
    'code-block',
    'link',
  ];

  const handleLogoMove = (id: string, x: number, y: number) => {
    setLogoElements((prev) =>
      prev.map((logo) => (logo.id === id ? { ...logo, x, y } : logo))
    );
  };

  const handleLogoDelete = (id: string) => {
    setLogoElements((prev) => prev.filter((logo) => logo.id !== id));
    if (selectedLogo === id) setSelectedLogo(null);
  };

  const handleLogoResize = (id: string, height: number) => {
    setLogoElements((prev) =>
      prev.map((logo) => (logo.id === id ? { ...logo, height } : logo))
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <h3 className="text-lg font-light text-[#e5e4e2] mb-4">
          Edytor treści (format A4)
        </h3>

        <div
          className="relative bg-white mx-auto shadow-2xl overflow-hidden"
          style={{
            width: `${A4_WIDTH}px`,
            minHeight: `${A4_HEIGHT}px`,
            padding: `${pageSettings.marginTop}px ${pageSettings.marginRight}px ${pageSettings.marginBottom}px ${pageSettings.marginLeft}px`,
          }}
        >
          {logoElements.map((logo) => (
            <Draggable
              key={logo.id}
              position={{ x: logo.x, y: logo.y }}
              onStop={(e, data) => handleLogoMove(logo.id, data.x, data.y)}
              bounds="parent"
            >
              <div
                className={`absolute cursor-move group ${
                  selectedLogo === logo.id ? 'ring-2 ring-blue-500' : ''
                }`}
                onClick={() => setSelectedLogo(logo.id)}
                style={{ zIndex: 10 }}
              >
                <img
                  src={logo.url}
                  alt="Logo"
                  style={{ height: `${logo.height}px` }}
                  className="object-contain pointer-events-none"
                  draggable={false}
                />
                <div className="absolute -top-8 left-0 hidden group-hover:flex gap-1 bg-black/80 rounded px-2 py-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLogoDelete(logo.id);
                    }}
                    className="text-xs text-white hover:text-red-400"
                  >
                    Usuń
                  </button>
                </div>
              </div>
            </Draggable>
          ))}

          <div className="relative" style={{ minHeight: '800px' }}>
            <ReactQuill
              ref={quillRef}
              theme="snow"
              value={content}
              onChange={setContent}
              modules={modules}
              formats={formats}
              placeholder="Wprowadź treść umowy..."
              className="h-full"
              style={{
                fontSize: `${pageSettings.fontSize || 12}px`,
                fontFamily: pageSettings.fontFamily || 'Arial',
              }}
            />
          </div>
        </div>
      </div>

      {selectedLogo && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4">
          <h4 className="text-[#e5e4e2] mb-3">Ustawienia wybranego logo</h4>
          <div className="space-y-2">
            <div>
              <label className="text-sm text-[#e5e4e2]/60">
                Wysokość: {logoElements.find((l) => l.id === selectedLogo)?.height}px
              </label>
              <input
                type="range"
                min="30"
                max="200"
                value={logoElements.find((l) => l.id === selectedLogo)?.height || 50}
                onChange={(e) => handleLogoResize(selectedLogo, parseInt(e.target.value))}
                className="w-full"
              />
            </div>
            <button
              onClick={() => handleLogoDelete(selectedLogo)}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Usuń logo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
