export type MessageListItem = {
  id: string;
  type: 'contact_form' | 'sent' | 'received';
  from: string;
  subject: string;
  preview: string;
  date: string;

  // te pola MUSZĄ istnieć w liście:
  is_read: boolean;
  is_starred: boolean;

  assigned_to?: string | null;
  assigned_employee?: { name: string; surname: string } | null;
};