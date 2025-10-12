import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface CreateEmployeeRequest {
  email: string;
  password: string;
  name: string;
  surname: string;
  nickname?: string;
  phone_number?: string;
  role?: string;
  access_level?: string;
  occupation?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    // Get Supabase URL from environment
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Create admin client with service role key
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Parse request body
    const body: CreateEmployeeRequest = await req.json();

    // Validate required fields
    if (!body.email || !body.password || !body.name || !body.surname) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: email, password, name, surname' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 1: Create auth user using Admin API
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        name: body.name,
        surname: body.surname,
      },
    });

    if (authError) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: `Failed to create auth user: ${authError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!authData.user) {
      return new Response(
        JSON.stringify({ error: 'No user returned from auth' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 2: Insert employee data
    const employeeData = {
      id: authData.user.id,
      email: body.email,
      name: body.name,
      surname: body.surname,
      nickname: body.nickname || null,
      phone_number: body.phone_number || null,
      role: body.role || 'unassigned',
      access_level: body.access_level || 'unassigned',
      occupation: body.occupation || null,
      is_active: true,
      show_on_website: false,
    };

    const { error: employeeError } = await supabaseAdmin
      .from('employees')
      .insert([employeeData]);

    if (employeeError) {
      console.error('Employee insert error:', employeeError);
      // Try to delete the auth user if employee insert failed
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return new Response(
        JSON.stringify({ error: `Failed to create employee: ${employeeError.message}` }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Success
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: authData.user.id,
          email: body.email,
          name: body.name,
          surname: body.surname,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
