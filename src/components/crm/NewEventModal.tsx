'use client';

import { X, Plus, Upload, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface NewEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (event: any) => void;
  initialDate?: Date;
}

interface Client {
  id: string;
  company_name: string;
}

interface Attachment {
  name: string;
  url: string;
  size: number;
  type: string;
}

export default function NewEventModal({
  isOpen,
  onClose,
  onSave,
  initialDate,
}: NewEventModalProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    client_id: '',
    event_date: initialDate?.toISOString().slice(0, 16) || '',
    event_end_date: '',
    location: '',
    budget: '',
    description: '',
    status: 'offer_sent',
  });

  useEffect(() => {
    if (isOpen) {
      fetchClients();
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialDate) {
      setFormData(prev => ({
        ...prev,
        event_date: initialDate.toISOString().slice(0, 16),
      }));
    }
  }, [initialDate]);

  const fetchClients = async () => {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_name')
        .order('company_name', { ascending: true });

      if (error) {
        console.error('Error fetching clients:', error);
        return;
      }

      if (data) {
        setClients(data);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const handleAddNewClient = async () => {
    if (!newClientName.trim()) {
      alert('Wprowadź nazwę klienta');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('clients')
        .insert([
          {
            company_name: newClientName.trim(),
          },
        ])
        .select();

      if (error) {
        console.error('Error adding client:', error);
        alert('Błąd podczas dodawania klienta: ' + error.message);
        return;
      }

      if (data && data[0]) {
        setClients([...clients, data[0]]);
        setFormData({ ...formData, client_id: data[0].id });
        setNewClientName('');
        setShowNewClientForm(false);
        alert('Klient został dodany!');
      }
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas dodawania klienta');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: Attachment[] = Array.from(files).map((file) => ({
      name: file.name,
      url: URL.createObjectURL(file),
      size: file.size,
      type: file.type,
    }));

    setAttachments([...attachments, ...newAttachments]);
  };

  const removeAttachment = (index: number) => {
    const newAttachments = attachments.filter((_, i) => i !== index);
    setAttachments(newAttachments);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...formData, attachments });
    setFormData({
      name: '',
      client_id: '',
      event_date: '',
      event_end_date: '',
      location: '',
      budget: '',
      description: '',
      status: 'offer_sent',
    });
    setAttachments([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-2xl bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/10 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-light text-[#e5e4e2]">Nowy event</h2>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/70 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Nazwa eventu *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Konferencja Tech Summit 2025"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Klient
              </label>

              {!showNewClientForm ? (
                <div className="flex gap-2">
                  <select
                    value={formData.client_id}
                    onChange={(e) =>
                      setFormData({ ...formData, client_id: e.target.value })
                    }
                    className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                  >
                    <option value="">Wybierz klienta</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.company_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewClientForm(true)}
                    className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    Nowy
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Nazwa nowego klienta"
                    className="flex-1 bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                  />
                  <button
                    type="button"
                    onClick={handleAddNewClient}
                    className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
                  >
                    Dodaj
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewClientForm(false);
                      setNewClientName('');
                    }}
                    className="bg-[#0f1119] text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#0f1119]/50 transition-colors"
                  >
                    Anuluj
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                  Data rozpoczęcia *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.event_date}
                  onChange={(e) =>
                    setFormData({ ...formData, event_date: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                  Data zakończenia
                </label>
                <input
                  type="datetime-local"
                  value={formData.event_end_date}
                  onChange={(e) =>
                    setFormData({ ...formData, event_end_date: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Lokalizacja *
              </label>
              <input
                type="text"
                required
                value={formData.location}
                onChange={(e) =>
                  setFormData({ ...formData, location: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="np. Warszawa, Hotel Marriott"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Budżet (zł)
              </label>
              <input
                type="number"
                value={formData.budget}
                onChange={(e) =>
                  setFormData({ ...formData, budget: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
              >
                <option value="offer_sent">Oferta wysłana</option>
                <option value="offer_accepted">Oferta zaakceptowana</option>
                <option value="in_preparation">W przygotowaniu</option>
                <option value="in_progress">W trakcie</option>
                <option value="completed">Zakończony</option>
                <option value="cancelled">Anulowany</option>
                <option value="invoiced">Rozliczony</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Opis
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                rows={4}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]/30"
                placeholder="Dodatkowe informacje o evencie..."
              />
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/70 mb-2">
                Załączniki
              </label>
              <div className="space-y-2">
                <label className="flex items-center justify-center gap-2 w-full bg-[#0f1119] border border-[#d3bb73]/10 border-dashed rounded-lg px-4 py-3 text-[#e5e4e2]/70 hover:border-[#d3bb73]/30 hover:bg-[#0f1119]/50 transition-colors cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm">Dodaj pliki</span>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {attachments.length > 0 && (
                  <div className="space-y-2">
                    {attachments.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#e5e4e2] truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-[#e5e4e2]/50">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(index)}
                          className="ml-2 text-red-400 hover:text-red-300 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-[#d3bb73]/10">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 rounded-lg text-sm font-medium text-[#e5e4e2] hover:bg-[#d3bb73]/10 transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="px-6 py-2 rounded-lg text-sm font-medium bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90 transition-colors"
            >
              Zapisz event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
