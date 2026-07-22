'use client';

import { useState, useEffect } from 'react';
import { ArrowLeft, Search, Users, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { Conversation } from './ChatWidget';

interface EmployeeOption {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  avatar_url: string | null;
  role: string | null;
}

interface Props {
  currentEmployeeId: string;
  onBack: () => void;
  onConversationCreated: (conv: Conversation) => void;
}

export default function ChatNewConversation({ currentEmployeeId, onBack, onConversationCreated }: Props) {
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [groupName, setGroupName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const isGroupMode = selected.length > 1;

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, name, surname, nickname, avatar_url, role')
      .neq('id', currentEmployeeId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    setEmployees(data || []);
    setIsLoading(false);
  };

  const toggleSelect = (empId: string) => {
    setSelected((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId],
    );
  };

  const createConversation = async () => {
    if (selected.length === 0 || isCreating) return;
    setIsCreating(true);

    try {
      // Check for existing 1-on-1
      if (selected.length === 1) {
        const { data: myParticipations } = await supabase
          .from('employee_conversation_participants')
          .select('conversation_id')
          .eq('employee_id', currentEmployeeId);

        if (myParticipations && myParticipations.length > 0) {
          const convIds = myParticipations.map((p) => p.conversation_id);
          const { data: otherParticipations } = await supabase
            .from('employee_conversation_participants')
            .select('conversation_id')
            .eq('employee_id', selected[0])
            .in('conversation_id', convIds);

          if (otherParticipations && otherParticipations.length > 0) {
            const commonIds = otherParticipations.map((p) => p.conversation_id);
            const { data: existingConvs } = await supabase
              .from('employee_conversations')
              .select('*')
              .in('id', commonIds)
              .eq('is_group', false);

            if (existingConvs && existingConvs.length > 0) {
              const existing = existingConvs[0];
              const conv = await enrichConversation(existing);
              onConversationCreated(conv);
              return;
            }
          }
        }
      }

      // Create new conversation
      const { data: newConv, error } = await supabase
        .from('employee_conversations')
        .insert({
          title: isGroupMode ? groupName || null : null,
          is_group: isGroupMode,
          created_by: currentEmployeeId,
        })
        .select()
        .single();

      if (error || !newConv) {
        console.error('[NewChat] create error:', error);
        return;
      }

      // Add participants
      const participantInserts = [currentEmployeeId, ...selected].map((empId) => ({
        conversation_id: newConv.id,
        employee_id: empId,
      }));

      await supabase.from('employee_conversation_participants').insert(participantInserts);

      const conv = await enrichConversation(newConv);
      onConversationCreated(conv);
    } catch (err) {
      console.error('[NewChat] error:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const enrichConversation = async (conv: any): Promise<Conversation> => {
    const { data: parts } = await supabase
      .from('employee_conversation_participants')
      .select('id, conversation_id, employee_id, last_read_at')
      .eq('conversation_id', conv.id);

    const empIds = (parts || []).map((p) => p.employee_id);
    const { data: emps } = await supabase
      .from('employees')
      .select('id, name, surname, nickname, avatar_url')
      .in('id', empIds);

    const empMap = new Map((emps || []).map((e) => [e.id, e]));
    return {
      ...conv,
      participants: (parts || []).map((p) => ({ ...p, employee: empMap.get(p.employee_id) })),
      unread_count: 0,
    };
  };

  const filtered = employees.filter((emp) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      emp.name?.toLowerCase().includes(q) ||
      emp.surname?.toLowerCase().includes(q) ||
      emp.nickname?.toLowerCase().includes(q)
    );
  });

  const getDisplayName = (emp: EmployeeOption) =>
    emp.nickname || `${emp.name} ${emp.surname}`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#d3bb73]/10 px-3 py-2">
        <button
          onClick={onBack}
          className="rounded-lg p-1 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-[#e5e4e2]">Nowy czat</span>
        <div className="flex-1" />
        <button
          onClick={createConversation}
          disabled={selected.length === 0 || isCreating}
          className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
            selected.length > 0
              ? 'bg-[#d3bb73] text-[#0f1119] hover:bg-[#c5aa5c]'
              : 'bg-[#d3bb73]/10 text-[#d3bb73]/40'
          }`}
        >
          {isCreating ? '...' : 'Utwórz'}
        </button>
      </div>

      {/* Group name */}
      {isGroupMode && (
        <div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-3 py-2">
          <Users className="h-3.5 w-3.5 text-[#d3bb73]" />
          <input
            type="text"
            placeholder="Nazwa grupy (opcjonalnie)"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="flex-1 bg-transparent text-xs text-[#e5e4e2] placeholder-[#e5e4e2]/40 outline-none"
          />
        </div>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-[#d3bb73]/10 px-3 py-2">
          {selected.map((id) => {
            const emp = employees.find((e) => e.id === id);
            if (!emp) return null;
            return (
              <button
                key={id}
                onClick={() => toggleSelect(id)}
                className="flex items-center gap-1 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-2 py-0.5 text-[10px] text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              >
                {getDisplayName(emp)}
                <span className="ml-0.5 text-[#d3bb73]/60">&times;</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search */}
      <div className="border-b border-[#d3bb73]/10 px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg bg-[#0f1119]/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-[#e5e4e2]/40" />
          <input
            type="text"
            placeholder="Szukaj pracownika..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs text-[#e5e4e2] placeholder-[#e5e4e2]/40 outline-none"
            autoFocus
          />
        </div>
      </div>

      {/* Employee list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d3bb73]/20 border-t-[#d3bb73]" />
          </div>
        ) : (
          filtered.map((emp) => {
            const isSelected = selected.includes(emp.id);
            return (
              <button
                key={emp.id}
                onClick={() => toggleSelect(emp.id)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[#d3bb73]/5 ${
                  isSelected ? 'bg-[#d3bb73]/5' : ''
                }`}
              >
                {/* Avatar */}
                {emp.avatar_url ? (
                  <img src={emp.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs font-semibold text-[#d3bb73]">
                    {(emp.nickname || emp.name || '').charAt(0).toUpperCase()}
                    {(emp.surname || '').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-[#e5e4e2]">
                    {getDisplayName(emp)}
                  </span>
                  {emp.nickname && (
                    <span className="truncate text-[10px] text-[#e5e4e2]/40">
                      {emp.name} {emp.surname}
                    </span>
                  )}
                  {emp.role && (
                    <span className="truncate text-[10px] text-[#e5e4e2]/30">{emp.role}</span>
                  )}
                </div>
                {/* Checkbox */}
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                    isSelected
                      ? 'border-[#d3bb73] bg-[#d3bb73]'
                      : 'border-[#e5e4e2]/20'
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3 text-[#0f1119]" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
