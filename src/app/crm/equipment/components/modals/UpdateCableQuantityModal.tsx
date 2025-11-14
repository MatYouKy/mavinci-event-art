export function UpdateCableQuantityModal({
  open,
  value,
  onChange,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  value: number;
  onChange: (v: number) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-xl font-light text-[#e5e4e2]">Ustaw ilość na stanie</h3>

        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość sztuk</label>
        <input
          type="number"
          min={0}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || '0', 10)))}
          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-lg text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
          placeholder="np. 50"
          autoFocus
        />
        <p className="mt-2 text-sm text-[#e5e4e2]/40">Wprowadź łączną ilość sztuk tego sprzętu.</p>

        <div className="flex gap-3 pt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
