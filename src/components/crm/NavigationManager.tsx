'use client';

import { useState, useEffect, DragEvent } from 'react';
import Link from 'next/link';
import { GripVertical, RotateCcw, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface NavigationItem {
  key: string;
  name: string;
  href: string;
  icon: any;
  module?: string;
}

interface Props {
  navigation: NavigationItem[];
  pathname: string;
  sidebarCollapsed: boolean;
  employeeId: string | null;
  onClose?: () => void;
  onOrderChange: (newOrder: NavigationItem[]) => void;
}

export default function NavigationManager({
  navigation,
  pathname,
  sidebarCollapsed,
  employeeId,
  onClose,
  onOrderChange,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [items, setItems] = useState<NavigationItem[]>(navigation);
  const [saving, setSaving] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  useEffect(() => {
    setItems(navigation);
  }, [navigation]);

  useEffect(() => {
    fetchUnreadCount();

    const contactChannel = supabase
      .channel('messages-unread-count')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'contact_messages',
        },
        (payload) => {
          const newMessage = payload.new as any;
          showSnackbar(`Nowa wiadomość z formularza: ${newMessage.subject || 'Wiadomość z formularza'}`, 'info');
          fetchUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contact_messages',
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    const receivedChannel = supabase
      .channel('received-emails-unread-count')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'received_emails',
        },
        (payload) => {
          const newEmail = payload.new as any;
          showSnackbar(`Nowy email: ${newEmail.subject || '(No subject)'}`, 'info');
          fetchUnreadCount();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'received_emails',
        },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(contactChannel);
      supabase.removeChannel(receivedChannel);
    };
  }, [showSnackbar]);

  const fetchUnreadCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { count: contactCount } = await supabase
        .from('contact_messages')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'unread');

      const { count: emailCount } = await supabase
        .from('received_emails')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);

      setUnreadMessagesCount((contactCount || 0) + (emailCount || 0));
    } catch (error) {
      console.error('Error fetching unread messages count:', error);
    }
  };

  const handleDragStart = (e: DragEvent<HTMLLIElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === index) return;

    const newItems = [...items];
    const draggedItem = newItems[draggedIndex];

    newItems.splice(draggedIndex, 1);
    newItems.splice(index, 0, draggedItem);

    setItems(newItems);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleSaveOrder = async () => {
    if (!employeeId) return;

    try {
      setSaving(true);
      const order = items.map(item => item.key);

      const { error } = await supabase
        .from('employees')
        .update({ navigation_order: order })
        .eq('id', employeeId);

      if (error) throw error;

      onOrderChange(items);
      setIsEditMode(false);
      showSnackbar('Kolejność nawigacji zapisana', 'success');
    } catch (err) {
      console.error('Error saving navigation order:', err);
      showSnackbar('Błąd podczas zapisywania kolejności', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetOrder = async () => {
    if (!employeeId) return;

    try {
      setSaving(true);

      const { error } = await supabase
        .from('employees')
        .update({ navigation_order: null })
        .eq('id', employeeId);

      if (error) throw error;

      setItems(navigation);
      onOrderChange(navigation);
      setIsEditMode(false);
      showSnackbar('Przywrócono domyślną kolejność', 'success');
    } catch (err) {
      console.error('Error resetting navigation order:', err);
      showSnackbar('Błąd podczas resetowania kolejności', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setItems(navigation);
    setIsEditMode(false);
  };

  return (
    <>
      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          {!sidebarCollapsed && (
            <span className="text-xs text-[#e5e4e2]/40 uppercase tracking-wider">
              Menu
            </span>
          )}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`p-1 rounded transition-colors ${
              isEditMode
                ? 'text-[#d3bb73]'
                : 'text-[#e5e4e2]/40 hover:text-[#e5e4e2]'
            }`}
            title="Dostosuj kolejność menu"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {isEditMode && !sidebarCollapsed && (
          <div className="mb-4 p-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-lg">
            <p className="text-xs text-[#e5e4e2]/80 mb-3">
              Przeciągnij elementy aby zmienić kolejność
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSaveOrder}
                disabled={saving}
                className="flex-1 px-3 py-1.5 bg-[#d3bb73] text-[#1c1f33] text-xs rounded hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="px-3 py-1.5 bg-[#1c1f33] text-[#e5e4e2] text-xs border border-[#d3bb73]/30 rounded hover:bg-[#0f1119] transition-colors disabled:opacity-50"
              >
                Anuluj
              </button>
            </div>
            <button
              onClick={handleResetOrder}
              disabled={saving}
              className="w-full mt-2 flex items-center justify-center gap-2 px-3 py-1.5 text-[#e5e4e2]/60 text-xs hover:text-[#e5e4e2] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              Reset do domyślnej
            </button>
          </div>
        )}

        <ul className="space-y-1">
          {items.map((item, index) => {
            const isActive = pathname === item.href;
            return (
              <li
                key={item.key}
                draggable={isEditMode}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`${
                  isEditMode ? 'cursor-move' : ''
                } ${
                  draggedIndex === index ? 'opacity-50' : ''
                }`}
              >
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center ${
                    sidebarCollapsed ? 'justify-center' : 'gap-3'
                  } px-4 py-3 rounded-lg text-sm font-light transition-all duration-200 relative ${
                    isActive
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
                  } ${isEditMode ? 'pointer-events-none' : ''}`}
                  title={sidebarCollapsed ? item.name : ''}
                >
                  {isEditMode && !sidebarCollapsed && (
                    <GripVertical className="w-4 h-4 text-[#e5e4e2]/40" />
                  )}
                  <div className="relative">
                    <item.icon className="w-5 h-5" />
                    {item.key === 'messages' && unreadMessagesCount > 0 && (
                      <div className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-semibold rounded-full">
                        {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                      </div>
                    )}
                  </div>
                  {!sidebarCollapsed && <span>{item.name}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
