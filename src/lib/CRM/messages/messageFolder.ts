import type { MessageFolder, MessageListItem } from '@/store/api/messagesApi';
export function messageMatchesFolder(m: MessageListItem, account: string, folder: MessageFolder) {
  if (account === 'contact_form' && m.type !== 'contact_form') return false;
  if (account !== 'all' && account !== 'contact_form' && m.email_account_id !== account) return false;
  if (folder === 'trash') return Boolean(m.isDeleted);
  if (m.isDeleted) return false;
  if (folder === 'all') return true;
  return m.type === (folder === 'drafts' ? 'draft' : folder);
}
