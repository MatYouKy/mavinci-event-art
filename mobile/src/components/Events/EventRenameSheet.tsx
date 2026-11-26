import React, { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Label, NoticeScope, Sheet, SheetActions, kit, useNotice } from '../Inquiries/InquiryKit';
import { supabase } from '../../lib/supabase';
import { colors } from '../../theme';

/*
 * Zmiana nazwy eventu w telefonie — jak „Edytuj” na karcie eventu w CRM (`EventRenameModal`) i na Macu (`EventEditSheet`):
 * zapisuje wyłącznie nazwę, więc nie nadpisuje terminu, lokalizacji, klienta, kategorii ani statusu.
 */

const MAX_LENGTH = 500;

export default function EventRenameSheet({ visible, eventId, name, onClose, onRenamed }: {
  visible: boolean;
  eventId: string;
  name: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const notice = useNotice();
  const [value, setValue] = useState(name);

  useEffect(() => {
    if (visible) setValue(name);
  }, [visible, name]);

  const trimmed = value.trim();

  const save = async () => {
    if (notice.busy) return;
    if (!trimmed) {
      notice.notify('Nazwa eventu jest wymagana', true);
      return;
    }
    if (trimmed === name.trim()) {
      onClose();
      return;
    }
    const saved = await notice.run('Zapisywanie nazwy…', async () => {
      const { data, error } = await supabase.from('events').update({ name: trimmed }).eq('id', eventId).select('id');
      if (error) throw new Error(error.message || 'Nie udało się zmienić nazwy eventu.');
      if (!data?.length) throw new Error('Nie masz uprawnień do zmiany nazwy tego eventu.');
      return trimmed;
    }, 'Nazwa eventu zmieniona');
    if (saved) onRenamed(saved);
  };

  return (
    <NoticeScope value={notice.scope}>
      <Sheet visible={visible} title="Zmień nazwę eventu" onClose={onClose}
        footer={<SheetActions onCancel={onClose} onConfirm={() => { void save(); }} label="Zapisz nazwę" saving={!!notice.busy} disabled={!trimmed} />}>
        <Label>Nazwa eventu</Label>
        <TextInput value={value} onChangeText={setValue} style={kit.input} maxLength={MAX_LENGTH} autoFocus selectTextOnFocus
          placeholder="np. Studniówka 2027 LO II" placeholderTextColor={colors.text.tertiary} returnKeyType="done"
          onSubmitEditing={() => { void save(); }} />
        <Text style={kit.muted}>Zmienia się tylko nazwa — pozostałe dane eventu zostają bez zmian.</Text>
      </Sheet>
      {notice.overlay}
    </NoticeScope>
  );
}
