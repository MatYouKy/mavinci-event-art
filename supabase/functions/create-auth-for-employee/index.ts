import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { employee_id, email, temporary_password }: CreateAuthRequest = await req.json();

    // Sprawdź czy employee istnieje
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('id, email, name, surname')
      .eq('id', employee_id)
      .single();

    if (employeeError || !employee) {
      return new Response(JSON.stringify({ error: 'Employee not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sprawdź czy użytkownik auth już istnieje
    const { data: existingUser } = await supabase.auth.admin.listUsers();
    const userExists = existingUser?.users?.find((u) => u.email === email);

    if (userExists) {
      return new Response(
        JSON.stringify({ error: 'Auth user already exists', user_id: userExists.id }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
        employee_id: employee_id,
      },
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        auth_user_id: authUser.user?.id,
        employee_id: employee_id,
        email: email,
        message: 'Auth user created successfully. Employee can now login and reset password.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error creating auth user:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
