import { supabase } from '../lib/supabase';

// Opening a conversation never sends a message on the employee's behalf.
export async function openEventAuthorChat(eventId: string, employeeId: string): Promise<string> {
  const event = await supabase.from('events').select('created_by').eq('id', eventId).maybeSingle();
  if (event.error) throw event.error;
  if (!event.data?.created_by) throw new Error('Nie udało się ustalić autora wydarzenia.');
  const creatorId = event.data.created_by;
  let author = await supabase.from('employees').select('id,is_active').eq('id', creatorId).maybeSingle();
  if (author.error) throw author.error;
  if (!author.data) {
    author = await supabase.from('employees').select('id,is_active').eq('auth_user_id', creatorId).maybeSingle();
    if (author.error) throw author.error;
  }
  if (!author.data?.is_active) throw new Error('Autor wydarzenia nie ma aktywnego konta pracownika.');
  const authorId = author.data.id;
  if (authorId === employeeId) throw new Error('Jesteś autorem tego wydarzenia. Wyznacz kierownika w zakładce Zespół w CRM.');

  const mine = await supabase.from('employee_conversation_participants').select('conversation_id').eq('employee_id', employeeId);
  if (mine.error) throw mine.error;
  const ids = (mine.data || []).map(row => row.conversation_id);
  // Keep requests bounded for employees with a long conversation history.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const conversations = await supabase.from('employee_conversations').select('id')
      .in('id', ids.slice(offset, offset + 100)).eq('is_group', false).order('created_at', { ascending: true });
    if (conversations.error) throw conversations.error;
    if (!conversations.data?.length) continue;
    const participants = await supabase.from('employee_conversation_participants').select('conversation_id,employee_id')
      .in('conversation_id', conversations.data.map(row => row.id));
    if (participants.error) throw participants.error;
    for (const conversation of conversations.data) {
      const members = (participants.data || []).filter(row => row.conversation_id === conversation.id);
      if (members.length === 2 && members.some(row => row.employee_id === employeeId) && members.some(row => row.employee_id === authorId)) return conversation.id;
    }
  }

  const created = await supabase.from('employee_conversations')
    .insert({ title: null, is_group: false, created_by: employeeId }).select('id').single();
  if (created.error) throw created.error;
  if (!created.data) throw new Error('Nie udało się utworzyć rozmowy.');
  const added = await supabase.from('employee_conversation_participants').insert([
    { conversation_id: created.data.id, employee_id: employeeId },
    { conversation_id: created.data.id, employee_id: authorId },
  ]);
  if (added.error) {
    // Only the empty conversation created by this attempt is eligible for cleanup.
    await supabase.from('employee_conversations').delete().eq('id', created.data.id).eq('created_by', employeeId);
    throw new Error('Nie udało się dodać uczestników rozmowy. Spróbuj ponownie.');
  }
  return created.data.id;
}
