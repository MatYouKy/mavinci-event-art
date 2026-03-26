import { useState } from 'react';

export function AddDocumentModal({
  isOpen,
  onClose,
  employeeId,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  onAdded: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    document_type: 'other',
    file_url: '',
    description: '',
    expiry_date: '',
  });

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.name || !formData.file_url) {
      alert('Wypełnij nazwę i URL pliku');
      return;
    }

    try {
      // Table employee_documents doesn't exist yet
      alert('Funkcja dokumentów nie jest jeszcze dostępna');
      onClose();
    } catch (err) {
      console.error('Error adding document:', err);
      alert('Błąd podczas dodawania dokumentu');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <h2 className="mb-6 text-xl font-light text-[#e5e4e2]">Dodaj dokument</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa dokumentu *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="np. Umowa zlecenie 2025"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ dokumentu</label>
            <select
              value={formData.document_type}
              onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
            >
              <option value="contract">Umowa</option>
              <option value="certificate">Certyfikat</option>
              <option value="id_document">Dokument tożsamości</option>
              <option value="other">Inny</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">URL pliku *</label>
            <input
              type="url"
              value={formData.file_url}
              onChange={(e) => setFormData({ ...formData, file_url: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="Dodatkowe informacje..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Data ważności</label>
            <input
              type="date"
              value={formData.expiry_date}
              onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
