import { supabase } from '@/lib/supabase/browser';

export const fetchAuditLog = async (eventId: string) => {
  try {
    const { data, error } = await supabase
      .from('event_audit_log')
      .select(
        `
        *,
        employee:employees!event_audit_log_user_id_fkey(
          id,
          name,
          surname,
          nickname,
          avatar_url,
          avatar_metadata,
          occupation,
          email
        )
      `,
      )
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data;
    } else if (error) {
      console.error('Error fetching audit log:', error);
      return null;
    }
  } catch (err) {
    console.error('Error fetching audit log:', err);
    return null;
  }
};
