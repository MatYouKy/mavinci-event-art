import { supabase } from '../lib/supabase';

export async function getOrCreateDirectConversation(
  currentEmployeeId: string,
  targetEmployeeId: string,
): Promise<string> {
  if (!currentEmployeeId || !targetEmployeeId || currentEmployeeId === targetEmployeeId) {
    throw new Error('Nie można rozpocząć tej rozmowy.');
  }

  const { data: myParticipations, error: myParticipationsError } = await supabase
    .from('employee_conversation_participants')
    .select('conversation_id')
    .eq('employee_id', currentEmployeeId);

  if (myParticipationsError) throw myParticipationsError;

  const myConversationIds = (myParticipations || []).map((item) => item.conversation_id);

  if (myConversationIds.length > 0) {
    const { data: commonParticipations, error: commonParticipationsError } = await supabase
      .from('employee_conversation_participants')
      .select('conversation_id')
      .eq('employee_id', targetEmployeeId)
      .in('conversation_id', myConversationIds);

    if (commonParticipationsError) throw commonParticipationsError;

    const commonConversationIds = (commonParticipations || []).map((item) => item.conversation_id);

    if (commonConversationIds.length > 0) {
      const { data: existingConversation, error: existingConversationError } = await supabase
        .from('employee_conversations')
        .select('id')
        .in('id', commonConversationIds)
        .eq('is_group', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existingConversationError) throw existingConversationError;
      if (existingConversation?.id) return existingConversation.id;
    }
  }

  const { data: conversation, error: conversationError } = await supabase
    .from('employee_conversations')
    .insert({
      title: null,
      is_group: false,
      created_by: currentEmployeeId,
    })
    .select('id')
    .single();

  if (conversationError || !conversation) {
    throw conversationError || new Error('Nie udało się utworzyć rozmowy.');
  }

  const { error: participantsError } = await supabase
    .from('employee_conversation_participants')
    .insert([
      { conversation_id: conversation.id, employee_id: currentEmployeeId },
      { conversation_id: conversation.id, employee_id: targetEmployeeId },
    ]);

  if (participantsError) {
    await supabase.from('employee_conversations').delete().eq('id', conversation.id);
    throw participantsError;
  }

  return conversation.id;
}
