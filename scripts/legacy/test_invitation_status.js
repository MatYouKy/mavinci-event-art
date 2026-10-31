require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testInvitationToken() {
  const token = 'PBZmYKHLVl01pdqLnfDxleLDGkFyt8aw';
  
  console.log('Sprawdzam token:', token);
  
  const { data, error } = await supabase
    .from('employee_assignments')
    .select(`
      id,
      status,
      invitation_expires_at,
      employee_id,
      event_id,
      employees!employee_assignments_employee_id_fkey(id, name, surname, email),
      events(id, name, created_by)
    `)
    .eq('invitation_token', token)
    .maybeSingle();
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  if (!data) {
    console.log('Nie znaleziono zaproszenia z tym tokenem');
    return;
  }
  
  console.log('Znaleziono zaproszenie:');
  console.log('ID:', data.id);
  console.log('Status:', data.status);
  console.log('Wygasa:', data.invitation_expires_at);
  console.log('Employee:', data.employees);
  console.log('Event:', data.events);
  console.log('Event created_by:', data.events?.created_by);
}

testInvitationToken().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
