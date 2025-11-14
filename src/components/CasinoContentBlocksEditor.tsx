'use client';

import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

interface ContentBlock {
  id: string;
  title: string;
  content: string;
  layout_type: 'grid-4' | 'grid-3' | 'grid-2' | 'grid-1';
  order_index: number;
}

interface CasinoContentBlocksEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
}

export default function CasinoContentBlocksEditor({ blocks, onChange }: CasinoContentBlocksEditorProps) {
  const addBlock = () => {
    const newBlock: ContentBlock = {
      id: crypto.randomUUID(),
      title: 'Nowa sekcja',
      content: 'Treść nowej sekcji...',
      layout_type: 'grid-1',
      order_index: blocks.length,
    };
    onChange([...blocks, newBlock]);
  };

  const removeBlock = (id: string) => {
    onChange(blocks.filter(b => b.id !== id));
  };

  const updateBlock = (id: string, field: keyof ContentBlock, value: any) => {
    onChange(blocks.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const newBlocks = [...blocks];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newBlocks.length) return;

    [newBlocks[index], newBlocks[targetIndex]] = [newBlocks[targetIndex], newBlocks[index]];
    newBlocks.forEach((block, idx) => {
      block.order_index = idx;
    });
    onChange(newBlocks);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-light text-[#e5e4e2]">Elastyczne Bloki Treści</h3>
          <p className="text-sm text-[#e5e4e2]/50 mt-1">Dowolnie komponowalne sekcje z różnymi układami grid</p>
        </div>
        <button
          onClick={addBlock}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Dodaj blok
        </button>
      </div>

      {blocks.map((block, index) => (
        <div key={block.id} className="bg-[#1c1f33]/60 border border-[#d3bb73]/20 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-light text-[#e5e4e2]">Blok #{index + 1}</h4>
            <div className="flex gap-2">
              <button
                onClick={() => moveBlock(index, 'up')}
                disabled={index === 0}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => moveBlock(index, 'down')}
                disabled={index === blocks.length - 1}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => removeBlock(block.id)}
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#e5e4e2]/70 text-sm mb-2">Tytuł sekcji</label>
            <input
              type="text"
              value={block.title}
              onChange={(e) => updateBlock(block.id, 'title', e.target.value)}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Nagłówek sekcji"
            />
          </div>

          <div>
            <label className="block text-[#e5e4e2]/70 text-sm mb-2">Układ grid</label>
            <select
              value={block.layout_type}
              onChange={(e) => updateBlock(block.id, 'layout_type', e.target.value)}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="grid-4">4 kolumny (Grid 4)</option>
              <option value="grid-3">3 kolumny (Grid 3)</option>
              <option value="grid-2">2 kolumny (Grid 2)</option>
              <option value="grid-1">1 kolumna (Grid 1)</option>
            </select>
          </div>

          <div>
            <label className="block text-[#e5e4e2]/70 text-sm mb-2">Treść</label>
            <textarea
              value={block.content}
              onChange={(e) => updateBlock(block.id, 'content', e.target.value)}
              rows={6}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none font-mono text-sm"
              placeholder="Treść bloku..."
            />
            <p className="text-xs text-[#e5e4e2]/40 mt-1">Możesz używać podstawowego formatowania</p>
          </div>

          <div className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-4">
            <p className="text-xs text-[#e5e4e2]/50 mb-2">Podgląd układu:</p>
            <div className={`grid ${
              block.layout_type === 'grid-4' ? 'grid-cols-4' :
              block.layout_type === 'grid-3' ? 'grid-cols-3' :
              block.layout_type === 'grid-2' ? 'grid-cols-2' : 'grid-cols-1'
            } gap-2`}>
              {Array.from({ length: parseInt(block.layout_type.split('-')[1]) }).map((_, i) => (
                <div key={i} className="bg-[#d3bb73]/20 h-8 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {blocks.length === 0 && (
        <div className="text-center py-12 text-[#e5e4e2]/50 border border-dashed border-[#d3bb73]/20 rounded-xl">
          <p className="mb-2">Brak bloków treści</p>
          <p className="text-xs">Bloki pozwalają na swobodne komponowanie dodatkowych sekcji na stronie</p>
        </div>
      )}
    </div>
  );
}
