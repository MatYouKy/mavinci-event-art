'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Plus, X } from 'lucide-react';

interface Contact {
  id: string;
  name: string;
  nip: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  client_type?: string;
}

interface BuyerSearchInputProps {
  contacts: Contact[];
  selectedContactId: string;
  onContactSelect: (contactId: string) => void;
  onAddNew: () => void;
}

export default function BuyerSearchInput({
  contacts,
  selectedContactId,
  onContactSelect,
  onAddNew,
}: BuyerSearchInputProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>(contacts);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedContact = contacts.find((c) => c.id === selectedContactId);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredContacts(contacts);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(query) ||
        contact.nip?.toLowerCase().includes(query) ||
        contact.city?.toLowerCase().includes(query),
    );
    setFilteredContacts(filtered);
  }, [searchQuery, contacts]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (contact: Contact) => {
    onContactSelect(contact.id);
    setSearchQuery('');
    setIsOpen(false);
  };

  const handleClear = () => {
    onContactSelect('');
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nabywca *</label>

      <div className="relative">
        {selectedContact ? (
          <div className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-3">
            <div className="flex-1">
              <div className="font-medium text-[#e5e4e2]">{selectedContact.name}</div>
              {selectedContact.nip && (
                <div className="text-xs text-[#e5e4e2]/60">NIP: {selectedContact.nip}</div>
              )}
              {selectedContact.city && (
                <div className="text-xs text-[#e5e4e2]/60">{selectedContact.city}</div>
              )}
            </div>
            <button
              onClick={handleClear}
              className="rounded p-1 text-[#e5e4e2]/60 hover:bg-[#d3bb73]/20 hover:text-[#e5e4e2]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsOpen(true);
                }}
                onFocus={() => setIsOpen(true)}
                placeholder="Wyszukaj nabywcę po nazwie, NIP lub mieście..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-3 pl-10 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
              />
            </div>

            {isOpen && (
              <div className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
                <button
                  onClick={onAddNew}
                  className="flex w-full items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/10"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/20">
                    <Plus className="h-4 w-4 text-[#d3bb73]" />
                  </div>
                  <div>
                    <div className="font-medium text-[#d3bb73]">Dodaj nowego nabywcę</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      Wprowadź dane ręcznie lub pobierz z GUS
                    </div>
                  </div>
                </button>

                {filteredContacts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[#e5e4e2]/60">
                    Nie znaleziono kontaktów
                    <div className="mt-2 text-xs">
                      Spróbuj wyszukać inaczej lub dodaj nowego nabywcę
                    </div>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    {filteredContacts.map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => handleSelect(contact)}
                        className="w-full border-b border-[#d3bb73]/5 px-4 py-3 text-left transition-colors hover:bg-[#d3bb73]/5 last:border-b-0"
                      >
                        <div className="font-medium text-[#e5e4e2]">{contact.name}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/60">
                          {contact.nip && <span>NIP: {contact.nip}</span>}
                          {contact.city && <span>{contact.city}</span>}
                          {contact.client_type === 'business' && (
                            <span className="rounded bg-[#d3bb73]/20 px-1.5 py-0.5 text-[#d3bb73]">
                              Firma
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-2 text-xs text-[#e5e4e2]/40">
        Wpisz nazwę firmy, NIP lub miasto aby wyszukać kontakt
      </div>
    </div>
  );
}
