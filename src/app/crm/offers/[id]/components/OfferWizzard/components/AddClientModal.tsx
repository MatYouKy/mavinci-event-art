'use client';

import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal } from '@/components/UI/Modal';

interface AddClientModalProps {
  open: boolean;
  onClose: () => void;

  contacts: any[];
  setContacts: (next: any[]) => void;
  setSelectedContactId: (id: string) => void;
}

export default function AddClientModal({
  open,
  onClose,
  contacts,
  setContacts,
  setSelectedContactId,
}: AddClientModalProps) {
  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj nowego klienta</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const name = formData.get('name') as string;
            const surname = formData.get('surname') as string;
            const email = formData.get('email') as string;
            const phone = formData.get('phone') as string;

            try {
              const { data, error } = await supabase
                .from('contacts')
                .insert([
                  {
                    name,
                    surname,
                    email: email || null,
                    phone: phone || null,
                    contact_type: 'individual',
                  },
                ])
                .select()
                .single();

              if (error) throw error;

              setContacts([...contacts, data]);
              setSelectedContactId(data.id);
              onClose();
              alert('Klient został dodany pomyślnie');
            } catch (err) {
              console.error('Error adding client:', err);
              alert('Wystąpił błąd podczas dodawania klienta');
            }
          }}
          className="space-y-4"
        >
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Imię *</label>
            <input
              type="text"
              name="name"
              required
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwisko *</label>
            <input
              type="text"
              name="surname"
              required
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Email</label>
            <input
              type="email"
              name="email"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Telefon</label>
            <input
              type="tel"
              name="phone"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}