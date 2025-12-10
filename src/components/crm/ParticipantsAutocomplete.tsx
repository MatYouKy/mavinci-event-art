'use client';

import { useState, useEffect, useRef } from 'react';
import { Users, Plus, X, Search, User, Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Employee {
  id: string;
  full_name: string;
  email?: string;
  position?: string;
}

interface Contact {
  id: string;
  full_name: string;
  email?: string;
  organization_id?: string;
}

interface Participant {
  type: 'employee' | 'contact' | 'manual';
  id: string | null;
  name: string;
  email?: string;
  position?: string;
}

interface ParticipantsAutocompleteProps {
  value: Participant[];
  onChange: (participants: Participant[]) => void;
  placeholder?: string;
  className?: string;
}

export default function ParticipantsAutocomplete({
  value,
  onChange,
  placeholder = 'Dodaj uczestnika...',
  className = '',
}: ParticipantsAutocompleteProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'employee' | 'contact'>('employee');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchEmployees();
    fetchContacts();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name, email, position')
      .order('full_name');
    if (data) setEmployees(data);
  };

  const fetchContacts = async () => {
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, email, organization_id')
      .order('full_name');
    if (data) setContacts(data);
  };

  const filteredEmployees = employees.filter((emp) =>
    emp.full_name.toLowerCase().includes(inputValue.toLowerCase()) ||
    emp.email?.toLowerCase().includes(inputValue.toLowerCase())
  );

  const filteredContacts = contacts.filter((contact) =>
    contact.full_name.toLowerCase().includes(inputValue.toLowerCase()) ||
    contact.email?.toLowerCase().includes(inputValue.toLowerCase())
  );

  const handleSelectEmployee = (employee: Employee) => {
    const newParticipant: Participant = {
      type: 'employee',
      id: employee.id,
      name: employee.full_name,
      email: employee.email,
      position: employee.position,
    };

    if (!value.some(p => p.type === 'employee' && p.id === employee.id)) {
      onChange([...value, newParticipant]);
    }
    setInputValue('');
    setShowDropdown(false);
  };

  const handleSelectContact = (contact: Contact) => {
    const newParticipant: Participant = {
      type: 'contact',
      id: contact.id,
      name: contact.full_name,
      email: contact.email,
    };

    if (!value.some(p => p.type === 'contact' && p.id === contact.id)) {
      onChange([...value, newParticipant]);
    }
    setInputValue('');
    setShowDropdown(false);
  };

  const handleAddManual = () => {
    if (!inputValue.trim()) return;

    const newParticipant: Participant = {
      type: 'manual',
      id: null,
      name: inputValue.trim(),
    };

    onChange([...value, newParticipant]);
    setInputValue('');
    setShowDropdown(false);
  };

  const handleRemoveParticipant = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowDropdown(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      handleAddManual();
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="relative">
        <div className="relative">
          <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#e5e4e2]/50" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            placeholder={placeholder}
            className="w-full pl-10 pr-10 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
          />
          {inputValue && (
            <button
              type="button"
              onClick={() => {
                setInputValue('');
                setShowDropdown(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/50 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute z-50 w-full mt-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg shadow-xl max-h-80 overflow-hidden"
          >
            <div className="flex border-b border-[#d3bb73]/20">
              <button
                type="button"
                onClick={() => setSelectedTab('employee')}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  selectedTab === 'employee'
                    ? 'bg-[#d3bb73]/20 text-[#d3bb73] border-b-2 border-[#d3bb73]'
                    : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <User className="w-4 h-4" />
                  Pracownicy
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedTab('contact')}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  selectedTab === 'contact'
                    ? 'bg-[#d3bb73]/20 text-[#d3bb73] border-b-2 border-[#d3bb73]'
                    : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Kontakty
                </div>
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {selectedTab === 'employee' && (
                <>
                  {filteredEmployees.length > 0 ? (
                    filteredEmployees.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        onClick={() => handleSelectEmployee(employee)}
                        className="w-full text-left px-4 py-3 hover:bg-[#d3bb73]/10 transition-colors border-b border-[#d3bb73]/10 last:border-b-0"
                      >
                        <div className="flex items-start gap-3">
                          <User className="w-4 h-4 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[#e5e4e2] truncate">
                              {employee.full_name}
                            </div>
                            {(employee.email || employee.position) && (
                              <div className="text-xs text-[#e5e4e2]/60 truncate mt-0.5">
                                {[employee.position, employee.email].filter(Boolean).join(' • ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-[#e5e4e2]/50 text-sm">
                      {inputValue
                        ? `Brak pracowników pasujących do "${inputValue}"`
                        : 'Brak pracowników w systemie'}
                    </div>
                  )}
                </>
              )}

              {selectedTab === 'contact' && (
                <>
                  {filteredContacts.length > 0 ? (
                    filteredContacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => handleSelectContact(contact)}
                        className="w-full text-left px-4 py-3 hover:bg-[#d3bb73]/10 transition-colors border-b border-[#d3bb73]/10 last:border-b-0"
                      >
                        <div className="flex items-start gap-3">
                          <Building2 className="w-4 h-4 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[#e5e4e2] truncate">
                              {contact.full_name}
                            </div>
                            {contact.email && (
                              <div className="text-xs text-[#e5e4e2]/60 truncate mt-0.5">
                                {contact.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-[#e5e4e2]/50 text-sm">
                      {inputValue
                        ? `Brak kontaktów pasujących do "${inputValue}"`
                        : 'Brak kontaktów w systemie'}
                    </div>
                  )}
                </>
              )}
            </div>

            {inputValue && (
              <div className="px-4 py-3 border-t border-[#d3bb73]/20 bg-[#0f1117]">
                <button
                  type="button"
                  onClick={handleAddManual}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#d3bb73]/20 hover:bg-[#d3bb73]/30 text-[#d3bb73] rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj "{inputValue}" jako uczestnika
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((participant, index) => (
            <div
              key={index}
              className="flex items-center justify-between px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg"
            >
              <div className="flex items-center gap-3">
                {participant.type === 'employee' && <User className="w-4 h-4 text-[#d3bb73]" />}
                {participant.type === 'contact' && <Building2 className="w-4 h-4 text-[#d3bb73]" />}
                {participant.type === 'manual' && <Users className="w-4 h-4 text-[#e5e4e2]/50" />}
                <div>
                  <div className="text-sm text-[#e5e4e2] font-medium">{participant.name}</div>
                  {(participant.email || participant.position) && (
                    <div className="text-xs text-[#e5e4e2]/60">
                      {[participant.position, participant.email].filter(Boolean).join(' • ')}
                    </div>
                  )}
                  {participant.type === 'manual' && (
                    <div className="text-xs text-[#e5e4e2]/40">
                      Ręczne wprowadzenie
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveParticipant(index)}
                className="p-1 hover:bg-red-500/20 rounded transition-colors"
              >
                <X className="w-4 h-4 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {value.length === 0 && (
        <div className="text-center py-4 text-[#e5e4e2]/50 text-sm">
          Brak uczestników. Kliknij w pole aby wybrać z listy lub wpisz ręcznie.
        </div>
      )}
    </div>
  );
}
