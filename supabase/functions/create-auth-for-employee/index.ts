import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

type CallerCheck = { ok: true; userId: string } | { ok: false; status: number; error: string };

/** Zalogowany administrator CRM (ta sama reguła co w bazie: public.current_employee_is_crm_admin()). */
async function requireCrmAdmin(req: Request, supabaseUrl: string): Promise<CallerCheck> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!token || !anonKey) return { ok: false, status: 401, error: 'Brak aktywnej sesji. Zaloguj się ponownie.' };
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return { ok: false, status: 401, error: 'Sesja wygasła. Zaloguj się ponownie.' };
  const { data: isAdmin, error } = await userClient.rpc('current_employee_is_crm_admin');
  if (error || isAdmin !== true) {
    return { ok: false, status: 403, error: 'Dostęp do logowania może nadać tylko administrator.' };
  }
  return { ok: true, userId: userData.user.id };
}

interface CreateAuthRequest {
  employee_id: string;
  email: string;
  temporary_password: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Dostęp do logowania dla pracownika nadaje wyłącznie zalogowany administrator CRM
    // (verify_jwt przepuszcza też publiczny klucz anon).
    const caller = await requireCrmAdmin(req, supabaseUrl);
    if (!caller.ok) {
      return new Response(JSON.stringify({ error: caller.error }), {
        status: caller.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { employee_id, email, temporary_password }: CreateAuthRequest = await req.json();
    if (!employee_id || !email || !temporary_password) {
      return new Response(
        JSON.stringify({ error: 'Wymagane: employee_id, email, temporary_password' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sprawdź czy employee istnieje
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, email, name, surname')
      .eq('id', employee_id)
      .single();

    if (employeeError || !employee) {
      return new Response(
        JSON.stringify({ error: 'Employee not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sprawdź czy użytkownik auth już istnieje
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const userExists = existingUser?.users?.find(u => u.email === email);

    if (userExists) {
      return new Response(
        JSON.stringify({ error: 'Auth user already exists' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Utwórz użytkownika auth z tym samym UUID co employee
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: temporary_password,
      email_confirm: true,
      user_metadata: {
        name: employee.name,
        surname: employee.surname,
        employee_id: employee_id
      }
    });

    if (authError) {
      return new Response(
        JSON.stringify({ error: authError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        auth_user_id: authUser.user?.id,
        employee_id: employee_id,
        email: email,
        message: 'Auth user created successfully. Employee can now login and reset password.'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error creating auth user:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});