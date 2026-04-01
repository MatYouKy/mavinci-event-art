import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createSupabaseServerClient(cookieStore);
    const body = await request.json();
    const { companyId } = body;

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Company ID is required' },
        { status: 400 }
      );
    }

    const { data: credentials, error } = await supabase
      .from('ksef_credentials')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching KSeF credentials:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch credentials' },
        { status: 500 }
      );
    }

    if (!credentials) {
      return NextResponse.json(
        { success: false, error: 'No credentials found for this company' },
        { status: 404 }
      );
    }

    if (!credentials.authorization_token || !credentials.certificate_key || !credentials.certificate_password) {
      return NextResponse.json(
        {
          success: false,
          error: 'Incomplete credentials. Please provide authorization token, certificate key, and password.'
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Credentials found and valid',
      hasToken: !!credentials.authorization_token,
      hasCertificate: !!credentials.certificate_key,
      hasPassword: !!credentials.certificate_password,
      environment: credentials.environment || 'test'
    });

  } catch (error) {
    console.error('Error in test-connection:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
