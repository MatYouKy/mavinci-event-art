'use client';

import { useState, useEffect, DragEvent } from 'react';
import Link from 'next/link';
import { GripVertical, RotateCcw, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
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
  initialUnreadMessagesCount: number;
  pathname: string;
  sidebarCollapsed: boolean;
  employeeId: string | null;
  onClose?: () => void;
  onOrderChange: (newOrder: NavigationItem[]) => void;
}

export default function NavigationManager({
  navigation,
  initialUnreadMessagesCount,
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
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(initialUnreadMessagesCount);

  useEffect(() => {
    setItems(navigation);
    setUnreadMessagesCount(initialUnreadMessagesCount);
  }, [navigation, initialUnreadMessagesCount]);

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
          showSnackbar(
            `Nowa wiadomość z formularza: ${newMessage.subject || 'Wiadomość z formularza'}`,
            'info',
          );
          fetchUnreadCount();
        },
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
        },
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
        },
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
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(contactChannel);
      supabase.removeChannel(receivedChannel);
    };
  }, [showSnackbar]);

  const fetchUnreadCount = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
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
      const order = items.map((item) => item.key);

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
        <div className="mb-4 flex items-center justify-between">
          {!sidebarCollapsed && (
            <span className="text-xs uppercase tracking-wider text-[#e5e4e2]/40">Menu</span>
          )}
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            className={`rounded p-1 transition-colors ${
              isEditMode ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40 hover:text-[#e5e4e2]'
            }`}
            title="Dostosuj kolejność menu"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {isEditMode && !sidebarCollapsed && (
          <div className="mb-4 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-3">
            <p className="mb-3 text-xs text-[#e5e4e2]/80">
              Przeciągnij elementy aby zmienić kolejność
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleSaveOrder}
                disabled={saving}
                className="flex-1 rounded bg-[#d3bb73] px-3 py-1.5 text-xs text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-1.5 text-xs text-[#e5e4e2] transition-colors hover:bg-[#0f1119] disabled:opacity-50"
              >
                Anuluj
              </button>
            </div>
            <button
              onClick={handleResetOrder}
              disabled={saving}
              className="mt-2 flex w-full items-center justify-center gap-2 px-3 py-1.5 text-xs text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2] disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
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
                className={`${isEditMode ? 'cursor-move' : ''} ${
                  draggedIndex === index ? 'opacity-50' : ''
                }`}
              >
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center ${
                    sidebarCollapsed ? 'justify-center' : 'gap-3'
                  } relative rounded-lg px-4 py-3 text-sm font-light transition-all duration-200 ${
                    isActive
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]'
                  } ${isEditMode ? 'pointer-events-none' : ''}`}
                  title={sidebarCollapsed ? item.name : ''}
                >
                  {isEditMode && !sidebarCollapsed && (
                    <GripVertical className="h-4 w-4 text-[#e5e4e2]/40" />
                  )}
                  <div className="relative">
                    <item.icon className="h-5 w-5" />
                    {item.key === 'messages' && unreadMessagesCount > 0 && (
                      <div className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
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
