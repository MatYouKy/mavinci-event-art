import { supabase } from '@/lib/supabase';
import { fetchAuditLog } from './fetchAuditLog';

export  const logChange = async (
  eventId: string,
  action: string,
  description: string,
  fieldName?: string,
  oldValue?: string,
  newValue?: string,
) => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const { data: employee } = await supabase
      .from('employees')
      .select('id, name, surname, nickname')
      .eq('id', session.user.id)
      .single();

    if (!employee) {
      console.warn('Employee not found for user:', session.user.id);
      return;
    }

    await supabase.from('event_audit_log').insert([
      {
        event_id: eventId,
        user_id: employee.id,
        user_name: employee.nickname || `${employee.name} ${employee.surname}`,
        action,
        field_name: fieldName,
        old_value: oldValue,
        new_value: newValue,
        description,
      },
    ]);

      return await fetchAuditLog(eventId);
  } catch (err) {
    console.error('Error logging change:', err);
    return null;
  }
};