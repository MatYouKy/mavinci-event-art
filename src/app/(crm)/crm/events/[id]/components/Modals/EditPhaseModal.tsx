'use client';

import React, { useState, useEffect } from 'react';
import { X, Palette } from 'lucide-react';
import { EventPhase, useUpdatePhaseMutation } from '@/store/api/eventPhasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface EditPhaseModalProps {
  open: boolean;
  onClose: () => void;
  phase: EventPhase | null;
}

const PRESET_COLORS = [
  { name: 'Niebieski', value: '#3b82f6' },
  { name: 'Zielony', value: '#10b981' },
  { name: 'Żółty', value: '#f59e0b' },
  { name: 'Czerwony', value: '#ef4444' },
  { name: 'Fioletowy', value: '#8b5cf6' },
  { name: 'Różowy', value: '#ec4899' },
  { name: 'Złoty', value: '#d3bb73' },
  { name: 'Pomarańczowy', value: '#f97316' },
  { name: 'Turkusowy', value: '#14b8a6' },
  { name: 'Indygo', value: '#6366f1' },
];

export const EditPhaseModal: React.FC<EditPhaseModalProps> = ({ open, onClose, phase }) => {
  const [updatePhase, { isLoading }] = useUpdatePhaseMutation();
  const { showSnackbar } = useSnackbar();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [customColor, setCustomColor] = useState('');

  useEffect(() => {
    if (phase) {
      setName(phase.name);
      setDescription(phase.description || '');
      setColor(phase.color || phase.phase_type?.color || '#3b82f6');
      setCustomColor('');
    }
  }, [phase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phase) return;

    if (!name.trim()) {
      showSnackbar('Podaj nazwę fazy', 'error');
      return;
    }

    try {
      await updatePhase({
        id: phase.id,
        name: name.trim(),
        description: description.trim() || undefined,
        color: customColor || color,
      }).unwrap();

      showSnackbar('Faza zaktualizowana', 'success');
      onClose();
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas aktualizacji fazy', 'error');
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setColor('#3b82f6');
    setCustomColor('');
    onClose();
  };

  if (!open || !phase) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-[#1c1f33] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-6 py-4">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-semibold text-[#e5e4e2]">Edytuj fazę</h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-[#e5e4e2]/50 hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6">
          {/* Nazwa */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Nazwa fazy</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
              placeholder="np. Załadunek, Realizacja, Rozładunek"
            />
          </div>

          {/* Opis */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis (opcjonalny)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
              placeholder="Dodatkowe informacje o fazie"
            />
          </div>

          {/* Kolor - Predefiniowane */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kolor fazy</label>
            <div className="grid grid-cols-5 gap-2">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    setColor(preset.value);
                    setCustomColor('');
                  }}
                  className={`flex h-10 items-center justify-center rounded-lg border-2 transition-all ${
                    color === preset.value && !customColor
                      ? 'border-[#d3bb73] scale-110'
                      : 'border-transparent hover:border-[#d3bb73]/50'
                  }`}
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                />
              ))}
            </div>
          </div>

          {/* Kolor - Własny */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Własny kolor (opcjonalnie)</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={customColor || color}
                onChange={(e) => setCustomColor(e.target.value)}
                className="h-10 w-20 cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a]"
              />
              <input
                type="text"
                value={customColor || color}
                onChange={(e) => setCustomColor(e.target.value)}
                className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0d0f1a] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
                placeholder="#3b82f6"
              />
            </div>
          </div>

          {/* Preview */}
          <div className="mb-6">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Podgląd</label>
            <div
              className="rounded-lg border-l-4 px-4 py-3"
              style={{
                borderLeftColor: customColor || color,
                backgroundColor: `${customColor || color}20`,
              }}
            >
              <div className="text-sm font-bold text-[#e5e4e2]">{name || 'Nazwa fazy'}</div>
              <div className="text-xs text-[#e5e4e2]/70">{description || 'Brak opisu'}</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#e5e4e2]/10"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {isLoading ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
