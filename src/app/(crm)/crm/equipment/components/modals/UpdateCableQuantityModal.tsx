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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl w-full max-w-md p-6">
        <h3 className="text-xl font-light text-[#e5e4e2] mb-4">Ustaw ilość na stanie</h3>

        <label className="block text-sm text-[#e5e4e2]/60 mb-2">Ilość sztuk</label>
        <input
          type="number"
          min={0}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || '0', 10)))}
          className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-3 text-[#e5e4e2] text-lg focus:outline-none focus:border-[#d3bb73]/30"
          placeholder="np. 50"
          autoFocus
        />
        <p className="text-sm text-[#e5e4e2]/40 mt-2">
          Wprowadź łączną ilość sztuk tego sprzętu.
        </p>

        <div className="flex gap-3 pt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}